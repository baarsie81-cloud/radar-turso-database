import Link from "next/link";
import { CaseDetailView } from "../../../components/case-detail";
import { createTursoClient } from "../../../src/db/client";
import { getCaseSummary } from "../../../src/db/repositories/tokenCases";
import { RADAR_VERSION } from "../../../src/domain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

type LoadResult =
  | { ok: true; summary: NonNullable<Awaited<ReturnType<typeof getCaseSummary>>> }
  | { ok: false; error: string; notFound?: boolean };

function parseCaseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

async function loadCase(idParam: string): Promise<LoadResult> {
  const id = parseCaseId(idParam);
  if (id == null) {
    return { ok: false, error: "Invalid case id.", notFound: true };
  }

  if (!process.env.TURSO_DATABASE_URL) {
    return {
      ok: false,
      error: "Turso is not configured. Set TURSO_DATABASE_URL.",
    };
  }

  try {
    const client = await createTursoClient();
    try {
      const summary = await getCaseSummary(client, id);
      if (!summary) {
        return { ok: false, error: `Case ${id} not found.`, notFound: true };
      }
      return { ok: true, summary };
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Turso unavailable: ${message}`,
    };
  }
}

export default async function CaseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const result = await loadCase(id);

  const title = result.ok
    ? (result.summary.tokenCase.symbol
      ?? result.summary.tokenCase.name
      ?? `Case ${result.summary.tokenCase.id}`)
    : `Case ${id}`;

  return (
    <main style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
        <Link href="/radar" style={{ color: "#333" }}>
          ← Radar
        </Link>
      </p>

      <header style={{ marginBottom: "0.5rem" }}>
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
          Moonshot Radar {RADAR_VERSION} · Turso
        </p>
        <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem" }}>{title}</h1>
      </header>

      {!result.ok ? (
        <p
          role="alert"
          style={{
            marginTop: "1.5rem",
            padding: "0.75rem 1rem",
            background: "#f8f8f8",
            border: "1px solid #ddd",
            borderRadius: "4px",
            color: "#333",
          }}
        >
          {result.error}
        </p>
      ) : (
        <CaseDetailView summary={result.summary} />
      )}
    </main>
  );
}
