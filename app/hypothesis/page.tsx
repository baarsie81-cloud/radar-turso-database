import Link from "next/link";
import { HypothesisList, type HypothesisListRow } from "../../components/hypothesis-list";
import { createTursoClient } from "../../src/db/client";
import { migrate } from "../../src/db/migrate";
import { listHypothesisUniverseAssets } from "../../src/db/repositories/hypothesis/assets";
import { getLatestHypothesisScoreSnapshot } from "../../src/db/repositories/hypothesis/scoreSnapshots";
import { RADAR_VERSION } from "../../src/domain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoadResult =
  | { ok: true; rows: HypothesisListRow[] }
  | { ok: false; error: string };

async function loadHypothesisRows(): Promise<LoadResult> {
  if (!process.env.TURSO_DATABASE_URL) {
    return { ok: false, error: "Turso is not configured. Set TURSO_DATABASE_URL." };
  }

  try {
    const client = await createTursoClient();
    try {
      await migrate(client);
      const assets = await listHypothesisUniverseAssets(client);
      const rows = await Promise.all(
        assets.map(async (asset): Promise<HypothesisListRow> => {
          const latest = await getLatestHypothesisScoreSnapshot(client, asset.id);
          return {
            id: String(asset.id),
            coin: asset.name ?? asset.symbol ?? asset.mint.slice(0, 8),
            symbol: asset.symbol ?? "—",
            category: asset.category ?? "—",
            hypothesis_score: latest?.hypothesisScore ?? asset.hypothesisScore,
            status: latest?.status ?? asset.status,
            rank: latest?.rank ?? asset.rank,
            narrative_score: latest?.narrativeScore ?? asset.narrativeScore,
            asymmetry_score: latest?.asymmetryScore ?? asset.asymmetryScore,
            catalyst_score: latest?.catalystScore ?? asset.catalystScore,
            attention_score: latest?.attentionScore ?? asset.attentionScore,
            liquidity_score: latest?.liquidityScore ?? asset.liquidityScore,
            updated_at: latest?.capturedAt ?? asset.updatedAt,
          };
        }),
      );

      rows.sort((a, b) => {
        if (a.rank != null && b.rank != null) return a.rank - b.rank;
        if (a.rank != null) return -1;
        if (b.rank != null) return 1;
        return b.hypothesis_score - a.hypothesis_score;
      });

      return { ok: true, rows };
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Turso unavailable: ${message}` };
  }
}

/** Read-only live Hypothesis research overview. No score recalculation or status changes. */
export default async function HypothesisPage() {
  const result = await loadHypothesisRows();

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ marginBottom: "0.75rem", fontSize: "0.9rem" }}>
        <Link href="/radar" style={{ color: "#333" }}>
          Radar
        </Link>
        {" · "}
        <strong>Hypothesis</strong>
      </nav>

      <header style={{ marginBottom: "0.5rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
          Moonshot Radar {RADAR_VERSION} · Turso
        </p>
        <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem" }}>
          Hypothesis
        </h1>
        <p style={{ margin: "0.35rem 0 0", color: "#555", fontSize: "0.9rem" }}>
          Live research score overzicht — observeren en handmatig onderzoeken. Geen trade-signalen.
        </p>
      </header>

      {!result.ok ? (
        <p role="alert" style={{ marginTop: "1.5rem", padding: "0.75rem 1rem", background: "#f8f8f8", border: "1px solid #ddd", borderRadius: "4px", color: "#333" }}>
          {result.error}
        </p>
      ) : (
        <HypothesisList rows={result.rows} />
      )}
    </main>
  );
}
