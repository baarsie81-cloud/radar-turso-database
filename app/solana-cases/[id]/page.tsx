import Link from "next/link";
import { notFound } from "next/navigation";
import { createTursoClient } from "../../../src/db/client";
import { MintAddressField } from "../../../components/mint-address-field";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SolanaCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caseId = Number(id);
  if (!Number.isInteger(caseId) || caseId <= 0) notFound();

  const client = await createTursoClient();
  try {
    const c = await client.execute({ sql: `SELECT c.*, d.status AS decision, d.reject_reason, d.plus5_roi_pct, d.plus10_roi_pct,
      d.momentum_5_to_10_pct, d.plus10_liquidity_usd, d.execution_status, d.round_trip_loss_pct, d.radar_version
      FROM solana_validated_cases c LEFT JOIN solana_validated_decisions d ON d.case_id=c.id WHERE c.id=?`, args: [caseId] });
    if (!c.rows.length) notFound();
    const row = c.rows[0];
    const snaps = await client.execute({ sql: "SELECT stage,captured_at,price,liquidity_usd FROM solana_validated_snapshots WHERE case_id=? ORDER BY captured_at ASC", args: [caseId] });

    return <main style={{padding:"1.5rem",fontFamily:"system-ui, sans-serif",maxWidth:1000,margin:"0 auto"}}>
      <Link href="/radar">← Radar</Link>
      <p style={{color:"#666",fontSize:"0.85rem",marginTop:"1rem"}}>Solana · Post-Validation</p>
      <h1>{row.symbol == null ? `Case ${caseId}` : String(row.symbol)}</h1>
      <h2 style={{fontSize:"1rem"}}>Mint</h2>
      <MintAddressField mint={String(row.mint)} />

      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:"0.75rem",margin:"1.5rem 0"}}>
        <div><strong>Entry liquidity</strong><br/>${Math.round(Number(row.entry_liquidity_usd)).toLocaleString()}</div>
        <div><strong>First seen</strong><br/>{new Date(Number(row.first_seen_at)).toLocaleString()}</div>
        <div><strong>Decision</strong><br/>{row.decision == null ? "PENDING" : String(row.decision)}</div>
        <div><strong>Jupiter</strong><br/>{row.execution_status == null ? "—" : String(row.execution_status)}</div>
        <div><strong>RT loss</strong><br/>{row.round_trip_loss_pct == null ? "—" : `${Number(row.round_trip_loss_pct).toFixed(2)}%`}</div>
        <div><strong>Reason</strong><br/>{row.reject_reason == null ? "—" : String(row.reject_reason)}</div>
      </section>

      <h2>Snapshots</h2>
      <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%"}}><thead><tr>{["Stage","Captured","Price","Liquidity"].map(h=><th key={h} style={{textAlign:"left",padding:"0.5rem",borderBottom:"1px solid #ddd"}}>{h}</th>)}</tr></thead><tbody>
        {snaps.rows.map((s:any)=><tr key={String(s.stage)}><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{String(s.stage)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{new Date(Number(s.captured_at)).toLocaleString()}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{Number(s.price).toPrecision(6)}</td><td style={{padding:"0.5rem",borderBottom:"1px solid #eee"}}>{s.liquidity_usd==null?"—":`$${Math.round(Number(s.liquidity_usd)).toLocaleString()}`}</td></tr>)}
      </tbody></table></div>
    </main>;
  } finally {
    client.close();
  }
}
