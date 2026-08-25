import type { Client, Row } from "@libsql/client";
import { createTursoClient } from "../db/client";
import { getPushSubscriptions } from "../db/repositories/push";
import { evaluateRadar24 } from "../decisions/engine";
import { validateJupiterExecution } from "../push/executionGate";
import { createWebPushSender } from "../push/webpush";
import type { PushPayload } from "../push/types";

const NETWORK = "solana";
const RADAR_VERSION = "2.4-solana-post-validation";
const MIN_POOL_AGE_MS = 15 * 60_000;
const MAX_POOL_AGE_MS = 60 * 60_000;
const MIN_ENTRY_LIQUIDITY_USD = 25_000;
const MAX_NEW_CASES_PER_RUN = 10;
const MAX_ROUND_TRIP_LOSS_PCT = 3;
const STAGES = [["PLUS_5",5],["PLUS_10",10],["PLUS_15",15],["PLUS_30",30],["PLUS_60",60]] as const;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD7hJcUAPXnY8W3K2p5uX3";
const MAJOR_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

type Pool = { poolAddress:string; mint:string; symbol:string|null; createdAt:number; price:number; liquidityUsd:number|null; volumeH1Usd:number|null; buysH1:number; sellsH1:number };
type CaseRow = { id:number; poolAddress:string; mint:string; symbol:string|null; firstSeenAt:number; entryPrice:number; entryLiquidityUsd:number };

function n(v:unknown):number|null { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : null; }
function relationAddress(resource:any, key:"base_token"|"quote_token"):string|null {
  const id = resource?.relationships?.[key]?.data?.id;
  if (typeof id !== "string") return null;
  return id.replace(/^solana_/, "");
}
function parsePool(resource:any):Pool|null {
  const a = resource?.attributes ?? {};
  const base = relationAddress(resource,"base_token");
  const quote = relationAddress(resource,"quote_token");
  if (!base || !quote) return null;
  const targetIsQuote = MAJOR_MINTS.has(base) && !MAJOR_MINTS.has(quote);
  const mint = targetIsQuote ? quote : base;
  if (MAJOR_MINTS.has(mint)) return null;
  const price = n(targetIsQuote ? a.quote_token_price_usd : a.base_token_price_usd);
  const createdAt = Date.parse(String(a.pool_created_at ?? ""));
  const poolAddress = typeof a.address === "string" ? a.address : String(resource?.id ?? "").replace(/^solana_/,"");
  if (!poolAddress || !Number.isFinite(createdAt) || price == null || price <= 0) return null;
  const tx = a.transactions?.h1 ?? {};
  const rawName = typeof a.name === "string" ? a.name : null;
  const parts = rawName?.split("/").map((x:string)=>x.trim()) ?? [];
  return { poolAddress, mint, symbol: targetIsQuote ? (parts[1] ?? null) : (parts[0] ?? null), createdAt, price, liquidityUsd:n(a.reserve_in_usd), volumeH1Usd:n(a.volume_usd?.h1), buysH1:Number(tx.buys ?? 0)||0, sellsH1:Number(tx.sells ?? 0)||0 };
}
async function getJson(url:string):Promise<any> { const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)}); if(!r.ok) throw new Error(`GeckoTerminal ${r.status}`); return r.json(); }
async function discover():Promise<Pool[]> { const j=await getJson(`https://api.geckoterminal.com/api/v2/networks/${NETWORK}/new_pools?page=1`); return Array.isArray(j?.data)?j.data.map(parsePool).filter(Boolean):[]; }
async function fetchPools(addresses:string[]):Promise<Map<string,Pool>> { if(!addresses.length)return new Map(); const j=await getJson(`https://api.geckoterminal.com/api/v2/networks/${NETWORK}/pools/multi/${addresses.map(encodeURIComponent).join(",")}`); const p:Pool[]=Array.isArray(j?.data)?j.data.map(parsePool).filter(Boolean):[]; return new Map(p.map(x=>[x.poolAddress.toLowerCase(),x])); }

async function ensureSchema(c:Client){ await c.batch([
`CREATE TABLE IF NOT EXISTS solana_validated_cases (id INTEGER PRIMARY KEY AUTOINCREMENT,pool_address TEXT NOT NULL UNIQUE,mint TEXT NOT NULL,symbol TEXT,first_seen_at INTEGER NOT NULL,entry_price REAL NOT NULL,entry_liquidity_usd REAL NOT NULL,entry_volume_h1_usd REAL,entry_buys_h1 INTEGER NOT NULL,entry_sells_h1 INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE')`,
`CREATE TABLE IF NOT EXISTS solana_validated_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,case_id INTEGER NOT NULL REFERENCES solana_validated_cases(id) ON DELETE CASCADE,stage TEXT NOT NULL,captured_at INTEGER NOT NULL,price REAL NOT NULL,liquidity_usd REAL,UNIQUE(case_id,stage))`,
`CREATE TABLE IF NOT EXISTS solana_validated_decisions (case_id INTEGER PRIMARY KEY REFERENCES solana_validated_cases(id) ON DELETE CASCADE,decided_at INTEGER NOT NULL,status TEXT NOT NULL,reject_reason TEXT,plus5_roi_pct REAL,plus10_roi_pct REAL,momentum_5_to_10_pct REAL,plus10_liquidity_usd REAL,execution_status TEXT,round_trip_loss_pct REAL,radar_version TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS solana_validated_push_deliveries (case_id INTEGER PRIMARY KEY REFERENCES solana_validated_cases(id) ON DELETE CASCADE,sent_at INTEGER NOT NULL)`],"write"); }
function eligible(p:Pool,now:number){ const age=now-p.createdAt; return age>=MIN_POOL_AGE_MS&&age<=MAX_POOL_AGE_MS&&(p.liquidityUsd??0)>=MIN_ENTRY_LIQUIDITY_USD&&(p.volumeH1Usd??0)>0&&(p.buysH1+p.sellsH1)>0; }
async function admit(c:Client,now:number){ const pools=(await discover()).filter(p=>eligible(p,now)).sort((a,b)=>b.createdAt-a.createdAt); let admitted=0; for(const p of pools.slice(0,MAX_NEW_CASES_PER_RUN)){ const r=await c.execute({sql:`INSERT INTO solana_validated_cases(pool_address,mint,symbol,first_seen_at,entry_price,entry_liquidity_usd,entry_volume_h1_usd,entry_buys_h1,entry_sells_h1) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(pool_address) DO NOTHING RETURNING id`,args:[p.poolAddress,p.mint,p.symbol,now,p.price,p.liquidityUsd!,p.volumeH1Usd,p.buysH1,p.sellsH1]}); if(!r.rows.length)continue; const id=Number(r.rows[0]?.id); await c.execute({sql:`INSERT INTO solana_validated_snapshots(case_id,stage,captured_at,price,liquidity_usd) VALUES(?, 'INITIAL', ?, ?, ?)`,args:[id,now,p.price,p.liquidityUsd]}); admitted++; } return {offered:pools.length,admitted}; }
function mapCase(r:Row):CaseRow { return {id:Number(r.id),poolAddress:String(r.pool_address),mint:String(r.mint),symbol:r.symbol==null?null:String(r.symbol),firstSeenAt:Number(r.first_seen_at),entryPrice:Number(r.entry_price),entryLiquidityUsd:Number(r.entry_liquidity_usd)}; }
async function active(c:Client){ const r=await c.execute("SELECT * FROM solana_validated_cases WHERE status='ACTIVE' ORDER BY first_seen_at ASC LIMIT 200"); return r.rows.map(mapCase); }
async function snapshot(c:Client,row:CaseRow,p:Pool,now:number){ const age=(now-row.firstSeenAt)/60000; for(const [stage,due] of STAGES){ if(age<due)continue; await c.execute({sql:`INSERT OR IGNORE INTO solana_validated_snapshots(case_id,stage,captured_at,price,liquidity_usd) VALUES(?,?,?,?,?)`,args:[row.id,stage,now,p.price,p.liquidityUsd]}); } if(age>=60) await c.execute({sql:"UPDATE solana_validated_cases SET status='CLOSED' WHERE id=?",args:[row.id]}); }
async function decide(c:Client,row:CaseRow){ const ex=await c.execute({sql:"SELECT 1 FROM solana_validated_decisions WHERE case_id=?",args:[row.id]}); if(ex.rows.length)return null; const r=await c.execute({sql:"SELECT * FROM solana_validated_snapshots WHERE case_id=? AND stage IN ('INITIAL','PLUS_5','PLUS_10')",args:[row.id]}); const m=new Map(r.rows.map(x=>[String(x.stage),x])); const i=m.get("INITIAL"),p5=m.get("PLUS_5"),p10=m.get("PLUS_10"); if(!i||!p5||!p10)return null;
 const d=evaluateRadar24({tokenCaseId:row.id,decisionStage:"PLUS_10",decidedAt:Number(p10.captured_at),radarVersion:RADAR_VERSION,entry:{entryPrice:row.entryPrice,entryValid:true},snapshots:{INITIAL:{stage:"INITIAL",capturedAt:Number(i.captured_at),price:Number(i.price),marketCap:null,liquidityUsd:n(i.liquidity_usd)},PLUS_5:{stage:"PLUS_5",capturedAt:Number(p5.captured_at),price:Number(p5.price),marketCap:null,liquidityUsd:n(p5.liquidity_usd)},PLUS_10:{stage:"PLUS_10",capturedAt:Number(p10.captured_at),price:Number(p10.price),marketCap:null,liquidityUsd:n(p10.liquidity_usd)}}});
 let status=d.decisionStatus; let reason=d.rejectReason; let executionStatus:string|null=null; let loss:number|null=null;
 if(status==="PASS"){ const e=await validateJupiterExecution(row.mint); executionStatus=e.status; loss=e.roundTripLossPct; if(e.status!=="EXECUTION_PASS"){status="REJECT";reason=e.reason??"EXECUTION_FAIL";} else if(loss==null||loss>MAX_ROUND_TRIP_LOSS_PCT){status="REJECT";reason="EXECUTION_FAIL_ROUND_TRIP_LOSS_GT_3PCT";} }
 await c.execute({sql:`INSERT INTO solana_validated_decisions(case_id,decided_at,status,reject_reason,plus5_roi_pct,plus10_roi_pct,momentum_5_to_10_pct,plus10_liquidity_usd,execution_status,round_trip_loss_pct,radar_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[row.id,Number(p10.captured_at),status,reason,d.plus5RoiPct,d.plus10RoiPct,d.momentum5To10Pct,n(p10.liquidity_usd),executionStatus,loss,RADAR_VERSION]});
 if(status!=="PASS")return {status,pushed:false}; const claim=await c.execute({sql:"INSERT OR IGNORE INTO solana_validated_push_deliveries(case_id,sent_at) VALUES(?,?)",args:[row.id,Date.now()]}); if(!claim.rowsAffected)return {status,pushed:false}; const send=createWebPushSender({getSubscriptions:()=>getPushSubscriptions(c)}); const payload:PushPayload={title:"🚀 Solana Radar · Validated",body:`${row.symbol??"SOL token"} | +10 ${d.plus10RoiPct?.toFixed(1)??"?"}% | RT loss ${loss?.toFixed(2)??"?"}%`,url:`/solana-cases/${row.id}`,mint:row.mint,decisionId:row.id,tokenCaseId:row.id,decisionStatus:"PASS",decisionStage:"PLUS_10",plus10RoiPct:d.plus10RoiPct,momentum5To10Pct:d.momentum5To10Pct,symbol:row.symbol}; await send(payload); return {status,pushed:true}; }

export async function runSolanaValidatedRadar(){ const c=await createTursoClient(); const now=Date.now(); await ensureSchema(c); const discovery=await admit(c,now); const rows=await active(c); let decisions=0,passes=0,pushes=0; const errors:any[]=[]; for(let o=0;o<rows.length;o+=30){ try{const pools=await fetchPools(rows.slice(o,o+30).map(x=>x.poolAddress)); for(const row of rows.slice(o,o+30)){const p=pools.get(row.poolAddress.toLowerCase()); if(!p)continue; try{await snapshot(c,row,p,now); const out=await decide(c,row); if(out){decisions++;if(out.status==="PASS")passes++;if(out.pushed)pushes++;}}catch(e){errors.push({caseId:row.id,message:e instanceof Error?e.message:String(e)});}}}catch(e){errors.push({caseId:null,message:e instanceof Error?e.message:String(e)});} }
 const counts=await c.execute("SELECT COUNT(*) cases,SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) active FROM solana_validated_cases"); const summary={mode:"SOLANA_POST_VALIDATION",admission:{minPoolAgeMinutes:15,maxPoolAgeMinutes:60,minEntryLiquidityUsd:25000},decision:{plus10RoiMinPct:25,momentum5To10MinPct:0,jupiterRoundTripRequired:true,maxRoundTripLossPct:3},...discovery,decisionsCreated:decisions,passesCreated:passes,pushesSent:pushes,totals:{cases:Number(counts.rows[0]?.cases??0),active:Number(counts.rows[0]?.active??0)},errors}; console.info("[solana-validated] cron finished",summary); c.close(); return summary; }
export async function handleSolanaValidatedCron(request:Request){ const secret=process.env.CRON_SECRET; if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`) return Response.json({ok:false,error:"Unauthorized"},{status:401}); try{return Response.json({ok:true,...await runSolanaValidatedRadar()});}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});} }
