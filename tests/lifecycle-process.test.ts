import { afterEach, describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { listDecisionsByCase } from "../src/db/repositories/decisions";
import {
  createSnapshotJob,
  createSnapshotJobsForCase,
} from "../src/db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../src/db/repositories/snapshots";
import * as snapshotsRepo from "../src/db/repositories/snapshots";
import { createTokenCase, getTokenCase } from "../src/db/repositories/tokenCases";
import { processSnapshotJob } from "../src/lifecycle/process";

const BASE = 1_700_000_000_000;
const OWNER = "lifecycle-test";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function lifecycleJobs(firstSeenAt: number) {
  return [
    { stage: "PLUS_5" as const, scheduledFor: firstSeenAt + 300_000, deadlineAt: firstSeenAt + 720_000 },
    { stage: "PLUS_10" as const, scheduledFor: firstSeenAt + 600_000, deadlineAt: firstSeenAt + 1_200_000 },
    { stage: "PLUS_15" as const, scheduledFor: firstSeenAt + 900_000, deadlineAt: firstSeenAt + 1_800_000 },
    { stage: "PLUS_30" as const, scheduledFor: firstSeenAt + 1_800_000, deadlineAt: firstSeenAt + 3_000_000 },
    { stage: "PLUS_60" as const, scheduledFor: firstSeenAt + 3_600_000, deadlineAt: firstSeenAt + 5_400_000 },
  ];
}

async function seedTrackedCase(client: Awaited<ReturnType<typeof setup>>) {
  const tokenCase = await createTokenCase(client, {
    mint: "MintProcess",
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
  const jobs = await createSnapshotJobsForCase(client, {
    tokenCaseId: tokenCase.id,
    jobs: lifecycleJobs(BASE),
    createdAt: BASE,
  });
  return { tokenCase, jobs };
}

describe("processSnapshotJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes PLUS_5 by persisting a snapshot and advancing stage", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);
    const plus5 = jobs.find((job) => job.stage === "PLUS_5")!;

    const result = await processSnapshotJob({
      client,
      tokenCase,
      job: plus5,
      owner: OWNER,
      now: BASE + 300_000,
      market: {
        price: 120,
        capturedAt: BASE + 300_000,
        marketCap: 1_000_000,
        liquidityUsd: 50_000,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.snapshot.stage).toBe("PLUS_5");
    expect(result.snapshot.price).toBe(120);
    expect(result.decision).toBeNull();
    expect(result.job.status).toBe("COMPLETED");

    const reloaded = await getTokenCase(client, tokenCase.id);
    expect(reloaded?.stage).toBe("PLUS_5");
    expect(reloaded?.caseStatus).toBe("OPEN");

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots.map((row) => row.stage)).toEqual(["INITIAL", "PLUS_5"]);
  });

  it("processes PLUS_10 into a PASS decision", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);

    await processSnapshotJob({
      client,
      tokenCase,
      job: jobs.find((job) => job.stage === "PLUS_5")!,
      owner: OWNER,
      now: BASE + 300_000,
      market: { price: 120, capturedAt: BASE + 300_000 },
    });

    const plus10 = jobs.find((job) => job.stage === "PLUS_10")!;
    const reloadedCase = (await getTokenCase(client, tokenCase.id))!;
    const result = await processSnapshotJob({
      client,
      tokenCase: reloadedCase,
      job: plus10,
      owner: OWNER,
      now: BASE + 600_000,
      market: { price: 130, capturedAt: BASE + 600_000 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision?.decisionStatus).toBe("PASS");
    expect(result.decision?.plus10RoiPct).toBe(30);
    expect(result.decision?.momentum5To10Pct).toBe(10);

    const decisions = await listDecisionsByCase(client, tokenCase.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decisionStage).toBe("PLUS_10");

    const reloaded = await getTokenCase(client, tokenCase.id);
    expect(reloaded?.stage).toBe("PLUS_10");
    expect(reloaded?.caseStatus).toBe("OPEN");
  });

  it("keeps the case OPEN after PLUS_10 REJECT", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);

    await processSnapshotJob({
      client,
      tokenCase,
      job: jobs.find((job) => job.stage === "PLUS_5")!,
      owner: OWNER,
      now: BASE + 300_000,
      market: { price: 140, capturedAt: BASE + 300_000 },
    });

    const plus10 = jobs.find((job) => job.stage === "PLUS_10")!;
    const reloadedCase = (await getTokenCase(client, tokenCase.id))!;
    const result = await processSnapshotJob({
      client,
      tokenCase: reloadedCase,
      job: plus10,
      owner: OWNER,
      now: BASE + 600_000,
      market: { price: 130, capturedAt: BASE + 600_000 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.decision?.decisionStatus).toBe("REJECT");
    expect(result.decision?.rejectReason).toBe("NEGATIVE_MOMENTUM_5_TO_10");

    const reloaded = await getTokenCase(client, tokenCase.id);
    expect(reloaded?.stage).toBe("PLUS_10");
    expect(reloaded?.caseStatus).toBe("OPEN");
  });

  it("closes the case and labels outcome on PLUS_60", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);

    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_15",
      capturedAt: BASE + 900_000,
      price: 150,
      roiPct: 50,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_30",
      capturedAt: BASE + 1_800_000,
      price: 180,
      roiPct: 80,
    });

    const plus60 = jobs.find((job) => job.stage === "PLUS_60")!;
    const result = await processSnapshotJob({
      client,
      tokenCase,
      job: plus60,
      owner: OWNER,
      now: BASE + 3_600_000,
      market: { price: 250, capturedAt: BASE + 3_600_000 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.tokenCase.caseStatus).toBe("CLOSED");
    expect(result.tokenCase.stage).toBe("CLOSED");
    expect(result.tokenCase.outcomeLabel).toBe("RUNNER");
    expect(result.tokenCase.outcomeLabeledAt).toBe(BASE + 3_600_000);

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots.map((row) => row.stage)).toEqual([
      "INITIAL",
      "PLUS_15",
      "PLUS_30",
      "PLUS_60",
    ]);
  });

  it("does not complete the job when processing fails and releases it for retry", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);
    const plus5 = jobs.find((job) => job.stage === "PLUS_5")!;

    const result = await processSnapshotJob({
      client,
      tokenCase,
      job: plus5,
      owner: OWNER,
      now: BASE + 300_000,
      market: { price: 0, capturedAt: BASE + 300_000 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBe("Invalid market price");
    expect(result.job).toBeNull();

    const stillPending = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      scheduledFor: plus5.scheduledFor,
      deadlineAt: plus5.deadlineAt,
    });
    expect(stillPending.status).toBe("PENDING");
  });

  it("releases a claimed job for retry after a persistence failure", async () => {
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);
    const plus5 = jobs.find((job) => job.stage === "PLUS_5")!;

    vi.spyOn(snapshotsRepo, "upsertSnapshot").mockRejectedValueOnce(
      new Error("SNAPSHOT_WRITE_FAILED"),
    );

    const result = await processSnapshotJob({
      client,
      tokenCase,
      job: plus5,
      owner: OWNER,
      now: BASE + 300_000,
      market: { price: 120, capturedAt: BASE + 300_000 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBe("SNAPSHOT_WRITE_FAILED");
    expect(result.job?.status).toBe("PENDING");
    expect(result.job?.lastError).toBe("SNAPSHOT_WRITE_FAILED");
    expect(result.job?.lockedBy).toBeNull();
  });

  it("does not call external APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = await setup();
    const { tokenCase, jobs } = await seedTrackedCase(client);

    await processSnapshotJob({
      client,
      tokenCase,
      job: jobs.find((job) => job.stage === "PLUS_5")!,
      owner: OWNER,
      now: BASE + 300_000,
      market: { price: 120, capturedAt: BASE + 300_000 },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
