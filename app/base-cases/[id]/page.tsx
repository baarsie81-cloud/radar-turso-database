import Link from "next/link";
import { createTursoClient } from "../../../src/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

function pct(value: unknown): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "—";
}

export default async function BaseCasePage({ params }: Props) {
  const { id } = await params;
  const caseId = Number(id);
  const client = await createTursoClient();
  try {
    const caseResult = await client.execute({
      sql: `SELECT c.*, d.status AS decision, d.reject_reason, d.plus5_roi_pct, d.plus10_roi_pct,
                   d.momentum_5_to_10_pct, d.plus10_liquidity_usd, d.decided_at
            FROM base_radar_cases c
            LEFT JOIN base_radar_decisions d ON d.case_id = c.id
            WHERE c.id = ?`,
      args: [caseId],
    });
    const row = caseResult.rows[0];

    if (!row) {
      return <main style={{ padding: "1.5rem", fontFamily: "system-ui" }}><Link href="/radar">← Radar</Link><p>Case not found.</p></main>;
    }

    const snapshots = await client.execute({
      sql: "SELECT stage, captured_at, price, liquidity_usd, volume_h1_usd, buys_h1, sells_h1 FROM base_radar_snapshots WHERE case_id = ? ORDER BY captured_at ASC",
      args: [caseId],
    });
    const outcomes = await client.execute({
      sql: "SELECT horizon_minutes, captured_at, price, liquidity_usd, roi_pct, tradeable FROM base_radar_outcomes WHERE case_id = ? ORDER BY horizon_minutes ASC",
      args: [caseId],
    });

    return (
      <main style={{ padding: "1.5rem", fontFamily: "system-ui", maxWidth: 1000, margin: "0 auto" }}>
        <p><Link href="/radar">← Base Radar</Link></p>
        <h1>{String(row.symbol ?? `Case ${caseId}`)}</h1>
        <p><strong>Decision:</strong> {String(row.decision ?? "PENDING")}{row.reject_reason ? ` · ${String(row.reject_reason)}` : ""}</p>
        <p><strong>Token address:</strong> <code style={{ userSelect: "all" }}>{String(row.token_address ?? "pending")}</code></p>
        <p><strong>Pool address:</strong> <code>{String(row.pool_address)}</code></p>
        <p><strong>Entry liquidity:</strong> ${Math.round(Number(row.entry_liquidity_usd)).toLocaleString()}</p>
        <p><strong>Entry activity:</strong> {Number(row.entry_buys_h1)} buys / {Number(row.entry_sells_h1)} sells · H1 volume ${Math.round(Number(row.entry_volume_h1_usd ?? 0)).toLocaleString()}</p>
        <p><strong>+5:</strong> {pct(row.plus5_roi_pct)} · <strong>+10:</strong> {pct(row.plus10_roi_pct)} · <strong>Momentum:</strong> {pct(row.momentum_5_to_10_pct)}</p>
        <p><strong>+10 liquidity:</strong> {row.plus10_liquidity_usd == null ? "—" : `$${Math.round(Number(row.plus10_liquidity_usd)).toLocaleString()}`}</p>

        <h2 style={{ marginTop: "2rem" }}>Snapshots</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["Stage","Time","Price","Liquidity","H1 volume","Buys/Sells"].map((h) => <th key={h} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #ddd" }}>{h}</th>)}</tr></thead>
            <tbody>
              {snapshots.rows.map((s) => (
                <tr key={String(s.stage)}>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{String(s.stage)}</td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{new Date(Number(s.captured_at)).toLocaleString()}</td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{Number(s.price).toPrecision(6)}</td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{s.liquidity_usd == null ? "—" : `$${Math.round(Number(s.liquidity_usd)).toLocaleString()}`}</td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{s.volume_h1_usd == null ? "—" : `$${Math.round(Number(s.volume_h1_usd)).toLocaleString()}`}</td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{Number(s.buys_h1)} / {Number(s.sells_h1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ marginTop: "2rem" }}>Outcomes</h2>
        {outcomes.rows.length === 0 ? <p>Nog geen 6u/24u outcome.</p> : (
          <ul>{outcomes.rows.map((o) => <li key={String(o.horizon_minutes)}>{Number(o.horizon_minutes) / 60}u: {pct(o.roi_pct)} · liq {o.liquidity_usd == null ? "—" : `$${Math.round(Number(o.liquidity_usd)).toLocaleString()}`} · {Number(o.tradeable) === 1 ? "tradeable" : "not tradeable"}</li>)}</ul>
        )}
      </main>
    );
  } finally {
    client.close();
  }
}
