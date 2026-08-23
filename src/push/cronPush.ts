import { createTursoClient } from "../db/client";
import {
  processPushDeliveriesWithWebPush,
  type ProcessPushWithWebPushDeps,
} from "./run";
import type { PushDeliverySummary } from "./types";
import type { VapidEnv } from "./webpush";

export type PushCronEnv = VapidEnv & {
  CRON_SECRET?: string;
  RADAR24_PUSH_ENABLED?: string;
  TURSO_DATABASE_URL?: string;
};

export type PushCronDeps = {
  env?: PushCronEnv;
  createClient?: typeof createTursoClient;
  processPushDeliveriesWithWebPushFn?: typeof processPushDeliveriesWithWebPush;
};

function readEnv(overrides?: PushCronEnv): PushCronEnv {
  return {
    CRON_SECRET: overrides?.CRON_SECRET ?? process.env.CRON_SECRET,
    RADAR24_PUSH_ENABLED:
      overrides?.RADAR24_PUSH_ENABLED ?? process.env.RADAR24_PUSH_ENABLED,
    TURSO_DATABASE_URL:
      overrides?.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL,
    VAPID_PUBLIC_KEY: overrides?.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: overrides?.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: overrides?.VAPID_SUBJECT ?? process.env.VAPID_SUBJECT,
  };
}

function isAuthorized(request: Request, cronSecret: string | undefined): boolean {
  if (!cronSecret || cronSecret.length === 0) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Push cron entry with observability.
 * This does not change selection or delivery logic.
 */
export async function handlePushCron(
  request: Request,
  deps: PushCronDeps = {},
): Promise<Response> {
  const env = readEnv(deps.env);
  const startedAt = Date.now();

  if (!isAuthorized(request, env.CRON_SECRET)) {
    console.warn("[push] unauthorized request");
    return unauthorizedResponse();
  }

  console.info("[push] cron started", {
    enabled: env.RADAR24_PUSH_ENABLED,
    time: new Date().toISOString(),
  });

  if (env.RADAR24_PUSH_ENABLED !== "true") {
    console.info("[push] disabled");
    return Response.json({ enabled: false, message: "push disabled" });
  }

  if (!env.TURSO_DATABASE_URL) {
    console.error("[push] missing TURSO_DATABASE_URL");
    return Response.json({ enabled: true, error: "TURSO_DATABASE_URL is required" }, { status: 500 });
  }

  const createClient = deps.createClient ?? createTursoClient;
  const run = deps.processPushDeliveriesWithWebPushFn ?? processPushDeliveriesWithWebPush;
  const client = await createClient();

  try {
    const runDeps: ProcessPushWithWebPushDeps = {
      client,
      env: {
        VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: env.VAPID_SUBJECT,
      },
    };

    const summary: PushDeliverySummary = await run(runDeps);

    console.info("[push] cron finished", {
      candidates: summary.candidates,
      delivered: summary.delivered,
      skipped: summary.skipped,
      errors: summary.errors.length,
      durationMs: Date.now() - startedAt,
    });

    if (summary.errors.length > 0) {
      console.error("[push] delivery errors", summary.errors);
    }

    return Response.json({
      enabled: true,
      candidates: summary.candidates,
      sent: summary.delivered,
      failed: summary.errors.length,
      skipped: summary.skipped,
      errors: summary.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push] cron failed", { message });
    return Response.json({ enabled: true, error: message }, { status: 500 });
  } finally {
    client.close();
  }
}

export function isPushEnabled(env: PushCronEnv = readEnv()): boolean {
  return env.RADAR24_PUSH_ENABLED === "true";
}
