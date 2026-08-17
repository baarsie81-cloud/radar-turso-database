import { describe, expect, it } from "vitest";
import { evaluateRadar24, roiPct } from "../src/decisions/engine";
import type { EvaluateInput, Snapshot, SnapshotStage } from "../src/domain/types";

const T0 = 1_700_000_000_000;

function snapshot(
  stage: SnapshotStage,
  price: number,
  capturedAt: number | null = T0,
): Snapshot {
  return { stage, capturedAt, price };
}

function input(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    tokenCaseId: 1,
    decisionStage: "PLUS_10",
    decidedAt: T0 + 10 * 60_000,
    ...overrides,
    entry: {
      entryPrice: 100,
      entryValid: true,
      ...overrides.entry,
    },
    snapshots: {
      INITIAL: snapshot("INITIAL", 100, T0),
      PLUS_5: snapshot("PLUS_5", 120, T0 + 5 * 60_000),
      PLUS_10: snapshot("PLUS_10", 130, T0 + 10 * 60_000),
      ...overrides.snapshots,
    },
  };
}

describe("evaluateRadar24", () => {
  it("passes when entry is valid, +10 ROI is at least 25%, and momentum is not negative", () => {
    const result = evaluateRadar24(input());

    expect(result.decisionStatus).toBe("PASS");
    expect(result.rejectReason).toBeNull();
    expect(result.plus5RoiPct).toBe(20);
    expect(result.plus10RoiPct).toBe(30);
    expect(result.momentum5To10Pct).toBe(10);
    expect(result.radarVersion).toBe("2.4");
    expect(JSON.parse(result.inputsJson)).toMatchObject({
      plus5RoiPct: 20,
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      plus10RoiMinPct: 25,
    });
  });

  it("passes when momentum from +5 to +10 is exactly zero", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_5: snapshot("PLUS_5", 130, T0 + 5 * 60_000),
          PLUS_10: snapshot("PLUS_10", 130, T0 + 10 * 60_000),
        },
      }),
    );

    expect(result.decisionStatus).toBe("PASS");
    expect(result.plus10RoiPct).toBe(30);
    expect(result.momentum5To10Pct).toBe(0);
  });

  it("rejects missing initial snapshot", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          INITIAL: undefined,
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_INITIAL_SNAPSHOT");
    expect(result.momentum5To10Pct).toBeNull();
  });

  it("rejects missing exact entry when INITIAL captured_at is absent", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          INITIAL: snapshot("INITIAL", 100, null),
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_EXACT_ENTRY");
  });

  it("rejects invalid entry price", () => {
    const result = evaluateRadar24(
      input({
        entry: { entryPrice: 0, entryValid: true },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("INVALID_ENTRY_PRICE");
  });

  it("rejects when entry_valid is false", () => {
    const result = evaluateRadar24(
      input({
        entry: { entryPrice: 100, entryValid: false },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("ENTRY_NOT_VALID");
  });

  it("rejects when +10 ROI is below 25%", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_5: snapshot("PLUS_5", 110, T0 + 5 * 60_000),
          PLUS_10: snapshot("PLUS_10", 120, T0 + 10 * 60_000),
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("ROI_BELOW_25_AT_PLUS_10");
    expect(result.plus5RoiPct).toBe(10);
    expect(result.plus10RoiPct).toBe(20);
    expect(result.momentum5To10Pct).toBe(10);
  });

  it("rejects negative +5 to +10 momentum", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_5: snapshot("PLUS_5", 140, T0 + 5 * 60_000),
          PLUS_10: snapshot("PLUS_10", 130, T0 + 10 * 60_000),
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("NEGATIVE_MOMENTUM_5_TO_10");
    expect(result.plus5RoiPct).toBe(40);
    expect(result.plus10RoiPct).toBe(30);
    expect(result.momentum5To10Pct).toBe(-10);
  });

  it("rejects missing PLUS_5 snapshot at PLUS_10", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_5: undefined,
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_PLUS_5_SNAPSHOT");
  });

  it("rejects missing PLUS_5 price at PLUS_10", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_5: snapshot("PLUS_5", Number.NaN, T0 + 5 * 60_000),
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_PLUS_5_SNAPSHOT");
  });

  it("rejects missing PLUS_10 snapshot at PLUS_10", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_10: undefined,
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_PLUS_10_SNAPSHOT");
  });

  it("rejects missing PLUS_10 price at PLUS_10", () => {
    const result = evaluateRadar24(
      input({
        snapshots: {
          PLUS_10: snapshot("PLUS_10", Number.NaN, T0 + 10 * 60_000),
        },
      }),
    );

    expect(result.decisionStatus).toBe("REJECT");
    expect(result.rejectReason).toBe("MISSING_PLUS_10_SNAPSHOT");
  });

  it("stays pending before PLUS_10 so a later reject can still be followed to CLOSED", () => {
    const result = evaluateRadar24(input({ decisionStage: "PLUS_5" }));

    expect(result.decisionStatus).toBe("PENDING");
    expect(result.rejectReason).toBeNull();
  });
});

describe("roiPct", () => {
  it("computes percent return against entry", () => {
    expect(roiPct(130, 100)).toBe(30);
  });
});
