import type { Client } from "@libsql/client";
import {
  getDueJobs,
  getExpiredPendingJobs,
  markJobMissedWindow,
  type SnapshotJobRow,
} from "../db/repositories/jobs";
import {
  acquireCollectionLock,
  LIFECYCLE_LOCK_KEY,
  releaseCollectionLock,
} from "../db/repositories/locks";
import { getTokenCase } from "../db/repositories/tokenCases";
import { processSnapshotJob } from "./process";
import type { MarketSnapshotInput } from "./types";

export type LifecycleMarketFetchFn = (
  mint: string,
) => Promise<MarketSnapshotInput>;

export type ProcessLifecycleJobsDeps = {
  client: Client;
  owner: string;
  fetchMarket: LifecycleMarketFetchFn;
  /** Milliseconds the lifecycle lock is held; defaults to 5 minutes. */
  lockDurationMs?: number;
  /** Max expired jobs to mark per run; defaults to 500. */
  expireLimit?: number;
  /** Max due jobs to process per run; defaults to 50. */
  jobLimit?: number;
  /** Injected clock; defaults to Date.now(). */
  now?: () => number;
};

export type LifecycleRunError = {
  phase: "expire" | "job" | "lock";
  context: string;
  message: string;
};

export type LifecycleRunSummary = {
  expiredJobs: number;
  processedJobs: number;
  snapshotsWritten: number;
  decisionsCreated: number;
  casesClosed: number;
  errors: LifecycleRunError[];
};

function emptySummary(): LifecycleRunSummary {
  return {
    expiredJobs: 0,
    processedJobs: 0,
    snapshotsWritten: 0,
    decisionsCreated: 0,
    casesClosed: 0,
    errors: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lifecycle-only runner: expire missed windows, then process in-window jobs.
 * Does not discover tokens or call GeckoTerminal.
 */
export async function processLifecycleJobs(
  deps: ProcessLifecycleJobsDeps,
): Promise<LifecycleRunSummary> {
  const now = deps.now ?? (() => Date.now());
  const lockDurationMs = deps.lockDurationMs ?? 5 * 60_000;
  const expireLimit = deps.expireLimit ?? 500;
  const jobLimit = deps.jobLimit ?? 50;
  const summary = emptySummary();

  const startedAt = now();
  const locked = await acquireCollectionLock(deps.client, {
    jobKey: LIFECYCLE_LOCK_KEY,
    owner: deps.owner,
    lockedUntil: startedAt + lockDurationMs,
    startedAt,
  });

  if (!locked) {
    summary.errors.push({
      phase: "lock",
      context: "lock",
      message: "Could not acquire lifecycle lock",
    });
    return summary;
  }

  try {
    const currentTime = now();

    // ---- phase 1: expire missed windows (no market fetch / no snapshots) --
    let expired: SnapshotJobRow[] = [];
    try {
      expired = await getExpiredPendingJobs(
        deps.client,
        currentTime,
        expireLimit,
      );
    } catch (err) {
      summary.errors.push({
        phase: "expire",
        context: "getExpiredPendingJobs",
        message: errorMessage(err),
      });
    }

    for (const job of expired) {
      const label = `job#${job.id}(${job.stage},case#${job.tokenCaseId})`;
      try {
        const marked = await markJobMissedWindow(
          deps.client,
          job.id,
          "WINDOW_EXPIRED",
        );
        if (marked) {
          summary.expiredJobs += 1;
        } else {
          summary.errors.push({
            phase: "expire",
            context: label,
            message: "Failed to mark MISSED_WINDOW",
          });
        }
      } catch (err) {
        summary.errors.push({
          phase: "expire",
          context: label,
          message: errorMessage(err),
        });
      }
    }

    // ---- phase 2: process due in-window jobs -----------------------------
    let dueJobs: SnapshotJobRow[] = [];
    try {
      dueJobs = await getDueJobs(deps.client, currentTime, jobLimit);
    } catch (err) {
      summary.errors.push({
        phase: "job",
        context: "getDueJobs",
        message: errorMessage(err),
      });
    }

    for (const job of dueJobs) {
      const jobLabel = `job#${job.id}(${job.stage},case#${job.tokenCaseId})`;

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

      if (tokenCase.caseStatus === "CLOSED") {
        continue;
      }

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

      const result = await processSnapshotJob({
        client: deps.client,
        tokenCase,
        job,
        market,
        owner: deps.owner,
        now: currentTime,
      });

      if (result.ok) {
        summary.processedJobs += 1;
        summary.snapshotsWritten += 1;
        if (result.decision != null) {
          summary.decisionsCreated += 1;
        }
        if (result.tokenCase.caseStatus === "CLOSED") {
          summary.casesClosed += 1;
        }
      } else {
        summary.errors.push({
          phase: "job",
          context: jobLabel,
          message: result.error,
        });
      }
    }
  } finally {
    await releaseCollectionLock(deps.client, {
      jobKey: LIFECYCLE_LOCK_KEY,
      owner: deps.owner,
      completedAt: now(),
    });
  }

  return summary;
}
