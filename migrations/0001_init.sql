-- Moonshot Radar 2.4 initial schema.
-- Neon is intentionally not used.
--
-- Status split (required):
--   case_status     = OPEN | CLOSED          (still tracking vs done)
--   decision_status = PENDING | PASS | REJECT (Radar outcome at a stage)
-- A case may be REJECT at PLUS_10 and remain OPEN until CLOSED.
--
-- Case lifecycle stages:
--   INITIAL → PLUS_5 → PLUS_10 → PLUS_15 → PLUS_30 → PLUS_60 → CLOSED
-- Snapshot/decision stages stop at PLUS_60. CLOSED is terminal case stage only.

CREATE TABLE token_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  first_seen_at INTEGER NOT NULL,
  entry_price REAL,
  entry_valid INTEGER NOT NULL DEFAULT 0
    CHECK (entry_valid IN (0, 1)),
  stage TEXT NOT NULL DEFAULT 'INITIAL'
    CHECK (stage IN ('INITIAL', 'PLUS_5', 'PLUS_10', 'PLUS_15', 'PLUS_30', 'PLUS_60', 'CLOSED')),
  case_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (case_status IN ('OPEN', 'CLOSED')),
  radar_version TEXT NOT NULL DEFAULT '2.4',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX token_cases_mint_idx ON token_cases (mint);
CREATE INDEX token_cases_status_stage_idx ON token_cases (case_status, stage);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_case_id INTEGER NOT NULL REFERENCES token_cases (id),
  -- Snapshot checkpoints only. CLOSED is not stored here.
  stage TEXT NOT NULL
    CHECK (stage IN ('INITIAL', 'PLUS_5', 'PLUS_10', 'PLUS_15', 'PLUS_30', 'PLUS_60')),
  captured_at INTEGER NOT NULL,
  price REAL NOT NULL,
  roi_pct REAL,
  market_cap REAL,
  liquidity_usd REAL,
  UNIQUE (token_case_id, stage)
);

CREATE INDEX snapshots_case_idx ON snapshots (token_case_id);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_case_id INTEGER NOT NULL REFERENCES token_cases (id),
  decision_stage TEXT NOT NULL
    CHECK (decision_stage IN ('INITIAL', 'PLUS_5', 'PLUS_10', 'PLUS_15', 'PLUS_30', 'PLUS_60')),
  decided_at INTEGER NOT NULL,
  decision_status TEXT NOT NULL
    CHECK (decision_status IN ('PENDING', 'PASS', 'REJECT')),
  reject_reason TEXT,
  radar_version TEXT NOT NULL DEFAULT '2.4',
  entry_price REAL,
  plus5_roi_pct REAL,
  plus10_roi_pct REAL,
  momentum_5_to_10_pct REAL,
  inputs_json TEXT NOT NULL,
  UNIQUE (token_case_id, radar_version, decision_stage)
);

CREATE INDEX decisions_case_idx ON decisions (token_case_id);
CREATE INDEX decisions_status_idx ON decisions (decision_status);

CREATE TABLE social_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT,
  called_at INTEGER NOT NULL,
  mint TEXT,
  token_case_id INTEGER REFERENCES token_cases (id),
  call_price REAL,
  call_market_cap REAL,
  collapse_before INTEGER
    CHECK (collapse_before IS NULL OR collapse_before IN (0, 1)),
  collapse_after INTEGER
    CHECK (collapse_after IS NULL OR collapse_after IN (0, 1)),
  collapse_window_minutes INTEGER,
  notes_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX social_calls_source_external_id_idx
  ON social_calls (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX social_calls_case_idx ON social_calls (token_case_id);
CREATE INDEX social_calls_mint_idx ON social_calls (mint);
CREATE INDEX social_calls_called_at_idx ON social_calls (called_at);
