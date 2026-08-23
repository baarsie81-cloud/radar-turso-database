-- Expand hypothesis event / push CHECKs for observation push test types.
-- Recreate tables (SQLite cannot alter CHECK constraints in place).

CREATE TABLE hypothesis_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_asset_id INTEGER NOT NULL REFERENCES hypothesis_assets (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ENTERED',
      'ACTIVATED',
      'MILESTONE',
      'INVALIDATED',
      'RANK_CHANGED',
      'EXITED',
      'OBSERVATION_UPDATE',
      'SCORE_CHANGE'
    )),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

INSERT INTO hypothesis_events_new (
  id, hypothesis_asset_id, event_type, payload_json, created_at
)
SELECT id, hypothesis_asset_id, event_type, payload_json, created_at
FROM hypothesis_events;

CREATE TABLE hypothesis_push_deliveries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES hypothesis_events_new (id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'HYPOTHESIS_ACTIVATED',
      'LIFECYCLE_MILESTONE',
      'HYPOTHESIS_OBSERVATION_UPDATE',
      'HYPOTHESIS_SCORE_CHANGE'
    )),
  sent_at INTEGER NOT NULL
);

INSERT INTO hypothesis_push_deliveries_new (id, event_id, event_type, sent_at)
SELECT id, event_id, event_type, sent_at
FROM hypothesis_push_deliveries;

DROP TABLE hypothesis_push_deliveries;
DROP TABLE hypothesis_events;

ALTER TABLE hypothesis_events_new RENAME TO hypothesis_events;
ALTER TABLE hypothesis_push_deliveries_new RENAME TO hypothesis_push_deliveries;

CREATE INDEX hypothesis_events_asset_created_idx
  ON hypothesis_events (hypothesis_asset_id, created_at);

CREATE INDEX hypothesis_events_type_created_idx
  ON hypothesis_events (event_type, created_at);

CREATE INDEX hypothesis_push_deliveries_sent_idx
  ON hypothesis_push_deliveries (sent_at);
