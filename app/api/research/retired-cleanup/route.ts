import { createTursoClient } from "../../../../src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM = "radar-retired-cleanup-20260825";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const client = await createTursoClient();
  try {
    await client.executeMultiple(`
      DROP TABLE IF EXISTS early_shadow_deliveries;
      DROP TABLE IF EXISTS hypothesis_push_deliveries;
      DROP TABLE IF EXISTS hypothesis_events;
      DROP TABLE IF EXISTS hypothesis_score_snapshots;
      DROP TABLE IF EXISTS hypothesis_assets;
    `);
    return Response.json({ ok: true, removed: [
      "early_shadow_deliveries",
      "hypothesis_push_deliveries",
      "hypothesis_events",
      "hypothesis_score_snapshots",
      "hypothesis_assets"
    ]});
  } finally {
    client.close();
  }
}
