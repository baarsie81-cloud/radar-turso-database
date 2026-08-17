import { roiPct } from "../decisions/engine";
import {
  OUTCOME_WINDOW_STAGES,
  RUNNER_MIN_PCT,
  SMALL_WIN_MIN_PCT,
  type OutcomeInputs,
  type OutcomeLabel,
  type OutcomeResult,
  type OutcomeWindowStage,
  type Snapshot,
  type SnapshotStage,
  type TokenCaseEntry,
} from "../domain/types";

function emptyOutcome(): OutcomeResult {
  return {
    outcomeLabel: null,
    peakRoiPct: null,
    terminalRoiPct: null,
    stagesUsed: [],
    inputs: null,
    inputsJson: null,
  };
}

function snapshotPrice(snapshot: Snapshot | undefined): number | null {
  if (!snapshot || !Number.isFinite(snapshot.price)) {
    return null;
  }
  return snapshot.price;
}

export function labelOutcome(
  entry: TokenCaseEntry,
  snapshots: Partial<Record<SnapshotStage, Snapshot>>,
): OutcomeResult {
  const plus60Price = snapshotPrice(snapshots.PLUS_60);
  const entryPrice = entry.entryPrice;
  if (
    plus60Price == null ||
    entryPrice == null ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0
  ) {
    return emptyOutcome();
  }

  const stagesUsed: OutcomeWindowStage[] = [];
  const rois: number[] = [];
  for (const stage of OUTCOME_WINDOW_STAGES) {
    const price = snapshotPrice(snapshots[stage]);
    if (price == null) {
      continue;
    }
    stagesUsed.push(stage);
    rois.push(roiPct(price, entryPrice));
  }

  if (!stagesUsed.includes("PLUS_60") || rois.length === 0) {
    return emptyOutcome();
  }

  const peakRoiPct = Math.max(...rois);
  const terminalRoiPct = roiPct(plus60Price, entryPrice);

  let outcomeLabel: OutcomeLabel = "NO_RESULT";
  if (peakRoiPct >= RUNNER_MIN_PCT) {
    outcomeLabel = "RUNNER";
  } else if (peakRoiPct >= SMALL_WIN_MIN_PCT) {
    outcomeLabel = "SMALL_WIN";
  }

  const inputs: OutcomeInputs = {
    entryPrice,
    peakRoiPct,
    terminalRoiPct,
    stagesUsed,
    smallWinMinPct: SMALL_WIN_MIN_PCT,
    runnerMinPct: RUNNER_MIN_PCT,
  };

  return {
    outcomeLabel,
    peakRoiPct,
    terminalRoiPct,
    stagesUsed,
    inputs,
    inputsJson: JSON.stringify(inputs),
  };
}
