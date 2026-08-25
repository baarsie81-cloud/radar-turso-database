import { createTursoClient } from "../../src/db/client";
import { PushSettings } from "../../components/push-settings";
import { RadarRefreshBar } from "../../components/radar-refresh";
import { BaseRadarTable, type BaseRadarTableRow } from "../../components/base-radar-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadRows(): Promise<{ rows: BaseRadarTableRow[]; error: string | null }> {
  if (!process.env.TURSO_DATABASE_URL) return { rows: [], error: "Turso is not configured." };
  const client = await createTursoClient();
  try {
    const result = await client.execute(`
      SELECT c.id, c.symbol, c.token_address, c.pool_address, c.first_seen_at, c.entry_liquidity_usd,
             d.plus5_roi_pct, d.plus10_roi_pct, d.momentum_5_to_10_pct,
             d.plus10_liquidity_usd, d.status AS decision, d.reject_reason
      FROM base_radar_cases c
      LEFT JOIN base_radar_decisions d ON d.case_id = c.id
      ORDER BY c.first_seen_at DESC, c.id DESC
      LIMIT 200
    `);
    return {
      rows: result.rows.map((row) => ({
        id: Number(row.id),
        symbol: row.symbol == null ? null : String(row.symbol),
        tokenAddress: row.token_address == null ? null : String(row.token_address),
        poolAddress: String(row.pool_address),
        firstSeenAt: Number(row.first_seen_at),
        entryLiquidityUsd: Number(row.entry_liquidity_usd),
        plus5RoiPct: row.plus5_roi_pct == null ? null : Number(row.plus5_roi_pct),
        plus10RoiPct: row.plus10_roi_pct == null ? null : Number(row.plus10_roi_pct),
        momentum: row.momentum_5_to_10_pct == null ? null : Number(row.momentum_5_to_10_pct),
        plus10LiquidityUsd: row.plus10_liquidity_usd == null ? null : Number(row.plus10_liquidity_usd),
        decision: row.decision == null ? null : String(row.decision),
        rejectReason: row.reject_reason == null ? null : String(row.reject_reason),
      })),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close();
  }
}

export default async function RadarPage() {
  const fetchedAt = Date.now();
  const { rows, error } = await loadRows();
  const passes = rows.filter((row) => row.decision === "PASS").length;
  const pending = rows.filter((row) => row.decision == null).length;

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", maxWidth: 1300, margin: "0 auto" }}>
      <header style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>Moonshot Radar · Base only · Research Mode</p>
        <h1 style={{ margin: "0.25rem 0" }}>Base Radar</h1>
        <p style={{ margin: "0.25rem 0", color: "#555" }}>
          Admission: ≤15m oud, ≥$10k entry liquidity + echte activiteit · PASS: +10 ≥25%, momentum ≥0, +10 liquidity ≥$15k.
        </p>
        <p style={{ margin: "0.25rem 0", color: "#555", fontSize: "0.9rem" }}>
          Nieuwste cases staan bovenaan. PASS blijft zichtbaar in de Decision-kolom. Copy plakt het echte Base-tokencontract naar je klembord voor Uniswap.
        </p>
        <RadarRefreshBar fetchedAt={fetchedAt} />
      </header>

      <PushSettings />

      <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <strong>{rows.length} cases</strong>
        <span>{passes} PASS</span>
        <span>{pending} pending</span>
      </section>

      {error ? <p role="alert">Turso error: {error}</p> : <BaseRadarTable rows={rows} />}
    </main>
  );
}
