import type { Client } from "@libsql/client";
import { seedHypothesisUniverse } from "../hypothesis/seedUniverse";

const FINAL_HYPOTHESIS_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hypothesis_assets (
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

CREATE INDEX IF NOT EXISTS hypothesis_assets_status_rank_idx
  ON hypothesis_assets (status, rank);
CREATE INDEX IF NOT EXISTS hypothesis_assets_mint_idx
  ON hypothesis_assets (mint);
CREATE INDEX IF NOT EXISTS hypothesis_assets_token_case_idx
  ON hypothesis_assets (token_case_id);
CREATE UNIQUE INDEX IF NOT EXISTS hypothesis_assets_open_mint_uq
  ON hypothesis_assets (mint)
  WHERE status IN ('WATCH', 'ACTIVE');

CREATE TABLE IF NOT EXISTS hypothesis_score_snapshots (
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
CREATE INDEX IF NOT EXISTS hypothesis_score_snapshots_asset_captured_idx
  ON hypothesis_score_snapshots (hypothesis_asset_id, captured_at);

CREATE TABLE IF NOT EXISTS hypothesis_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_asset_id INTEGER NOT NULL REFERENCES hypothesis_assets (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ENTERED','ACTIVATED','MILESTONE','INVALIDATED','RANK_CHANGED','EXITED',
      'OBSERVATION_UPDATE','SCORE_CHANGE'
    )),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hypothesis_events_asset_created_idx
  ON hypothesis_events (hypothesis_asset_id, created_at);
CREATE INDEX IF NOT EXISTS hypothesis_events_type_created_idx
  ON hypothesis_events (event_type, created_at);

CREATE TABLE IF NOT EXISTS hypothesis_push_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES hypothesis_events (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'HYPOTHESIS_ACTIVATED','LIFECYCLE_MILESTONE',
      'HYPOTHESIS_OBSERVATION_UPDATE','HYPOTHESIS_SCORE_CHANGE'
    )),
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hypothesis_push_deliveries_sent_idx
  ON hypothesis_push_deliveries (sent_at);

CREATE TABLE IF NOT EXISTS hypothesis_seed_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO hypothesis_seed_meta (key, value, applied_at)
VALUES ('universe_seed_version', 'v1', 1760000000000);
`;

/** Serverless-safe, idempotent Hypothesis schema initialization. */
export async function ensureHypothesisSchema(client: Client): Promise<void> {
  await client.executeMultiple(FINAL_HYPOTHESIS_SCHEMA);

  const now = Date.now();
  for (const version of [
    "0005_hypothesis",
    "0006_hypothesis_seed",
    "0007_hypothesis_observation_push",
  ]) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      args: [version, now],
    });
  }

  await seedHypothesisUniverse(client);
}
