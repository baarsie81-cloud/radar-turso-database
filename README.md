# Moonshot Radar V24

Standalone Turso-backed Moonshot Radar V24: lifecycle tracking, reproducible decisions, collector core, and a Next.js App Router dashboard.

**Turso is the only database.** Neon and Moonshot Radar V2 are not dependencies. The old V2/Neon radar is stopped and used only as lessons learned (see `docs/V24_DESIGN_PRINCIPLES.md`).

## What this repo is

- Next.js 15 App Router (`/radar`, `/cases/[id]`, `/api/health`)
- Turso / libSQL via `@libsql/client`
- Plain SQL migrations (no ORM)
- Pure Radar 2.4 decision engine (`evaluateRadar24`)
- Collector / providers / lifecycle (library + tests; live cron not enabled yet)
- Vitest tests

## What this repo is not

- Not Neon / not a V2 migration or data bridge
- Not dependent on `moon-radar-dashboard`
- No wallets, private keys, buying, selling, or trade execution
- No production cron or push delivery yet (documented env flags only)

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

## Schema (summary)

| Table | Role |
| --- | --- |
| `token_cases` | Tracked mint lifecycle |
| `snapshots` | Price checkpoints per stage |
| `decisions` | Stored, replayable Radar outcomes |
| `snapshot_jobs` / locks / watermarks | Lifecycle scheduling |
| `social_calls` | Audit-only (not a decision filter) |
| `push_*` | Schema ready; delivery not enabled yet |

## Local development

```bash
cp .env.example .env
npm install
```

### Option A — remote Turso (recommended)

Set in `.env`:

```bash
TURSO_DATABASE_URL=libsql://your-db-name.turso.io
TURSO_AUTH_TOKEN=...
```

Apply migrations **once** from your machine (never from a web request):

```bash
npm run migrate
```

Run the Next app:

```bash
npm run dev
```

Open [http://localhost:3000/radar](http://localhost:3000/radar).

### Option B — local file database

```bash
TURSO_DATABASE_URL=file:./data/radar.db npm run migrate
TURSO_DATABASE_URL=file:./data/radar.db npm run dev
```

File URLs are for local experimentation only. **Do not use `file:` on Vercel.**

### Checks

```bash
npx tsc --noEmit
npm test
npm run build
```

### Optional Hono API (legacy local)

```bash
npm run dev:api
```

The Next dashboard does **not** require the Hono server; it reads Turso via repositories in Server Components.

## Vercel deployment preparation

Target project name: **Moonshot Radar V24**  
GitHub repo: `radar-turso-database`  
Framework: Next.js (auto-detected). Scripts: `build` → `next build`, `start` → `next start`. Node `>=20`.

### Before first deploy

1. Create a **production Turso** database and auth token.
2. Run `npm run migrate` against that database from a trusted machine/CI (**not** on each serverless request).
3. Create the Vercel project linked to this repo’s `main` branch.
4. Set Production environment variables (see `.env.example`):

| Variable | Required now | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | Yes | `libsql://…` only |
| `TURSO_AUTH_TOKEN` | Yes | Turso token |
| `CRON_SECRET` | Document only | For future cron auth; unused until cron routes exist |
| `RADAR24_COLLECT_ENABLED` | Document only | Keep `false` / unset; live collection not enabled |
| `RADAR24_PUSH_ENABLED` | Document only | Keep `false` / unset; push delivery not enabled |

### Do not set

- `DATABASE_URL` or any Neon variables
- `RADAR_API_URL` (same app; no external Radar API hop)
- V2 / Jupiter / shared push secrets from the old stack

### After deploy (smoke)

- `/api/health` → `tursoConfigured` / `tursoOk`
- `/radar` and `/cases/[id]` load (empty list is fine)

**Not in this phase:** Vercel cron config, collect/push route handlers, enabling live collection.

## Production safety

- Migrations are CLI-only (`npm run migrate`). Request handlers never run migrations.
- Secrets belong in Vercel env / local `.env` (gitignored). Never commit `.env` or tokens.
- Dashboard pages require `TURSO_DATABASE_URL`; they do not fall back to a local file path.

## Layout

```text
app/                 Next.js App Router (radar, cases, health)
components/          Presentational UI
src/db/              Turso client + migrate + repositories
src/domain/          stages, statuses, types
src/decisions/       evaluateRadar24 (frozen rules)
src/collector/       discovery + runCollection (no cron yet)
src/lifecycle/       processSnapshotJob
src/providers/       GeckoTerminal + DexScreener
src/simulation/      local lifecycle harness
migrations/          SQL migrations 0001–0004
docs/                V24 design principles
tests/
```
