import {
  HYPOTHESIS_REPLACEMENT_MARGIN,
  HYPOTHESIS_UNIVERSE_MAX,
  HYPOTHESIS_UNIVERSE_SCORE_FLOOR,
  type HypothesisStatus,
} from "../domain/hypothesis";

/** Alias matching product naming (max 25 active universe slots). */
export const ACTIVE_UNIVERSE_MAX = HYPOTHESIS_UNIVERSE_MAX;

export type HypothesisUniverseAsset = {
  /** Stable identity for membership (typically mint). */
  id: string;
  mint: string;
  hypothesis_score: number;
  status: HypothesisStatus;
};

export type RankedHypothesisAsset = HypothesisUniverseAsset & {
  /** 1-based rank within the selection (1 = highest score). */
  rank: number;
};

export type SelectHypothesisUniverseOptions = {
  max?: number;
  replacementMargin?: number;
  scoreFloor?: number;
};

function isUniverseEligible(
  asset: HypothesisUniverseAsset,
  scoreFloor: number,
): boolean {
  if (asset.status === "INVALIDATED") return false;
  if (asset.status !== "WATCH" && asset.status !== "ACTIVE") return false;
  return Number.isFinite(asset.hypothesis_score) && asset.hypothesis_score >= scoreFloor;
}

function compareByScoreDesc(
  a: HypothesisUniverseAsset,
  b: HypothesisUniverseAsset,
): number {
  if (b.hypothesis_score !== a.hypothesis_score) {
    return b.hypothesis_score - a.hypothesis_score;
  }
  // Deterministic tie-break.
  return a.mint.localeCompare(b.mint) || a.id.localeCompare(b.id);
}

/**
 * Rank assets by hypothesis_score (desc). Does not filter status.
 * Pure / deterministic.
 */
export function rankHypothesisAssets(
  assets: readonly HypothesisUniverseAsset[],
): RankedHypothesisAsset[] {
  return [...assets]
    .sort(compareByScoreDesc)
    .map((asset, index) => ({
      ...asset,
      rank: index + 1,
    }));
}

/**
 * True when candidate clearly beats the weakest member (hysteresis).
 * candidate_score >= weakest_score + replacement_margin
 */
export function shouldReplaceAsset(input: {
  candidateScore: number;
  weakestScore: number;
  replacementMargin?: number;
}): boolean {
  const margin = input.replacementMargin ?? HYPOTHESIS_REPLACEMENT_MARGIN;
  if (!Number.isFinite(input.candidateScore) || !Number.isFinite(input.weakestScore)) {
    return false;
  }
  if (!Number.isFinite(margin) || margin < 0) {
    return false;
  }
  return input.candidateScore >= input.weakestScore + margin;
}

function weakestMember(
  members: readonly HypothesisUniverseAsset[],
): HypothesisUniverseAsset | null {
  if (members.length === 0) return null;
  return [...members].sort((a, b) => {
    if (a.hypothesis_score !== b.hypothesis_score) {
      return a.hypothesis_score - b.hypothesis_score;
    }
    return b.mint.localeCompare(a.mint) || b.id.localeCompare(a.id);
  })[0] ?? null;
}

/**
 * Select up to `max` WATCH/ACTIVE assets for the current universe.
 *
 * - Sticky: existing members stay unless INVALIDATED, below score floor, or replaced.
 * - Vacancies fill with best outsiders (no margin required).
 * - Full universe: outsider replaces weakest only when margin is met.
 * - Does not mutate history; returns a new ranked selection only.
 */
export function selectHypothesisUniverse(
  current: readonly HypothesisUniverseAsset[],
  candidates: readonly HypothesisUniverseAsset[],
  options: SelectHypothesisUniverseOptions = {},
): RankedHypothesisAsset[] {
  const max = options.max ?? HYPOTHESIS_UNIVERSE_MAX;
  const replacementMargin = options.replacementMargin ?? HYPOTHESIS_REPLACEMENT_MARGIN;
  const scoreFloor = options.scoreFloor ?? HYPOTHESIS_UNIVERSE_SCORE_FLOOR;

  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }

  const sticky = current.filter((asset) => isUniverseEligible(asset, scoreFloor));
  const poolById = new Map<string, HypothesisUniverseAsset>();

  for (const asset of [...candidates, ...sticky]) {
    if (!isUniverseEligible(asset, scoreFloor)) continue;
    const existing = poolById.get(asset.id);
    if (!existing || asset.hypothesis_score > existing.hypothesis_score) {
      poolById.set(asset.id, asset);
    }
  }

  const selected = new Map<string, HypothesisUniverseAsset>();
  for (const asset of sticky) {
    const latest = poolById.get(asset.id) ?? asset;
    if (isUniverseEligible(latest, scoreFloor)) {
      selected.set(latest.id, latest);
    }
  }

  // Drop sticky overflow if somehow over capacity (keep highest scores).
  if (selected.size > max) {
    const kept = [...selected.values()].sort(compareByScoreDesc).slice(0, max);
    selected.clear();
    for (const asset of kept) selected.set(asset.id, asset);
  }

  const outsiders = [...poolById.values()]
    .filter((asset) => !selected.has(asset.id))
    .sort(compareByScoreDesc);

  // Fill vacancies without hysteresis.
  let outsiderIndex = 0;
  while (selected.size < max && outsiderIndex < outsiders.length) {
    const next = outsiders[outsiderIndex]!;
    outsiderIndex += 1;
    selected.set(next.id, next);
  }

  // Replace weakest only when candidate clearly wins.
  while (selected.size >= max && outsiderIndex < outsiders.length) {
    const candidate = outsiders[outsiderIndex]!;
    outsiderIndex += 1;
    if (selected.has(candidate.id)) continue;

    const weakest = weakestMember([...selected.values()]);
    if (!weakest) break;

    if (
      !shouldReplaceAsset({
        candidateScore: candidate.hypothesis_score,
        weakestScore: weakest.hypothesis_score,
        replacementMargin,
      })
    ) {
      // Remaining outsiders are weaker or equal after sort; stop.
      break;
    }

    selected.delete(weakest.id);
    selected.set(candidate.id, candidate);
  }

  return rankHypothesisAssets([...selected.values()]);
}
