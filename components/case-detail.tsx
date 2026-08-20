import type { CSSProperties, ReactNode } from "react";
import type { CaseSummary } from "../src/db/repositories/tokenCases";
import type { DecisionRow } from "../src/db/repositories/decisions";
import type { SnapshotRow } from "../src/db/repositories/snapshots";
import { SNAPSHOT_STAGES, type SnapshotStage } from "../src/domain/types";

function displayName(summary: CaseSummary): string {
  const { symbol, name } = summary.tokenCase;
  if (symbol && name && symbol !== name) {
    return `${symbol} · ${name}`;
  }
  return symbol ?? name ?? "—";
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return String(value);
}

function formatTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  return new Date(ms).toISOString();
}

function snapshotsByStage(
  snapshots: SnapshotRow[],
): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>();
  for (const row of snapshots) {
    map.set(row.stage, row);
  }
  return map;
}

function stageOrder(stage: string): number {
  const index = (SNAPSHOT_STAGES as readonly string[]).indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sortedDecisions(decisions: DecisionRow[]): DecisionRow[] {
  return [...decisions].sort(
    (a, b) =>
      stageOrder(a.decisionStage) - stageOrder(b.decisionStage)
      || a.decidedAt - b.decidedAt
      || a.id - b.id,
  );
}

/** Parse stored inputsJson for display only — never recalculates. */
function parseStoredInputs(inputsJson: string): {
  inputs: unknown | null;
  error: string | null;
} {
  try {
    return { inputs: JSON.parse(inputsJson) as unknown, error: null };
  } catch (error) {
    return {
      inputs: null,
      error: error instanceof Error ? error.message : "Invalid inputsJson",
    };
  }
}

function formatInputsValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : "—";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type Props = {
  summary: CaseSummary;
};

/** Presentational case detail (no data fetching, no decision recalculation). */
export function CaseDetailView({ summary }: Props) {
  const { tokenCase } = summary;
  const decisions = sortedDecisions(summary.decisions);
  const byStage = snapshotsByStage(summary.snapshots);
  const presentCount = SNAPSHOT_STAGES.filter((stage) => byStage.has(stage)).length;
  const availableStages = decisions.map((d) => d.decisionStage);

  return (
    <div style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <section style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.75rem" }}>Token</h2>
        <dl style={dlStyle}>
          <Dt>ID</Dt>
          <Dd>{tokenCase.id}</Dd>
          <Dt>Mint</Dt>
          <Dd mono>{tokenCase.mint}</Dd>
          <Dt>Name</Dt>
          <Dd>{displayName(summary)}</Dd>
          <Dt>Entry price</Dt>
          <Dd>{formatPrice(tokenCase.entryPrice)}</Dd>
          <Dt>Entry valid</Dt>
          <Dd>{tokenCase.entryValid ? "yes" : "no"}</Dd>
          <Dt>First seen</Dt>
          <Dd>{formatTime(tokenCase.firstSeenAt)}</Dd>
          <Dt>Radar version</Dt>
          <Dd>{tokenCase.radarVersion}</Dd>
        </dl>
      </section>

      <section style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.75rem" }}>Lifecycle</h2>
        <dl style={dlStyle}>
          <Dt>Stage</Dt>
          <Dd>{tokenCase.stage}</Dd>
          <Dt>Case status</Dt>
          <Dd>{tokenCase.caseStatus}</Dd>
          <Dt>Outcome</Dt>
          <Dd>{tokenCase.outcomeLabel ?? "—"}</Dd>
          <Dt>Outcome labeled at</Dt>
          <Dd>{formatTime(tokenCase.outcomeLabeledAt)}</Dd>
        </dl>
      </section>

      <section style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>
          Decision replay
        </h2>
        <p style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.9rem" }}>
          Stored decisions only — no recalculation.
        </p>

        <p style={{ margin: "0 0 1rem", fontSize: "0.9rem" }}>
          <span style={{ color: "#666" }}>Stages available: </span>
          {availableStages.length > 0
            ? availableStages.join(", ")
            : "none"}
        </p>

        {decisions.length === 0 ? (
          <p style={{ color: "#555", margin: 0 }}>No decision recorded yet.</p>
        ) : (
          decisions.map((decision) => (
            <DecisionReplayBlock key={decision.id} decision={decision} />
          ))
        )}
      </section>

      <section style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>
          Snapshot completeness
        </h2>
        <p style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.9rem" }}>
          {presentCount} / {SNAPSHOT_STAGES.length} snapshot stages present
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
          }}
        >
          {SNAPSHOT_STAGES.map((stage) => {
            const present = byStage.has(stage);
            return (
              <li
                key={stage}
                style={{
                  padding: "0.25rem 0.5rem",
                  border: "1px solid #ccc",
                  borderRadius: "3px",
                  fontSize: "0.8rem",
                  background: present ? "#f0f0f0" : "#fff",
                  color: present ? "#111" : "#999",
                }}
              >
                {stage}
                {present ? " ✓" : " —"}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.75rem" }}>
          Snapshots timeline
        </h2>
        <div style={{ overflowX: "auto" }}>
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
                {["Stage", "Captured at", "Price", "ROI %", "Market cap", "Liquidity"].map(
                  (heading) => (
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {SNAPSHOT_STAGES.map((stage) => {
                const row = byStage.get(stage);
                return (
                  <tr key={stage}>
                    <td style={tdStyle}>{stage}</td>
                    <td style={tdStyle}>
                      {row ? formatTime(row.capturedAt) : "—"}
                    </td>
                    <td style={tdStyle}>
                      {row ? formatPrice(row.price) : "missing"}
                    </td>
                    <td style={tdStyle}>
                      {row ? formatPct(row.roiPct) : "—"}
                    </td>
                    <td style={tdStyle}>
                      {row ? formatPrice(row.marketCap) : "—"}
                    </td>
                    <td style={tdStyle}>
                      {row ? formatPrice(row.liquidityUsd) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DecisionReplayBlock({ decision }: { decision: DecisionRow }) {
  const parsed = parseStoredInputs(decision.inputsJson);
  const inputsRecord =
    parsed.inputs != null
    && typeof parsed.inputs === "object"
    && !Array.isArray(parsed.inputs)
      ? (parsed.inputs as Record<string, unknown>)
      : null;

  return (
    <article
      style={{
        marginBottom: "1.25rem",
        padding: "0.85rem 1rem",
        border: "1px solid #ddd",
        borderRadius: "4px",
        background: "#fafafa",
      }}
    >
      <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
        {decision.decisionStage as SnapshotStage}
        {" · "}
        {decision.decisionStatus}
      </h3>

      <dl style={dlStyle}>
        <Dt>Radar version</Dt>
        <Dd>{decision.radarVersion}</Dd>
        <Dt>Entry price</Dt>
        <Dd>{formatPrice(decision.entryPrice)}</Dd>
        <Dt>+5 ROI</Dt>
        <Dd>{formatPct(decision.plus5RoiPct)}</Dd>
        <Dt>+10 ROI</Dt>
        <Dd>{formatPct(decision.plus10RoiPct)}</Dd>
        <Dt>Momentum 5→10</Dt>
        <Dd>{formatPct(decision.momentum5To10Pct)}</Dd>
        <Dt>Reject reason</Dt>
        <Dd>{decision.rejectReason ?? "—"}</Dd>
        <Dt>Decision timestamp</Dt>
        <Dd>{formatTime(decision.decidedAt)}</Dd>
      </dl>

      <h4
        style={{
          margin: "1rem 0 0.5rem",
          fontSize: "0.9rem",
          fontWeight: 600,
        }}
      >
        Stored decision inputs
      </h4>

      {parsed.error != null ? (
        <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
          Could not parse inputsJson: {parsed.error}
        </p>
      ) : inputsRecord != null ? (
        <dl style={dlStyle}>
          {Object.entries(inputsRecord).map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <Dt>{key}</Dt>
              <Dd mono>{formatInputsValue(value)}</Dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: "0.5rem",
            background: "#fff",
            border: "1px solid #eee",
            fontSize: "0.8rem",
            overflowX: "auto",
          }}
        >
          {formatInputsValue(parsed.inputs)}
        </pre>
      )}
    </article>
  );
}

const dlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "10rem 1fr",
  gap: "0.35rem 1rem",
  margin: 0,
  fontSize: "0.9rem",
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "0.5rem 0.75rem",
  whiteSpace: "nowrap",
};

function Dt({ children }: { children: ReactNode }) {
  return (
    <dt style={{ margin: 0, color: "#666", fontWeight: 500 }}>{children}</dt>
  );
}

function Dd({
  children,
  mono,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <dd
      style={{
        margin: 0,
        fontFamily: mono ? "ui-monospace, monospace" : undefined,
        fontSize: mono ? "0.85rem" : undefined,
        wordBreak: "break-all",
      }}
    >
      {children}
    </dd>
  );
}
