import Link from "next/link";
import { createTursoClient } from "../../src/db/client";
import { listCaseSummaries } from "../../src/db/repositories/tokenCases";
import { RADAR_VERSION } from "../../src/domain/types";
import { PushSettings } from "../../components/push-settings";
import { RadarCaseList } from "../../components/radar-case-list";
import { RadarRefreshBar } from "../../components/radar-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoadResult =
  | { ok: true; summaries: Awaited<ReturnType<typeof listCaseSummaries>> }
  | { ok: false; error: string };

async function loadCaseSummaries(): Promise<LoadResult> {
  if (!process.env.TURSO_DATABASE_URL) {
    return { ok: false, error: "Turso is not configured. Set TURSO_DATABASE_URL." };
  }

  try {
    const client = await createTursoClient();
    try {
      const summaries = await listCaseSummaries(client);
      return { ok: true, summaries };
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Turso unavailable: ${message}` };
  }
}

export default async function RadarPage() {
  const fetchedAt = Date.now();
  const result = await loadCaseSummaries();

  const summaries = result.ok
    ? [...result.summaries].sort(
        (a, b) => b.tokenCase.createdAt - a.tokenCase.createdAt,
      )
    : [];

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ marginBottom: "0.75rem", fontSize: "0.9rem" }}>
        <strong>Radar</strong>
        {" · "}
        <Link href="/hypothesis" style={{ color: "#333" }}>
          Hypothesis
        </Link>
      </nav>

      <header style={{ marginBottom: "0.5rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
          Moonshot Radar {RADAR_VERSION} · Turso
        </p>
        <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem" }}>Radar</h1>
        <RadarRefreshBar fetchedAt={fetchedAt} />
      </header>

      <PushSettings />

      {!result.ok ? (
        <p role="alert" style={{ marginTop: "1.5rem", padding: "0.75rem 1rem", background: "#f8f8f8", border: "1px solid #ddd", borderRadius: "4px", color: "#333" }}>
          {result.error}
        </p>
      ) : (
        <RadarCaseList summaries={summaries} />
      )}
    </main>
  );
}
