import type { Client, Row } from "@libsql/client";
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

  const inserted = result.rows[0];
  if (inserted) {
    return mapPushDeliveryRow(inserted);
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
