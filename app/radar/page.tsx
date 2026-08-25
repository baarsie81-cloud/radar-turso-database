import { createTursoClient } from "../../src/db/client";
import { PushSettings } from "../../components/push-settings";
import { RadarRefreshBar } from "../../components/radar-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BaseRow = {
  id: number;
  symbol: string | null;
  poolAddress: string;
  firstSeenAt: number;
  entryLiquidityUsd: number;
  status: string;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum: number | null;
  plus10LiquidityUsd: number | null;
  decision: string | null;
  rejectReason: string | null;
};

async function loadRows(): Promise<{ rows: BaseRow[]; error: string | null }> {
  if (!process.env.TURSO_DATABASE_URL) return { rows: [], error: "Turso is not configured." };
  const client = await createTursoClient();
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS base_radar_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL UNIQUE,
      symbol TEXT,
      launched_at INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      entry_liquidity_usd REAL NOT NULL,
      entry_volume_h1_usd REAL,
      entry_buys_h1 INTEGER NOT NULL DEFAULT 0,
      entry_sells_h1 INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED'))
    )`);
    const result = await client.execute(`
      SELECT c.id, c.symbol, c.pool_address, c.first_seen_at, c.entry_liquidity_usd, c.status,
             d.plus5_roi_pct, d.plus10_roi_pct, d.momentum_5_to_10_pct,
             d.plus10_liquidity_usd, d.status AS decision, d.reject_reason
      FROM base_radar_cases c
      LEFT JOIN base_radar_decisions d ON d.case_id = c.id
      ORDER BY c.first_seen_at DESC
      LIMIT 200
    `);
    return {
      rows: result.rows.map((row) => ({
        id: Number(row.id),
        symbol: row.symbol == null ? null : String(row.symbol),
        poolAddress: String(row.pool_address),
        firstSeenAt: Number(row.first_seen_at),
        entryLiquidityUsd: Number(row.entry_liquidity_usd),
        status: String(row.status),
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

function pct(value: number | null): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default async function RadarPage() {
  const fetchedAt = Date.now();
  const { rows, error } = await loadRows();
  const passes = rows.filter((row) => row.decision === "PASS").length;
  const pending = rows.filter((row) => row.decision == null).length;

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>Moonshot Radar · Base only · Research Mode</p>
        <h1 style={{ margin: "0.25rem 0" }}>Base Radar</h1>
        <p style={{ margin: "0.25rem 0", color: "#555" }}>
          Admission: ≤15m oud, ≥$10k entry liquidity + echte activiteit · PASS: +10 ≥25%, momentum ≥0, +10 liquidity ≥$15k.
        </p>
        <RadarRefreshBar fetchedAt={fetchedAt} />
      </header>

      <PushSettings />

      <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <strong>{rows.length} cases</strong>
        <span>{passes} PASS</span>
        <span>{pending} pending</span>
      </section>

      {error ? <p role="alert">Turso error: {error}</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              {['Coin','Seen','Entry liq','+5','+10','Momentum','+10 liq','Decision'].map((label) => (
                <th key={label} style={{ textAlign: "left", padding: "0.55rem", borderBottom: "1px solid #ddd" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{row.symbol ?? row.poolAddress.slice(0, 10)}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{new Date(row.firstSeenAt).toLocaleString()}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>${Math.round(row.entryLiquidityUsd).toLocaleString()}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.plus5RoiPct)}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.plus10RoiPct)}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.momentum)}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{row.plus10LiquidityUsd == null ? '—' : `$${Math.round(row.plus10LiquidityUsd).toLocaleString()}`}</td>
                <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }} title={row.rejectReason ?? undefined}>{row.decision ?? 'PENDING'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
