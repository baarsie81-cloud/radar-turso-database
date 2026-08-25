export const RADAR_VERSION = "2.4";

export const SNAPSHOT_STAGES = [
  "INITIAL",
  "PLUS_5",
  "PLUS_10",
  "PLUS_15",
  "PLUS_30",
  "PLUS_60",
] as const;

export const LIFECYCLE_STAGES = [...SNAPSHOT_STAGES, "CLOSED"] as const;

export type SnapshotStage = (typeof SNAPSHOT_STAGES)[number];
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export type CaseStatus = "OPEN" | "CLOSED";

export type DecisionStatus = "PENDING" | "PASS" | "REJECT";

export const REJECT_REASONS = [
  "MISSING_INITIAL_SNAPSHOT",
  "INVALID_ENTRY_PRICE",
  "ENTRY_NOT_VALID",
  "MISSING_EXACT_ENTRY",
  "MISSING_PLUS_5_SNAPSHOT",
  "MISSING_PLUS_10_SNAPSHOT",
  "ROI_BELOW_25_AT_PLUS_10",
  "NEGATIVE_MOMENTUM_5_TO_10",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export const PLUS_10_ROI_MIN_PCT = 25;

export const OUTCOME_WINDOW_STAGES = ["PLUS_15", "PLUS_30", "PLUS_60"] as const;

export type OutcomeWindowStage = (typeof OUTCOME_WINDOW_STAGES)[number];

export const OUTCOME_LABELS = ["NO_RESULT", "SMALL_WIN", "RUNNER"] as const;

export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export const SMALL_WIN_MIN_PCT = 25;
export const RUNNER_MIN_PCT = 100;

export type OutcomeInputs = {
  entryPrice: number;
  peakRoiPct: number;
  terminalRoiPct: number;
  stagesUsed: OutcomeWindowStage[];
  smallWinMinPct: number;
  runnerMinPct: number;
};

export type OutcomeResult = {
  outcomeLabel: OutcomeLabel | null;
  peakRoiPct: number | null;
  terminalRoiPct: number | null;
  stagesUsed: OutcomeWindowStage[];
  inputs: OutcomeInputs | null;
  inputsJson: string | null;
};

export type Snapshot = {
  stage: SnapshotStage;
  capturedAt: number | null;
  price: number;
  roiPct?: number | null;
  marketCap?: number | null;
  liquidityUsd?: number | null;
};

export type TokenCaseEntry = {
  entryPrice: number | null;
  entryValid: boolean;
};

export type EvaluateInput = {
  tokenCaseId: number;
  radarVersion?: string;
  decisionStage: SnapshotStage;
  decidedAt: number;
  entry: TokenCaseEntry;
  snapshots: Partial<Record<SnapshotStage, Snapshot>>;
};

export type DecisionInputs = {
  radarVersion: string;
  decisionStage: SnapshotStage;
  entryPrice: number | null;
  entryValid: boolean;
  initialCapturedAt: number | null;
  initialPrice: number | null;
  plus5Price: number | null;
  plus10Price: number | null;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum5To10Pct: number | null;
  plus10RoiMinPct: number;
};

export type DecisionResult = {
  tokenCaseId: number;
  decisionStage: SnapshotStage;
  decidedAt: number;
  decisionStatus: DecisionStatus;
  /** Core strategy reasons are typed by RejectReason; downstream execution gates may add explicit execution reasons. */
  rejectReason: string | null;
  radarVersion: string;
  entryPrice: number | null;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum5To10Pct: number | null;
  inputs: DecisionInputs;
  inputsJson: string;
};
