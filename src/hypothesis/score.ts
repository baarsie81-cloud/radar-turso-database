import {
  HYPOTHESIS_SCORE_VERSION,
  HYPOTHESIS_SCORE_WEIGHTS,
} from "../domain/hypothesis";

/**
 * Raw component inputs for hypothesis scoring (0–100 scale).
 * Missing or invalid values are normalized before weighting.
 */
export type HypothesisScoreInput = {
  narrative_score?: number | null;
  asymmetry_score?: number | null;
  catalyst_score?: number | null;
  attention_score?: number | null;
  liquidity_score?: number | null;
};

export type HypothesisScoreResult = {
  hypothesis_score: number;
  narrative_score: number;
  asymmetry_score: number;
  catalyst_score: number;
  attention_score: number;
  liquidity_score: number;
  score_version: typeof HYPOTHESIS_SCORE_VERSION;
};

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/**
 * Normalize a component to a finite number in [0, 100].
 * Missing, non-finite, or non-numeric values become 0.
 */
export function normalizeComponentScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SCORE_MIN;
  }
  if (value < SCORE_MIN) return SCORE_MIN;
  if (value > SCORE_MAX) return SCORE_MAX;
  return value;
}

function roundScore(value: number): number {
  // Fixed 4-decimal rounding keeps replay stable without inventing precision.
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Pure h1.0 hypothesis research score.
 * Deterministic: same normalized inputs always yield the same output.
 * No I/O, no DB, no Radar coupling.
 */
export function computeHypothesisScore(
  inputs: HypothesisScoreInput | null | undefined,
): HypothesisScoreResult {
  const source = inputs ?? {};

  const narrative_score = normalizeComponentScore(source.narrative_score);
  const asymmetry_score = normalizeComponentScore(source.asymmetry_score);
  const catalyst_score = normalizeComponentScore(source.catalyst_score);
  const attention_score = normalizeComponentScore(source.attention_score);
  const liquidity_score = normalizeComponentScore(source.liquidity_score);

  const weighted =
    narrative_score * HYPOTHESIS_SCORE_WEIGHTS.narrative
    + asymmetry_score * HYPOTHESIS_SCORE_WEIGHTS.asymmetry
    + catalyst_score * HYPOTHESIS_SCORE_WEIGHTS.catalyst
    + attention_score * HYPOTHESIS_SCORE_WEIGHTS.attention
    + liquidity_score * HYPOTHESIS_SCORE_WEIGHTS.liquidity;

  const hypothesis_score = normalizeComponentScore(roundScore(weighted));

  return {
    hypothesis_score,
    narrative_score,
    asymmetry_score,
    catalyst_score,
    attention_score,
    liquidity_score,
    score_version: HYPOTHESIS_SCORE_VERSION,
  };
}
