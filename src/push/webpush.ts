import webpush from "web-push";
import type { PushSubscriptionRow } from "../db/repositories/push";
import { toServiceWorkerPushData } from "./swPayload";
import type { PushPayload, PushSendFn } from "./types";

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type VapidEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export class VapidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VapidConfigError";
  }
}

function readEnv(overrides?: VapidEnv): VapidEnv {
  return {
    VAPID_PUBLIC_KEY:
      overrides?.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY:
      overrides?.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: overrides?.VAPID_SUBJECT ?? process.env.VAPID_SUBJECT,
  };
}

/**
 * Read VAPID settings from env. Returns null when incomplete (safe fail).
 */
export function readVapidConfig(overrides?: VapidEnv): VapidConfig | null {
  const env = readEnv(overrides);
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

export function requireVapidConfig(overrides?: VapidEnv): VapidConfig {
  const config = readVapidConfig(overrides);
  if (!config) {
    throw new VapidConfigError(
      "VAPID is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
    );
  }
  return config;
}

export type WebPushTransport = {
  sendNotification: (
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload: string,
    options?: { TTL?: number },
  ) => Promise<unknown>;
  setVapidDetails: (
    subject: string,
    publicKey: string,
    privateKey: string,
  ) => void;
};

export type CreateWebPushSenderDeps = {
  /** Load active browser subscriptions from Turso. */
  getSubscriptions: () => Promise<PushSubscriptionRow[]>;
  vapid?: VapidConfig | null;
  env?: VapidEnv;
  /** Injectable web-push client for tests. */
  transport?: WebPushTransport;
};

/**
 * Build a PushSendFn backed by standard web-push + stored subscriptions.
 * Fails safely when VAPID env is missing.
 */
export function createWebPushSender(
  deps: CreateWebPushSenderDeps,
): PushSendFn {
  const vapid =
    deps.vapid === undefined
      ? readVapidConfig(deps.env)
      : deps.vapid;

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

  return async (payload: PushPayload) => {
    const subscriptions = await deps.getSubscriptions();
    if (subscriptions.length === 0) {
      throw new Error("No push subscriptions configured");
    }

    const body = JSON.stringify(toServiceWorkerPushData(payload));
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
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(`${row.endpoint}: ${message}`);
      }
    }

    if (errors.length === subscriptions.length) {
      throw new Error(`Web Push failed for all subscriptions: ${errors.join("; ")}`);
    }
  };
}
