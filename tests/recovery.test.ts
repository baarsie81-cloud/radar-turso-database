import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { listDecisionsByCase } from "../src/db/repositories/decisions";
import {
  createSnapshotJobsForCase,
  type SnapshotJobRow,
} from "../src/db/repositories/jobs";
import { listSnapshotsByCase, upsertSnapshot } from "../src/db/repositories/snapshots";
import {
  createTokenCase,
  getTokenCase,
} from "../src/db/repositories/tokenCases";
import {
  closeIncompleteCases,
  expireMissedSnapshotJobs,
  RECOVERY_CASE_CLOSE_REASON,
  RECOVERY_JOB_EXPIRE_REASON,
} from "../src/lifecycle/recovery";

const BASE = 1_760_000_000_000;

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function makeMint(tag: string): string {
  const safe = tag.replace(/[0OIl]/g, "x");
  return `RcMint${safe.padEnd(38, "1")}`;
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

async function listJobs(
  client: Awaited<ReturnType<typeof setup>>,
  tokenCaseId: number,
): Promise<SnapshotJobRow[]> {
  const result = await client.execute({
    sql: "SELECT * FROM snapshot_jobs WHERE token_case_id = ? ORDER BY id",
    args: [tokenCaseId],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    tokenCaseId: Number(row.token_case_id),
    stage: String(row.stage) as SnapshotJobRow["stage"],
    scheduledFor: Number(row.scheduled_for),
    deadlineAt: Number(row.deadline_at),
    status: String(row.status) as SnapshotJobRow["status"],
    attempts: Number(row.attempts),
    lockedBy: row.locked_by == null ? null : String(row.locked_by),
    lockedAt: row.locked_at == null ? null : Number(row.locked_at),
    measuredAt: row.measured_at == null ? null : Number(row.measured_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: Number(row.created_at),
  }));
}

async function seedIncompleteCase(
  client: Awaited<ReturnType<typeof setup>>,
  tag: string,
  firstSeenAt = BASE,
) {
  const tokenCase = await createTokenCase(client, {
    mint: makeMint(tag),
    symbol: tag.toUpperCase(),
    firstSeenAt,
    entryPrice: 100,
    entryValid: true,
    stage: "PLUS_5",
    caseStatus: "OPEN",
    createdAt: firstSeenAt,
  });
  await upsertSnapshot(client, {
    tokenCaseId: tokenCase.id,
    stage: "INITIAL",
    capturedAt: firstSeenAt,
    price: 100,
    roiPct: 0,
  });
  await upsertSnapshot(client, {
    tokenCaseId: tokenCase.id,
    stage: "PLUS_5",
    capturedAt: firstSeenAt + 300_000,
    price: 110,
    roiPct: 10,
  });

  const jobs = await createSnapshotJobsForCase(client, {
    tokenCaseId: tokenCase.id,
    jobs: schedule(firstSeenAt),
    createdAt: firstSeenAt,
  });

  // Mirror production audit: PLUS_5 completed; later stages still PENDING.
  await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'COMPLETED',
        measured_at = ?
      WHERE token_case_id = ? AND stage = 'PLUS_5'
    `,
    args: [firstSeenAt + 300_000, tokenCase.id],
  });

  return { tokenCase, jobs };
}

describe("lifecycle recovery tooling", () => {
  it("expires pending jobs past deadline as MISSED_WINDOW", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "EXP");
    const now = BASE + 5_400_000 + 1;

    const result = await expireMissedSnapshotJobs({ client, now });

    expect(result.expiredJobs).toBe(4);
    expect(result.reason).toBe(RECOVERY_JOB_EXPIRE_REASON);

    const jobs = await listJobs(client, tokenCase.id);
    const byStage = Object.fromEntries(jobs.map((j) => [j.stage, j]));
    expect(byStage.PLUS_5?.status).toBe("COMPLETED");
    expect(byStage.PLUS_10?.status).toBe("MISSED_WINDOW");
    expect(byStage.PLUS_15?.status).toBe("MISSED_WINDOW");
    expect(byStage.PLUS_30?.status).toBe("MISSED_WINDOW");
    expect(byStage.PLUS_60?.status).toBe("MISSED_WINDOW");
    expect(byStage.PLUS_10?.lastError).toBe(RECOVERY_JOB_EXPIRE_REASON);

    expect(await listSnapshotsByCase(client, tokenCase.id)).toHaveLength(2);
    expect(await listDecisionsByCase(client, tokenCase.id)).toHaveLength(0);
  });

  it("leaves non-expired pending jobs untouched", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "LIVE");
    // After PLUS_5 deadline, but PLUS_10..PLUS_60 still inside window.
    const now = BASE + 800_000;

    const result = await expireMissedSnapshotJobs({ client, now });
    expect(result.expiredJobs).toBe(0);

    const jobs = await listJobs(client, tokenCase.id);
    expect(jobs.filter((j) => j.status === "PENDING")).toHaveLength(4);
    expect(jobs.filter((j) => j.status === "COMPLETED")).toHaveLength(1);
    expect(jobs.every((j) => j.status !== "MISSED_WINDOW")).toBe(true);
  });

  it("does not alter completed jobs", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "DONE");
    const now = BASE + 10_000_000;

    await expireMissedSnapshotJobs({ client, now });

    const plus5 = (await listJobs(client, tokenCase.id)).find(
      (j) => j.stage === "PLUS_5",
    );
    expect(plus5?.status).toBe("COMPLETED");
    expect(plus5?.measuredAt).toBe(BASE + 300_000);
    expect(plus5?.lastError).toBeNull();
  });

  it("closes incomplete OPEN cases with outcome NULL and no decisions", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "CLOSE");
    const now = BASE + 10_000_000;

    await expireMissedSnapshotJobs({ client, now });
    const closeResult = await closeIncompleteCases({ client, now });

    expect(closeResult.closedCases).toBe(1);
    expect(closeResult.closedCaseIds).toEqual([tokenCase.id]);
    expect(closeResult.reason).toBe(RECOVERY_CASE_CLOSE_REASON);

    const closed = await getTokenCase(client, tokenCase.id);
    expect(closed?.caseStatus).toBe("CLOSED");
    expect(closed?.stage).toBe("CLOSED");
    expect(closed?.outcomeLabel).toBeNull();
    expect(closed?.outcomeLabeledAt).toBeNull();
    expect(closed?.outcomeInputsJson).toBeNull();
    expect(closed?.updatedAt).toBe(now);

    expect(await listDecisionsByCase(client, tokenCase.id)).toHaveLength(0);
    expect(await listSnapshotsByCase(client, tokenCase.id)).toHaveLength(2);
  });

  it("does not close cases that still have in-window pending jobs", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "WAIT");
    const now = BASE + 800_000;

    const expire = await expireMissedSnapshotJobs({ client, now });
    expect(expire.expiredJobs).toBe(0);

    const close = await closeIncompleteCases({ client, now });
    expect(close.closedCases).toBe(0);

    const open = await getTokenCase(client, tokenCase.id);
    expect(open?.caseStatus).toBe("OPEN");
  });

  it("running recovery twice is idempotent", async () => {
    const client = await setup();
    const { tokenCase } = await seedIncompleteCase(client, "IDEM");
    const now = BASE + 10_000_000;

    const expire1 = await expireMissedSnapshotJobs({ client, now });
    const close1 = await closeIncompleteCases({ client, now });
    expect(expire1.expiredJobs).toBe(4);
    expect(close1.closedCases).toBe(1);

    const expire2 = await expireMissedSnapshotJobs({ client, now });
    const close2 = await closeIncompleteCases({ client, now });
    expect(expire2.expiredJobs).toBe(0);
    expect(close2.closedCases).toBe(0);
    expect(close2.closedCaseIds).toEqual([]);

    const jobs = await listJobs(client, tokenCase.id);
    expect(jobs.filter((j) => j.status === "MISSED_WINDOW")).toHaveLength(4);
    expect(jobs.filter((j) => j.status === "COMPLETED")).toHaveLength(1);

    const closed = await getTokenCase(client, tokenCase.id);
    expect(closed?.caseStatus).toBe("CLOSED");
    expect(closed?.outcomeLabel).toBeNull();
    expect(await listDecisionsByCase(client, tokenCase.id)).toHaveLength(0);
  });
});
