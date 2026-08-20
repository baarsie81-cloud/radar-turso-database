import { describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { listDecisionsByCase } from "../src/db/repositories/decisions";
import { listSnapshotsByCase } from "../src/db/repositories/snapshots";
import { getTokenCase } from "../src/db/repositories/tokenCases";
import {
  simulateLifecycle,
  type LifecycleMarketPrices,
} from "../src/simulation/lifecycle";

const FIRST_SEEN = 1_750_000_000_000;
const ENTRY = 100;

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function mint(tag: string): string {
  // base58-safe (no 0, O, I, l)
  const safe = tag.replace(/[0OIl]/g, "x");
  return `SimMint${safe.padEnd(36, "1")}`;
}

describe("lifecycle simulation", () => {
  it("Scenario A: successful momentum token → PASS + RUNNER", async () => {
    const client = await setup();
    const prices: LifecycleMarketPrices = {
      INITIAL: ENTRY,
      PLUS_5: 120, // +20%
      PLUS_10: 130, // +30% (≥25), momentum +10 → PASS
      PLUS_15: 180, // +80%
      PLUS_30: 220, // +120% peak → RUNNER
      PLUS_60: 250, // +150%
    };

    const simulation = await simulateLifecycle({
      client,
      mint: mint("A"),
      entryPrice: ENTRY,
      prices,
      firstSeenAt: FIRST_SEEN,
    });

    expect(simulation.ok).toBe(true);
    if (!simulation.ok) {
      return;
    }

    expect(simulation.result).toEqual({
      caseId: simulation.result.caseId,
      decisionStatus: "PASS",
      rejectReason: null,
      outcomeLabel: "RUNNER",
      snapshotsCreated: 6,
      finalCaseStatus: "CLOSED",
    });

    const tokenCase = await getTokenCase(client, simulation.result.caseId);
    expect(tokenCase?.stage).toBe("CLOSED");
    expect(tokenCase?.outcomeLabel).toBe("RUNNER");

    const decisions = await listDecisionsByCase(client, simulation.result.caseId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decisionStatus).toBe("PASS");
    expect(decisions[0]?.rejectReason).toBeNull();

    const snapshots = await listSnapshotsByCase(client, simulation.result.caseId);
    expect(snapshots.map((s) => s.stage)).toEqual([
      "INITIAL",
      "PLUS_5",
      "PLUS_10",
      "PLUS_15",
      "PLUS_30",
      "PLUS_60",
    ]);
  });

  it("Scenario B: ROI below 25% → REJECT, stays tracked, closes NO_RESULT", async () => {
    const client = await setup();
    const prices: LifecycleMarketPrices = {
      INITIAL: ENTRY,
      PLUS_5: 110, // +10%
      PLUS_10: 115, // +15% (<25) → REJECT ROI_BELOW_25
      PLUS_15: 110,
      PLUS_30: 105,
      PLUS_60: 90, // peak in outcome window < 25% → NO_RESULT
    };

    const simulation = await simulateLifecycle({
      client,
      mint: mint("B"),
      entryPrice: ENTRY,
      prices,
      firstSeenAt: FIRST_SEEN,
    });

    expect(simulation.ok).toBe(true);
    if (!simulation.ok) {
      return;
    }

    expect(simulation.result.decisionStatus).toBe("REJECT");
    expect(simulation.result.rejectReason).toBe("ROI_BELOW_25_AT_PLUS_10");
    expect(simulation.result.outcomeLabel).toBe("NO_RESULT");
    expect(simulation.result.finalCaseStatus).toBe("CLOSED");
    expect(simulation.result.snapshotsCreated).toBe(6);

    // After PLUS_10 the case was still OPEN (tracked); only PLUS_60 closes it.
    const decisions = await listDecisionsByCase(client, simulation.result.caseId);
    expect(decisions[0]?.decisionStatus).toBe("REJECT");

    const tokenCase = await getTokenCase(client, simulation.result.caseId);
    expect(tokenCase?.caseStatus).toBe("CLOSED");
    expect(tokenCase?.outcomeLabel).toBe("NO_RESULT");
  });

  it("Scenario C: negative momentum → REJECT NEGATIVE_MOMENTUM_5_TO_10", async () => {
    const client = await setup();
    const prices: LifecycleMarketPrices = {
      INITIAL: ENTRY,
      PLUS_5: 140, // +40%
      PLUS_10: 130, // +30% (≥25) but momentum -10 → REJECT
      PLUS_15: 120,
      PLUS_30: 110,
      PLUS_60: 100,
    };

    const simulation = await simulateLifecycle({
      client,
      mint: mint("C"),
      entryPrice: ENTRY,
      prices,
      firstSeenAt: FIRST_SEEN,
    });

    expect(simulation.ok).toBe(true);
    if (!simulation.ok) {
      return;
    }

    expect(simulation.result.decisionStatus).toBe("REJECT");
    expect(simulation.result.rejectReason).toBe("NEGATIVE_MOMENTUM_5_TO_10");
    expect(simulation.result.snapshotsCreated).toBe(6);
    expect(simulation.result.finalCaseStatus).toBe("CLOSED");

    const decisions = await listDecisionsByCase(client, simulation.result.caseId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.rejectReason).toBe("NEGATIVE_MOMENTUM_5_TO_10");
    expect(decisions[0]?.plus5RoiPct).toBe(40);
    expect(decisions[0]?.plus10RoiPct).toBe(30);
    expect(decisions[0]?.momentum5To10Pct).toBe(-10);
  });

  it("does not call external APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = await setup();

    await simulateLifecycle({
      client,
      mint: mint("Z"),
      entryPrice: ENTRY,
      prices: {
        INITIAL: ENTRY,
        PLUS_5: 120,
        PLUS_10: 130,
        PLUS_15: 180,
        PLUS_30: 220,
        PLUS_60: 250,
      },
      firstSeenAt: FIRST_SEEN,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects mismatched INITIAL price vs entryPrice", async () => {
    const client = await setup();

    const simulation = await simulateLifecycle({
      client,
      mint: mint("X"),
      entryPrice: ENTRY,
      prices: {
        INITIAL: 99,
        PLUS_5: 120,
        PLUS_10: 130,
        PLUS_15: 140,
        PLUS_30: 150,
        PLUS_60: 160,
      },
      firstSeenAt: FIRST_SEEN,
    });

    expect(simulation.ok).toBe(false);
    if (simulation.ok) {
      return;
    }
    expect(simulation.error).toMatch(/INITIAL must equal entryPrice/);
  });
});
