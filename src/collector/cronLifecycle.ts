import { createTursoClient } from "../db/client";
import {
  processLifecycleJobs,
  type LifecycleMarketFetchFn,
  type LifecycleRunSummary,
} from "../lifecycle/run";
import { fetchMarketSnapshotByMint } from "../providers/dexscreener";

const DEFAULT_OWNER = "v24-cron-lifecycle";

export type LifecycleCronEnv = {
  CRON_SECRET?: string;
  RADAR24_LIFECYCLE_ENABLED?: string;
  TURSO_DATABASE_URL?: string;
};

export type LifecycleCronDeps = {
  env?: LifecycleCronEnv;
  createClient?: typeof createTursoClient;
  processLifecycleJobsFn?: typeof processLifecycleJobs;
  fetchMarket?: LifecycleMarketFetchFn;
  owner?: string;
};

function readEnv(overrides?: LifecycleCronEnv): LifecycleCronEnv {
  return {
    CRON_SECRET: overrides?.CRON_SECRET ?? process.env.CRON_SECRET,
    RADAR24_LIFECYCLE_ENABLED:
      overrides?.RADAR24_LIFECYCLE_ENABLED
      ?? process.env.RADAR24_LIFECYCLE_ENABLED,
    TURSO_DATABASE_URL:
      overrides?.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL,
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
 * Lifecycle cron preparation helper (no HTTP route yet).
 * Live DexScreener processing only when RADAR24_LIFECYCLE_ENABLED === "true".
 * Does not call GeckoTerminal / discovery.
 */
export async function handleLifecycleCron(
  request: Request,
  deps: LifecycleCronDeps = {},
): Promise<Response> {
  const env = readEnv(deps.env);

  if (!isAuthorized(request, env.CRON_SECRET)) {
    return unauthorizedResponse();
  }

  if (env.RADAR24_LIFECYCLE_ENABLED !== "true") {
    return Response.json({
      enabled: false,
      message: "lifecycle disabled",
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
  const run = deps.processLifecycleJobsFn ?? processLifecycleJobs;
  const fetchMarket =
    deps.fetchMarket
    ?? ((mint: string) => fetchMarketSnapshotByMint(mint));
  const owner = deps.owner ?? DEFAULT_OWNER;

  const client = await createClient();
  try {
    const summary: LifecycleRunSummary = await run({
      client,
      owner,
      fetchMarket,
    });

    return Response.json({
      enabled: true,
      expiredJobs: summary.expiredJobs,
      processedJobs: summary.processedJobs,
      snapshotsWritten: summary.snapshotsWritten,
      decisionsCreated: summary.decisionsCreated,
      casesClosed: summary.casesClosed,
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

export function isLifecycleEnabled(
  env: LifecycleCronEnv = readEnv(),
): boolean {
  return env.RADAR24_LIFECYCLE_ENABLED === "true";
}
