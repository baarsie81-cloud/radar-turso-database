import type { PushCandidate, PushPayload } from "./types";
import { PUSH_NOTIFICATION_TITLE } from "./types";

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

/**
 * Build a push payload from a stored PASS decision.
 * Does not call evaluateRadar24 or recalculate metrics.
 */
export function buildPassPushPayload(candidate: PushCandidate): PushPayload {
  const symbol = candidate.symbol?.trim() || candidate.name?.trim() || "Token";
  const plus10 = formatPct(candidate.plus10RoiPct);
  const momentum = formatPct(candidate.momentum5To10Pct);

  return {
    title: PUSH_NOTIFICATION_TITLE,
    body: `${symbol} · PASS · +10 ROI ${plus10} · momentum ${momentum}`,
    url: `/cases/${candidate.tokenCaseId}`,
    mint: candidate.mint,
    decisionId: candidate.decisionId,
    tokenCaseId: candidate.tokenCaseId,
    decisionStatus: "PASS",
    decisionStage: "PLUS_10",
    plus10RoiPct: candidate.plus10RoiPct,
    momentum5To10Pct: candidate.momentum5To10Pct,
    symbol: candidate.symbol,
  };
}
