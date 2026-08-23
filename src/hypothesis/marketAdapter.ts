import type { MarketSnapshotInput } from "../lifecycle/types";
import type { SnapshotRow } from "../db/repositories/snapshots";
import type { DiscoveredToken } from "../providers/types";
import {
  computeHypothesisScore,
  normalizeComponentScore,
  type HypothesisScoreInput,
  type HypothesisScoreResult,
} from "./score";

/**
 * Market observation fields accepted by the hypothesis adapter.
 * Built from existing project shapes (DexScreener/Gecko/lifecycle snapshots).
 * Optional volume / change / momentum fields are accepted when already present
 * upstream — this phase does not add new providers.
 */
export type HypothesisMarketObservation = {
  price?: number | null;
  marketCap?: number | null;
  liquidityUsd?: number | null;
  /** USD volume over a recent window, when available. */
  volumeUsd?: number | null;
  /** Percent price change over a recent window, when available. */
  priceChangePct?: number | null;
  /** Generic momentum percent proxy, when available. */
  momentumPct?: number | null;
  /** ROI percent from an existing snapshot series, when available. */
  roiPct?: number | null;
};

/** Seed / asset component scores retained when market fields are missing. */
export type HypothesisMarketSeedScores = {
  narrative_score: number;
  catalyst_score: number;
  asymmetry_score: number;
  attention_score: number;
  liquidity_score: number;
};

export type HypothesisMarketComponentSource =
  | "market"
  | "seed_fallback"
  | "seed_retained";

export type HypothesisMarketProvenance = {
  source: "hypothesis_market_adapter";
  observation: {
    price: number | null;
    marketCap: number | null;
    liquidityUsd: number | null;
    volumeUsd: number | null;
    priceChangePct: number | null;
    momentumPct: number | null;
    roiPct: number | null;
  };
  components: {
    narrative_score: HypothesisMarketComponentSource;
    catalyst_score: HypothesisMarketComponentSource;
    asymmetry_score: HypothesisMarketComponentSource;
    attention_score: HypothesisMarketComponentSource;
    liquidity_score: HypothesisMarketComponentSource;
  };
  attention_basis: "volumeUsd" | "priceChangePct" | "momentumPct" | "roiPct" | "seed_fallback";
  asymmetry_basis: "marketCap" | "seed_fallback";
  liquidity_basis: "liquidityUsd" | "seed_fallback";
};

export type AdaptHypothesisMarketInputsResult = {
  scoreInput: HypothesisScoreInput;
  provenance: HypothesisMarketProvenance;
  /** Convenience: scoreInput run through computeHypothesisScore (pure). */
  scored: HypothesisScoreResult;
  inputsJson: string;
};

function finiteOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function positiveOrNull(value: unknown): number | null {
  const n = finiteOrNull(value);
  if (n == null || n <= 0) {
    return null;
  }
  return n;
}

/**
 * Map liquidity USD onto 0–100 via log10 scale.
 * Anchors: $1k≈20, $10k≈40, $100k≈60, $1M≈80, $10M+≈100.
 * Missing / non-positive → null (caller must fallback).
 */
export function mapLiquidityUsdToScore(liquidityUsd: number | null | undefined): number | null {
  const liq = positiveOrNull(liquidityUsd);
  if (liq == null) return null;
  const log = Math.log10(liq);
  // Map log10 [3, 7] → [20, 100]
  const scored = 20 + ((log - 3) / 4) * 80;
  return normalizeComponentScore(scored);
}

/**
 * Map USD volume onto 0–100 (attention proxy).
 * Anchors: $1k≈15, $10k≈35, $100k≈55, $1M≈75, $10M+≈95.
 */
export function mapVolumeUsdToScore(volumeUsd: number | null | undefined): number | null {
  const vol = positiveOrNull(volumeUsd);
  if (vol == null) return null;
  const log = Math.log10(vol);
  const scored = 15 + ((log - 3) / 4) * 80;
  return normalizeComponentScore(scored);
}

/**
 * Map absolute percent move onto attention 0–100.
 * 0%→15, 10%→35, 25%→55, 50%→75, 100%+→95.
 */
export function mapAbsPctToAttentionScore(pct: number | null | undefined): number | null {
  const value = finiteOrNull(pct);
  if (value == null) return null;
  const abs = Math.abs(value);
  const scored = 15 + Math.min(abs, 100) * 0.8;
  return normalizeComponentScore(scored);
}

/**
 * Smaller market cap → higher research asymmetry (upside-space proxy).
 * Anchors: $100k≈90, $1M≈70, $10M≈50, $100M≈30, $1B≈15.
 * Missing / non-positive → null.
 */
export function mapMarketCapToAsymmetryScore(marketCap: number | null | undefined): number | null {
  const cap = positiveOrNull(marketCap);
  if (cap == null) return null;
  const log = Math.log10(cap);
  // Map log10 [5 ($100k), 9 ($1B)] → [90, 15]
  const scored = 90 - ((log - 5) / 4) * 75;
  return normalizeComponentScore(scored);
}

export function marketSnapshotToObservation(
  snapshot: MarketSnapshotInput,
): HypothesisMarketObservation {
  return {
    price: snapshot.price,
    marketCap: snapshot.marketCap ?? null,
    liquidityUsd: snapshot.liquidityUsd ?? null,
  };
}

export function snapshotRowToObservation(
  row: Pick<SnapshotRow, "price" | "marketCap" | "liquidityUsd" | "roiPct">,
): HypothesisMarketObservation {
  return {
    price: row.price,
    marketCap: row.marketCap,
    liquidityUsd: row.liquidityUsd,
    roiPct: row.roiPct,
  };
}

export function discoveredTokenToObservation(
  token: Pick<DiscoveredToken, "price" | "marketCap" | "liquidityUsd">,
): HypothesisMarketObservation {
  return {
    price: token.price,
    marketCap: token.marketCap ?? null,
    liquidityUsd: token.liquidityUsd ?? null,
  };
}

/**
 * Pure market → hypothesis score-input adapter.
 * Does not fetch, write DB, emit events, or change asset status.
 *
 * - narrative_score / catalyst_score: always retained from seed metadata
 * - liquidity / attention / asymmetry: market when present, else explicit seed fallback
 * - missing data is never guessed beyond documented fallbacks
 */
export function adaptHypothesisMarketInputs(input: {
  market?: HypothesisMarketObservation | null;
  seed: HypothesisMarketSeedScores;
}): AdaptHypothesisMarketInputsResult {
  const market = input.market ?? {};
  const observation = {
    price: finiteOrNull(market.price),
    marketCap: finiteOrNull(market.marketCap),
    liquidityUsd: finiteOrNull(market.liquidityUsd),
    volumeUsd: finiteOrNull(market.volumeUsd),
    priceChangePct: finiteOrNull(market.priceChangePct),
    momentumPct: finiteOrNull(market.momentumPct),
    roiPct: finiteOrNull(market.roiPct),
  };

  const components: HypothesisMarketProvenance["components"] = {
    narrative_score: "seed_retained",
    catalyst_score: "seed_retained",
    asymmetry_score: "seed_fallback",
    attention_score: "seed_fallback",
    liquidity_score: "seed_fallback",
  };

  let attention_basis: HypothesisMarketProvenance["attention_basis"] = "seed_fallback";
  let asymmetry_basis: HypothesisMarketProvenance["asymmetry_basis"] = "seed_fallback";
  let liquidity_basis: HypothesisMarketProvenance["liquidity_basis"] = "seed_fallback";

  const narrative_score = normalizeComponentScore(input.seed.narrative_score);
  const catalyst_score = normalizeComponentScore(input.seed.catalyst_score);

  const liquidityMapped = mapLiquidityUsdToScore(observation.liquidityUsd);
  let liquidity_score: number;
  if (liquidityMapped != null) {
    liquidity_score = liquidityMapped;
    components.liquidity_score = "market";
    liquidity_basis = "liquidityUsd";
  } else {
    liquidity_score = normalizeComponentScore(input.seed.liquidity_score);
  }

  const asymmetryMapped = mapMarketCapToAsymmetryScore(observation.marketCap);
  let asymmetry_score: number;
  if (asymmetryMapped != null) {
    asymmetry_score = asymmetryMapped;
    components.asymmetry_score = "market";
    asymmetry_basis = "marketCap";
  } else {
    asymmetry_score = normalizeComponentScore(input.seed.asymmetry_score);
  }

  let attention_score: number;
  const volumeMapped = mapVolumeUsdToScore(observation.volumeUsd);
  const changeMapped = mapAbsPctToAttentionScore(observation.priceChangePct);
  const momentumMapped = mapAbsPctToAttentionScore(observation.momentumPct);
  const roiMapped = mapAbsPctToAttentionScore(observation.roiPct);

  if (volumeMapped != null) {
    attention_score = volumeMapped;
    components.attention_score = "market";
    attention_basis = "volumeUsd";
  } else if (changeMapped != null) {
    attention_score = changeMapped;
    components.attention_score = "market";
    attention_basis = "priceChangePct";
  } else if (momentumMapped != null) {
    attention_score = momentumMapped;
    components.attention_score = "market";
    attention_basis = "momentumPct";
  } else if (roiMapped != null) {
    attention_score = roiMapped;
    components.attention_score = "market";
    attention_basis = "roiPct";
  } else {
    attention_score = normalizeComponentScore(input.seed.attention_score);
  }

  const scoreInput: HypothesisScoreInput = {
    narrative_score,
    catalyst_score,
    asymmetry_score,
    attention_score,
    liquidity_score,
  };

  const provenance: HypothesisMarketProvenance = {
    source: "hypothesis_market_adapter",
    observation,
    components,
    attention_basis,
    asymmetry_basis,
    liquidity_basis,
  };

  const scored = computeHypothesisScore(scoreInput);

  return {
    scoreInput,
    provenance,
    scored,
    inputsJson: JSON.stringify({
      ...provenance,
      score_input: scoreInput,
      research_only: true,
      not_a_trade_signal: true,
    }),
  };
}
