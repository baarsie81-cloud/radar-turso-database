-- Radar 2.4 push persistence.
-- Independent from Neon/V2. Subscriptions and delivery bookkeeping live in Turso.

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER
);

CREATE TABLE push_deliveries (
  decision_id INTEGER PRIMARY KEY REFERENCES decisions (id),
  token_case_id INTEGER NOT NULL REFERENCES token_cases (id),
  sent_at INTEGER NOT NULL
);
