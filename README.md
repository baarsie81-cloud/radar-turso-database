# Moonshot Radar 2.4 — Turso data and decision layer

Turso-first Radar 2.4 core: track very early Solana token lifecycles, store lightweight snapshots, apply reproducible decision rules, and expose dashboard-ready data.

The dashboard UI remains in `moon-radar-dashboard`. This repo does not contain UI.

Neon is intentionally not used. This is a parallel rebuild, not a migration, and it does not connect to the existing production database.

## What this repo is

- Node + TypeScript
- Turso / libSQL via `@libsql/client`
- Plain SQL migrations (no Drizzle, no Prisma, no ORM)
- Pure Radar 2.4 decision engine
- Vitest tests

## What this repo is not

- Not the dashboard UI (`moon-radar-dashboard`)
- Not a Neon project or Neon migration
- No wallets, private keys, buying, selling, or trade execution
- No queues

## Status model

Do not collapse tracking and decisions into one status field.

| Field | Values | Meaning |
| --- | --- | --- |
| `case_status` | `OPEN` / `CLOSED` | Whether the token is still being followed |
| `decision_status` | `PENDING` / `PASS` / `REJECT` | Radar 2.4 outcome at a given stage |

A token may be `REJECT` at `PLUS_10` and remain `OPEN` until `CLOSED`.

## Lifecycle

`INITIAL → PLUS_5 → PLUS_10 → PLUS_15 → PLUS_30 → PLUS_60 → CLOSED`

- Snapshot checkpoints: `INITIAL` … `PLUS_60` (stored in `snapshots`)
- `CLOSED` is the terminal **case** stage on `token_cases.stage`, not a market snapshot
- Decisions are stored per snapshot stage, unique on `(token_case_id, radar_version, decision_stage)`

## Schema

| Table | Role |
| --- | --- |
| `token_cases` | One tracked mint lifecycle: entry fields, current stage, `case_status` |
| `snapshots` | One price checkpoint per case per snapshot stage |
| `decisions` | Reproducible Radar outcome per stage, including reject reason and numeric inputs |
| `social_calls` | Audit-only social / debt-market-collapse observations; not a decision filter |

## Layout

```text
package.json
tsconfig.json
.env.example
README.md
migrations/0001_init.sql
src/db/            Turso client + migrate runner
src/domain/        stages, statuses, types
src/decisions/     pure Radar 2.4 engine
tests/
```

## Setup

```bash
cp .env.example .env
npm install
npm test
npm run migrate
```

Local file database:

```bash
TURSO_DATABASE_URL=file:./data/radar.db npm run migrate
```

Remote Turso: set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.
