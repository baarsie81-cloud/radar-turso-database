import type { DecisionResult, SnapshotStage } from "../../domain/types";

export const SURVIVOR_CHAINS = [
  "SOLANA",
  "BNB",
  "BASE",
  "MONAD",
  "ARBITRUM",
] as const;
export type SurvivorChain = (typeof SURVIVOR_CHAINS)[number];

export const SURVIVAL_HORIZONS_MINUTES = [60, 360, 1440] as const;
export type SurvivalHorizonMinutes = (typeof SURVIVAL_HORIZONS_MINUTES)[number];

export type SurvivorSnapshotInput = {
  stage: SnapshotStage;
  capturedAt: number;
  price: number;
  marketCap?: number | null;
  liquidityUsd?: number | null;
};

export type SurvivorObservationInput = {
  chain: SurvivorChain;
  assetId: string;
  symbol?: string | null;
  launchedAt: number;
  entryPrice: number;
  entryValid: boolean;
  snapshots: SurvivorSnapshotInput[];
  survivalChecks: Array<{
    horizonMinutes: SurvivalHorizonMinutes;
    capturedAt: number;
    tradeable: boolean;
    liquidityUsd?: number | null;
  }>;
};

export type SurvivalStatus = "SURVIVED" | "FAILED" | "UNKNOWN";

export type SurvivorRadarResult = {
  chain: SurvivorChain;
  assetId: string;
  symbol: string | null;
  horizonMinutes: SurvivalHorizonMinutes;
  survivalStatus: SurvivalStatus;
  survivalLiquidityUsd: number | null;
  radarDecision: DecisionResult;
  roiAtHorizonPct: number | null;
};
