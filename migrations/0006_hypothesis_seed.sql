-- Hypothesis Layer seed universe marker (research hypotheses only — not a trade list).
-- Asset rows are applied idempotently by seedHypothesisUniverse() at the end of migrate().

CREATE TABLE IF NOT EXISTS hypothesis_seed_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO hypothesis_seed_meta (key, value, applied_at)
VALUES ('universe_seed_version', 'v1', 1760000000000);
