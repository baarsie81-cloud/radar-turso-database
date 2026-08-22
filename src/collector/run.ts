import type { Client } from "@libsql/client";
import {
  acquireCollectionLock,
  DEFAULT_COLLECTION_LOCK_KEY,
  releaseCollectionLock,
} from "../db/repositories/locks";
import { getDueJobs, type SnapshotJobRow } from "../db/repositories/jobs";
import { getTokenCase } from "../db/repositories/tokenCases";
import { processSnapshotJob } from "../lifecycle/process";
import type { MarketSnapshotInput } from "../lifecycle/types";
import type { DiscoveredToken } from "../providers/types";
import { persistDiscoveredTokens } from "./discovery";

// ---- dependency injection types ----------------------------------------

export type DiscoveryFn = () => Promise<DiscoveredToken[]>;

export type MarketFetchFn = (mint: string) => Promise<MarketSnapshotInput>;

export const DEFAULT_MAX_NEW_CASES_PER_RUN = 1;

export type RunCollectionDeps = {
  client: Client;
  owner: string;
  discoverTokens: DiscoveryFn;
  fetchMarket: MarketFetchFn;
  /** Milliseconds the lock is held for; defaults to 5 minutes. */
  lockDurationMs?: number;
  /** Maximum due jobs to pull per run; defaults to 50. */
  jobLimit?: number;
  /** Max new token_cases to create per run; defaults to V24_MAX_NEW_CASES_PER_RUN or 1. */
  maxNewCasesPerRun?: number;
  /** Injected clock; defaults to Date.now(). */
  now?: () => number;
};

// ---- summary type -------------------------------------------------------

export type CollectionSummary = {
  /** Tokens returned by the discovery provider this run. */
  offered: number;
  /** New token_cases created from discovery. */
  discovered: number;
  skipped: number;
  jobsProcessed: number;
  snapshotsWritten: number;
  decisionsCreated: number;
  casesClosed: number;
  errors: CollectionError[];
};

export type CollectionError = {
  phase: "discovery" | "job";
  context: string;
  message: string;
};

// ---- internal helpers ---------------------------------------------------

export function resolveMaxNewCasesPerRun(
  override?: number,
  envValue?: string,
): number {
  if (override != null) {
    return override;
  }
  const raw = envValue ?? process.env.V24_MAX_NEW_CASES_PER_RUN;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MAX_NEW_CASES_PER_RUN;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_NEW_CASES_PER_RUN;
  }
  return parsed;
}

function emptySummary(): CollectionSummary {
  return {
    offered: 0,
    discovered: 0,
    skipped: 0,
    jobsProcessed: 0,
    snapshotsWritten: 0,
    decisionsCreated: 0,
    casesClosed: 0,
    errors: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- main orchestration -------------------------------------------------

export async function runCollection(
  deps: RunCollectionDeps,
): Promise<CollectionSummary> {
  const now = deps.now ?? (() => Date.now());
  const lockDurationMs = deps.lockDurationMs ?? 5 * 60_000;
  const jobLimit = deps.jobLimit ?? 50;
  const maxNewCasesPerRun = resolveMaxNewCasesPerRun(deps.maxNewCasesPerRun);
  const summary = emptySummary();

  const startedAt = now();
  const locked = await acquireCollectionLock(deps.client, {
    jobKey: DEFAULT_COLLECTION_LOCK_KEY,
    owner: deps.owner,
    lockedUntil: startedAt + lockDurationMs,
    startedAt,
  });

  if (!locked) {
    summary.errors.push({
      phase: "discovery",
      context: "lock",
      message: "Could not acquire collection lock",
    });
    return summary;
  }

  try {
    // ---- phase 1: discovery -------------------------------------------
    let tokens: DiscoveredToken[] = [];
    try {
      tokens = await deps.discoverTokens();
    } catch (err) {
      summary.errors.push({
        phase: "discovery",
        context: "fetchNewPools",
        message: errorMessage(err),
      });
    }

    summary.offered = tokens.length;

    if (tokens.length > 0) {
      try {
        const persistResult = await persistDiscoveredTokens(
          deps.client,
          tokens,
          { createdAt: now(), maxNewCasesPerRun },
        );
        summary.discovered += persistResult.created;
        summary.skipped += persistResult.skipped;
      } catch (err) {
        summary.errors.push({
          phase: "discovery",
          context: "persistDiscoveredTokens",
          message: errorMessage(err),
        });
      }
    }

    // ---- phase 2: snapshot jobs ---------------------------------------
    const currentTime = now();
    let dueJobs: SnapshotJobRow[];
    try {
      dueJobs = await getDueJobs(deps.client, currentTime, jobLimit);
    } catch (err) {
      summary.errors.push({
        phase: "job",
        context: "getDueJobs",
        message: errorMessage(err),
      });
      dueJobs = [];
    }

    for (const job of dueJobs) {
      const jobLabel = `job#${job.id}(${job.stage},case#${job.tokenCaseId})`;

      // load token case
      let tokenCase;
      try {
        tokenCase = await getTokenCase(deps.client, job.tokenCaseId);
      } catch (err) {
        summary.errors.push({
          phase: "job",
          context: jobLabel,
          message: `getTokenCase: ${errorMessage(err)}`,
        });
        continue;
      }

      if (!tokenCase) {
        summary.errors.push({
          phase: "job",
          context: jobLabel,
          message: "Token case not found",
        });
        continue;
      }

      // skip already-closed cases
      if (tokenCase.caseStatus === "CLOSED") {
        continue;
      }

      // fetch market data — do not claim the job before we have data
      let market: MarketSnapshotInput;
      try {
        market = await deps.fetchMarket(tokenCase.mint);
      } catch (err) {
        summary.errors.push({
          phase: "job",
          context: jobLabel,
          message: `fetchMarket(${tokenCase.mint}): ${errorMessage(err)}`,
        });
        continue;
      }

      // process
      const result = await processSnapshotJob({
        client: deps.client,
        tokenCase,
        job,
        market,
        owner: deps.owner,
        now: currentTime,
      });

      if (result.ok) {
        summary.jobsProcessed += 1;
        summary.snapshotsWritten += 1;
        if (result.decision != null) {
          summary.decisionsCreated += 1;
        }
        if (result.tokenCase.caseStatus === "CLOSED") {
          summary.casesClosed += 1;
        }
      } else {
        // processSnapshotJob already handles retry/release internally;
        // still surface the error in the summary
        summary.errors.push({
          phase: "job",
          context: jobLabel,
          message: result.error,
        });
      }
    }
  } finally {
    await releaseCollectionLock(deps.client, {
      jobKey: DEFAULT_COLLECTION_LOCK_KEY,
      owner: deps.owner,
      completedAt: now(),
    });
  }

  return summary;
}
