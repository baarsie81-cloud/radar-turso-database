import type { HypothesisStatus } from "../src/domain/hypothesis";

export type HypothesisListRow = {
  id: string;
  coin: string;
  symbol: string;
  category: string;
  hypothesis_score: number;
  status: HypothesisStatus;
  rank: number | null;
  narrative_score: number;
  asymmetry_score: number;
  catalyst_score: number;
  attention_score: number;
  liquidity_score: number;
  updated_at: number;
};

const STATUS_LABELS: Record<HypothesisStatus, string> = {
  WATCH: "Watch — handmatig onderzoeken",
  ACTIVE: "Active hypothesis",
  INVALIDATED: "Invalidated",
};

const COLUMNS: { key: string; label: string }[] = [
  { key: "coin", label: "coin" },
  { key: "symbol", label: "symbol" },
  { key: "category", label: "category" },
  { key: "hypothesis_score", label: "research score" },
  { key: "status", label: "status" },
  { key: "rank", label: "rank" },
  { key: "narrative_score", label: "narrative_score" },
  { key: "asymmetry_score", label: "asymmetry_score" },
  { key: "catalyst_score", label: "catalyst_score" },
  { key: "attention_score", label: "attention_score" },
  { key: "liquidity_score", label: "liquidity_score" },
  { key: "updated_at", label: "updated_at" },
];

const cellStyle = {
  borderBottom: "1px solid #eee",
  padding: "0.5rem 0.75rem",
  whiteSpace: "nowrap" as const,
};

function formatUpdatedAt(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return "—";
  }
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type Props = {
  rows: HypothesisListRow[];
};

/** Presentational hypothesis overview (no fetch / score / universe logic). */
export function HypothesisList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="hypothesis-empty"
        style={{
          marginTop: "1.5rem",
          padding: "0.75rem 1rem",
          background: "#f8f8f8",
          border: "1px solid #ddd",
          borderRadius: "4px",
          color: "#333",
        }}
      >
        <p style={{ margin: "0 0 0.35rem" }}>
          Nog geen hypotheses om te tonen.
        </p>
        <p style={{ margin: 0, color: "#555", fontSize: "0.9rem" }}>
          Read-only research overzicht. Koppel later data om assets te
          bekijken — handmatig onderzoeken, geen trade-signalen.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="hypothesis-table"
      style={{ overflowX: "auto", marginTop: "1.5rem" }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.9rem",
          textAlign: "left",
        }}
      >
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                style={{
                  borderBottom: "1px solid #ccc",
                  padding: "0.5rem 0.75rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={`hypothesis-row-${row.id}`}>
              <td style={cellStyle}>{row.coin || "—"}</td>
              <td style={cellStyle}>{row.symbol || "—"}</td>
              <td style={cellStyle}>{row.category || "—"}</td>
              <td style={cellStyle} title="hypothesis_score (research score)">
                {formatScore(row.hypothesis_score)}
              </td>
              <td style={cellStyle}>
                <span title={row.status}>{STATUS_LABELS[row.status]}</span>
              </td>
              <td style={cellStyle}>
                {row.rank == null ? "—" : String(row.rank)}
              </td>
              <td style={cellStyle}>{formatScore(row.narrative_score)}</td>
              <td style={cellStyle}>{formatScore(row.asymmetry_score)}</td>
              <td style={cellStyle}>{formatScore(row.catalyst_score)}</td>
              <td style={cellStyle}>{formatScore(row.attention_score)}</td>
              <td style={cellStyle}>{formatScore(row.liquidity_score)}</td>
              <td style={cellStyle}>{formatUpdatedAt(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { STATUS_LABELS as HYPOTHESIS_STATUS_LABELS };
