import { afterEach, describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  acquireCollectionLock,
  LIFECYCLE_LOCK_KEY,
} from "../src/db/repositories/locks";
import {
  createSnapshotJob,
  createSnapshotJobsForCase,
} from "../src/db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../src/db/repositories/snapshots";
import { listDecisionsByCase } from "../src/db/repositories/decisions";
import {
  createTokenCase,
  getTokenCase,
} from "../src/db/repositories/tokenCases";
import { processLifecycleJobs } from "../src/lifecycle/run";
import { handleLifecycleCron } from "../src/collector/cronLifecycle";
import type { MarketSnapshotInput } from "../src/lifecycle/types";

const BASE = 1_760_000_000_000;
const OWNER = "lifecycle-runner-test";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function makeMint(tag: string): string {
  const safe = tag.replace(/[0OIl]/g, "x");
  return `LfMint${safe.padEnd(38, "1")}`;
}

function makeMarket(price: number, capturedAt: number): MarketSnapshotInput {
  return {
    price,
    capturedAt,
    marketCap: price * 1_000_000,
    liquidityUsd: 25_000,
  };
}

function schedule(firstSeenAt: number) {
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

async function seedCase(
  client: Awaited<ReturnType<typeof setup>>,
  tag: string,
  firstSeenAt = BASE,
  entryPrice = 100,
) {
  const tokenCase = await createTokenCase(client, {
    mint: makeMint(tag),
    symbol: tag.toUpperCase(),
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
    jobs: schedule(firstSeenAt),
    createdAt: firstSeenAt,
  });
  return { tokenCase, jobs };
}

describe("processLifecycleJobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expires overdue PENDING jobs as MISSED_WINDOW without snapshots", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: makeMint("EXP"),
      firstSeenAt: BASE,
      entryPrice: 100,
      entryValid: true,
      stage: "INITIAL",
      caseStatus: "OPEN",
      createdAt: BASE,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "INITIAL",
      capturedAt: BASE,
      price: 100,
      roiPct: 0,
    });
    // Only an expired PLUS_5 job — no other due jobs
    await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      scheduledFor: BASE + 300_000,
      deadlineAt: BASE + 720_000,
      createdAt: BASE,
    });
    // Future PLUS_10 not yet scheduled
    await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      scheduledFor: BASE + 2_000_000,
      deadlineAt: BASE + 2_500_000,
      createdAt: BASE,
    });

    const nowMs = BASE + 800_000; // past PLUS_5 deadline, before PLUS_10 schedule
    const fetchMarket = vi.fn(async () => makeMarket(110, nowMs));

    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket,
      now: () => nowMs,
    });

    expect(summary.expiredJobs).toBe(1);
    expect(summary.processedJobs).toBe(0);
    expect(fetchMarket).not.toHaveBeenCalled();

    const plus5 = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      scheduledFor: BASE + 300_000,
      deadlineAt: BASE + 720_000,
    });
    expect(plus5.status).toBe("MISSED_WINDOW");

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots.map((s) => s.stage)).toEqual(["INITIAL"]);
  });

  it("processes due PLUS_5 with injected market fetch", async () => {
    const client = await setup();
    const { tokenCase } = await seedCase(client, "B");
    const nowMs = BASE + 300_000;
    const fetchMarket = vi.fn(async (mint: string) => {
      expect(mint).toBe(tokenCase.mint);
      return makeMarket(120, nowMs);
    });

    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket,
      now: () => nowMs,
    });

    expect(summary.expiredJobs).toBe(0);
    expect(summary.processedJobs).toBe(1);
    expect(summary.snapshotsWritten).toBe(1);
    expect(fetchMarket).toHaveBeenCalledOnce();

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots.map((s) => s.stage)).toEqual(["INITIAL", "PLUS_5"]);
    expect(snapshots.find((s) => s.stage === "PLUS_5")?.price).toBe(120);

    const plus5Job = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      scheduledFor: BASE + 300_000,
      deadlineAt: BASE + 720_000,
    });
    expect(plus5Job.status).toBe("COMPLETED");
  });

  it("PLUS_10 creates a stored decision", async () => {
    const client = await setup();
    const { tokenCase } = await seedCase(client, "C");

    await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket: async () => makeMarket(120, BASE + 300_000),
      now: () => BASE + 300_000,
    });

    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket: async () => makeMarket(130, BASE + 600_000),
      now: () => BASE + 600_000,
    });

    expect(summary.decisionsCreated).toBe(1);
    const decisions = await listDecisionsByCase(client, tokenCase.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decisionStage).toBe("PLUS_10");
    expect(decisions[0]?.decisionStatus).toBe("PASS");
  });

  it("PLUS_60 closes the case and labels outcome", async () => {
    const client = await setup();
    const { tokenCase } = await seedCase(client, "D");

    // Seed intermediate snapshots so peak ROI can be RUNNER
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_15",
      capturedAt: BASE + 900_000,
      price: 180,
      roiPct: 80,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_30",
      capturedAt: BASE + 1_800_000,
      price: 220,
      roiPct: 120,
    });

    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket: async () => makeMarket(250, BASE + 3_600_000),
      now: () => BASE + 3_600_000,
    });

    // At +60m: PLUS_5..PLUS_30 deadlines may be expired; PLUS_60 is due.
    expect(summary.processedJobs).toBe(1);
    expect(summary.casesClosed).toBe(1);
    expect(summary.expiredJobs).toBeGreaterThan(0);

    const closed = await getTokenCase(client, tokenCase.id);
    expect(closed?.caseStatus).toBe("CLOSED");
    expect(closed?.stage).toBe("CLOSED");
    expect(closed?.outcomeLabel).toBe("RUNNER");
  });

  it("failed market fetch collects error and continues other jobs", async () => {
    const client = await setup();
    await seedCase(client, "E");
    await seedCase(client, "F");
    const nowMs = BASE + 300_000;

    let calls = 0;
    const fetchMarket = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("DEX_DOWN");
      }
      return makeMarket(115, nowMs);
    });

    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket,
      now: () => nowMs,
    });

    expect(summary.processedJobs).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.message).toContain("DEX_DOWN");
  });

  it("lock prevents a concurrent lifecycle runner", async () => {
    const client = await setup();
    await seedCase(client, "G");
    const nowMs = BASE + 300_000;

    const held = await acquireCollectionLock(client, {
      jobKey: LIFECYCLE_LOCK_KEY,
      owner: "other-owner",
      lockedUntil: nowMs + 60_000,
      startedAt: nowMs,
    });
    expect(held).toBe(true);

    const fetchMarket = vi.fn(async () => makeMarket(110, nowMs));
    const summary = await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket,
      now: () => nowMs,
    });

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.message).toMatch(/lifecycle lock/i);
    expect(summary.processedJobs).toBe(0);
    expect(fetchMarket).not.toHaveBeenCalled();
  });

  it("does not call discovery / GeckoTerminal", async () => {
    const client = await setup();
    await seedCase(client, "H");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fetchMarket = vi.fn(async () => makeMarket(110, BASE + 300_000));

    await processLifecycleJobs({
      client,
      owner: OWNER,
      fetchMarket,
      now: () => BASE + 300_000,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("handleLifecycleCron", () => {
  it("returns disabled without running lifecycle when flag is false", async () => {
    const processLifecycleJobsFn = vi.fn(async () => ({
      expiredJobs: 0,
      processedJobs: 0,
      snapshotsWritten: 0,
      decisionsCreated: 0,
      casesClosed: 0,
      errors: [],
    }));

    const response = await handleLifecycleCron(
      new Request("http://localhost/api/cron/lifecycle", {
        headers: { authorization: "Bearer secret" },
      }),
      {
        env: {
          CRON_SECRET: "secret",
          RADAR24_LIFECYCLE_ENABLED: "false",
          TURSO_DATABASE_URL: "libsql://test",
        },
        processLifecycleJobsFn,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      message: "lifecycle disabled",
    });
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });

  it("rejects unauthorized requests", async () => {
    const processLifecycleJobsFn = vi.fn(async () => ({
      expiredJobs: 0,
      processedJobs: 0,
      snapshotsWritten: 0,
      decisionsCreated: 0,
      casesClosed: 0,
      errors: [],
    }));

    const response = await handleLifecycleCron(
      new Request("http://localhost/api/cron/lifecycle"),
      {
        env: {
          CRON_SECRET: "secret",
          RADAR24_LIFECYCLE_ENABLED: "true",
          TURSO_DATABASE_URL: "libsql://test",
        },
        processLifecycleJobsFn,
      },
    );

    expect(response.status).toBe(401);
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });
});
