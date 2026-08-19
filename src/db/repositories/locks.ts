import type { Client, Row } from "@libsql/client";
import { num, numOrNull, str } from "../map";

export const DEFAULT_COLLECTION_LOCK_KEY = "v24-collect";

export type CollectionLockRow = {
  jobKey: string;
  owner: string;
  lockedUntil: number;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
};

export type AcquireCollectionLockInput = {
  jobKey?: string;
  owner: string;
  lockedUntil: number;
  startedAt?: number;
};

export type ReleaseCollectionLockInput = {
  jobKey?: string;
  owner: string;
  completedAt?: number;
};

export function mapCollectionLockRow(row: Row): CollectionLockRow {
  return {
    jobKey: str(row.job_key),
    owner: str(row.owner),
    lockedUntil: num(row.locked_until),
    lastStartedAt: numOrNull(row.last_started_at),
    lastCompletedAt: numOrNull(row.last_completed_at),
  };
}

export async function acquireCollectionLock(
  client: Client,
  input: AcquireCollectionLockInput,
): Promise<boolean> {
  const jobKey = input.jobKey ?? DEFAULT_COLLECTION_LOCK_KEY;
  const startedAt = input.startedAt ?? Date.now();

  const result = await client.execute({
    sql: `
      INSERT INTO collection_locks (
        job_key, owner, locked_until, last_started_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(job_key) DO UPDATE SET
        owner = excluded.owner,
        locked_until = excluded.locked_until,
        last_started_at = excluded.last_started_at
      WHERE collection_locks.locked_until <= excluded.last_started_at
      RETURNING owner
    `,
    args: [jobKey, input.owner, input.lockedUntil, startedAt],
  });

  const row = result.rows[0];
  return row != null && str(row.owner) === input.owner;
}

export async function releaseCollectionLock(
  client: Client,
  input: ReleaseCollectionLockInput,
): Promise<boolean> {
  const jobKey = input.jobKey ?? DEFAULT_COLLECTION_LOCK_KEY;
  const completedAt = input.completedAt ?? Date.now();

  const result = await client.execute({
    sql: `
      UPDATE collection_locks SET
        locked_until = ?,
        last_completed_at = ?
      WHERE job_key = ?
        AND owner = ?
      RETURNING job_key
    `,
    args: [completedAt, completedAt, jobKey, input.owner],
  });

  return result.rows.length > 0;
}
