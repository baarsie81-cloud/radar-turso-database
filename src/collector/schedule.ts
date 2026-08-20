import type { SnapshotJobStage } from "../db/repositories/jobs";

const SNAPSHOT_JOB_DEADLINES_MS: Record<SnapshotJobStage, number> = {
  PLUS_5: 720_000,
  PLUS_10: 1_200_000,
  PLUS_15: 1_800_000,
  PLUS_30: 3_000_000,
  PLUS_60: 5_400_000,
};

const SNAPSHOT_JOB_OFFSETS_MS: Record<SnapshotJobStage, number> = {
  PLUS_5: 300_000,
  PLUS_10: 600_000,
  PLUS_15: 900_000,
  PLUS_30: 1_800_000,
  PLUS_60: 3_600_000,
};

export function buildSnapshotJobSchedule(firstSeenAt: number): Array<{
  stage: SnapshotJobStage;
  scheduledFor: number;
  deadlineAt: number;
}> {
  return (Object.keys(SNAPSHOT_JOB_OFFSETS_MS) as SnapshotJobStage[]).map((stage) => ({
    stage,
    scheduledFor: firstSeenAt + SNAPSHOT_JOB_OFFSETS_MS[stage],
    deadlineAt: firstSeenAt + SNAPSHOT_JOB_DEADLINES_MS[stage],
  }));
}
