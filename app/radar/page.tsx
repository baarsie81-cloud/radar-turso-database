import { createTursoClient } from "../../src/db/client";
import { PushSettings } from "../../components/push-settings";
import { RadarRefreshBar } from "../../components/radar-refresh";
import { SolanaRadarTable, type SolanaRadarRow } from "../../components/solana-radar-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadRows(): Promise<{ rows: SolanaRadarRow[]; error: string | null }> {
  if (!process.env.TURSO_DATABASE_URL) return { rows: [], error: "Turso is not configured." };
  const client = await createTursoClient();
  try {
    const result = await client.execute(`
      SELECT c.id, c.symbol, c.mint, c.first_seen_at, c.entry_liquidity_usd,
             d.plus5_roi_pct, d.plus10_roi_pct, d.momentum_5_to_10_pct,
             d.execution_status, d.round_trip_loss_pct, d.status AS decision, d.reject_reason
      FROM solana_validated_cases c
      LEFT JOIN solana_validated_decisions d ON d.case_id = c.id
      WHERE c.status <> 'WAITING'
      ORDER BY
        CASE
          WHEN d.status = 'PASS' THEN 0
          WHEN d.status = 'REJECT' THEN 1
          WHEN d.status = 'CANDIDATE' THEN 2
          ELSE 3
        END,
        COALESCE(d.decided_at, c.first_seen_at) DESC,
        c.id DESC
      LIMIT 200
    `);
    return {
      rows: result.rows.map((row) => ({
        id: Number(row.id),
        symbol: row.symbol == null ? null : String(row.symbol),
        mint: String(row.mint),
        firstSeenAt: Number(row.first_seen_at),
        entryLiquidityUsd: Number(row.entry_liquidity_usd),
        plus5RoiPct: row.plus5_roi_pct == null ? null : Number(row.plus5_roi_pct),
        plus10RoiPct: row.plus10_roi_pct == null ? null : Number(row.plus10_roi_pct),
        momentum: row.momentum_5_to_10_pct == null ? null : Number(row.momentum_5_to_10_pct),
        executionStatus: row.execution_status == null ? null : String(row.execution_status),
        roundTripLossPct: row.round_trip_loss_pct == null ? null : Number(row.round_trip_loss_pct),
        decision: row.decision == null ? null : String(row.decision),
        rejectReason: row.reject_reason == null ? null : String(row.reject_reason),
      })),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such table: solana_validated_cases")) return { rows: [], error: null };
    return { rows: [], error: message };
  } finally {
    client.close();
  }
}

export default async function RadarPage() {
  const fetchedAt = Date.now();
  const { rows, error } = await loadRows();
  const passes = rows.filter((row) => row.decision === "PASS").length;
  const candidates = rows.filter((row) => row.decision === "CANDIDATE").length;
  const pending = rows.filter((row) => row.decision == null).length;

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", maxWidth: 1350, margin: "0 auto" }}>
      <header style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>Moonshot Radar · Solana · Post-Validation Research Mode</p>
        <h1 style={{ margin: "0.25rem 0" }}>Solana Validated Radar</h1>
        <p style={{ margin: "0.25rem 0", color: "#555" }}>
          Alleen coins die de 15-minuten survival-gate halen verschijnen hier: ≥$25k liquiditeit + echte activiteit.
        </p>
        <p style={{ margin: "0.25rem 0", color: "#555", fontSize: "0.9rem" }}>
          +10 ≥25% en momentum ≥0 maakt eerst een CANDIDATE. Circa vijf minuten later moet Jupiter opnieuw een buy + sell round-trip leveren met maximaal 3% verlies. Pas daarna wordt het PASS en volgt push.
        </p>
        <RadarRefreshBar fetchedAt={fetchedAt} />
      </header>

      <PushSettings />

      <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <strong>{rows.length} validated cases</strong>
        <span>{passes} confirmed PASS</span>
        <span>{candidates} awaiting +15 execution</span>
        <span>{pending} pending +10</span>
      </section>

      {error ? <p role="alert">Turso error: {error}</p> : <SolanaRadarTable rows={rows} />}
    </main>
  );
}
