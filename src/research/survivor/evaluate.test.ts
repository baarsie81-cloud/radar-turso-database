import { describe, expect, it } from "vitest";
import { evaluateSurvivorObservation } from "./evaluate";
import type { SurvivorObservationInput } from "./types";

function fixture(chain: "SOLANA" | "BNB"): SurvivorObservationInput {
  const launchedAt = 1_700_000_000_000;
  return {
    chain,
    assetId: `${chain.toLowerCase()}-asset`,
    symbol: "TEST",
    launchedAt,
    entryPrice: 1,
    entryValid: true,
    snapshots: [
      { stage: "INITIAL", capturedAt: launchedAt, price: 1 },
      { stage: "PLUS_5", capturedAt: launchedAt + 5 * 60_000, price: 1.1 },
      { stage: "PLUS_10", capturedAt: launchedAt + 10 * 60_000, price: 1.3 },
      { stage: "PLUS_60", capturedAt: launchedAt + 60 * 60_000, price: 1.5 },
    ],
    survivalChecks: [
      {
        horizonMinutes: 60,
        capturedAt: launchedAt + 60 * 60_000,
        tradeable: true,
        liquidityUsd: 50_000,
      },
    ],
  };
}

describe("survivor research evaluator", () => {
  it("applies identical Radar24 rules to Solana and BNB survivors", () => {
    const solana = evaluateSurvivorObservation(fixture("SOLANA"), 60);
    const bnb = evaluateSurvivorObservation(fixture("BNB"), 60);

    expect(solana.radarDecision.decisionStatus).toBe("PASS");
    expect(bnb.radarDecision.decisionStatus).toBe("PASS");
    expect(solana.radarDecision.plus10RoiPct).toBeCloseTo(30);
    expect(bnb.radarDecision.plus10RoiPct).toBeCloseTo(30);
    expect(solana.radarDecision.momentum5To10Pct).toBeCloseTo(20);
    expect(bnb.radarDecision.momentum5To10Pct).toBeCloseTo(20);
    expect(solana.survivalStatus).toBe("SURVIVED");
    expect(bnb.survivalStatus).toBe("SURVIVED");
  });

  it("keeps survival outcome separate from the Radar24 decision", () => {
    const input = fixture("SOLANA");
    input.survivalChecks[0] = {
      ...input.survivalChecks[0],
      tradeable: false,
      liquidityUsd: 0,
    };

    const result = evaluateSurvivorObservation(input, 60);
    expect(result.radarDecision.decisionStatus).toBe("PASS");
    expect(result.survivalStatus).toBe("FAILED");
  });
});
