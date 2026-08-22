import type { Client } from "@libsql/client";
import {
  upsertPushSubscription,
  type PushSubscriptionRow,
} from "../db/repositories/push";

export type BrowserPushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parse a browser PushSubscription JSON (or flat p256dh/auth shape).
 */
export function parseBrowserPushSubscription(
  value: unknown,
): BrowserPushSubscriptionInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.endpoint)) {
    return null;
  }

  const keys =
    row.keys && typeof row.keys === "object"
      ? (row.keys as Record<string, unknown>)
      : null;

  const p256dh = isNonEmptyString(row.p256dh)
    ? row.p256dh
    : keys && isNonEmptyString(keys.p256dh)
      ? keys.p256dh
      : null;
  const auth = isNonEmptyString(row.auth)
    ? row.auth
    : keys && isNonEmptyString(keys.auth)
      ? keys.auth
      : null;

  if (p256dh == null || auth == null) {
    return null;
  }

  return {
    endpoint: row.endpoint,
    p256dh,
    auth,
    userAgent: typeof row.userAgent === "string" ? row.userAgent : null,
  };
}

/**
 * Upsert a browser push subscription into Turso (dedupe by endpoint).
 */
export async function savePushSubscription(
  client: Client,
  input: BrowserPushSubscriptionInput,
): Promise<PushSubscriptionRow> {
  return upsertPushSubscription(client, {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent,
  });
}
