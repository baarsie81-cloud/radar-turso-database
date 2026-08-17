import { describe, expect, it } from "vitest";
import { labelOutcome } from "../src/outcomes/label";
import type { Snapshot, SnapshotStage, TokenCaseEntry } from "../src/domain/types";

const T0 = 1_700_000_000_000;

function snapshot(
  stage: SnapshotStage,
  price: number,
  capturedAt: number | null = T0,
): Snapshot {
  return { stage, capturedAt, price };
}

function entry(entryPrice: number | null = 100): TokenCaseEntry {
  return { entryPrice, entryValid: true };
}

function snapshots(
  overrides: Partial<Record<SnapshotStage, Snapshot | undefined>> = {},
): Partial<Record<SnapshotStage, Snapshot>> {
  return {
    INITIAL: snapshot("INITIAL", 100, T0),
    PLUS_5: snapshot("PLUS_5", 120, T0 + 5 * 60_000),
    PLUS_10: snapshot("PLUS_10", 130, T0 + 10 * 60_000),
    PLUS_15: snapshot("PLUS_15", 140, T0 + 15 * 60_000),
    PLUS_30: snapshot("PLUS_30", 150, T0 + 30 * 60_000),
    PLUS_60: snapshot("PLUS_60", 160, T0 + 60 * 60_000),
    ...overrides,
  };
}

describe("labelOutcome", () => {
  it("labels RUNNER when peak ROI across PLUS_15/30/60 is at least 100%", () => {
    const result = labelOutcome(
      entry(),
      snapshots({
        PLUS_15: snapshot("PLUS_15", 180, T0 + 15 * 60_000),
        PLUS_30: snapshot("PLUS_30", 220, T0 + 30 * 60_000),
        PLUS_60: snapshot("PLUS_60", 150, T0 + 60 * 60_000),
      }),
    );

    expect(result.outcomeLabel).toBe("RUNNER");
    expect(result.peakRoiPct).toBe(120);
    expect(result.terminalRoiPct).toBe(50);
    expect(result.stagesUsed).toEqual(["PLUS_15", "PLUS_30", "PLUS_60"]);
    expect(JSON.parse(result.inputsJson ?? "")).toMatchObject({
      entryPrice: 100,
      peakRoiPct: 120,
      terminalRoiPct: 50,
      runnerMinPct: 100,
      smallWinMinPct: 25,
    });
  });

  it("labels SMALL_WIN when peak ROI is at least 25% and below 100%", () => {
    const result = labelOutcome(
      entry(),
      snapshots({
        PLUS_15: snapshot("PLUS_15", 110, T0 + 15 * 60_000),
        PLUS_30: snapshot("PLUS_30", 140, T0 + 30 * 60_000),
        PLUS_60: snapshot("PLUS_60", 120, T0 + 60 * 60_000),
      }),
    );

    expect(result.outcomeLabel).toBe("SMALL_WIN");
    expect(result.peakRoiPct).toBe(40);
    expect(result.terminalRoiPct).toBe(20);
  });

  it("labels NO_RESULT when peak ROI stays below 25%", () => {
    const result = labelOutcome(
      entry(),
      snapshots({
        PLUS_15: snapshot("PLUS_15", 110, T0 + 15 * 60_000),
        PLUS_30: snapshot("PLUS_30", 105, T0 + 30 * 60_000),
        PLUS_60: snapshot("PLUS_60", 90, T0 + 60 * 60_000),
      }),
    );

    expect(result.outcomeLabel).toBe("NO_RESULT");
    expect(result.peakRoiPct).toBe(10);
    expect(result.terminalRoiPct).toBe(-10);
  });

  it("does not label when PLUS_60 is missing", () => {
    const result = labelOutcome(
      entry(),
      snapshots({
        PLUS_15: snapshot("PLUS_15", 300, T0 + 15 * 60_000),
        PLUS_30: snapshot("PLUS_30", 400, T0 + 30 * 60_000),
        PLUS_60: undefined,
      }),
    );

    expect(result.outcomeLabel).toBeNull();
    expect(result.peakRoiPct).toBeNull();
    expect(result.terminalRoiPct).toBeNull();
    expect(result.stagesUsed).toEqual([]);
    expect(result.inputs).toBeNull();
    expect(result.inputsJson).toBeNull();
  });

  it("treats exactly 100% peak ROI as RUNNER and exactly 25% as SMALL_WIN", () => {
    const runner = labelOutcome(
      entry(),
      snapshots({
        PLUS_60: snapshot("PLUS_60", 200, T0 + 60 * 60_000),
      }),
    );
    expect(runner.outcomeLabel).toBe("RUNNER");
    expect(runner.peakRoiPct).toBe(100);

    const smallWin = labelOutcome(
      entry(),
      snapshots({
        PLUS_15: snapshot("PLUS_15", 125, T0 + 15 * 60_000),
        PLUS_30: snapshot("PLUS_30", 110, T0 + 30 * 60_000),
        PLUS_60: snapshot("PLUS_60", 110, T0 + 60 * 60_000),
      }),
    );
    expect(smallWin.outcomeLabel).toBe("SMALL_WIN");
    expect(smallWin.peakRoiPct).toBe(25);
  });
});
