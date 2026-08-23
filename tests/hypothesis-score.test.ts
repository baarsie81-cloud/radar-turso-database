import { describe, expect, it } from "vitest";
import {
  computeHypothesisScore,
  normalizeComponentScore,
  type HypothesisScoreInput,
} from "../src/hypothesis/score";
import {
  HYPOTHESIS_SCORE_VERSION,
  HYPOTHESIS_SCORE_WEIGHTS,
} from "../src/domain/hypothesis";

function input(overrides: HypothesisScoreInput = {}): HypothesisScoreInput {
  return {
    narrative_score: 80,
    asymmetry_score: 60,
    catalyst_score: 40,
    attention_score: 20,
    liquidity_score: 100,
    ...overrides,
  };
}

describe("computeHypothesisScore", () => {
  it("applies h1.0 weights correctly", () => {
    const result = computeHypothesisScore(input());

    const expected =
      80 * HYPOTHESIS_SCORE_WEIGHTS.narrative
      + 60 * HYPOTHESIS_SCORE_WEIGHTS.asymmetry
      + 40 * HYPOTHESIS_SCORE_WEIGHTS.catalyst
      + 20 * HYPOTHESIS_SCORE_WEIGHTS.attention
      + 100 * HYPOTHESIS_SCORE_WEIGHTS.liquidity;

    expect(result.score_version).toBe(HYPOTHESIS_SCORE_VERSION);
    expect(result.score_version).toBe("h1.0");
    expect(result.narrative_score).toBe(80);
    expect(result.asymmetry_score).toBe(60);
    expect(result.catalyst_score).toBe(40);
    expect(result.attention_score).toBe(20);
    expect(result.liquidity_score).toBe(100);
    expect(result.hypothesis_score).toBeCloseTo(expected, 4);
    // 0.25*80 + 0.25*60 + 0.2*40 + 0.15*20 + 0.15*100 = 20+15+8+3+15 = 61
    expect(result.hypothesis_score).toBe(61);
  });

  it("keeps hypothesis_score and components within 0-100", () => {
    const result = computeHypothesisScore({
      narrative_score: 150,
      asymmetry_score: -10,
      catalyst_score: 200,
      attention_score: Number.POSITIVE_INFINITY,
      liquidity_score: Number.NaN,
    });

    for (const value of [
      result.hypothesis_score,
      result.narrative_score,
      result.asymmetry_score,
      result.catalyst_score,
      result.attention_score,
      result.liquidity_score,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(result.narrative_score).toBe(100);
    expect(result.asymmetry_score).toBe(0);
    expect(result.catalyst_score).toBe(100);
    expect(result.attention_score).toBe(0);
    expect(result.liquidity_score).toBe(0);
  });

  it("handles extreme component values 0 and 100", () => {
    const allZero = computeHypothesisScore({
      narrative_score: 0,
      asymmetry_score: 0,
      catalyst_score: 0,
      attention_score: 0,
      liquidity_score: 0,
    });
    expect(allZero.hypothesis_score).toBe(0);

    const allMax = computeHypothesisScore({
      narrative_score: 100,
      asymmetry_score: 100,
      catalyst_score: 100,
      attention_score: 100,
      liquidity_score: 100,
    });
    expect(allMax.hypothesis_score).toBe(100);
  });

  it("handles missing or invalid inputs by treating them as 0", () => {
    expect(normalizeComponentScore(undefined)).toBe(0);
    expect(normalizeComponentScore(null)).toBe(0);
    expect(normalizeComponentScore("50")).toBe(0);
    expect(normalizeComponentScore({})).toBe(0);

    const partial = computeHypothesisScore({
      narrative_score: 100,
      // asymmetry / catalyst / attention / liquidity missing
    });
    expect(partial.asymmetry_score).toBe(0);
    expect(partial.catalyst_score).toBe(0);
    expect(partial.attention_score).toBe(0);
    expect(partial.liquidity_score).toBe(0);
    expect(partial.hypothesis_score).toBe(25); // 100 * 0.25

    const empty = computeHypothesisScore(undefined);
    expect(empty).toEqual({
      hypothesis_score: 0,
      narrative_score: 0,
      asymmetry_score: 0,
      catalyst_score: 0,
      attention_score: 0,
      liquidity_score: 0,
      score_version: "h1.0",
    });

    const nullInput = computeHypothesisScore(null);
    expect(nullInput.hypothesis_score).toBe(0);
  });

  it("is replayable: identical inputs always yield identical output", () => {
    const once = computeHypothesisScore(input());
    const twice = computeHypothesisScore(input());
    const third = computeHypothesisScore({
      narrative_score: 80,
      asymmetry_score: 60,
      catalyst_score: 40,
      attention_score: 20,
      liquidity_score: 100,
    });

    expect(twice).toEqual(once);
    expect(third).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
