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
    VAPID_PUBLIC_KEY:
      overrides?.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY:
      overrides?.VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: overrides?.VAPID_SUBJECT ?? process.env.VAPID_SUBJECT,
  };
}

function isAuthorized(
  request: Request,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret || cronSecret.length === 0) {
    return false;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${cronSecret}`;
}

function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Push cron entry.
 * Live Web Push only when RADAR24_PUSH_ENABLED === "true".
 * Does not call evaluateRadar24 or discovery.
 */
export async function handlePushCron(
  request: Request,
  deps: PushCronDeps = {},
): Promise<Response> {
  const env = readEnv(deps.env);

  if (!isAuthorized(request, env.CRON_SECRET)) {
    return unauthorizedResponse();
  }

  if (env.RADAR24_PUSH_ENABLED !== "true") {
    return Response.json({
      enabled: false,
      message: "push disabled",
    });
  }

  if (!env.TURSO_DATABASE_URL) {
    return Response.json(
      {
        enabled: true,
        error: "TURSO_DATABASE_URL is required",
      },
      { status: 500 },
    );
  }

  const createClient = deps.createClient ?? createTursoClient;
  const run =
    deps.processPushDeliveriesWithWebPushFn
    ?? processPushDeliveriesWithWebPush;

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
    return Response.json(
      {
        enabled: true,
        error: message,
      },
      { status: 500 },
    );
  } finally {
    client.close();
  }
}

export function isPushEnabled(env: PushCronEnv = readEnv()): boolean {
  return env.RADAR24_PUSH_ENABLED === "true";
}
