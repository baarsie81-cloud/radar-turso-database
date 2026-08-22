import type { Client } from "@libsql/client";
import {
  claimPushDelivery,
  deletePushDelivery,
} from "../db/repositories/push";
import { buildPassPushPayload } from "./payload";
import { selectPassPushCandidates } from "./select";
import type {
  PushDeliverySummary,
  PushPayload,
  PushSendFn,
} from "./types";

export type ProcessPushDeliveriesDeps = {
  client: Client;
  /** Transport for the built payload (VAPID/web-push injected later). */
  sendPush: PushSendFn;
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
  };
}

/**
 * Deliver push notifications for undelivered PASS @ PLUS_10 decisions.
 *
 * Flow: select stored decisions → build payload → claim delivery → send.
 * Does not call evaluateRadar24. Deduplicates by decision_id.
 */
export async function processPushDeliveries(
  deps: ProcessPushDeliveriesDeps,
): Promise<PushDeliverySummary> {
  const now = deps.now ?? (() => Date.now());
  const limit = deps.limit ?? 50;
  const candidates = await selectPassPushCandidates(deps.client, limit);
  const summary = emptySummary(candidates.length);

  for (const candidate of candidates) {
    const payload: PushPayload = buildPassPushPayload(candidate);

    const claimed = await claimPushDelivery(deps.client, {
      decisionId: candidate.decisionId,
      tokenCaseId: candidate.tokenCaseId,
      sentAt: now(),
    });

    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    try {
      await deps.sendPush(payload);
      summary.delivered += 1;
    } catch (error) {
      await deletePushDelivery(deps.client, candidate.decisionId);
      summary.errors.push({
        decisionId: candidate.decisionId,
        message: errorMessage(error),
      });
    }
  }

  return summary;
}
