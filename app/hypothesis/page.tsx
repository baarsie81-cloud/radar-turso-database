import Link from "next/link";
import { HypothesisList } from "../../components/hypothesis-list";
import { RADAR_VERSION } from "../../src/domain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only Hypothesis research overview.
 * Data is not wired yet — presentational empty state only.
 * Does not call score / universe / cron / push layers.
 */
export default function HypothesisPage() {
  const rows: Parameters<typeof HypothesisList>[0]["rows"] = [];

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
          Research score overzicht — handmatig onderzoeken. Geen trade-signalen.
        </p>
      </header>

      <HypothesisList rows={rows} />
    </main>
  );
}
