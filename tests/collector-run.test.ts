import { describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  acquireCollectionLock,
  DEFAULT_COLLECTION_LOCK_KEY,
} from "../src/db/repositories/locks";
import {
  createSnapshotJobsForCase,
  getDueJobs,
} from "../src/db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../src/db/repositories/snapshots";
import { listDecisionsByCase } from "../src/db/repositories/decisions";
import {
  createTokenCase,
  getTokenCase,
  listTokenCases,
} from "../src/db/repositories/tokenCases";
import { runCollection } from "../src/collector/run";
import type { DiscoveredToken } from "../src/providers/types";
import type { MarketSnapshotInput } from "../src/lifecycle/types";

// ---- setup helpers -------------------------------------------------------

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

const BASE = 1_750_000_000_000;

function makeMint(suffix: string): string {
  // Use only base58 characters (no 0, O, I, l).
  const safe = suffix.replace(/[0OIl]/g, "x");
  return `SoMnt${safe.padEnd(39, "1")}`;
}

function makeToken(suffix: string, firstSeenAt = BASE): DiscoveredToken {
  return {
    mint: makeMint(suffix),
    symbol: suffix.toUpperCase(),
    name: `Token ${suffix}`,
    firstSeenAt,
    price: 0.001,
    marketCap: 10_000,
    liquidityUsd: 5_000,
  };
}

function makeMarket(price: number, capturedAt = BASE): MarketSnapshotInput {
  return { price, capturedAt, marketCap: price * 1_000_000, liquidityUsd: 50_000 };
}

function lifecycleJobs(firstSeenAt: number) {
  return [
    {
      stage: "PLUS_5" as const,
      scheduledFor: firstSeenAt + 300_000,
      deadlineAt: firstSeenAt + 720_000,
    },
    {
      stage: "PLUS_10" as const,
      scheduledFor: firstSeenAt + 600_000,
      deadlineAt: firstSeenAt + 1_200_000,
    },
    {
      stage: "PLUS_15" as const,
      scheduledFor: firstSeenAt + 900_000,
      deadlineAt: firstSeenAt + 1_800_000,
    },
    {
      stage: "PLUS_30" as const,
      scheduledFor: firstSeenAt + 1_800_000,
      deadlineAt: firstSeenAt + 3_000_000,
    },
    {
      stage: "PLUS_60" as const,
      scheduledFor: firstSeenAt + 3_600_000,
      deadlineAt: firstSeenAt + 5_400_000,
    },
  ];
}

async function seedTrackedCase(
  client: Awaited<ReturnType<typeof setup>>,
  suffix: string,
  firstSeenAt = BASE,
  entryPrice = 100,
) {
  const tokenCase = await createTokenCase(client, {
    mint: makeMint(suffix),
    symbol: suffix.toUpperCase(),
    firstSeenAt,
    entryPrice,
    entryValid: true,
    stage: "INITIAL",
    caseStatus: "OPEN",
    createdAt: firstSeenAt,
  });
  await upsertSnapshot(client, {
    tokenCaseId: tokenCase.id,
    stage: "INITIAL",
    capturedAt: firstSeenAt,
    price: entryPrice,
    roiPct: 0,
  });
  const jobs = await createSnapshotJobsForCase(client, {
    tokenCaseId: tokenCase.id,
    jobs: lifecycleJobs(firstSeenAt),
    createdAt: firstSeenAt,
  });
  return { tokenCase, jobs };
}

// ---- tests ---------------------------------------------------------------

describe("runCollection", () => {
  it("discovery creates token cases and INITIAL snapshots", async () => {
    const client = await setup();
    const token = makeToken("A");

    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [token],
      fetchMarket: async () => makeMarket(0.001),
      now: () => BASE,
    });

    expect(summary.discovered).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(0);

    const cases = await listTokenCases(client);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.mint).toBe(token.mint);

    const snapshots = await listSnapshotsByCase(client, cases[0]!.id);
    expect(snapshots.map((s) => s.stage)).toContain("INITIAL");
  });

  it("due jobs are processed and snapshots written", async () => {
    const client = await setup();
    const { tokenCase } = await seedTrackedCase(client, "B", BASE);
    const jobTime = BASE + 300_000; // PLUS_5 due

    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket: async () => makeMarket(110, jobTime),
      now: () => jobTime,
    });

    expect(summary.jobsProcessed).toBe(1);
    expect(summary.snapshotsWritten).toBe(1);
    expect(summary.errors).toHaveLength(0);

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots.map((s) => s.stage)).toContain("PLUS_5");
    expect(snapshots.find((s) => s.stage === "PLUS_5")?.price).toBe(110);
  });

  it("DexScreener market data reaches processSnapshotJob correctly", async () => {
    const client = await setup();
    const { tokenCase } = await seedTrackedCase(client, "C", BASE);
    const jobTime = BASE + 300_000;

    const market: MarketSnapshotInput = {
      price: 0.0042,
      capturedAt: jobTime,
      marketCap: 42_000,
      liquidityUsd: 8_000,
    };
    const fetchMarket = vi.fn(async (_mint: string) => market);

    await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket,
      now: () => jobTime,
    });

    expect(fetchMarket).toHaveBeenCalledWith(tokenCase.mint);
    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    const plus5 = snapshots.find((s) => s.stage === "PLUS_5");
    expect(plus5?.price).toBe(0.0042);
    expect(plus5?.marketCap).toBe(42_000);
    expect(plus5?.liquidityUsd).toBe(8_000);
  });

  it("PLUS_10 creates a decision", async () => {
    const client = await setup();
    const { tokenCase } = await seedTrackedCase(client, "D", BASE);

    // advance PLUS_5 first
    await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket: async () => makeMarket(120, BASE + 300_000),
      now: () => BASE + 300_000,
    });

    // now process PLUS_10
    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket: async () => makeMarket(130, BASE + 600_000),
      now: () => BASE + 600_000,
    });

    expect(summary.decisionsCreated).toBe(1);
    expect(summary.errors).toHaveLength(0);

    const decisions = await listDecisionsByCase(client, tokenCase.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decisionStage).toBe("PLUS_10");
    expect(decisions[0]?.decisionStatus).toBe("PASS");
  });

  it("PLUS_60 closes the case", async () => {
    const client = await setup();
    const { tokenCase } = await seedTrackedCase(client, "E", BASE);

    // seed intermediate snapshots so outcome labeling has enough data
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      capturedAt: BASE + 300_000,
      price: 120,
      roiPct: 20,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      capturedAt: BASE + 600_000,
      price: 130,
      roiPct: 30,
    });

    const jobTime = BASE + 3_600_000;
    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket: async () => makeMarket(250, jobTime),
      now: () => jobTime,
    });

    expect(summary.casesClosed).toBe(1);
    expect(summary.errors).toHaveLength(0);

    const reloaded = await getTokenCase(client, tokenCase.id);
    expect(reloaded?.caseStatus).toBe("CLOSED");
    expect(reloaded?.stage).toBe("CLOSED");
  });

  it("lock prevents a duplicate concurrent run", async () => {
    const client = await setup();

    // hold the lock ourselves so runCollection cannot acquire it
    const locked = await acquireCollectionLock(client, {
      jobKey: DEFAULT_COLLECTION_LOCK_KEY,
      owner: "other-runner",
      lockedUntil: BASE + 60_000,
      startedAt: BASE,
    });
    expect(locked).toBe(true);

    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: vi.fn(async () => []),
      fetchMarket: vi.fn(async () => makeMarket(1)),
      now: () => BASE,
    });

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.message).toMatch(/lock/i);
    expect(summary.discovered).toBe(0);
  });

  it("one failing job does not stop other jobs", async () => {
    const client = await setup();
    await seedTrackedCase(client, "F", BASE);
    await seedTrackedCase(client, "G", BASE);
    const jobTime = BASE + 300_000;

    let callCount = 0;
    const fetchMarket = vi.fn(async (mint: string) => {
      callCount += 1;
      // fail for the first mint queried
      if (callCount === 1) {
        throw new Error("MARKET_UNAVAILABLE");
      }
      return makeMarket(110, jobTime);
    });

    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket,
      now: () => jobTime,
    });

    // one succeeded, one failed
    expect(summary.jobsProcessed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.message).toContain("MARKET_UNAVAILABLE");
  });

  it("discovery errors are collected without aborting job processing", async () => {
    const client = await setup();
    await seedTrackedCase(client, "H", BASE);
    const jobTime = BASE + 300_000;

    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => {
        throw new Error("GECKO_DOWN");
      },
      fetchMarket: async () => makeMarket(110, jobTime),
      now: () => jobTime,
    });

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.phase).toBe("discovery");
    expect(summary.errors[0]?.message).toContain("GECKO_DOWN");
    // jobs still ran
    expect(summary.jobsProcessed).toBe(1);
  });

  it("skips duplicate token discovery in same run", async () => {
    const client = await setup();
    const token = makeToken("I");

    // first run creates the case
    await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [token],
      fetchMarket: async () => makeMarket(0.001),
      now: () => BASE,
    });

    // second run at different time sees same mint — should skip it
    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [token],
      fetchMarket: async () => makeMarket(0.001, BASE + 300_000),
      now: () => BASE + 300_000,
    });

    expect(summary.skipped).toBe(1);
    expect(summary.discovered).toBe(0);
    const cases = await listTokenCases(client);
    const matching = cases.filter((c) => c.mint === token.mint);
    expect(matching).toHaveLength(1);
  });

  it("summary counts jobs across discovery + lifecycle in one run", async () => {
    const client = await setup();
    // pre-seed a case that has a due PLUS_5 job at BASE + 300_000
    await seedTrackedCase(client, "L", BASE);

    // discover two new tokens — scheduled at BASE + 2 * 60_000 so their jobs
    // are NOT due at the PLUS_5 window of BASE + 300_000
    const futureBase = BASE + 2 * 60 * 60_000; // 2 hours later
    const tokenA = makeToken("J", futureBase);
    const tokenB = makeToken("K", futureBase);

    const jobTime = BASE + 300_000;
    const summary = await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [tokenA, tokenB],
      fetchMarket: async () => makeMarket(0.002, jobTime),
      now: () => jobTime,
    });

    expect(summary.discovered).toBe(2);
    expect(summary.jobsProcessed).toBe(1); // only pre-seeded PLUS_5 is due
    expect(summary.snapshotsWritten).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });

  it("does not call external APIs directly (only via injected deps)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = await setup();

    await runCollection({
      client,
      owner: "test-runner",
      discoverTokens: async () => [],
      fetchMarket: async () => makeMarket(1),
      now: () => BASE,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
