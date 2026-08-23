import type { Client } from "@libsql/client";
import {
  listHypothesisUniverseAssets,
  type HypothesisAssetRow,
} from "../db/repositories/hypothesis/assets";
import { insertHypothesisScoreSnapshot } from "../db/repositories/hypothesis/scoreSnapshots";
import {
  acquireCollectionLock,
  HYPOTHESIS_LOCK_KEY,
  releaseCollectionLock,
} from "../db/repositories/locks";
import {
  collectHypothesisInputsFromAsset,
  type CollectHypothesisInputsFn,
} from "./collector";
import { computeHypothesisScore } from "./score";
import { rankHypothesisAssets } from "./universe";

export type HypothesisObservationEnv = {
  RADAR24_HYPOTHESIS_ENABLED?: string;
};

export type RunHypothesisObservationDeps = {
  client: Client;
  owner: string;
  /** Feature flag source; observation runs only when === "true". */
  env?: HypothesisObservationEnv;
  collectInputs?: CollectHypothesisInputsFn;
  /** Override universe listing (tests). Default: WATCH + ACTIVE. */
  listAssets?: (client: Client) => Promise<HypothesisAssetRow[]>;
  /** Milliseconds the hypothesis lock is held; defaults to 5 minutes. */
  lockDurationMs?: number;
  /** Injected clock; defaults to Date.now(). */
  now?: () => number;
};

export type HypothesisObservationError = {
  phase: "lock" | "list" | "asset";
  context: string;
  message: string;
};

export type HypothesisObservationSummary = {
  enabled: boolean;
  assetsConsidered: number;
  snapshotsWritten: number;
  errors: HypothesisObservationError[];
};

export function isHypothesisObservationEnabled(
  env: HypothesisObservationEnv | undefined,
): boolean {
  return env?.RADAR24_HYPOTHESIS_ENABLED === "true";
}

function emptySummary(enabled: boolean): HypothesisObservationSummary {
  return {
    enabled,
    assetsConsidered: 0,
    snapshotsWritten: 0,
    errors: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hypothesis observation runner (research-only).
 *
 * Flow: universe assets → collect inputs → computeHypothesisScore → append snapshot.
 * Does not emit events, push, lifecycle transitions, or Radar decisions.
 * Snapshots are append-only; history is never overwritten.
 */
export async function runHypothesisObservation(
  deps: RunHypothesisObservationDeps,
): Promise<HypothesisObservationSummary> {
  if (!isHypothesisObservationEnabled(deps.env)) {
    return emptySummary(false);
  }

  const now = deps.now ?? (() => Date.now());
  const lockDurationMs = deps.lockDurationMs ?? 5 * 60_000;
  const collectInputs = deps.collectInputs ?? collectHypothesisInputsFromAsset;
  const listAssets = deps.listAssets ?? listHypothesisUniverseAssets;
  const summary = emptySummary(true);

  const startedAt = now();
  const locked = await acquireCollectionLock(deps.client, {
    jobKey: HYPOTHESIS_LOCK_KEY,
    owner: deps.owner,
    lockedUntil: startedAt + lockDurationMs,
    startedAt,
  });

  if (!locked) {
    summary.errors.push({
      phase: "lock",
      context: "lock",
      message: "Could not acquire hypothesis lock",
    });
    return summary;
  }

  try {
    const capturedAt = now();

    let assets: HypothesisAssetRow[] = [];
    try {
      assets = await listAssets(deps.client);
    } catch (err) {
      summary.errors.push({
        phase: "list",
        context: "listHypothesisUniverseAssets",
        message: errorMessage(err),
      });
      return summary;
    }

    summary.assetsConsidered = assets.length;
    if (assets.length === 0) {
      return summary;
    }

    type Prepared = {
      asset: HypothesisAssetRow;
      hypothesisScore: number;
      narrativeScore: number;
      asymmetryScore: number;
      catalystScore: number;
      attentionScore: number;
      liquidityScore: number;
      scoreVersion: string;
      inputsJson: string;
    };

    const prepared: Prepared[] = [];

    for (const asset of assets) {
      const label = `asset#${asset.id}(${asset.mint})`;
      try {
        const collected = await collectInputs(asset, capturedAt);
        const scored = computeHypothesisScore(collected.scoreInput);
        prepared.push({
          asset,
          hypothesisScore: scored.hypothesis_score,
          narrativeScore: scored.narrative_score,
          asymmetryScore: scored.asymmetry_score,
          catalystScore: scored.catalyst_score,
          attentionScore: scored.attention_score,
          liquidityScore: scored.liquidity_score,
          scoreVersion: scored.score_version,
          inputsJson: collected.inputsJson,
        });
      } catch (err) {
        summary.errors.push({
          phase: "asset",
          context: label,
          message: errorMessage(err),
        });
      }
    }

    const ranked = rankHypothesisAssets(
      prepared.map((row) => ({
        id: String(row.asset.id),
        mint: row.asset.mint,
        hypothesis_score: row.hypothesisScore,
        status: row.asset.status,
      })),
    );
    const rankById = new Map(ranked.map((row) => [row.id, row.rank]));

    for (const row of prepared) {
      const label = `asset#${row.asset.id}(${row.asset.mint})`;
      try {
        await insertHypothesisScoreSnapshot(deps.client, {
          hypothesisAssetId: row.asset.id,
          capturedAt,
          hypothesisScore: row.hypothesisScore,
          narrativeScore: row.narrativeScore,
          asymmetryScore: row.asymmetryScore,
          catalystScore: row.catalystScore,
          attentionScore: row.attentionScore,
          liquidityScore: row.liquidityScore,
          status: row.asset.status,
          rank: rankById.get(String(row.asset.id)) ?? row.asset.rank,
          inputsJson: row.inputsJson,
          scoreVersion: row.scoreVersion,
        });
        summary.snapshotsWritten += 1;
      } catch (err) {
        summary.errors.push({
          phase: "asset",
          context: label,
          message: errorMessage(err),
        });
      }
    }
  } finally {
    await releaseCollectionLock(deps.client, {
      jobKey: HYPOTHESIS_LOCK_KEY,
      owner: deps.owner,
      completedAt: now(),
    });
  }

  return summary;
}
