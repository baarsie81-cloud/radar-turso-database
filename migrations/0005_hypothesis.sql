-- Hypothesis Layer foundation (independent of Radar V24 decisions/push).
-- Soft link to token_cases only. Does not alter evaluateRadar24 or PASS push.

CREATE TABLE hypothesis_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  token_case_id INTEGER REFERENCES token_cases (id),
  symbol TEXT,
  name TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'WATCH'
    CHECK (status IN ('WATCH', 'ACTIVE', 'INVALIDATED')),
  hypothesis_score REAL NOT NULL DEFAULT 0,
  narrative_score REAL NOT NULL DEFAULT 0,
  asymmetry_score REAL NOT NULL DEFAULT 0,
  catalyst_score REAL NOT NULL DEFAULT 0,
  attention_score REAL NOT NULL DEFAULT 0,
  liquidity_score REAL NOT NULL DEFAULT 0,
  rank INTEGER,
  narrative_summary TEXT,
  catalyst_summary TEXT,
  score_version TEXT NOT NULL DEFAULT 'h1.0',
  inputs_json TEXT NOT NULL DEFAULT '{}',
  activated_at INTEGER,
  invalidated_at INTEGER,
  entered_universe_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX hypothesis_assets_status_rank_idx
  ON hypothesis_assets (status, rank);

CREATE INDEX hypothesis_assets_mint_idx
  ON hypothesis_assets (mint);

CREATE INDEX hypothesis_assets_token_case_idx
  ON hypothesis_assets (token_case_id);

-- At most one WATCH/ACTIVE slot per mint (INVALIDATED history may repeat).
CREATE UNIQUE INDEX hypothesis_assets_open_mint_uq
  ON hypothesis_assets (mint)
  WHERE status IN ('WATCH', 'ACTIVE');

CREATE TABLE hypothesis_score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_asset_id INTEGER NOT NULL REFERENCES hypothesis_assets (id),
  captured_at INTEGER NOT NULL,
  hypothesis_score REAL NOT NULL,
  narrative_score REAL NOT NULL,
  asymmetry_score REAL NOT NULL,
  catalyst_score REAL NOT NULL,
  attention_score REAL NOT NULL,
  liquidity_score REAL NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('WATCH', 'ACTIVE', 'INVALIDATED')),
  rank INTEGER,
  inputs_json TEXT NOT NULL,
  score_version TEXT NOT NULL DEFAULT 'h1.0'
);

CREATE INDEX hypothesis_score_snapshots_asset_captured_idx
  ON hypothesis_score_snapshots (hypothesis_asset_id, captured_at);

CREATE TABLE hypothesis_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_asset_id INTEGER NOT NULL REFERENCES hypothesis_assets (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ENTERED',
      'ACTIVATED',
      'MILESTONE',
      'INVALIDATED',
      'RANK_CHANGED',
      'EXITED'
    )),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX hypothesis_events_asset_created_idx
  ON hypothesis_events (hypothesis_asset_id, created_at);

CREATE INDEX hypothesis_events_type_created_idx
  ON hypothesis_events (event_type, created_at);

CREATE TABLE hypothesis_push_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES hypothesis_events (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('HYPOTHESIS_ACTIVATED', 'LIFECYCLE_MILESTONE')),
  sent_at INTEGER NOT NULL
);

CREATE INDEX hypothesis_push_deliveries_sent_idx
  ON hypothesis_push_deliveries (sent_at);
