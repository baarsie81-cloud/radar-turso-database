import type { Client, Row } from "@libsql/client";
import { RADAR_VERSION } from "../../domain/types";
import { num, numOrNull, str, strOrNull } from "../map";

export type UpsertPushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt: number | null;
};

export type CreatePushDeliveryInput = {
  decisionId: number;
  tokenCaseId: number;
  sentAt?: number;
};

export type PushDeliveryRow = {
  decisionId: number;
  tokenCaseId: number;
  sentAt: number;
};

export function mapPushSubscriptionRow(row: Row): PushSubscriptionRow {
  return {
    endpoint: str(row.endpoint),
    p256dh: str(row.p256dh),
    auth: str(row.auth),
    userAgent: strOrNull(row.user_agent),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    lastSuccessAt: numOrNull(row.last_success_at),
  };
}

export function mapPushDeliveryRow(row: Row): PushDeliveryRow {
  return {
    decisionId: num(row.decision_id),
    tokenCaseId: num(row.token_case_id),
    sentAt: num(row.sent_at),
  };
}

export async function upsertPushSubscription(
  client: Client,
  input: UpsertPushSubscriptionInput,
): Promise<PushSubscriptionRow> {
  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  const result = await client.execute({
    sql: `
      INSERT INTO push_subscriptions (
        endpoint, p256dh, auth, user_agent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at
      RETURNING *
    `,
    args: [
      input.endpoint,
      input.p256dh,
      input.auth,
      input.userAgent ?? null,
      createdAt,
      updatedAt,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to upsert push subscription");
  }
  return mapPushSubscriptionRow(row);
}

export async function deletePushSubscription(
  client: Client,
  endpoint: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: "DELETE FROM push_subscriptions WHERE endpoint = ? RETURNING endpoint",
    args: [endpoint],
  });
  return result.rows.length > 0;
}

export async function getPushSubscriptions(
  client: Client,
): Promise<PushSubscriptionRow[]> {
  const result = await client.execute(
    "SELECT * FROM push_subscriptions ORDER BY updated_at DESC, endpoint",
  );
  return result.rows.map(mapPushSubscriptionRow);
}

export async function hasPushDelivery(
  client: Client,
  decisionId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 AS present FROM push_deliveries WHERE decision_id = ? LIMIT 1",
    args: [decisionId],
  });
  return result.rows.length > 0;
}

export async function createPushDelivery(
  client: Client,
  input: CreatePushDeliveryInput,
): Promise<PushDeliveryRow> {
  const claimed = await claimPushDelivery(client, input);
  if (claimed) {
    return claimed;
  }

  const existing = await client.execute({
    sql: "SELECT * FROM push_deliveries WHERE decision_id = ?",
    args: [input.decisionId],
  });
  const row = existing.rows[0];
  if (!row) {
    throw new Error("Failed to create push delivery");
  }
  return mapPushDeliveryRow(row);
}

/**
 * Insert a delivery row for deduplication. Returns null if already delivered.
 */
export async function claimPushDelivery(
  client: Client,
  input: CreatePushDeliveryInput,
): Promise<PushDeliveryRow | null> {
  const sentAt = input.sentAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO push_deliveries (decision_id, token_case_id, sent_at)
      VALUES (?, ?, ?)
      ON CONFLICT(decision_id) DO NOTHING
      RETURNING *
    `,
    args: [input.decisionId, input.tokenCaseId, sentAt],
  });

  const row = result.rows[0];
  return row ? mapPushDeliveryRow(row) : null;
}

export async function deletePushDelivery(
  client: Client,
  decisionId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: "DELETE FROM push_deliveries WHERE decision_id = ? RETURNING decision_id",
    args: [decisionId],
  });
  return result.rows.length > 0;
}

export type UndeliveredPassDecisionRow = {
  decisionId: number;
  tokenCaseId: number;
  decidedAt: number;
  decisionStatus: string;
  decisionStage: string;
  radarVersion: string;
  entryPrice: number | null;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum5To10Pct: number | null;
  mint: string;
  symbol: string | null;
  name: string | null;
};

/**
 * PASS @ PLUS_10 @ radar 2.4 decisions with no push_deliveries row yet.
 * Push is not a decision layer — only reads stored decisions.
 */
export async function listUndeliveredPassPlus10Decisions(
  client: Client,
  limit = 50,
  radarVersion: string = RADAR_VERSION,
): Promise<UndeliveredPassDecisionRow[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await client.execute({
    sql: `
      SELECT
        d.id AS decision_id,
        d.token_case_id AS token_case_id,
        d.decided_at AS decided_at,
        d.decision_status AS decision_status,
        d.decision_stage AS decision_stage,
        d.radar_version AS radar_version,
        d.entry_price AS entry_price,
        d.plus5_roi_pct AS plus5_roi_pct,
        d.plus10_roi_pct AS plus10_roi_pct,
        d.momentum_5_to_10_pct AS momentum_5_to_10_pct,
        tc.mint AS mint,
        tc.symbol AS symbol,
        tc.name AS name
      FROM decisions d
      INNER JOIN token_cases tc ON tc.id = d.token_case_id
      WHERE d.decision_status = 'PASS'
        AND d.decision_stage = 'PLUS_10'
        AND d.radar_version = ?
        AND NOT EXISTS (
          SELECT 1 FROM push_deliveries pd
          WHERE pd.decision_id = d.id
        )
      ORDER BY d.decided_at ASC, d.id ASC
      LIMIT ?
    `,
    args: [radarVersion, safeLimit],
  });

  return result.rows.map((row) => ({
    decisionId: num(row.decision_id),
    tokenCaseId: num(row.token_case_id),
    decidedAt: num(row.decided_at),
    decisionStatus: str(row.decision_status),
    decisionStage: str(row.decision_stage),
    radarVersion: str(row.radar_version),
    entryPrice: numOrNull(row.entry_price),
    plus5RoiPct: numOrNull(row.plus5_roi_pct),
    plus10RoiPct: numOrNull(row.plus10_roi_pct),
    momentum5To10Pct: numOrNull(row.momentum_5_to_10_pct),
    mint: str(row.mint),
    symbol: strOrNull(row.symbol),
    name: strOrNull(row.name),
  }));
}
