import { createTursoClient } from "../../src/db/client";
import { PushSettings } from "../../components/push-settings";
import { RadarRefreshBar } from "../../components/radar-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row={id:number;symbol:string;name:string;venueSymbol:string;venueName:string;entryAt:number;marketCap:number;volume:number;ratio:number;h1:number|null;h24:number|null;d7:number|null;confirm:number|null;spread:number|null;decision:string|null;reason:string|null};

async function loadRows():Promise<{rows:Row[];error:string|null}>{
  const c=await createTursoClient();
  try{
    const r=await c.execute(`SELECT c.id,c.symbol,c.name,c.venue_symbol,COALESCE(c.venue_name,c.venue_symbol) venue_name,c.entry_at,c.market_cap_usd,c.volume_24h_usd,c.volume_cap_ratio,c.change_1h_pct,c.change_24h_pct,c.change_7d_pct,d.confirm_roi_pct,d.spread_pct,d.status decision,d.reject_reason FROM microcap_cases c LEFT JOIN microcap_decisions d ON d.case_id=c.id ORDER BY CASE WHEN d.status='PASS' THEN 0 WHEN d.status='REJECT' THEN 1 ELSE 2 END,COALESCE(d.decided_at,c.entry_at) DESC LIMIT 200`);
    return{rows:r.rows.map(x=>({id:Number(x.id),symbol:String(x.symbol),name:String(x.name),venueSymbol:String(x.venue_symbol),venueName:String(x.venue_name),entryAt:Number(x.entry_at),marketCap:Number(x.market_cap_usd),volume:Number(x.volume_24h_usd),ratio:Number(x.volume_cap_ratio),h1:x.change_1h_pct==null?null:Number(x.change_1h_pct),h24:x.change_24h_pct==null?null:Number(x.change_24h_pct),d7:x.change_7d_pct==null?null:Number(x.change_7d_pct),confirm:x.confirm_roi_pct==null?null:Number(x.confirm_roi_pct),spread:x.spread_pct==null?null:Number(x.spread_pct),decision:x.decision==null?null:String(x.decision),reason:x.reject_reason==null?null:String(x.reject_reason)})),error:null};
  }catch(e){const m=e instanceof Error?e.message:String(e);if(m.includes("no such table: microcap_cases"))return{rows:[],error:null};return{rows:[],error:m};}finally{c.close();}
}
function pct(v:number|null){return v==null?"—":`${v>=0?"+":""}${v.toFixed(1)}%`;}
function usd(v:number){return `$${Math.round(v).toLocaleString()}`;}

export default async function RadarPage(){
  const fetchedAt=Date.now();const{rows,error}=await loadRows();const pass=rows.filter(x=>x.decision==="PASS").length;const pending=rows.filter(x=>x.decision==null).length;
  return <main style={{padding:"1.5rem",fontFamily:"system-ui, sans-serif",maxWidth:1450,margin:"0 auto"}}>
    <header><p style={{margin:0,color:"#666",fontSize:"0.85rem"}}>Moonshot Radar · Established Micro-Cap Research</p><h1 style={{margin:"0.25rem 0"}}>Established Micro-Cap Momentum Radar</h1><p style={{margin:"0.25rem 0",color:"#555"}}>Geen newborns. Alleen bewezen microcaps met een aantoonbaar liquide markt: Coinbase spot of een gevestigde Solana DEX-pool.</p><p style={{margin:"0.25rem 0",color:"#555",fontSize:"0.9rem"}}>Basisgates blijven gelijk: 7+ dagen historie, $8–300m market cap, ≥$2m 24u volume, volume/cap ≥8% en +3% tot +35% 24u momentum. CEX vereist ≤0,75% spread. DEX vereist daarnaast ≥$500k poolliquiditeit, ≥$2m poolvolume én een Jupiter buy/sell round-trip met ≤0,75% verlies. Na 15 minuten moet koersmomentum nog minimaal +2% doorzetten voor PASS + push.</p><RadarRefreshBar fetchedAt={fetchedAt}/></header>
    <PushSettings/>
    <section style={{display:"flex",gap:"1rem",flexWrap:"wrap",margin:"1rem 0"}}><strong>{rows.length} cases</strong><span>{pass} confirmed PASS</span><span>{pending} awaiting +15</span></section>
    {error?<p role="alert">Turso error: {error}</p>:<div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%",fontSize:"0.88rem"}}><thead><tr>{["Coin","Venue","Entry","MCap","24h vol","Vol/Cap","1h","24h","7d","+15","Cost/Spread","Decision"].map(h=><th key={h} style={{textAlign:"left",padding:"0.5rem",borderBottom:"1px solid #ddd"}}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}><strong>{r.symbol}</strong><br/><span style={{color:"#666"}}>{r.name}</span></td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{r.venueName}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{new Date(r.entryAt).toLocaleString()}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{usd(r.marketCap)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{usd(r.volume)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{(r.ratio*100).toFixed(1)}%</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{pct(r.h1)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{pct(r.h24)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{pct(r.d7)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{pct(r.confirm)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{r.spread==null?"—":`${r.spread.toFixed(3)}%`}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}} title={r.reason??undefined}>{r.decision??"PENDING"}</td></tr>)}</tbody></table></div>}
  </main>;
}
