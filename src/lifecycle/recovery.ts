import type { Client } from "@libsql/client";
import { num } from "../db/map";

/** Default last_error written when pending jobs are marked MISSED_WINDOW. */
export const RECOVERY_JOB_EXPIRE_REASON = "WINDOW_EXPIRED";

/** Reason recorded for cases closed because lifecycle windows are gone. */
export const RECOVERY_CASE_CLOSE_REASON = "INCOMPLETE_LIFECYCLE";

export type ExpireMissedSnapshotJobsInput = {
  client: Client;
  /** Injected clock; defaults to Date.now(). */
  now?: number;
  /** Stored on snapshot_jobs.last_error for audit; defaults to WINDOW_EXPIRED. */
  reason?: string;
};

export type ExpireMissedSnapshotJobsResult = {
  expiredJobs: number;
  /** Wall-clock used for the deadline comparison and audit trail. */
  recoveredAt: number;
  reason: string;
};

export type CloseIncompleteCasesInput = {
  client: Client;
  /** Injected clock; defaults to Date.now(). */
  now?: number;
  /** Returned for caller/audit logs; defaults to INCOMPLETE_LIFECYCLE. */
  reason?: string;
};

export type CloseIncompleteCasesResult = {
  closedCases: number;
  /** Case ids closed in this run (empty on idempotent re-run). */
  closedCaseIds: number[];
  recoveredAt: number;
  reason: string;
};

/**
 * Mark expired PENDING snapshot jobs as MISSED_WINDOW.
 * Does not create snapshots, decisions, or outcomes.
 */
export async function expireMissedSnapshotJobs(
  input: ExpireMissedSnapshotJobsInput,
): Promise<ExpireMissedSnapshotJobsResult> {
  const recoveredAt = input.now ?? Date.now();
  const reason = input.reason ?? RECOVERY_JOB_EXPIRE_REASON;

  const result = await input.client.execute({
    sql: `
      UPDATE snapshot_jobs SET
        status = 'MISSED_WINDOW',
        locked_by = NULL,
        locked_at = NULL,
        last_error = ?
      WHERE status = 'PENDING'
        AND deadline_at < ?
    `,
    args: [reason, recoveredAt],
  });

  return {
    expiredJobs: result.rowsAffected,
    recoveredAt,
    reason,
  };
}

/**
 * Close OPEN cases whose remaining lifecycle windows are no longer recoverable.
 *
 * A case is eligible when:
 * - case_status = OPEN
 * - no PENDING job is still inside its deadline
 * - PLUS_60 was never COMPLETED
 * - at least one job is MISSED_WINDOW or expired PENDING
 *
 * Does not label outcomes (outcome_label stays NULL).
 * Does not create decisions or snapshots.
 */
export async function closeIncompleteCases(
  input: CloseIncompleteCasesInput,
): Promise<CloseIncompleteCasesResult> {
  const recoveredAt = input.now ?? Date.now();
  const reason = input.reason ?? RECOVERY_CASE_CLOSE_REASON;

  const eligible = await input.client.execute({
    sql: `
      SELECT tc.id AS id
      FROM token_cases tc
      WHERE tc.case_status = 'OPEN'
        AND NOT EXISTS (
          SELECT 1 FROM snapshot_jobs j
          WHERE j.token_case_id = tc.id
            AND j.status = 'PENDING'
            AND j.deadline_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM snapshot_jobs j
          WHERE j.token_case_id = tc.id
            AND j.stage = 'PLUS_60'
            AND j.status = 'COMPLETED'
        )
        AND EXISTS (
          SELECT 1 FROM snapshot_jobs j
          WHERE j.token_case_id = tc.id
            AND (
              j.status = 'MISSED_WINDOW'
              OR (j.status = 'PENDING' AND j.deadline_at < ?)
            )
        )
      ORDER BY tc.id ASC
    `,
    args: [recoveredAt, recoveredAt],
  });

  const closedCaseIds: number[] = [];
  for (const row of eligible.rows) {
    const id = num(row.id);
    const updated = await input.client.execute({
      sql: `
        UPDATE token_cases SET
          stage = 'CLOSED',
          case_status = 'CLOSED',
          outcome_label = NULL,
          outcome_labeled_at = NULL,
          outcome_inputs_json = NULL,
          updated_at = ?
        WHERE id = ?
          AND case_status = 'OPEN'
        RETURNING id
      `,
      args: [recoveredAt, id],
    });
    if (updated.rows[0]) {
      closedCaseIds.push(id);
    }
  }

  return {
    closedCases: closedCaseIds.length,
    closedCaseIds,
    recoveredAt,
    reason,
  };
}
