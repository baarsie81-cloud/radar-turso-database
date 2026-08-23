import type { Client } from "@libsql/client";
import type { HypothesisAssetRow } from "../db/repositories/hypothesis/assets";
import {
  claimHypothesisPushDelivery,
  deleteHypothesisPushDelivery,
} from "../db/repositories/hypothesis/pushDeliveries";
import { insertHypothesisEvent } from "../db/repositories/hypothesis/events";
import type { HypothesisScoreSnapshotRow } from "../db/repositories/hypothesis/scoreSnapshots";
import type { PushSubscriptionRow } from "../db/repositories/push";
import {
  type HypothesisEventType,
  type HypothesisPushEventType,
  type HypothesisStatus,
} from "../domain/hypothesis";
import {
  readVapidConfig,
  VapidConfigError,
  type VapidConfig,
  type VapidEnv,
  type WebPushTransport,
} from "../push/webpush";
import webpush from "web-push";
import type { ObservationChange } from "./observationChange";
import { detectObservationChange } from "./observationChange";

export type HypothesisObservationPushEnv = {
  RADAR24_HYPOTHESIS_OBSERVATION_PUSH?: string;
};

export function isHypothesisObservationPushEnabled(
  env: HypothesisObservationPushEnv | undefined,
): boolean {
  return env?.RADAR24_HYPOTHESIS_OBSERVATION_PUSH === "true";
}

export const HYPOTHESIS_OBSERVATION_PUSH_TITLE = "🧠 Hypothesis Observation";
export const HYPOTHESIS_OBSERVATION_PUSH_URL = "/hypothesis";

export type HypothesisObservationPushPayload = {
  title: string;
  body: string;
  url: string;
  mint: string;
  eventId: number;
  eventType: HypothesisPushEventType;
  hypothesisAssetId: number;
  symbol: string | null;
};

export type HypothesisObservationSendFn = (
  payload: HypothesisObservationPushPayload,
) => Promise<void>;

const STATUS_LABEL: Record<HypothesisStatus, string> = {
  WATCH: "WATCH — handmatig onderzoeken",
  ACTIVE: "ACTIVE — hypothesis volgen",
  INVALIDATED: "INVALIDATED",
};

function domainEventType(
  kind: ObservationChange["kind"],
): HypothesisEventType {
  return kind === "OBSERVATION_UPDATE" ? "OBSERVATION_UPDATE" : "SCORE_CHANGE";
}

function pushEventType(
  kind: ObservationChange["kind"],
): HypothesisPushEventType {
  return kind === "OBSERVATION_UPDATE"
    ? "HYPOTHESIS_OBSERVATION_UPDATE"
    : "HYPOTHESIS_SCORE_CHANGE";
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatChangeLine(change: ObservationChange): string {
  if (change.rankChangedInTop25) {
    return `rank ${change.previousRank ?? "—"} → ${change.nextRank ?? "—"}`;
  }
  const delta = change.scoreDelta;
  const signed = delta > 0 ? `+${formatScore(delta)}` : formatScore(delta);
  return `research score ${signed}`;
}

/**
 * Build research-only observation push copy.
 * No trade language (buy / entry / target / stop / signal).
 */
export function buildHypothesisObservationPushPayload(input: {
  asset: Pick<HypothesisAssetRow, "id" | "mint" | "symbol" | "name" | "status">;
  currentScore: number;
  change: ObservationChange;
  eventId: number;
  eventType: HypothesisPushEventType;
}): HypothesisObservationPushPayload {
  const coin =
    input.asset.symbol
    ?? input.asset.name
    ?? input.asset.mint.slice(0, 8);

  const body = [
    `Coin: ${coin}`,
    `Research score: ${formatScore(input.currentScore)}`,
    `Verandering: ${formatChangeLine(input.change)}`,
    `Belangrijkste reden: ${input.change.primaryReason}`,
    `Status: ${STATUS_LABEL[input.asset.status]}`,
  ].join("\n");

  return {
    title: HYPOTHESIS_OBSERVATION_PUSH_TITLE,
    body,
    url: HYPOTHESIS_OBSERVATION_PUSH_URL,
    mint: input.asset.mint,
    eventId: input.eventId,
    eventType: input.eventType,
    hypothesisAssetId: input.asset.id,
    symbol: input.asset.symbol,
  };
}

export type DeliverHypothesisObservationPushResult = {
  notified: boolean;
  eventId: number | null;
  pushEventType: HypothesisPushEventType | null;
  skippedReason:
    | "disabled"
    | "no_change"
    | "already_delivered"
    | "send_failed"
    | null;
  error: string | null;
};

/**
 * Create hypothesis event + claim delivery + send observation push (test layer).
 * Uses hypothesis_push_deliveries only — never Radar push_deliveries.
 * Does not change asset status or call Jupiter.
 */
export async function deliverHypothesisObservationPush(input: {
  client: Client;
  asset: HypothesisAssetRow;
  previous: HypothesisScoreSnapshotRow | null;
  current: HypothesisScoreSnapshotRow;
  env?: HypothesisObservationPushEnv;
  sendPush?: HypothesisObservationSendFn;
  now?: number;
}): Promise<DeliverHypothesisObservationPushResult> {
  if (!isHypothesisObservationPushEnabled(input.env)) {
    return {
      notified: false,
      eventId: null,
      pushEventType: null,
      skippedReason: "disabled",
      error: null,
    };
  }

  const change = detectObservationChange(
    input.previous
      ? {
          hypothesisScore: input.previous.hypothesisScore,
          rank: input.previous.rank,
          narrativeScore: input.previous.narrativeScore,
          asymmetryScore: input.previous.asymmetryScore,
          catalystScore: input.previous.catalystScore,
          attentionScore: input.previous.attentionScore,
          liquidityScore: input.previous.liquidityScore,
          status: input.previous.status,
        }
      : null,
    {
      hypothesisScore: input.current.hypothesisScore,
      rank: input.current.rank,
      narrativeScore: input.current.narrativeScore,
      asymmetryScore: input.current.asymmetryScore,
      catalystScore: input.current.catalystScore,
      attentionScore: input.current.attentionScore,
      liquidityScore: input.current.liquidityScore,
      status: input.current.status,
    },
  );

  if (!change) {
    return {
      notified: false,
      eventId: null,
      pushEventType: null,
      skippedReason: "no_change",
      error: null,
    };
  }

  const createdAt = input.now ?? Date.now();
  const domainType = domainEventType(change.kind);
  const pushType = pushEventType(change.kind);

  const event = await insertHypothesisEvent(input.client, {
    hypothesisAssetId: input.asset.id,
    eventType: domainType,
    createdAt,
    payloadJson: JSON.stringify({
      research_only: true,
      not_a_trade_alert: true,
      kind: change.kind,
      score_delta: change.scoreDelta,
      previous_rank: change.previousRank,
      next_rank: change.nextRank,
      reasons: change.reasons,
      primary_reason: change.primaryReason,
      component_deltas: change.componentDeltas,
      previous_score: input.previous?.hypothesisScore ?? null,
      current_score: input.current.hypothesisScore,
    }),
  });

  if (!input.sendPush) {
    return {
      notified: false,
      eventId: event.id,
      pushEventType: pushType,
      skippedReason: "send_failed",
      error: "No observation push transport configured",
    };
  }

  const claimed = await claimHypothesisPushDelivery(input.client, {
    eventId: event.id,
    eventType: pushType,
    sentAt: createdAt,
  });

  if (!claimed) {
    return {
      notified: false,
      eventId: event.id,
      pushEventType: pushType,
      skippedReason: "already_delivered",
      error: null,
    };
  }

  const payload = buildHypothesisObservationPushPayload({
    asset: input.asset,
    currentScore: input.current.hypothesisScore,
    change,
    eventId: event.id,
    eventType: pushType,
  });

  try {
    await input.sendPush(payload);
    return {
      notified: true,
      eventId: event.id,
      pushEventType: pushType,
      skippedReason: null,
      error: null,
    };
  } catch (error) {
    await deleteHypothesisPushDelivery(input.client, event.id);
    return {
      notified: false,
      eventId: event.id,
      pushEventType: pushType,
      skippedReason: "send_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Web Push sender for hypothesis observation payloads.
 * Reuses the same VAPID + subscription transport as Radar, without Radar push_deliveries.
 */
export function createHypothesisObservationWebPushSender(deps: {
  getSubscriptions: () => Promise<PushSubscriptionRow[]>;
  vapid?: VapidConfig | null;
  env?: VapidEnv;
  transport?: WebPushTransport;
}): HypothesisObservationSendFn {
  const vapid =
    deps.vapid === undefined ? readVapidConfig(deps.env) : deps.vapid;

  if (!vapid) {
    return async () => {
      throw new VapidConfigError(
        "VAPID is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
      );
    };
  }

  const transport: WebPushTransport = deps.transport ?? {
    sendNotification: (subscription, payload, options) =>
      webpush.sendNotification(subscription, payload, options),
    setVapidDetails: (subject, publicKey, privateKey) => {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    },
  };

  transport.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  return async (payload: HypothesisObservationPushPayload) => {
    const subscriptions = await deps.getSubscriptions();
    if (subscriptions.length === 0) {
      throw new Error("No push subscriptions configured");
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      mint: payload.mint,
    });
    const errors: string[] = [];

    for (const row of subscriptions) {
      try {
        await transport.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${row.endpoint}: ${message}`);
      }
    }

    if (errors.length === subscriptions.length) {
      throw new Error(
        `Hypothesis observation Web Push failed for all subscriptions: ${errors.join("; ")}`,
      );
    }
  };
}
