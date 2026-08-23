import type { HypothesisAssetRow } from "../db/repositories/hypothesis/assets";
import type { HypothesisScoreInput } from "./score";

/**
 * Collected observation inputs for one universe asset.
 * Pure mapping — no market I/O, no Radar coupling.
 */
export type HypothesisCollectedInputs = {
  scoreInput: HypothesisScoreInput;
  /** Opaque JSON blob stored on the score snapshot (append-only history). */
  inputsJson: string;
};

export type CollectHypothesisInputsFn = (
  asset: HypothesisAssetRow,
  capturedAt: number,
) => Promise<HypothesisCollectedInputs> | HypothesisCollectedInputs;

/**
 * Default collector: pass through current asset component scores.
 * Later phases can inject market-derived collectors without changing the runner.
 */
export function collectHypothesisInputsFromAsset(
  asset: HypothesisAssetRow,
  capturedAt: number,
): HypothesisCollectedInputs {
  const scoreInput: HypothesisScoreInput = {
    narrative_score: asset.narrativeScore,
    asymmetry_score: asset.asymmetryScore,
    catalyst_score: asset.catalystScore,
    attention_score: asset.attentionScore,
    liquidity_score: asset.liquidityScore,
  };

  return {
    scoreInput,
    inputsJson: JSON.stringify({
      source: "hypothesis_asset_passthrough",
      hypothesis_asset_id: asset.id,
      mint: asset.mint,
      status: asset.status,
      rank: asset.rank,
      captured_at: capturedAt,
      score_input: scoreInput,
    }),
  };
}
