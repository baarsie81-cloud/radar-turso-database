import type { Client } from "@libsql/client";
import { storeDecision } from "../db/repositories/decisions";
import {
  claimJob,
  completeJob,
  releaseJobForRetry,
  SNAPSHOT_JOB_STAGES,
  type SnapshotJobRow,
} from "../db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../db/repositories/snapshots";
import {
  closeCase,
  type TokenCaseRow,
  updateTokenCaseStage,
} from "../db/repositories/tokenCases";
import { evaluateRadar24, roiPct } from "../decisions/engine";
import type { Snapshot, SnapshotStage } from "../domain/types";
import type { DecisionRow } from "../db/repositories/decisions";
import type { SnapshotRow } from "../db/repositories/snapshots";
import type { MarketSnapshotInput } from "./types";

export type { MarketSnapshotInput } from "./types";

export type ProcessSnapshotJobInput = {
  client: Client;
  tokenCase: TokenCaseRow;
  job: SnapshotJobRow;
  market: MarketSnapshotInput;
  owner: string;
  now?: number;
};

export type ProcessSnapshotJobSuccess = {
  ok: true;
  job: SnapshotJobRow;
  tokenCase: TokenCaseRow;
  snapshot: SnapshotRow;
  decision: DecisionRow | null;
};

export type ProcessSnapshotJobFailure = {
  ok: false;
  error: string;
  job: SnapshotJobRow | null;
};

export type ProcessSnapshotJobResult =
  | ProcessSnapshotJobSuccess
  | ProcessSnapshotJobFailure;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateJobInput(
  tokenCase: TokenCaseRow,
  job: SnapshotJobRow,
): string | null {
  if (job.tokenCaseId !== tokenCase.id) {
    return "Job does not belong to token case";
  }
  if (!(SNAPSHOT_JOB_STAGES as readonly string[]).includes(job.stage)) {
    return "Invalid job stage";
  }
  if (tokenCase.caseStatus === "CLOSED") {
    return "Token case is already closed";
  }
  return null;
}

function validateMarketInput(market: MarketSnapshotInput): string | null {
  if (!Number.isFinite(market.price) || market.price <= 0) {
    return "Invalid market price";
  }
  if (!Number.isFinite(market.capturedAt) || market.capturedAt <= 0) {
    return "Invalid market capturedAt";
  }
  return null;
}

function snapshotsByStage(
  rows: SnapshotRow[],
): Partial<Record<SnapshotStage, Snapshot>> {
  const mapped: Partial<Record<SnapshotStage, Snapshot>> = {};
  for (const row of rows) {
    mapped[row.stage] = {
      stage: row.stage,
      capturedAt: row.capturedAt,
      price: row.price,
      roiPct: row.roiPct,
      marketCap: row.marketCap,
      liquidityUsd: row.liquidityUsd,
    };
  }
  return mapped;
}

function entryRoiPct(
  tokenCase: TokenCaseRow,
  price: number,
): number | null {
  const entryPrice = tokenCase.entryPrice;
  if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return null;
  }
  return roiPct(price, entryPrice);
}

async function evaluatePlus10Decision(
  client: Client,
  tokenCase: TokenCaseRow,
  decidedAt: number,
): Promise<DecisionRow> {
  const snapshotRows = await listSnapshotsByCase(client, tokenCase.id);
  const snapshots = snapshotsByStage(snapshotRows);
  const result = evaluateRadar24({
    tokenCaseId: tokenCase.id,
    radarVersion: tokenCase.radarVersion,
    decisionStage: "PLUS_10",
    decidedAt,
    entry: {
      entryPrice: tokenCase.entryPrice,
      entryValid: tokenCase.entryValid,
    },
    snapshots,
  });

  return storeDecision(client, {
    tokenCaseId: result.tokenCaseId,
    decisionStage: result.decisionStage,
    decidedAt: result.decidedAt,
    decisionStatus: result.decisionStatus,
    rejectReason: result.rejectReason,
    radarVersion: result.radarVersion,
    entryPrice: result.entryPrice,
    plus5RoiPct: result.plus5RoiPct,
    plus10RoiPct: result.plus10RoiPct,
    momentum5To10Pct: result.momentum5To10Pct,
    inputsJson: result.inputsJson,
  });
}

export async function processSnapshotJob(
  input: ProcessSnapshotJobInput,
): Promise<ProcessSnapshotJobResult> {
  const now = input.now ?? Date.now();
  const validationError =
    validateJobInput(input.tokenCase, input.job)
    ?? validateMarketInput(input.market);
  if (validationError) {
    return { ok: false, error: validationError, job: null };
  }

  const claimed = await claimJob(input.client, input.job.id, input.owner, now);
  if (!claimed) {
    return { ok: false, error: "Job is not claimable", job: null };
  }

  try {
    const stage = claimed.stage as SnapshotStage;
    const snapshot = await upsertSnapshot(input.client, {
      tokenCaseId: input.tokenCase.id,
      stage,
      capturedAt: input.market.capturedAt,
      price: input.market.price,
      roiPct: entryRoiPct(input.tokenCase, input.market.price),
      marketCap: input.market.marketCap ?? null,
      liquidityUsd: input.market.liquidityUsd ?? null,
    });

    let tokenCase = await updateTokenCaseStage(
      input.client,
      input.tokenCase.id,
      stage,
      now,
    );

    let decision: DecisionRow | null = null;
    if (stage === "PLUS_10") {
      decision = await evaluatePlus10Decision(input.client, tokenCase, now);
    }

    if (stage === "PLUS_60") {
      tokenCase = await closeCase(input.client, tokenCase.id, now);
    }

    const completed = await completeJob(input.client, claimed.id, input.market.capturedAt);
    if (!completed) {
      throw new Error("Failed to complete job");
    }

    return {
      ok: true,
      job: completed,
      tokenCase,
      snapshot,
      decision,
    };
  } catch (error) {
    const message = errorMessage(error);
    const released = await releaseJobForRetry(input.client, claimed.id, message);
    return {
      ok: false,
      error: message,
      job: released,
    };
  }
}
