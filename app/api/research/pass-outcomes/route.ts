import { createTursoClient } from "../../../../src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "pass-outcomes-827";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) return Response.json({ ok:false }, { status:401 });
  const c = await createTursoClient();
  try {
    const r = await c.execute(`
      SELECT c.id,c.symbol,d.round_trip_loss_pct,
        p10.price p10,p15.price p15,p30.price p30,p60.price p60,
        p10.liquidity_usd l10,p15.liquidity_usd l15,p30.liquidity_usd l30,p60.liquidity_usd l60,
        p10.captured_at t10,p15.captured_at t15,p30.captured_at t30,p60.captured_at t60
      FROM solana_validated_cases c
      JOIN solana_validated_decisions d ON d.case_id=c.id AND d.status='PASS'
      JOIN solana_validated_snapshots p10 ON p10.case_id=c.id AND p10.stage='PLUS_10'
      LEFT JOIN solana_validated_snapshots p15 ON p15.case_id=c.id AND p15.stage='PLUS_15'
      LEFT JOIN solana_validated_snapshots p30 ON p30.case_id=c.id AND p30.stage='PLUS_30'
      LEFT JOIN solana_validated_snapshots p60 ON p60.case_id=c.id AND p60.stage='PLUS_60'
      ORDER BY d.decided_at DESC
    `);
    const pct=(a:any,b:any)=>a==null||b==null||Number(a)<=0?null:(Number(b)/Number(a)-1)*100;
    const rows=r.rows.map(x=>({id:Number(x.id),symbol:String(x.symbol??''),rt:Number(x.round_trip_loss_pct),r15:pct(x.p10,x.p15),r30:pct(x.p10,x.p30),r60:pct(x.p10,x.p60),liq15:pct(x.l10,x.l15),liq30:pct(x.l10,x.l30),liq60:pct(x.l10,x.l60),dt15:x.t15==null?null:(Number(x.t15)-Number(x.t10))/60000,dt30:x.t30==null?null:(Number(x.t30)-Number(x.t10))/60000,dt60:x.t60==null?null:(Number(x.t60)-Number(x.t10))/60000}));
    return Response.json({ok:true,count:rows.length,rows});
  } finally { c.close(); }
}
