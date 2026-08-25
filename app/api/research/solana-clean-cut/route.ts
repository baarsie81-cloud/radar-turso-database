import { createTursoClient } from "../../../../src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = await createTursoClient();
  try {
    await client.batch([
      "DROP TABLE IF EXISTS base_radar_push_deliveries",
      "DROP TABLE IF EXISTS base_radar_outcomes",
      "DROP TABLE IF EXISTS base_radar_decisions",
      "DROP TABLE IF EXISTS base_radar_snapshots",
      "DROP TABLE IF EXISTS base_radar_cases",
      "DROP TABLE IF EXISTS survivor_push_deliveries_v2",
      "DROP TABLE IF EXISTS survivor_snapshots_v2",
      "DROP TABLE IF EXISTS survivor_candidates_v2",
      "DROP TABLE IF EXISTS survivor_push_deliveries",
      "DROP TABLE IF EXISTS survivor_snapshots",
      "DROP TABLE IF EXISTS survivor_candidates",
      "DROP TABLE IF EXISTS hypothesis_seed_meta"
    ], "write");
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    return Response.json({ ok: true, tables: tables.rows.map((row) => String(row.name)) });
  } finally {
    client.close();
  }
}
