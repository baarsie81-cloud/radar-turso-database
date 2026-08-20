import Link from "next/link";
import type { CaseSummary } from "../src/db/repositories/tokenCases";
import type { DecisionRow } from "../src/db/repositories/decisions";

function primaryDecision(summary: CaseSummary): DecisionRow | null {
  return (
    summary.decisions.find((d: DecisionRow) => d.decisionStage === "PLUS_10")
    ?? summary.decisions[summary.decisions.length - 1]
    ?? null
  );
}

function displayName(summary: CaseSummary): string {
  const { symbol, name } = summary.tokenCase;
  if (symbol && name && symbol !== name) {
    return `${symbol} · ${name}`;
  }
  return symbol ?? name ?? "—";
}

type Props = {
  summaries: CaseSummary[];
};

/** Presentational table for V24 case summaries (no data fetching). */
export function RadarCaseList({ summaries }: Props) {
  if (summaries.length === 0) {
    return (
      <p style={{ marginTop: "1.5rem", color: "#555" }}>
        No token cases yet.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto", marginTop: "1.5rem" }}>
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
            {[
              "Mint",
              "Token",
              "Stage",
              "Case status",
              "Decision",
              "Outcome",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  borderBottom: "1px solid #ccc",
                  padding: "0.5rem 0.75rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => {
            const decision = primaryDecision(summary);
            const { tokenCase } = summary;
            return (
              <tr key={tokenCase.id}>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.8rem",
                    maxWidth: "14rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={tokenCase.mint}
                >
                  <Link
                    href={`/cases/${tokenCase.id}`}
                    style={{ color: "inherit" }}
                  >
                    {tokenCase.mint}
                  </Link>
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                  }}
                >
                  <Link
                    href={`/cases/${tokenCase.id}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {displayName(summary)}
                  </Link>
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                  }}
                >
                  {tokenCase.stage}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                  }}
                >
                  {tokenCase.caseStatus}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                  }}
                >
                  {decision
                    ? decision.rejectReason
                      ? `${decision.decisionStatus} (${decision.rejectReason})`
                      : decision.decisionStatus
                    : "—"}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0.75rem",
                  }}
                >
                  {tokenCase.outcomeLabel ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
