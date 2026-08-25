-- Final product direction: Base Radar Research Mode only.
-- Keep push_subscriptions and schema_migrations; remove retired Solana/multichain state.
DROP TABLE IF EXISTS base_radar_test_push_deliveries;
DROP TABLE IF EXISTS survivor_research_checks_v2;
DROP TABLE IF EXISTS survivor_research_snapshots_v2;
DROP TABLE IF EXISTS survivor_research_cases_v2;
DROP TABLE IF EXISTS survivor_research_checks;
DROP TABLE IF EXISTS survivor_research_snapshots;
DROP TABLE IF EXISTS survivor_research_cases;
DROP TABLE IF EXISTS push_deliveries;
DROP TABLE IF EXISTS snapshot_jobs;
DROP TABLE IF EXISTS social_calls;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS token_cases;
DROP TABLE IF EXISTS collection_locks;
DROP TABLE IF EXISTS discovery_watermarks;
