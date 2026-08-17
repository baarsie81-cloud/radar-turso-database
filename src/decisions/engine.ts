import {
  PLUS_10_ROI_MIN_PCT,
  RADAR_VERSION,
  type DecisionInputs,
  type DecisionResult,
  type EvaluateInput,
  type RejectReason,
  type Snapshot,
} from "../domain/types";

export function roiPct(price: number, entryPrice: number): number {
  return ((price - entryPrice) / entryPrice) * 100;
}

function isPresentCapturedAt(capturedAt: number | null | undefined): boolean {
  return typeof capturedAt === "number" && capturedAt > 0;
}

function snapshotPrice(snapshot: Snapshot | undefined): number | null {
  if (!snapshot || !Number.isFinite(snapshot.price)) {
    return null;
  }
  return snapshot.price;
}

function buildResult(
  input: EvaluateInput,
  radarVersion: string,
  decisionStatus: DecisionResult["decisionStatus"],
  rejectReason: RejectReason | null,
  metrics: {
    plus5RoiPct: number | null;
    plus10RoiPct: number | null;
    momentum5To10Pct: number | null;
    initialCapturedAt: number | null;
    initialPrice: number | null;
    plus5Price: number | null;
    plus10Price: number | null;
  },
): DecisionResult {
  const inputs: DecisionInputs = {
    radarVersion,
    decisionStage: input.decisionStage,
    entryPrice: input.entry.entryPrice,
    entryValid: input.entry.entryValid,
    initialCapturedAt: metrics.initialCapturedAt,
    initialPrice: metrics.initialPrice,
    plus5Price: metrics.plus5Price,
    plus10Price: metrics.plus10Price,
    plus5RoiPct: metrics.plus5RoiPct,
    plus10RoiPct: metrics.plus10RoiPct,
    momentum5To10Pct: metrics.momentum5To10Pct,
    plus10RoiMinPct: PLUS_10_ROI_MIN_PCT,
  };

  return {
    tokenCaseId: input.tokenCaseId,
    decisionStage: input.decisionStage,
    decidedAt: input.decidedAt,
    decisionStatus,
    rejectReason,
    radarVersion,
    entryPrice: input.entry.entryPrice,
    plus5RoiPct: metrics.plus5RoiPct,
    plus10RoiPct: metrics.plus10RoiPct,
    momentum5To10Pct: metrics.momentum5To10Pct,
    inputs,
    inputsJson: JSON.stringify(inputs),
  };
}

function entryRejectReason(input: EvaluateInput): RejectReason | null {
  const initial = input.snapshots.INITIAL;

  if (!initial) {
    return "MISSING_INITIAL_SNAPSHOT";
  }

  if (!isPresentCapturedAt(initial.capturedAt)) {
    return "MISSING_EXACT_ENTRY";
  }

  if (input.entry.entryValid !== true) {
    return "ENTRY_NOT_VALID";
  }

  const entryPrice = input.entry.entryPrice;
  if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return "INVALID_ENTRY_PRICE";
  }

  return null;
}

export function evaluateRadar24(input: EvaluateInput): DecisionResult {
  const radarVersion = input.radarVersion ?? RADAR_VERSION;
  const initial = input.snapshots.INITIAL;
  const plus5 = input.snapshots.PLUS_5;
  const plus10 = input.snapshots.PLUS_10;

  const initialPrice = snapshotPrice(initial);
  const plus5Price = snapshotPrice(plus5);
  const plus10Price = snapshotPrice(plus10);
  const initialCapturedAt = initial?.capturedAt ?? null;

  const metrics = {
    plus5RoiPct: null as number | null,
    plus10RoiPct: null as number | null,
    momentum5To10Pct: null as number | null,
    initialCapturedAt,
    initialPrice,
    plus5Price,
    plus10Price,
  };

  const pending = (reason: RejectReason | null = null) =>
    buildResult(input, radarVersion, reason ? "REJECT" : "PENDING", reason, metrics);

  if (input.decisionStage !== "PLUS_10") {
    return pending();
  }

  const entryReason = entryRejectReason(input);
  if (entryReason) {
    return pending(entryReason);
  }

  if (!plus5 || plus5Price == null) {
    return buildResult(
      input,
      radarVersion,
      "REJECT",
      "MISSING_PLUS_5_SNAPSHOT",
      metrics,
    );
  }

  if (!plus10 || plus10Price == null) {
    return buildResult(
      input,
      radarVersion,
      "REJECT",
      "MISSING_PLUS_10_SNAPSHOT",
      metrics,
    );
  }

  const entryPrice = input.entry.entryPrice;
  if (entryPrice == null) {
    return buildResult(
      input,
      radarVersion,
      "REJECT",
      "INVALID_ENTRY_PRICE",
      metrics,
    );
  }

  const plus5RoiPct = roiPct(plus5Price, entryPrice);
  const plus10RoiPct = roiPct(plus10Price, entryPrice);
  const momentum5To10Pct = plus10RoiPct - plus5RoiPct;

  metrics.plus5RoiPct = plus5RoiPct;
  metrics.plus10RoiPct = plus10RoiPct;
  metrics.momentum5To10Pct = momentum5To10Pct;

  if (plus10RoiPct < PLUS_10_ROI_MIN_PCT) {
    return buildResult(
      input,
      radarVersion,
      "REJECT",
      "ROI_BELOW_25_AT_PLUS_10",
      metrics,
    );
  }

  if (momentum5To10Pct < 0) {
    return buildResult(
      input,
      radarVersion,
      "REJECT",
      "NEGATIVE_MOMENTUM_5_TO_10",
      metrics,
    );
  }

  return buildResult(input, radarVersion, "PASS", null, metrics);
}
