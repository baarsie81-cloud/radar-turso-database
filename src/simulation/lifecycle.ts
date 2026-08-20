import type { Client } from "@libsql/client";
import { buildSnapshotJobSchedule } from "../collector/schedule";
import { listDecisionsByCase } from "../db/repositories/decisions";
import {
  createSnapshotJobsForCase,
  SNAPSHOT_JOB_STAGES,
  type SnapshotJobStage,
} from "../db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../db/repositories/snapshots";
import {
  createTokenCase,
  getTokenCase,
} from "../db/repositories/tokenCases";
import { processSnapshotJob } from "../lifecycle/process";
import type { MarketSnapshotInput } from "../lifecycle/types";
import type {
  CaseStatus,
  DecisionStatus,
  OutcomeLabel,
  RejectReason,
} from "../domain/types";

export type LifecycleMarketPrices = {
  INITIAL: number;
  PLUS_5: number;
  PLUS_10: number;
  PLUS_15: number;
  PLUS_30: number;
  PLUS_60: number;
};

export type SimulateLifecycleInput = {
  client: Client;
  mint: string;
  /** Entry / INITIAL price. Must match prices.INITIAL. */
  entryPrice: number;
  prices: LifecycleMarketPrices;
  firstSeenAt?: number;
  owner?: string;
  symbol?: string | null;
  name?: string | null;
};

export type SimulationResult = {
  caseId: number;
  decisionStatus: DecisionStatus | null;
  rejectReason: RejectReason | null;
  outcomeLabel: OutcomeLabel | null;
  snapshotsCreated: number;
  finalCaseStatus: CaseStatus;
};

export type SimulationFailure = {
  ok: false;
  error: string;
  result: SimulationResult | null;
};

export type SimulationSuccess = {
  ok: true;
  result: SimulationResult;
};

export type SimulateLifecycleResult = SimulationSuccess | SimulationFailure;

const DEFAULT_OWNER = "v24-simulation";
const DEFAULT_FIRST_SEEN_AT = 1_750_000_000_000;

function marketFor(
  price: number,
  capturedAt: number,
): MarketSnapshotInput {
  return {
    price,
    capturedAt,
    marketCap: null,
    liquidityUsd: null,
  };
}

/**
 * Deterministic end-to-end lifecycle simulation.
 *
 * Creates a token case + INITIAL snapshot + jobs, then drives every
 * PLUS_* job through the real `processSnapshotJob` with injected prices.
 * Does not call external providers.
 */
export async function simulateLifecycle(
  input: SimulateLifecycleInput,
): Promise<SimulateLifecycleResult> {
  const firstSeenAt = input.firstSeenAt ?? DEFAULT_FIRST_SEEN_AT;
  const owner = input.owner ?? DEFAULT_OWNER;
  const { client, mint, entryPrice, prices } = input;

  if (prices.INITIAL !== entryPrice) {
    return {
      ok: false,
      error: "prices.INITIAL must equal entryPrice",
      result: null,
    };
  }

  const tokenCase = await createTokenCase(client, {
    mint,
    symbol: input.symbol ?? null,
    name: input.name ?? null,
    firstSeenAt,
    entryPrice,
    entryValid: true,
    stage: "INITIAL",
    caseStatus: "OPEN",
    createdAt: firstSeenAt,
  });

  await upsertSnapshot(client, {
    tokenCaseId: tokenCase.id,
    stage: "INITIAL",
    capturedAt: firstSeenAt,
    price: prices.INITIAL,
    roiPct: 0,
  });

  const jobs = await createSnapshotJobsForCase(client, {
    tokenCaseId: tokenCase.id,
    jobs: buildSnapshotJobSchedule(firstSeenAt),
    createdAt: firstSeenAt,
  });

  // Process stages in schedule order (PLUS_5 → … → PLUS_60).
  for (const stage of SNAPSHOT_JOB_STAGES) {
    const job = jobs.find((row) => row.stage === stage);
    if (!job) {
      return {
        ok: false,
        error: `Missing snapshot job for stage ${stage}`,
        result: null,
      };
    }

    const currentCase = await getTokenCase(client, tokenCase.id);
    if (!currentCase) {
      return {
        ok: false,
        error: `Token case ${tokenCase.id} disappeared`,
        result: null,
      };
    }

    // After CLOSE we would not continue, but PLUS_60 is the closer.
    if (currentCase.caseStatus === "CLOSED") {
      break;
    }

    const price = prices[stage as SnapshotJobStage];
    const result = await processSnapshotJob({
      client,
      tokenCase: currentCase,
      job,
      owner,
      now: job.scheduledFor,
      market: marketFor(price, job.scheduledFor),
    });

    if (!result.ok) {
      return {
        ok: false,
        error: `Failed processing ${stage}: ${result.error}`,
        result: null,
      };
    }
  }

  const finalCase = await getTokenCase(client, tokenCase.id);
  if (!finalCase) {
    return {
      ok: false,
      error: `Token case ${tokenCase.id} not found after simulation`,
      result: null,
    };
  }

  const decisions = await listDecisionsByCase(client, tokenCase.id);
  const plus10 = decisions.find((d) => d.decisionStage === "PLUS_10") ?? null;
  const snapshots = await listSnapshotsByCase(client, tokenCase.id);

  return {
    ok: true,
    result: {
      caseId: finalCase.id,
      decisionStatus: plus10?.decisionStatus ?? null,
      rejectReason: (plus10?.rejectReason as RejectReason | null) ?? null,
      outcomeLabel: finalCase.outcomeLabel,
      snapshotsCreated: snapshots.length,
      finalCaseStatus: finalCase.caseStatus,
    },
  };
}
