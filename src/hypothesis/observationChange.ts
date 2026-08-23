import {
  HYPOTHESIS_UNIVERSE_MAX,
  type HypothesisStatus,
} from "../domain/hypothesis";

/** Meaningful research-score move (points). */
export const OBSERVATION_SCORE_DELTA_MIN = 5;

/** Meaningful component-score move (points). */
export const OBSERVATION_COMPONENT_DELTA_MIN = 10;

export type ObservationScoreView = {
  hypothesisScore: number;
  rank: number | null;
  narrativeScore: number;
  asymmetryScore: number;
  catalystScore: number;
  attentionScore: number;
  liquidityScore: number;
  status: HypothesisStatus;
};

export type ObservationChangeKind = "OBSERVATION_UPDATE" | "SCORE_CHANGE";

export type ObservationComponentName =
  | "narrative_score"
  | "asymmetry_score"
  | "catalyst_score"
  | "attention_score"
  | "liquidity_score";

export type ObservationChange = {
  kind: ObservationChangeKind;
  scoreDelta: number;
  rankChangedInTop25: boolean;
  previousRank: number | null;
  nextRank: number | null;
  /** Human research reasons (observeren / volgen / onderzoeken). */
  reasons: string[];
  /** Primary reason line for push body. */
  primaryReason: string;
  componentDeltas: Partial<Record<ObservationComponentName, number>>;
};

function inTop25(rank: number | null): boolean {
  return rank != null && rank >= 1 && rank <= HYPOTHESIS_UNIVERSE_MAX;
}

function formatSigned(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

/**
 * Detect whether two consecutive observation snapshots warrant a push test event.
 * First snapshot (no previous) never notifies — only meaningful changes.
 */
export function detectObservationChange(
  previous: ObservationScoreView | null | undefined,
  next: ObservationScoreView,
): ObservationChange | null {
  if (previous == null) {
    return null;
  }

  const scoreDelta =
    Math.round((next.hypothesisScore - previous.hypothesisScore) * 10_000)
    / 10_000;
  const absScoreDelta = Math.abs(scoreDelta);

  const rankChanged = previous.rank !== next.rank;
  const rankChangedInTop25 =
    rankChanged && (inTop25(previous.rank) || inTop25(next.rank));

  const componentPairs: Array<[ObservationComponentName, number, number]> = [
    ["narrative_score", previous.narrativeScore, next.narrativeScore],
    ["asymmetry_score", previous.asymmetryScore, next.asymmetryScore],
    ["catalyst_score", previous.catalystScore, next.catalystScore],
    ["attention_score", previous.attentionScore, next.attentionScore],
    ["liquidity_score", previous.liquidityScore, next.liquidityScore],
  ];

  const componentDeltas: Partial<Record<ObservationComponentName, number>> = {};
  const componentReasons: string[] = [];

  for (const [name, before, after] of componentPairs) {
    const delta = Math.round((after - before) * 10_000) / 10_000;
    if (Math.abs(delta) >= OBSERVATION_COMPONENT_DELTA_MIN) {
      componentDeltas[name] = delta;
      componentReasons.push(
        `${name} ${formatSigned(delta)} — volgen voor onderzoek`,
      );
    }
  }

  const scoreMeaningful = absScoreDelta >= OBSERVATION_SCORE_DELTA_MIN;
  const componentMeaningful = componentReasons.length > 0;

  if (!rankChangedInTop25 && !scoreMeaningful && !componentMeaningful) {
    return null;
  }

  const reasons: string[] = [];
  if (rankChangedInTop25) {
    reasons.push(
      `rank ${previous.rank ?? "—"} → ${next.rank ?? "—"} binnen top ${HYPOTHESIS_UNIVERSE_MAX} — observeren`,
    );
  }
  if (scoreMeaningful) {
    reasons.push(
      `research score ${formatSigned(scoreDelta)} — verder onderzoeken`,
    );
  }
  reasons.push(...componentReasons);

  const kind: ObservationChangeKind = rankChangedInTop25
    ? "OBSERVATION_UPDATE"
    : "SCORE_CHANGE";

  return {
    kind,
    scoreDelta,
    rankChangedInTop25,
    previousRank: previous.rank,
    nextRank: next.rank,
    reasons,
    primaryReason: reasons[0] ?? "betekenisvolle observatie — volgen",
    componentDeltas,
  };
}
