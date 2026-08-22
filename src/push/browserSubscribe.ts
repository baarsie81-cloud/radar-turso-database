/**
 * Browser push subscription helpers (no Web Push send, no decision engine).
 */

export type PushUiStatus =
  | "unsupported"
  | "idle"
  | "denied"
  | "enabled"
  | "error"
  | "loading";

export type BrowserSubscriptionJson = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

/**
 * Map Notification.permission into a UI status (before/without subscribe).
 */
export function statusFromNotificationPermission(
  permission: NotificationPermission | "unsupported",
): Exclude<PushUiStatus, "loading" | "error" | "enabled"> {
  if (permission === "unsupported") {
    return "unsupported";
  }
  if (permission === "denied") {
    return "denied";
  }
  return "idle";
}

/**
 * Resolve initial push UI status from permission + existing subscription.
 */
export function resolveInitialPushStatus(input: {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  hasSubscription: boolean;
}): Exclude<PushUiStatus, "loading" | "error"> {
  if (!input.supported || input.permission === "unsupported") {
    return "unsupported";
  }
  if (input.permission === "denied") {
    return "denied";
  }
  if (input.hasSubscription && input.permission === "granted") {
    return "enabled";
  }
  return "idle";
}

/**
 * Convert a browser PushSubscription (or toJSON() result) into POST body shape.
 */
export function browserSubscriptionToPayload(
  value: unknown,
): BrowserSubscriptionJson | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.endpoint !== "string" || row.endpoint.length === 0) {
    return null;
  }

  const keys =
    row.keys && typeof row.keys === "object"
      ? (row.keys as Record<string, unknown>)
      : null;
  const p256dh =
    keys && typeof keys.p256dh === "string" && keys.p256dh.length > 0
      ? keys.p256dh
      : null;
  const auth =
    keys && typeof keys.auth === "string" && keys.auth.length > 0
      ? keys.auth
      : null;

  if (p256dh == null || auth == null) {
    return null;
  }

  return {
    endpoint: row.endpoint,
    keys: { p256dh, auth },
  };
}

/** Decode a URL-safe base64 VAPID public key for PushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isPushSupported(
  serviceWorker?: unknown,
  pushManager?: unknown,
  notification?: unknown,
): boolean {
  return (
    typeof serviceWorker !== "undefined"
    && typeof pushManager !== "undefined"
    && typeof notification !== "undefined"
  );
}
