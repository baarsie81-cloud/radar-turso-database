import type { Client } from "@libsql/client";
import {
  claimPushDelivery,
  deletePushDelivery,
} from "../db/repositories/push";
import { buildPassPushPayload } from "./payload";
import { selectPassPushCandidates } from "./select";
import { validateJupiterExecution } from "./executionGate";
import type {
  PushDeliverySummary,
  PushPayload,
  PushSendFn,
} from "./types";

export type ExecutionGateFn = typeof validateJupiterExecution;

export type ProcessPushDeliveriesDeps = {
  client: Client;
  /** Transport for the built payload (VAPID/web-push injected later). */
  sendPush: PushSendFn;
  /** Fail-closed executable buy/sell-route validation for PASS candidates. */
  validateExecution?: ExecutionGateFn;
  /** Max undelivered PASS decisions to process; defaults to 50. */
  limit?: number;
  /** Injected clock for delivery bookkeeping. */
  now?: () => number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptySummary(candidates = 0): PushDeliverySummary {
  return {
    candidates,
    delivered: 0,
    skipped: 0,
    errors: [],
    unknown: [],
  };
}

/**
 * Deliver push notifications for undelivered PASS @ PLUS_10 decisions.
 *
 * Flow: select stored decisions → executable Jupiter route gate → build payload
 * → claim delivery → send. Does not call evaluateRadar24 and does not change
 * the stored strategy decision. Deduplicates by decision_id.
 *
 * Execution statuses:
 * - EXECUTION_PASS → push may proceed
 * - EXECUTION_FAIL → block push (proven untradeable)
 * - EXECUTION_UNKNOWN → no push; inconclusive provider/tech error (not a bad token)
 */
export async function processPushDeliveries(
  deps: ProcessPushDeliveriesDeps,
): Promise<PushDeliverySummary> {
  const now = deps.now ?? (() => Date.now());
  const limit = deps.limit ?? 50;
  const validateExecution = deps.validateExecution ?? validateJupiterExecution;
  const candidates = await selectPassPushCandidates(deps.client, limit);
  const summary = emptySummary(candidates.length);

  for (const candidate of candidates) {
    console.info("[push] strategy PASS", {
      decisionId: candidate.decisionId,
      tokenCaseId: candidate.tokenCaseId,
      mint: candidate.mint,
    });

    const execution = await validateExecution(candidate.mint);

    if (execution.status === "EXECUTION_UNKNOWN") {
      const blockReason = execution.reason ?? "EXECUTION_UNKNOWN";
      summary.skipped += 1;
      summary.unknown.push({
        decisionId: candidate.decisionId,
        message: blockReason,
      });
      console.warn("[push] execution UNKNOWN", {
        decisionId: candidate.decisionId,
        mint: candidate.mint,
        executionStatus: execution.status,
        pushDecision: "SKIP",
        blockReason,
      });
      continue;
    }

    if (execution.status === "EXECUTION_FAIL" || !execution.ok) {
      const blockReason = execution.reason ?? "EXECUTION_FAIL";
      summary.skipped += 1;
      summary.errors.push({
        decisionId: candidate.decisionId,
        message: blockReason,
      });
      console.info("[push] execution FAIL", {
        decisionId: candidate.decisionId,
        mint: candidate.mint,
        executionStatus: "EXECUTION_FAIL",
        pushDecision: "BLOCK",
        blockReason,
      });
      continue;
    }

    console.info("[push] execution PASS", {
      decisionId: candidate.decisionId,
      mint: candidate.mint,
      executionStatus: execution.status,
      roundTripLossPct: execution.roundTripLossPct,
    });

    const payload: PushPayload = buildPassPushPayload(candidate);

    const claimed = await claimPushDelivery(deps.client, {
      decisionId: candidate.decisionId,
      tokenCaseId: candidate.tokenCaseId,
      sentAt: now(),
    });

    if (!claimed) {
      summary.skipped += 1;
      console.info("[push] push decision", {
        decisionId: candidate.decisionId,
        pushDecision: "SKIP",
        blockReason: "ALREADY_CLAIMED_OR_DELIVERED",
      });
      continue;
    }

    try {
      await deps.sendPush(payload);
      summary.delivered += 1;
      console.info("[push] push decision", {
        decisionId: candidate.decisionId,
        mint: candidate.mint,
        pushDecision: "SEND",
        blockReason: null,
      });
    } catch (error) {
      await deletePushDelivery(deps.client, candidate.decisionId);
      const message = errorMessage(error);
      summary.errors.push({
        decisionId: candidate.decisionId,
        message,
      });
      console.error("[push] push decision", {
        decisionId: candidate.decisionId,
        mint: candidate.mint,
        pushDecision: "SEND_FAILED",
        blockReason: message,
      });
    }
  }

  return summary;
}
