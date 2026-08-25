import type { Client, Row } from "@libsql/client";
import { createTursoClient } from "../../db/client";
import { getPushSubscriptions } from "../../db/repositories/push";
import { evaluateRadar24 } from "../../decisions/engine";
import { createWebPushSender } from "../../push/webpush";
import type { PushPayload } from "../../push/types";

const NETWORK = "base";
const RADAR_VERSION = "2.4-base-research";
const MAX_DISCOVERY_AGE_MS = 15 * 60_000;
const MAX_NEW_CASES_PER_RUN = 10;
const MIN_ENTRY_LIQUIDITY_USD = 10_000;
const MIN_PLUS10_LIQUIDITY_USD = 15_000;
const STAGES = [
  ["PLUS_5", 5],
  ["PLUS_10", 10],
  ["PLUS_15", 15],
  ["PLUS_30", 30],
  ["PLUS_60", 60],
] as const;
const OUTCOME_HORIZONS = [360, 1440] as const;

type Pool = {
  address: string;
  name: string | null;
  createdAt: number;
  price: number;
  liquidityUsd: number | null;
  volumeH1Usd: number | null;
  buysH1: number;
  sellsH1: number;
};

type CaseRow = {
  id: number;
  poolAddress: string;
  symbol: string | null;
  launchedAt: number;
  firstSeenAt: number;
  entryPrice: number;
  entryLiquidityUsd: number;
};

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function poolFromResource(resource: any): Pool | null {
  const attributes = resource?.attributes ?? {};
  const address = typeof attributes.address === "string"
    ? attributes.address
    : typeof resource?.id === "string"
      ? resource.id.replace(/^[^_]+_/, "")
      : null;
  const createdAt = Date.parse(String(attributes.pool_created_at ?? ""));
  const price = asNumber(attributes.base_token_price_usd);
  if (!address || !Number.isFinite(createdAt) || price == null || price <= 0) return null;

  const tx = attributes.transactions?.h1 ?? {};
  return {
    address,
    name: typeof attributes.name === "string" ? attributes.name : null,
    createdAt,
    price,
    liquidityUsd: asNumber(attributes.reserve_in_usd),
    volumeH1Usd: asNumber(attributes.volume_usd?.h1),
    buysH1: Math.max(0, Number(tx.buys ?? 0) || 0),
    sellsH1: Math.max(0, Number(tx.sells ?? 0) || 0),
  };
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status} for ${url}`);
  return response.json();
}

async function discoverPools(): Promise<Pool[]> {
  const json = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${NETWORK}/new_pools?page=1`,
  );
  return Array.isArray(json?.data)
    ? json.data.map(poolFromResource).filter((pool: Pool | null): pool is Pool => pool != null)
    : [];
}

async function fetchPools(addresses: string[]): Promise<Map<string, Pool>> {
  if (addresses.length === 0) return new Map();
  const encoded = addresses.map(encodeURIComponent).join(",");
  const json = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${NETWORK}/pools/multi/${encoded}`,
  );
  const pools: Pool[] = Array.isArray(json?.data)
    ? json.data.map(poolFromResource).filter((pool: Pool | null): pool is Pool => pool != null)
    : [];
  return new Map(pools.map((pool) => [pool.address.toLowerCase(), pool]));
}

async function ensureSchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS base_radar_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL UNIQUE,
      symbol TEXT,
      launched_at INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      entry_liquidity_usd REAL NOT NULL,
      entry_volume_h1_usd REAL,
      entry_buys_h1 INTEGER NOT NULL DEFAULT 0,
      entry_sells_h1 INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED'))
    )`,
    `CREATE TABLE IF NOT EXISTS base_radar_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES base_radar_cases(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      price REAL NOT NULL,
      liquidity_usd REAL,
      volume_h1_usd REAL,
      buys_h1 INTEGER NOT NULL DEFAULT 0,
      sells_h1 INTEGER NOT NULL DEFAULT 0,
      UNIQUE(case_id, stage)
    )`,
    `CREATE TABLE IF NOT EXISTS base_radar_decisions (
      case_id INTEGER PRIMARY KEY REFERENCES base_radar_cases(id) ON DELETE CASCADE,
      decided_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PASS','REJECT')),
      reject_reason TEXT,
      plus5_roi_pct REAL,
      plus10_roi_pct REAL,
      momentum_5_to_10_pct REAL,
      plus10_liquidity_usd REAL,
      radar_version TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS base_radar_push_deliveries (
      case_id INTEGER PRIMARY KEY REFERENCES base_radar_cases(id) ON DELETE CASCADE,
      sent_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS base_radar_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES base_radar_cases(id) ON DELETE CASCADE,
      horizon_minutes INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      price REAL NOT NULL,
      liquidity_usd REAL,
      roi_pct REAL NOT NULL,
      tradeable INTEGER NOT NULL CHECK (tradeable IN (0,1)),
      UNIQUE(case_id, horizon_minutes)
    )`,
  ], "write");
}

function firstSymbol(name: string | null): string | null {
  if (!name) return null;
  const symbol = name.split("/")[0]?.trim();
  return symbol || null;
}

function admitted(pool: Pool, now: number): boolean {
  const age = now - pool.createdAt;
  return age >= 0
    && age <= MAX_DISCOVERY_AGE_MS
    && pool.liquidityUsd != null
    && Number.isFinite(pool.liquidityUsd)
    && pool.liquidityUsd >= MIN_ENTRY_LIQUIDITY_USD
    && (pool.volumeH1Usd ?? 0) > 0
    && pool.buysH1 + pool.sellsH1 > 0;
}

async function discoverAndAdmit(client: Client, now: number): Promise<{ offered: number; admitted: number }> {
  const pools = (await discoverPools())
    .filter((pool) => admitted(pool, now))
    .sort((a, b) => b.createdAt - a.createdAt);
  let admittedCount = 0;
  for (const pool of pools.slice(0, MAX_NEW_CASES_PER_RUN)) {
    const result = await client.execute({
      sql: `INSERT OR IGNORE INTO base_radar_cases
        (pool_address, symbol, launched_at, first_seen_at, entry_price, entry_liquidity_usd,
         entry_volume_h1_usd, entry_buys_h1, entry_sells_h1)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        pool.address,
        firstSymbol(pool.name),
        pool.createdAt,
        now,
        pool.price,
        pool.liquidityUsd!,
        pool.volumeH1Usd,
        pool.buysH1,
        pool.sellsH1,
      ],
    });
    if (result.rowsAffected === 0) continue;
    const idResult = await client.execute("SELECT last_insert_rowid() AS id");
    const caseId = Number(idResult.rows[0]?.id);
    await client.execute({
      sql: `INSERT INTO base_radar_snapshots
        (case_id, stage, captured_at, price, liquidity_usd, volume_h1_usd, buys_h1, sells_h1)
        VALUES (?, 'INITIAL', ?, ?, ?, ?, ?, ?)`,
      args: [caseId, now, pool.price, pool.liquidityUsd, pool.volumeH1Usd, pool.buysH1, pool.sellsH1],
    });
    admittedCount += 1;
  }
  return { offered: pools.length, admitted: admittedCount };
}

function mapCase(row: Row): CaseRow {
  return {
    id: Number(row.id),
    poolAddress: String(row.pool_address),
    symbol: row.symbol == null ? null : String(row.symbol),
    launchedAt: Number(row.launched_at),
    firstSeenAt: Number(row.first_seen_at),
    entryPrice: Number(row.entry_price),
    entryLiquidityUsd: Number(row.entry_liquidity_usd),
  };
}

async function listActive(client: Client): Promise<CaseRow[]> {
  const result = await client.execute(
    "SELECT * FROM base_radar_cases WHERE status = 'ACTIVE' ORDER BY first_seen_at ASC LIMIT 200",
  );
  return result.rows.map(mapCase);
}

async function writeDueSnapshots(client: Client, row: CaseRow, pool: Pool, now: number): Promise<void> {
  const ageMinutes = (now - row.firstSeenAt) / 60_000;
  for (const [stage, due] of STAGES) {
    if (ageMinutes < due) continue;
    await client.execute({
      sql: `INSERT OR IGNORE INTO base_radar_snapshots
        (case_id, stage, captured_at, price, liquidity_usd, volume_h1_usd, buys_h1, sells_h1)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, stage, now, pool.price, pool.liquidityUsd, pool.volumeH1Usd, pool.buysH1, pool.sellsH1],
    });
  }

  for (const horizon of OUTCOME_HORIZONS) {
    if (ageMinutes < horizon) continue;
    const roi = ((pool.price - row.entryPrice) / row.entryPrice) * 100;
    const tradeable = pool.liquidityUsd != null && pool.liquidityUsd >= MIN_PLUS10_LIQUIDITY_USD;
    await client.execute({
      sql: `INSERT OR IGNORE INTO base_radar_outcomes
        (case_id, horizon_minutes, captured_at, price, liquidity_usd, roi_pct, tradeable)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, horizon, now, pool.price, pool.liquidityUsd, roi, tradeable ? 1 : 0],
    });
  }

  if (ageMinutes >= 1440) {
    await client.execute({
      sql: "UPDATE base_radar_cases SET status = 'CLOSED' WHERE id = ?",
      args: [row.id],
    });
  }
}

async function evaluateDueCase(client: Client, row: CaseRow): Promise<{ status: string; pushed: boolean } | null> {
  const existing = await client.execute({
    sql: "SELECT status FROM base_radar_decisions WHERE case_id = ?",
    args: [row.id],
  });
  if (existing.rows.length > 0) return null;

  const snaps = await client.execute({
    sql: "SELECT * FROM base_radar_snapshots WHERE case_id = ? AND stage IN ('INITIAL','PLUS_5','PLUS_10')",
    args: [row.id],
  });
  const byStage = new Map(snaps.rows.map((snap) => [String(snap.stage), snap]));
  const initial = byStage.get("INITIAL");
  const p5 = byStage.get("PLUS_5");
  const p10 = byStage.get("PLUS_10");
  if (!initial || !p5 || !p10) return null;

  const decision = evaluateRadar24({
    tokenCaseId: row.id,
    decisionStage: "PLUS_10",
    decidedAt: Number(p10.captured_at),
    radarVersion: RADAR_VERSION,
    entry: { entryPrice: row.entryPrice, entryValid: true },
    snapshots: {
      INITIAL: { stage: "INITIAL", capturedAt: Number(initial.captured_at), price: Number(initial.price), marketCap: null, liquidityUsd: asNumber(initial.liquidity_usd) },
      PLUS_5: { stage: "PLUS_5", capturedAt: Number(p5.captured_at), price: Number(p5.price), marketCap: null, liquidityUsd: asNumber(p5.liquidity_usd) },
      PLUS_10: { stage: "PLUS_10", capturedAt: Number(p10.captured_at), price: Number(p10.price), marketCap: null, liquidityUsd: asNumber(p10.liquidity_usd) },
    },
  });

  const plus10Liquidity = asNumber(p10.liquidity_usd);
  const strategyPass = decision.decisionStatus === "PASS";
  const executionPass = plus10Liquidity != null && plus10Liquidity >= MIN_PLUS10_LIQUIDITY_USD;
  const finalStatus = strategyPass && executionPass ? "PASS" : "REJECT";
  const rejectReason = !strategyPass
    ? decision.rejectReason
    : !executionPass
      ? "LIQUIDITY_BELOW_15000_AT_PLUS_10"
      : null;

  await client.execute({
    sql: `INSERT INTO base_radar_decisions
      (case_id, decided_at, status, reject_reason, plus5_roi_pct, plus10_roi_pct,
       momentum_5_to_10_pct, plus10_liquidity_usd, radar_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      Number(p10.captured_at),
      finalStatus,
      rejectReason,
      decision.plus5RoiPct,
      decision.plus10RoiPct,
      decision.momentum5To10Pct,
      plus10Liquidity,
      RADAR_VERSION,
    ],
  });

  if (finalStatus !== "PASS") return { status: finalStatus, pushed: false };

  const claim = await client.execute({
    sql: "INSERT OR IGNORE INTO base_radar_push_deliveries (case_id, sent_at) VALUES (?, ?)",
    args: [row.id, Date.now()],
  });
  if (claim.rowsAffected === 0) return { status: finalStatus, pushed: false };

  const sendPush = createWebPushSender({ getSubscriptions: () => getPushSubscriptions(client) });
  const payload: PushPayload = {
    title: "🚀 Base Radar · Research",
    body: `${row.symbol ?? "BASE token"} | +10 ${decision.plus10RoiPct?.toFixed(1) ?? "?"}% | momentum ${decision.momentum5To10Pct?.toFixed(1) ?? "?"}% | liq $${Math.round(plus10Liquidity!).toLocaleString("en-US")}`,
    url: "/radar",
    mint: row.poolAddress,
    decisionId: row.id,
    tokenCaseId: row.id,
    decisionStatus: "PASS",
    decisionStage: "PLUS_10",
    plus10RoiPct: decision.plus10RoiPct,
    momentum5To10Pct: decision.momentum5To10Pct,
    symbol: row.symbol,
  };

  try {
    await sendPush(payload);
    return { status: finalStatus, pushed: true };
  } catch (error) {
    await client.execute({
      sql: "DELETE FROM base_radar_push_deliveries WHERE case_id = ?",
      args: [row.id],
    });
    throw error;
  }
}

export async function runBaseRadar(): Promise<Record<string, unknown>> {
  const client = await createTursoClient();
  const now = Date.now();
  await ensureSchema(client);
  const discovery = await discoverAndAdmit(client, now);
  const active = await listActive(client);
  const errors: Array<{ caseId: number | null; message: string }> = [];
  let observed = 0;
  let decisions = 0;
  let passes = 0;
  let pushes = 0;

  for (let offset = 0; offset < active.length; offset += 30) {
    const batch = active.slice(offset, offset + 30);
    try {
      const pools = await fetchPools(batch.map((row) => row.poolAddress));
      for (const row of batch) {
        const pool = pools.get(row.poolAddress.toLowerCase());
        if (!pool) {
          errors.push({ caseId: row.id, message: "Pool missing from GeckoTerminal response" });
          continue;
        }
        try {
          await writeDueSnapshots(client, row, pool, now);
          observed += 1;
          const outcome = await evaluateDueCase(client, row);
          if (outcome) {
            decisions += 1;
            if (outcome.status === "PASS") passes += 1;
            if (outcome.pushed) pushes += 1;
          }
        } catch (error) {
          errors.push({ caseId: row.id, message: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      errors.push({ caseId: null, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const counts = await client.execute(`SELECT
    COUNT(*) AS cases,
    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
    FROM base_radar_cases`);
  const decisionCounts = await client.execute(`SELECT
    SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) AS passes,
    SUM(CASE WHEN status = 'REJECT' THEN 1 ELSE 0 END) AS rejects
    FROM base_radar_decisions`);

  const summary = {
    enabled: true,
    mode: "BASE_RADAR_RESEARCH",
    network: NETWORK,
    radarVersion: RADAR_VERSION,
    admission: {
      maxDiscoveryAgeMinutes: MAX_DISCOVERY_AGE_MS / 60_000,
      minEntryLiquidityUsd: MIN_ENTRY_LIQUIDITY_USD,
      requiresActivity: true,
      maxNewCasesPerRun: MAX_NEW_CASES_PER_RUN,
    },
    decision: {
      plus10RoiMinPct: 25,
      momentum5To10MinPct: 0,
      minPlus10LiquidityUsd: MIN_PLUS10_LIQUIDITY_USD,
    },
    offered: discovery.offered,
    admitted: discovery.admitted,
    observed,
    decisionsCreated: decisions,
    passesCreated: passes,
    pushesSent: pushes,
    totals: {
      cases: Number(counts.rows[0]?.cases ?? 0),
      active: Number(counts.rows[0]?.active ?? 0),
      closed: Number(counts.rows[0]?.closed ?? 0),
      passes: Number(decisionCounts.rows[0]?.passes ?? 0),
      rejects: Number(decisionCounts.rows[0]?.rejects ?? 0),
    },
    errors,
  };
  console.info("[base-radar] cron finished", summary);
  client.close();
  return summary;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleBaseRadarCron(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runBaseRadar()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[base-radar] cron failed", { message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
