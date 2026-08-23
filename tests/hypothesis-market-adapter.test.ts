import { describe, expect, it } from "vitest";
import {
  adaptHypothesisMarketInputs,
  discoveredTokenToObservation,
  mapAbsPctToAttentionScore,
  mapLiquidityUsdToScore,
  mapMarketCapToAsymmetryScore,
  mapVolumeUsdToScore,
  marketSnapshotToObservation,
  snapshotRowToObservation,
  type HypothesisMarketSeedScores,
} from "../src/hypothesis/marketAdapter";
import { computeHypothesisScore } from "../src/hypothesis/score";

const SEED: HypothesisMarketSeedScores = {
  narrative_score: 70,
  catalyst_score: 55,
  asymmetry_score: 40,
  attention_score: 35,
  liquidity_score: 30,
};

describe("hypothesis marketAdapter", () => {
  it("maps liquidity, market cap, and volume into component scores", () => {
    const adapted = adaptHypothesisMarketInputs({
      seed: SEED,
      market: {
        price: 1.25,
        liquidityUsd: 100_000,
        marketCap: 1_000_000,
        volumeUsd: 50_000,
      },
    });

    expect(adapted.provenance.components.narrative_score).toBe("seed_retained");
    expect(adapted.provenance.components.catalyst_score).toBe("seed_retained");
    expect(adapted.provenance.components.liquidity_score).toBe("market");
    expect(adapted.provenance.components.asymmetry_score).toBe("market");
    expect(adapted.provenance.components.attention_score).toBe("market");
    expect(adapted.provenance.liquidity_basis).toBe("liquidityUsd");
    expect(adapted.provenance.asymmetry_basis).toBe("marketCap");
    expect(adapted.provenance.attention_basis).toBe("volumeUsd");

    expect(adapted.scoreInput.narrative_score).toBe(70);
    expect(adapted.scoreInput.catalyst_score).toBe(55);
    expect(adapted.scoreInput.liquidity_score).toBe(mapLiquidityUsdToScore(100_000));
    expect(adapted.scoreInput.asymmetry_score).toBe(mapMarketCapToAsymmetryScore(1_000_000));
    expect(adapted.scoreInput.attention_score).toBe(mapVolumeUsdToScore(50_000));

    const scored = computeHypothesisScore(adapted.scoreInput);
    expect(adapted.scored).toEqual(scored);

    const parsed = JSON.parse(adapted.inputsJson);
    expect(parsed.source).toBe("hypothesis_market_adapter");
    expect(parsed.research_only).toBe(true);
    expect(parsed.not_a_trade_signal).toBe(true);
    expect(parsed.observation.liquidityUsd).toBe(100_000);
  });

  it("falls back explicitly when market fields are missing", () => {
    const adapted = adaptHypothesisMarketInputs({
      seed: SEED,
      market: {
        price: 0.01,
        // no liquidity / mcap / volume / change
      },
    });

    expect(adapted.scoreInput).toEqual({
      narrative_score: 70,
      catalyst_score: 55,
      asymmetry_score: 40,
      attention_score: 35,
      liquidity_score: 30,
    });
    expect(adapted.provenance.components.liquidity_score).toBe("seed_fallback");
    expect(adapted.provenance.components.asymmetry_score).toBe("seed_fallback");
    expect(adapted.provenance.components.attention_score).toBe("seed_fallback");
    expect(adapted.provenance.liquidity_basis).toBe("seed_fallback");
    expect(adapted.provenance.asymmetry_basis).toBe("seed_fallback");
    expect(adapted.provenance.attention_basis).toBe("seed_fallback");
  });

  it("uses roiPct attention only when volume and price-change are absent", () => {
    const adapted = adaptHypothesisMarketInputs({
      seed: SEED,
      market: {
        liquidityUsd: 10_000,
        marketCap: 500_000,
        roiPct: 25,
      },
    });

    expect(adapted.provenance.attention_basis).toBe("roiPct");
    expect(adapted.scoreInput.attention_score).toBe(mapAbsPctToAttentionScore(25));
  });

  it("treats null / non-finite / non-positive values as missing (no guessing)", () => {
    const adapted = adaptHypothesisMarketInputs({
      seed: SEED,
      market: {
        price: Number.NaN,
        liquidityUsd: 0,
        marketCap: -100,
        volumeUsd: null,
        priceChangePct: Number.POSITIVE_INFINITY,
        momentumPct: undefined,
        roiPct: null,
      },
    });

    expect(adapted.scoreInput.liquidity_score).toBe(30);
    expect(adapted.scoreInput.asymmetry_score).toBe(40);
    expect(adapted.scoreInput.attention_score).toBe(35);
    expect(adapted.provenance.observation).toEqual({
      price: null,
      marketCap: -100,
      liquidityUsd: 0,
      volumeUsd: null,
      priceChangePct: null,
      momentumPct: null,
      roiPct: null,
    });
  });

  it("is deterministic for identical inputs", () => {
    const market = {
      price: 2,
      liquidityUsd: 250_000,
      marketCap: 8_000_000,
      volumeUsd: 12_000,
      priceChangePct: 8,
    };

    const a = adaptHypothesisMarketInputs({ seed: SEED, market });
    const b = adaptHypothesisMarketInputs({ seed: SEED, market });
    expect(a).toEqual(b);
    expect(a.inputsJson).toBe(b.inputsJson);
  });

  it("keeps computeHypothesisScore behavior unchanged for a fixed score input", () => {
    const adapted = adaptHypothesisMarketInputs({
      seed: SEED,
      market: {
        liquidityUsd: 1_000_000,
        marketCap: 10_000_000,
        volumeUsd: 100_000,
      },
    });

    const direct = computeHypothesisScore({
      narrative_score: 70,
      catalyst_score: 55,
      asymmetry_score: adapted.scoreInput.asymmetry_score,
      attention_score: adapted.scoreInput.attention_score,
      liquidity_score: adapted.scoreInput.liquidity_score,
    });

    expect(adapted.scored).toEqual(direct);
    expect(adapted.scored.score_version).toBe("h1.0");
  });

  it("converts existing project market shapes without inventing fields", () => {
    expect(
      marketSnapshotToObservation({
        price: 1,
        capturedAt: 1,
        marketCap: 2,
        liquidityUsd: 3,
      }),
    ).toEqual({
      price: 1,
      marketCap: 2,
      liquidityUsd: 3,
    });

    expect(
      snapshotRowToObservation({
        price: 1,
        marketCap: 2,
        liquidityUsd: 3,
        roiPct: 4,
      }),
    ).toEqual({
      price: 1,
      marketCap: 2,
      liquidityUsd: 3,
      roiPct: 4,
    });

    expect(
      discoveredTokenToObservation({
        price: 1,
        marketCap: null,
        liquidityUsd: 5,
      }),
    ).toEqual({
      price: 1,
      marketCap: null,
      liquidityUsd: 5,
    });
  });
});

describe("marketAdapter score maps", () => {
  it("returns null for missing liquidity / volume / market cap", () => {
    expect(mapLiquidityUsdToScore(null)).toBeNull();
    expect(mapLiquidityUsdToScore(0)).toBeNull();
    expect(mapVolumeUsdToScore(undefined)).toBeNull();
    expect(mapMarketCapToAsymmetryScore(-1)).toBeNull();
    expect(mapAbsPctToAttentionScore(Number.NaN)).toBeNull();
  });

  it("uses monotonic liquidity and inverse market-cap mapping", () => {
    expect(mapLiquidityUsdToScore(10_000)!).toBeLessThan(mapLiquidityUsdToScore(1_000_000)!);
    expect(mapMarketCapToAsymmetryScore(100_000)!).toBeGreaterThan(
      mapMarketCapToAsymmetryScore(1_000_000_000)!,
    );
  });
});
