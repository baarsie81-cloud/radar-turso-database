/**
 * Hypothesis Layer domain constants and types.
 * Independent of Radar 2.4 decision / outcome / PASS-push models.
 */

export const HYPOTHESIS_SCORE_VERSION = "h1.0";

/** Maximum concurrent WATCH + ACTIVE universe slots. */
export const HYPOTHESIS_UNIVERSE_MAX = 25;

/** Candidate must beat weakest member by this many points to replace. */
export const HYPOTHESIS_REPLACEMENT_MARGIN = 5;

/**
 * Members at or below this floor leave the active universe selection.
 * Default 0: only INVALIDATED / replacement / explicit floor override remove sticky assets.
 */
export const HYPOTHESIS_UNIVERSE_SCORE_FLOOR = 0;

export const HYPOTHESIS_STATUSES = ["WATCH", "ACTIVE", "INVALIDATED"] as const;

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

/** Research category labels for hypothesis assets (not trade tags). */
export const HYPOTHESIS_CATEGORIES = [
  "AI",
  "RWA",
  "SOLANA_ECOSYSTEM",
  "DEFI",
  "INFRA",
  "GAMING",
  "MEME",
  "L1",
  "L2",
] as const;

export type HypothesisCategory = (typeof HYPOTHESIS_CATEGORIES)[number];

export const HYPOTHESIS_EVENT_TYPES = [
  "ENTERED",
  "ACTIVATED",
  "MILESTONE",
  "INVALIDATED",
  "RANK_CHANGED",
  "EXITED",
] as const;

export type HypothesisEventType = (typeof HYPOTHESIS_EVENT_TYPES)[number];

export const HYPOTHESIS_PUSH_EVENT_TYPES = [
  "HYPOTHESIS_ACTIVATED",
  "LIFECYCLE_MILESTONE",
] as const;

export type HypothesisPushEventType = (typeof HYPOTHESIS_PUSH_EVENT_TYPES)[number];

/**
 * Score weights for hypothesis_score version h1.0.
 * Component scores are stored separately for historical measurement.
 */
export const HYPOTHESIS_SCORE_WEIGHTS = Object.freeze({
  narrative: 0.25,
  asymmetry: 0.25,
  catalyst: 0.2,
  attention: 0.15,
  liquidity: 0.15,
} as const);

export type HypothesisScoreWeights = typeof HYPOTHESIS_SCORE_WEIGHTS;

export type HypothesisComponentScores = {
  narrativeScore: number;
  asymmetryScore: number;
  catalystScore: number;
  attentionScore: number;
  liquidityScore: number;
};
