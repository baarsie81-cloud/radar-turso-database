import { createTursoClient } from "../../../src/db/client";
import { RADAR_VERSION } from "../../../src/domain/types";

export const runtime = "nodejs";

/**
 * Phase-1 health check: proves App Router can import existing server modules.
 * When TURSO_DATABASE_URL is set, also verifies a trivial Turso query.
 */
export async function GET() {
  const tursoConfigured = Boolean(process.env.TURSO_DATABASE_URL);
  let tursoOk: boolean | null = null;
  let tursoError: string | null = null;

  if (tursoConfigured) {
    try {
      const client = await createTursoClient();
      await client.execute("SELECT 1 AS ok");
      client.close();
      tursoOk = true;
    } catch (error) {
      tursoOk = false;
      tursoError = error instanceof Error ? error.message : String(error);
    }
  }

  return Response.json({
    ok: true,
    radarVersion: RADAR_VERSION,
    source: "next-app-router",
    tursoConfigured,
    tursoOk,
    tursoError,
  });
}
