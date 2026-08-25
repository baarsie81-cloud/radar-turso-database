import { createTursoClient } from "../../../../src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM = "base-only-cleanup-20260825";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const client = await createTursoClient();
  try {
    await client.executeMultiple(`
      DROP TABLE IF EXISTS base_radar_test_push_deliveries;
      DROP TABLE IF EXISTS survivor_research_checks_v2;
      DROP TABLE IF EXISTS survivor_research_snapshots_v2;
      DROP TABLE IF EXISTS survivor_research_cases_v2;
      DROP TABLE IF EXISTS survivor_research_checks;
      DROP TABLE IF EXISTS survivor_research_snapshots;
      DROP TABLE IF EXISTS survivor_research_cases;
      DROP TABLE IF EXISTS push_deliveries;
      DROP TABLE IF EXISTS snapshot_jobs;
      DROP TABLE IF EXISTS social_calls;
      DROP TABLE IF EXISTS decisions;
      DROP TABLE IF EXISTS snapshots;
      DROP TABLE IF EXISTS token_cases;
      DROP TABLE IF EXISTS collection_locks;
      DROP TABLE IF EXISTS discovery_watermarks;
    `);
    return Response.json({ ok: true, mode: "BASE_ONLY", kept: ["push_subscriptions", "schema_migrations", "base_radar_*"] });
  } finally {
    client.close();
  }
}
