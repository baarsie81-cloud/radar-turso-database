import { evaluateRadar24, roiPct } from "../../decisions/engine";
import type { Snapshot } from "../../domain/types";
import type {
  SurvivalHorizonMinutes,
  SurvivalStatus,
  SurvivorObservationInput,
  SurvivorRadarResult,
} from "./types";

function snapshotMap(input: SurvivorObservationInput): Record<string, Snapshot> {
  const mapped: Record<string, Snapshot> = {};
  for (const snapshot of input.snapshots) {
    mapped[snapshot.stage] = {
      stage: snapshot.stage,
      capturedAt: snapshot.capturedAt,
      price: snapshot.price,
      marketCap: snapshot.marketCap ?? null,
      liquidityUsd: snapshot.liquidityUsd ?? null,
    };
  }
  return mapped;
}

function survivalStatus(
  input: SurvivorObservationInput,
  horizonMinutes: SurvivalHorizonMinutes,
): {
  status: SurvivalStatus;
  liquidityUsd: number | null;
  capturedAt: number | null;
} {
  const check = input.survivalChecks.find(
    (candidate) => candidate.horizonMinutes === horizonMinutes,
  );
  if (!check) {
    return { status: "UNKNOWN", liquidityUsd: null, capturedAt: null };
  }
  return {
    status: check.tradeable ? "SURVIVED" : "FAILED",
    liquidityUsd: check.liquidityUsd ?? null,
    capturedAt: check.capturedAt,
  };
}

export function evaluateSurvivorObservation(
  input: SurvivorObservationInput,
  horizonMinutes: SurvivalHorizonMinutes,
): SurvivorRadarResult {
  const snapshots = snapshotMap(input);
  const radarDecision = evaluateRadar24({
    tokenCaseId: 0,
    radarVersion: "2.4-survivor-research",
    decisionStage: "PLUS_10",
    decidedAt: snapshots.PLUS_10?.capturedAt ?? input.launchedAt + 10 * 60_000,
    entry: {
      entryPrice: input.entryPrice,
      entryValid: input.entryValid,
    },
    snapshots,
  });

  const survival = survivalStatus(input, horizonMinutes);
  const horizonPrice = input.snapshots
    .filter((snapshot) => snapshot.capturedAt <= (survival.capturedAt ?? -1))
    .sort((a, b) => b.capturedAt - a.capturedAt)[0]?.price ?? null;

  return {
    chain: input.chain,
    assetId: input.assetId,
    symbol: input.symbol ?? null,
    horizonMinutes,
    survivalStatus: survival.status,
    survivalLiquidityUsd: survival.liquidityUsd,
    radarDecision,
    roiAtHorizonPct:
      horizonPrice != null && input.entryPrice > 0
        ? roiPct(horizonPrice, input.entryPrice)
        : null,
  };
}
