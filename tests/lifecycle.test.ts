import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  claimJob,
  completeJob,
  createSnapshotJob,
  createSnapshotJobsForCase,
  getDueJobs,
  markJobMissedWindow,
  markJobNoData,
} from "../src/db/repositories/jobs";
import {
  acquireCollectionLock,
  releaseCollectionLock,
} from "../src/db/repositories/locks";
import { getWatermark, updateWatermark } from "../src/db/repositories/watermarks";
import { createTokenCase } from "../src/db/repositories/tokenCases";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

const BASE = 1_700_000_000_000;

function lifecycleJobs(firstSeenAt: number) {
  return [
    { stage: "PLUS_5" as const, scheduledFor: firstSeenAt + 300_000, deadlineAt: firstSeenAt + 720_000 },
    { stage: "PLUS_10" as const, scheduledFor: firstSeenAt + 600_000, deadlineAt: firstSeenAt + 1_200_000 },
    { stage: "PLUS_15" as const, scheduledFor: firstSeenAt + 900_000, deadlineAt: firstSeenAt + 1_800_000 },
    { stage: "PLUS_30" as const, scheduledFor: firstSeenAt + 1_800_000, deadlineAt: firstSeenAt + 3_000_000 },
    { stage: "PLUS_60" as const, scheduledFor: firstSeenAt + 3_600_000, deadlineAt: firstSeenAt + 5_400_000 },
  ];
}

describe("snapshot_jobs repository", () => {
  it("creates a job and all jobs for a case", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: "MintJobs1",
      firstSeenAt: BASE,
    });

    const single = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      scheduledFor: BASE + 300_000,
      deadlineAt: BASE + 720_000,
      createdAt: BASE,
    });

    expect(single.tokenCaseId).toBe(tokenCase.id);
    expect(single.stage).toBe("PLUS_5");
    expect(single.status).toBe("PENDING");
    expect(single.attempts).toBe(0);

    const all = await createSnapshotJobsForCase(client, {
      tokenCaseId: tokenCase.id,
      jobs: lifecycleJobs(BASE),
      createdAt: BASE,
    });

    expect(all).toHaveLength(5);
    expect(all.map((row) => row.stage)).toEqual([
      "PLUS_5",
      "PLUS_10",
      "PLUS_15",
      "PLUS_30",
      "PLUS_60",
    ]);
  });

  it("enforces unique (token_case_id, stage) via idempotent create", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: "MintJobs2",
      firstSeenAt: BASE,
    });

    const first = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      scheduledFor: BASE + 600_000,
      deadlineAt: BASE + 1_200_000,
      createdAt: BASE,
    });
    const second = await createSnapshotJob(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      scheduledFor: BASE + 999_000,
      deadlineAt: BASE + 1_999_000,
      createdAt: BASE + 1,
    });

    expect(second.id).toBe(first.id);
    expect(second.scheduledFor).toBe(BASE + 600_000);
    expect(second.deadlineAt).toBe(BASE + 1_200_000);

    await expect(
      client.execute({
        sql: `
          INSERT INTO snapshot_jobs (
            token_case_id, stage, scheduled_for, deadline_at, created_at
          ) VALUES (?, 'PLUS_10', ?, ?, ?)
        `,
        args: [tokenCase.id, BASE + 1, BASE + 2, BASE],
      }),
    ).rejects.toThrow();
  });

  it("claims, completes, and marks no-data jobs", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: "MintJobs3",
      firstSeenAt: BASE,
    });
    const [job] = await createSnapshotJobsForCase(client, {
      tokenCaseId: tokenCase.id,
      jobs: [lifecycleJobs(BASE)[0]!],
      createdAt: BASE,
    });

    const beforeDue = BASE + 100_000;
    expect(await getDueJobs(client, beforeDue)).toHaveLength(0);

    const due = BASE + 300_000;
    expect(await getDueJobs(client, due)).toHaveLength(1);

    const claimed = await claimJob(client, job.id, "worker-a", due);
    expect(claimed?.status).toBe("PROCESSING");
    expect(claimed?.lockedBy).toBe("worker-a");
    expect(claimed?.attempts).toBe(1);

    expect(await claimJob(client, job.id, "worker-b", due)).toBeNull();

    const completed = await completeJob(client, job.id, due + 5_000);
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.measuredAt).toBe(due + 5_000);
    expect(completed?.lockedBy).toBeNull();
  });

  it("marks no-data and missed-window terminal states", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: "MintJobs4",
      firstSeenAt: BASE,
    });
    const jobs = await createSnapshotJobsForCase(client, {
      tokenCaseId: tokenCase.id,
      jobs: lifecycleJobs(BASE).slice(0, 2),
      createdAt: BASE,
    });

    const plus5 = jobs[0]!;
    const plus10 = jobs[1]!;

    const claimed = await claimJob(client, plus5.id, "worker-a", BASE + 300_000);
    expect(claimed).not.toBeNull();

    const noData = await markJobNoData(client, plus5.id);
    expect(noData?.status).toBe("NO_DATA");
    expect(noData?.lastError).toBe("NO_DATA");

    const missed = await markJobMissedWindow(client, plus10.id);
    expect(missed?.status).toBe("MISSED_WINDOW");
    expect(missed?.lastError).toBe("WINDOW_EXPIRED");
  });
});

describe("collection_locks repository", () => {
  it("acquires and releases a lock", async () => {
    const client = await setup();
    const startedAt = BASE;
    const lockedUntil = BASE + 240_000;

    expect(
      await acquireCollectionLock(client, {
        owner: "run-1",
        lockedUntil,
        startedAt,
      }),
    ).toBe(true);

    expect(
      await acquireCollectionLock(client, {
        owner: "run-2",
        lockedUntil: BASE + 480_000,
        startedAt: BASE + 60_000,
      }),
    ).toBe(false);

    expect(
      await releaseCollectionLock(client, {
        owner: "run-1",
        completedAt: BASE + 120_000,
      }),
    ).toBe(true);

    expect(
      await acquireCollectionLock(client, {
        owner: "run-2",
        lockedUntil: BASE + 480_000,
        startedAt: BASE + 120_000,
      }),
    ).toBe(true);
  });
});

describe("discovery_watermarks repository", () => {
  it("creates and updates a watermark", async () => {
    const client = await setup();

    expect(await getWatermark(client, "geckoterminal", "new-pools")).toBeNull();

    const created = await updateWatermark(client, {
      provider: "geckoterminal",
      capability: "new-pools",
      coverageThroughSourceAt: BASE,
      newestSeenSourceAt: BASE + 1_000,
      lastEventKey: "event-1",
      lastSuccessfulRunAt: BASE,
      updatedAt: BASE,
    });

    expect(created.provider).toBe("geckoterminal");
    expect(created.coverageThroughSourceAt).toBe(BASE);
    expect(created.lastEventKey).toBe("event-1");

    const updated = await updateWatermark(client, {
      provider: "geckoterminal",
      capability: "new-pools",
      coverageThroughSourceAt: BASE + 60_000,
      newestSeenSourceAt: BASE + 61_000,
      lastEventKey: "event-2",
      lastSuccessfulRunAt: BASE + 60_000,
      updatedAt: BASE + 60_000,
    });

    expect(updated.coverageThroughSourceAt).toBe(BASE + 60_000);
    expect(updated.lastEventKey).toBe("event-2");

    const loaded = await getWatermark(client, "geckoterminal", "new-pools");
    expect(loaded?.newestSeenSourceAt).toBe(BASE + 61_000);
  });
});

describe("0004_lifecycle schema", () => {
  it("applies lifecycle migration and enforces one OPEN case per mint", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    const ran = await migrate(client);
    expect(ran).toContain("0004_lifecycle");

    const now = BASE;
    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, stage, case_status, created_at, updated_at
        ) VALUES ('SameMint', ?, 'INITIAL', 'OPEN', ?, ?)
      `,
      args: [now, now, now],
    });

    await expect(
      client.execute({
        sql: `
          INSERT INTO token_cases (
            mint, first_seen_at, stage, case_status, created_at, updated_at
          ) VALUES ('SameMint', ?, 'INITIAL', 'OPEN', ?, ?)
        `,
        args: [now + 1, now, now],
      }),
    ).rejects.toThrow();

    await client.execute({
      sql: `
        UPDATE token_cases
        SET stage = 'CLOSED', case_status = 'CLOSED', updated_at = ?
        WHERE mint = 'SameMint' AND case_status = 'OPEN'
      `,
      args: [now + 2],
    });

    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, stage, case_status, created_at, updated_at
        ) VALUES ('SameMint', ?, 'CLOSED', 'CLOSED', ?, ?)
      `,
      args: [now + 2, now, now],
    });

    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, stage, case_status, created_at, updated_at
        ) VALUES ('SameMint', ?, 'INITIAL', 'OPEN', ?, ?)
      `,
      args: [now + 3, now, now],
    });

    const openCount = await client.execute(
      "SELECT COUNT(*) AS count FROM token_cases WHERE mint = 'SameMint' AND case_status = 'OPEN'",
    );
    expect(openCount.rows[0]?.count).toBe(1);
  });
});
