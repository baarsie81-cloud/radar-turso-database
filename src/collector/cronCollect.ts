import { createTursoClient } from "../db/client";
import {
  resolveMaxNewCasesPerRun,
  runCollection,
  type CollectionSummary,
  type DiscoveryFn,
  type MarketFetchFn,
} from "./run";
import { fetchNewSolanaPools } from "../providers/geckoterminal";
import { fetchMarketSnapshotByMint } from "../providers/dexscreener";

const DEFAULT_OWNER = "v24-cron-collect";

export type CollectCronEnv = {
  CRON_SECRET?: string;
  RADAR24_COLLECT_ENABLED?: string;
  TURSO_DATABASE_URL?: string;
  V24_MAX_NEW_CASES_PER_RUN?: string;
};

export type CollectCronDeps = {
  env?: CollectCronEnv;
  createClient?: typeof createTursoClient;
  runCollectionFn?: typeof runCollection;
  discoverTokens?: DiscoveryFn;
  fetchMarket?: MarketFetchFn;
  owner?: string;
};

function readEnv(overrides?: CollectCronEnv): CollectCronEnv {
  return {
    CRON_SECRET: overrides?.CRON_SECRET ?? process.env.CRON_SECRET,
    RADAR24_COLLECT_ENABLED:
      overrides?.RADAR24_COLLECT_ENABLED ?? process.env.RADAR24_COLLECT_ENABLED,
    TURSO_DATABASE_URL:
      overrides?.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL,
    V24_MAX_NEW_CASES_PER_RUN:
      overrides?.V24_MAX_NEW_CASES_PER_RUN
      ?? process.env.V24_MAX_NEW_CASES_PER_RUN,
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
 * Production collect cron entry.
 * Live providers run only when RADAR24_COLLECT_ENABLED === "true".
 */
export async function handleCollectCron(
  request: Request,
  deps: CollectCronDeps = {},
): Promise<Response> {
  const env = readEnv(deps.env);

  if (!isAuthorized(request, env.CRON_SECRET)) {
    return unauthorizedResponse();
  }

  if (env.RADAR24_COLLECT_ENABLED !== "true") {
    return Response.json({
      enabled: false,
      message: "collection disabled",
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
  const run = deps.runCollectionFn ?? runCollection;
  const discoverTokens =
    deps.discoverTokens ?? (() => fetchNewSolanaPools());
  const fetchMarket =
    deps.fetchMarket
    ?? ((mint: string) => fetchMarketSnapshotByMint(mint));
  const owner = deps.owner ?? DEFAULT_OWNER;

  const client = await createClient();
  try {
    const summary: CollectionSummary = await run({
      client,
      owner,
      discoverTokens,
      fetchMarket,
      maxNewCasesPerRun: resolveMaxNewCasesPerRun(
        undefined,
        env.V24_MAX_NEW_CASES_PER_RUN,
      ),
    });

    return Response.json({
      enabled: true,
      offered: summary.offered,
      discovered: summary.discovered,
      skipped: summary.skipped,
      jobsProcessed: summary.jobsProcessed,
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
