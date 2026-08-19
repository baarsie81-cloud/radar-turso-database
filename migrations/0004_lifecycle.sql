-- Radar 2.4 lifecycle worker foundation.
-- Job queue, collection lock, and discovery watermark for Turso-only ingest.

CREATE TABLE snapshot_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_case_id INTEGER NOT NULL REFERENCES token_cases (id),
  stage TEXT NOT NULL
    CHECK (stage IN ('PLUS_5', 'PLUS_10', 'PLUS_15', 'PLUS_30', 'PLUS_60')),
  scheduled_for INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'NO_DATA', 'MISSED_WINDOW')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_at INTEGER,
  measured_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (token_case_id, stage),
  CHECK (deadline_at > scheduled_for)
);

CREATE INDEX snapshot_jobs_status_scheduled_idx
  ON snapshot_jobs (status, scheduled_for);

CREATE TABLE collection_locks (
  job_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  locked_until INTEGER NOT NULL,
  last_started_at INTEGER,
  last_completed_at INTEGER
);

CREATE TABLE discovery_watermarks (
  provider TEXT NOT NULL,
  capability TEXT NOT NULL,
  coverage_through_source_at INTEGER,
  newest_seen_source_at INTEGER,
  last_event_key TEXT,
  last_successful_run_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, capability)
);

CREATE UNIQUE INDEX token_cases_open_mint_uq
  ON token_cases (mint)
  WHERE case_status = 'OPEN';
