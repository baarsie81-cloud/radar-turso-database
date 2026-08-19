import type { Client, Row } from "@libsql/client";
import type { SnapshotStage } from "../../domain/types";
import { num, numOrNull, str, strOrNull } from "../map";

export const SNAPSHOT_JOB_STAGES = [
  "PLUS_5",
  "PLUS_10",
  "PLUS_15",
  "PLUS_30",
  "PLUS_60",
] as const;

export type SnapshotJobStage = (typeof SNAPSHOT_JOB_STAGES)[number];

export type SnapshotJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "NO_DATA"
  | "MISSED_WINDOW";

export type SnapshotJobRow = {
  id: number;
  tokenCaseId: number;
  stage: SnapshotJobStage;
  scheduledFor: number;
  deadlineAt: number;
  status: SnapshotJobStatus;
  attempts: number;
  lockedBy: string | null;
  lockedAt: number | null;
  measuredAt: number | null;
  lastError: string | null;
  createdAt: number;
};

export type CreateSnapshotJobInput = {
  tokenCaseId: number;
  stage: SnapshotJobStage;
  scheduledFor: number;
  deadlineAt: number;
  createdAt?: number;
};

export type CreateSnapshotJobsForCaseInput = {
  tokenCaseId: number;
  jobs: Array<{
    stage: SnapshotJobStage;
    scheduledFor: number;
    deadlineAt: number;
  }>;
  createdAt?: number;
};

function isSnapshotJobStage(value: string): value is SnapshotJobStage {
  return (SNAPSHOT_JOB_STAGES as readonly string[]).includes(value);
}

export function mapSnapshotJobRow(row: Row): SnapshotJobRow {
  return {
    id: num(row.id),
    tokenCaseId: num(row.token_case_id),
    stage: str(row.stage) as SnapshotJobStage,
    scheduledFor: num(row.scheduled_for),
    deadlineAt: num(row.deadline_at),
    status: str(row.status) as SnapshotJobStatus,
    attempts: num(row.attempts),
    lockedBy: strOrNull(row.locked_by),
    lockedAt: numOrNull(row.locked_at),
    measuredAt: numOrNull(row.measured_at),
    lastError: strOrNull(row.last_error),
    createdAt: num(row.created_at),
  };
}

async function getSnapshotJobByCaseStage(
  client: Client,
  tokenCaseId: number,
  stage: SnapshotJobStage,
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: "SELECT * FROM snapshot_jobs WHERE token_case_id = ? AND stage = ?",
    args: [tokenCaseId, stage],
  });
  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export async function createSnapshotJob(
  client: Client,
  input: CreateSnapshotJobInput,
): Promise<SnapshotJobRow> {
  const createdAt = input.createdAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO snapshot_jobs (
        token_case_id, stage, scheduled_for, deadline_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_case_id, stage) DO NOTHING
      RETURNING *
    `,
    args: [
      input.tokenCaseId,
      input.stage,
      input.scheduledFor,
      input.deadlineAt,
      createdAt,
    ],
  });

  const row = result.rows[0];
  if (row) {
    return mapSnapshotJobRow(row);
  }

  const existing = await getSnapshotJobByCaseStage(client, input.tokenCaseId, input.stage);
  if (!existing) {
    throw new Error("Failed to create snapshot job");
  }
  return existing;
}

export async function createSnapshotJobsForCase(
  client: Client,
  input: CreateSnapshotJobsForCaseInput,
): Promise<SnapshotJobRow[]> {
  const rows: SnapshotJobRow[] = [];
  for (const job of input.jobs) {
    rows.push(
      await createSnapshotJob(client, {
        tokenCaseId: input.tokenCaseId,
        stage: job.stage,
        scheduledFor: job.scheduledFor,
        deadlineAt: job.deadlineAt,
        createdAt: input.createdAt,
      }),
    );
  }
  return rows;
}

export async function getDueJobs(
  client: Client,
  now: number,
  limit = 50,
): Promise<SnapshotJobRow[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await client.execute({
    sql: `
      SELECT * FROM snapshot_jobs
      WHERE status = 'PENDING'
        AND scheduled_for <= ?
        AND deadline_at >= ?
      ORDER BY scheduled_for ASC, id ASC
      LIMIT ?
    `,
    args: [now, now, safeLimit],
  });
  return result.rows.map(mapSnapshotJobRow);
}

export async function claimJob(
  client: Client,
  jobId: number,
  owner: string,
  now: number = Date.now(),
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'PROCESSING',
        locked_by = ?,
        locked_at = ?,
        attempts = attempts + 1
      WHERE id = ?
        AND status = 'PENDING'
        AND scheduled_for <= ?
        AND deadline_at >= ?
      RETURNING *
    `,
    args: [owner, now, jobId, now, now],
  });

  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export async function completeJob(
  client: Client,
  jobId: number,
  measuredAt: number,
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'COMPLETED',
        measured_at = ?,
        locked_by = NULL,
        locked_at = NULL,
        last_error = NULL
      WHERE id = ?
        AND status = 'PROCESSING'
      RETURNING *
    `,
    args: [measuredAt, jobId],
  });

  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export async function markJobNoData(
  client: Client,
  jobId: number,
  lastError: string = "NO_DATA",
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'NO_DATA',
        locked_by = NULL,
        locked_at = NULL,
        last_error = ?
      WHERE id = ?
        AND status = 'PROCESSING'
      RETURNING *
    `,
    args: [lastError, jobId],
  });

  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export async function releaseJobForRetry(
  client: Client,
  jobId: number,
  lastError: string,
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'PENDING',
        locked_by = NULL,
        locked_at = NULL,
        last_error = ?
      WHERE id = ?
        AND status = 'PROCESSING'
      RETURNING *
    `,
    args: [lastError, jobId],
  });

  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export async function markJobMissedWindow(
  client: Client,
  jobId: number,
  lastError: string = "WINDOW_EXPIRED",
): Promise<SnapshotJobRow | null> {
  const result = await client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'MISSED_WINDOW',
        locked_by = NULL,
        locked_at = NULL,
        last_error = ?
      WHERE id = ?
        AND status IN ('PENDING', 'PROCESSING', 'NO_DATA')
      RETURNING *
    `,
    args: [lastError, jobId],
  });

  const row = result.rows[0];
  return row ? mapSnapshotJobRow(row) : null;
}

export function isSnapshotJobStageValue(value: SnapshotStage): value is SnapshotJobStage {
  return isSnapshotJobStage(value);
}
