import type { Client, Row } from "@libsql/client";
import { createTursoClient } from "../db/client";
import { getPushSubscriptions } from "../db/repositories/push";
import { evaluateRadar24 } from "../decisions/engine";
import { validateJupiterExecution } from "../push/executionGate";
import { createWebPushSender } from "../push/webpush";
import type { PushPayload } from "../push/types";

const NETWORK = "solana";
const RADAR_VERSION = "2.4-solana-post-validation";
const MIN_POOL_AGE_MS = 15 * 60_000;
const MAX_POOL_AGE_MS = 60 * 60_000;
const MIN_ENTRY_LIQUIDITY_USD = 25_000;
const MAX_NEW_CASES_PER_RUN = 10;
const MAX_ROUND_TRIP_LOSS_PCT = 3;
const DISCOVERY_PAGES = [1, 2, 3, 4, 5] as const;
const STAGES = [["PLUS_5", 5], ["PLUS_10", 10], ["PLUS_15", 15], ["PLUS_30", 30], ["PLUS_60", 60]] as const;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD7hJcUAPXnY8W3K2p5uX3";
const MAJOR_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

type Pool = {
  poolAddress: string;
  mint: string;
  symbol: string | null;
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
  mint: string;
  symbol: string | null;
  firstSeenAt: number;
  entryPrice: number;
  entryLiquidityUsd: number;
};

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relationAddress(resource: any, key: "base_token" | "quote_token"): string | null {
  const id = resource?.relationships?.[key]?.data?.id;
  if (typeof id !== "string") return null;
  return id.replace(/^solana_/, "");
}

function parsePool(resource: any): Pool | null {
  const attributes = resource?.attributes ?? {};
  const base = relationAddress(resource, "base_token");
  const quote = relationAddress(resource, "quote_token");
  if (!base || !quote) return null;

  const targetIsQuote = MAJOR_MINTS.has(base) && !MAJOR_MINTS.has(quote);
  const mint = targetIsQuote ? quote : base;
  if (MAJOR_MINTS.has(mint)) return null;

  const price = asNumber(targetIsQuote ? attributes.quote_token_price_usd : attributes.base_token_price_usd);
  const createdAt = Date.parse(String(attributes.pool_created_at ?? ""));
  const poolAddress = typeof attributes.address === "string"
    ? attributes.address
    : String(resource?.id ?? "").replace(/^solana_/, "");
  if (!poolAddress || !Number.isFinite(createdAt) || price == null || price <= 0) return null;

  const tx = attributes.transactions?.h1 ?? {};
  const parts = typeof attributes.name === "string"
    ? attributes.name.split("/").map((part: string) => part.trim())
    : [];

  return {
    poolAddress,
    mint,
    symbol: targetIsQuote ? (parts[1] ?? null) : (parts[0] ?? null),
    createdAt,
    price,
    liquidityUsd: asNumber(attributes.reserve_in_usd),
    volumeH1Usd: asNumber(attributes.volume_usd?.h1),
    buysH1: Math.max(0, Number(tx.buys ?? 0) || 0),
    sellsH1: Math.max(0, Number(tx.sells ?? 0) || 0),
  };
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status} for ${url}`);
  return response.json();
}

async function discover(): Promise<Pool[]> {
  const pages = await Promise.all(
    DISCOVERY_PAGES.map((page) => getJson(`https://api.geckoterminal.com/api/v2/networks/${NETWORK}/new_pools?page=${page}`)),
  );
  const all = pages.flatMap((json) => Array.isArray(json?.data) ? json.data : [])
    .map(parsePool)
    .filter((pool: Pool | null): pool is Pool => pool != null);

  const bestByMint = new Map<string, Pool>();
  for (const pool of all) {
    const current = bestByMint.get(pool.mint);
    if (!current || (pool.liquidityUsd ?? 0) > (current.liquidityUsd ?? 0)) {
      bestByMint.set(pool.mint, pool);
    }
  }
  return [...bestByMint.values()];
}

async function fetchPools(addresses: string[]): Promise<Map<string, Pool>> {
  if (addresses.length === 0) return new Map();
  const json = await getJson(
    `https://api.geckoterminal.com/api/v2/networks/${NETWORK}/pools/multi/${addresses.map(encodeURIComponent).join(",")}`,
  );
  const pools: Pool[] = Array.isArray(json?.data)
    ? json.data.map(parsePool).filter((pool: Pool | null): pool is Pool => pool != null)
    : [];
  return new Map(pools.map((pool) => [pool.poolAddress.toLowerCase(), pool]));
}

async function ensureSchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS solana_validated_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL UNIQUE,
      mint TEXT NOT NULL UNIQUE,
      symbol TEXT,
      first_seen_at INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      entry_liquidity_usd REAL NOT NULL,
      entry_volume_h1_usd REAL,
      entry_buys_h1 INTEGER NOT NULL,
      entry_sells_h1 INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    )`,
    `CREATE TABLE IF NOT EXISTS solana_validated_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES solana_validated_cases(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      price REAL NOT NULL,
      liquidity_usd REAL,
      UNIQUE(case_id, stage)
    )`,
    `CREATE TABLE IF NOT EXISTS solana_validated_decisions (
      case_id INTEGER PRIMARY KEY REFERENCES solana_validated_cases(id) ON DELETE CASCADE,
      decided_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      reject_reason TEXT,
      plus5_roi_pct REAL,
      plus10_roi_pct REAL,
      momentum_5_to_10_pct REAL,
      plus10_liquidity_usd REAL,
      execution_status TEXT,
      round_trip_loss_pct REAL,
      radar_version TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS solana_validated_push_deliveries (
      case_id INTEGER PRIMARY KEY REFERENCES solana_validated_cases(id) ON DELETE CASCADE,
      sent_at INTEGER NOT NULL
    )`,
  ], "write");
}

function eligible(pool: Pool, now: number): boolean {
  const age = now - pool.createdAt;
  return age >= MIN_POOL_AGE_MS
    && age <= MAX_POOL_AGE_MS
    && pool.liquidityUsd != null
    && pool.liquidityUsd >= MIN_ENTRY_LIQUIDITY_USD
    && (pool.volumeH1Usd ?? 0) > 0
    && pool.buysH1 + pool.sellsH1 > 0;
}

async function admit(client: Client, now: number): Promise<{ offered: number; admitted: number }> {
  const pools = (await discover())
    .filter((pool) => eligible(pool, now))
    .sort((a, b) => b.createdAt - a.createdAt);

  let admitted = 0;
  for (const pool of pools.slice(0, MAX_NEW_CASES_PER_RUN)) {
    const result = await client.execute({
      sql: `INSERT INTO solana_validated_cases
        (pool_address, mint, symbol, first_seen_at, entry_price, entry_liquidity_usd,
         entry_volume_h1_usd, entry_buys_h1, entry_sells_h1)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        RETURNING id`,
      args: [
        pool.poolAddress,
        pool.mint,
        pool.symbol,
        now,
        pool.price,
        pool.liquidityUsd!,
        pool.volumeH1Usd,
        pool.buysH1,
        pool.sellsH1,
      ],
    });
    if (result.rows.length === 0) continue;
    const caseId = Number(result.rows[0]?.id);
    await client.execute({
      sql: `INSERT INTO solana_validated_snapshots
        (case_id, stage, captured_at, price, liquidity_usd)
        VALUES (?, 'INITIAL', ?, ?, ?)`,
      args: [caseId, now, pool.price, pool.liquidityUsd],
    });
    admitted += 1;
  }
  return { offered: pools.length, admitted };
}

function mapCase(row: Row): CaseRow {
  return {
    id: Number(row.id),
    poolAddress: String(row.pool_address),
    mint: String(row.mint),
    symbol: row.symbol == null ? null : String(row.symbol),
    firstSeenAt: Number(row.first_seen_at),
    entryPrice: Number(row.entry_price),
    entryLiquidityUsd: Number(row.entry_liquidity_usd),
  };
}

async function listActive(client: Client): Promise<CaseRow[]> {
  const result = await client.execute(
    "SELECT * FROM solana_validated_cases WHERE status='ACTIVE' ORDER BY first_seen_at ASC LIMIT 200",
  );
  return result.rows.map(mapCase);
}

async function writeSnapshots(client: Client, row: CaseRow, pool: Pool, now: number): Promise<void> {
  const ageMinutes = (now - row.firstSeenAt) / 60_000;
  for (const [stage, due] of STAGES) {
    if (ageMinutes < due) continue;
    await client.execute({
      sql: `INSERT OR IGNORE INTO solana_validated_snapshots
        (case_id, stage, captured_at, price, liquidity_usd)
        VALUES (?, ?, ?, ?, ?)`,
      args: [row.id, stage, now, pool.price, pool.liquidityUsd],
    });
  }
  if (ageMinutes >= 60) {
    await client.execute({
      sql: "UPDATE solana_validated_cases SET status='CLOSED' WHERE id=?",
      args: [row.id],
    });
  }
}

async function evaluateDueCase(client: Client, row: CaseRow): Promise<{ status: string; pushed: boolean } | null> {
  const existing = await client.execute({
    sql: "SELECT 1 FROM solana_validated_decisions WHERE case_id=?",
    args: [row.id],
  });
  if (existing.rows.length > 0) return null;

  const result = await client.execute({
    sql: "SELECT * FROM solana_validated_snapshots WHERE case_id=? AND stage IN ('INITIAL','PLUS_5','PLUS_10')",
    args: [row.id],
  });
  const stages = new Map(result.rows.map((snapshot) => [String(snapshot.stage), snapshot]));
  const initial = stages.get("INITIAL");
  const plus5 = stages.get("PLUS_5");
  const plus10 = stages.get("PLUS_10");
  if (!initial || !plus5 || !plus10) return null;

  const decision = evaluateRadar24({
    tokenCaseId: row.id,
    decisionStage: "PLUS_10",
    decidedAt: Number(plus10.captured_at),
    radarVersion: RADAR_VERSION,
    entry: { entryPrice: row.entryPrice, entryValid: true },
    snapshots: {
      INITIAL: { stage: "INITIAL", capturedAt: Number(initial.captured_at), price: Number(initial.price), marketCap: null, liquidityUsd: asNumber(initial.liquidity_usd) },
      PLUS_5: { stage: "PLUS_5", capturedAt: Number(plus5.captured_at), price: Number(plus5.price), marketCap: null, liquidityUsd: asNumber(plus5.liquidity_usd) },
      PLUS_10: { stage: "PLUS_10", capturedAt: Number(plus10.captured_at), price: Number(plus10.price), marketCap: null, liquidityUsd: asNumber(plus10.liquidity_usd) },
    },
  });

  let status = decision.decisionStatus;
  let rejectReason = decision.rejectReason;
  let executionStatus: string | null = null;
  let roundTripLossPct: number | null = null;

  if (status === "PASS") {
    const execution = await validateJupiterExecution(row.mint);
    executionStatus = execution.status;
    roundTripLossPct = execution.roundTripLossPct;
    if (execution.status !== "EXECUTION_PASS") {
      status = "REJECT";
      rejectReason = execution.reason ?? "EXECUTION_FAIL";
    } else if (roundTripLossPct == null || roundTripLossPct > MAX_ROUND_TRIP_LOSS_PCT) {
      status = "REJECT";
      rejectReason = "EXECUTION_FAIL_ROUND_TRIP_LOSS_GT_3PCT";
    }
  }

  await client.execute({
    sql: `INSERT INTO solana_validated_decisions
      (case_id, decided_at, status, reject_reason, plus5_roi_pct, plus10_roi_pct,
       momentum_5_to_10_pct, plus10_liquidity_usd, execution_status, round_trip_loss_pct, radar_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      Number(plus10.captured_at),
      status,
      rejectReason,
      decision.plus5RoiPct,
      decision.plus10RoiPct,
      decision.momentum5To10Pct,
      asNumber(plus10.liquidity_usd),
      executionStatus,
      roundTripLossPct,
      RADAR_VERSION,
    ],
  });

  if (status !== "PASS") return { status, pushed: false };

  const claim = await client.execute({
    sql: "INSERT OR IGNORE INTO solana_validated_push_deliveries(case_id,sent_at) VALUES(?,?)",
    args: [row.id, Date.now()],
  });
  if (claim.rowsAffected === 0) return { status, pushed: false };

  const sendPush = createWebPushSender({ getSubscriptions: () => getPushSubscriptions(client) });
  const payload: PushPayload = {
    title: "🚀 Solana Radar · Validated",
    body: `${row.symbol ?? "SOL token"} | +10 ${decision.plus10RoiPct?.toFixed(1) ?? "?"}% | RT loss ${roundTripLossPct?.toFixed(2) ?? "?"}%`,
    url: `/solana-cases/${row.id}`,
    mint: row.mint,
    decisionId: row.id,
    tokenCaseId: row.id,
    decisionStatus: "PASS",
    decisionStage: "PLUS_10",
    plus10RoiPct: decision.plus10RoiPct,
    momentum5To10Pct: decision.momentum5To10Pct,
    symbol: row.symbol,
  };
  await sendPush(payload);
  return { status, pushed: true };
}

export async function runSolanaValidatedRadar(): Promise<Record<string, unknown>> {
  const client = await createTursoClient();
  const now = Date.now();
  await ensureSchema(client);
  const discovery = await admit(client, now);
  const rows = await listActive(client);
  const errors: Array<{ caseId: number | null; message: string }> = [];
  let decisions = 0;
  let passes = 0;
  let pushes = 0;

  for (let offset = 0; offset < rows.length; offset += 30) {
    const batch = rows.slice(offset, offset + 30);
    try {
      const pools = await fetchPools(batch.map((row) => row.poolAddress));
      for (const row of batch) {
        const pool = pools.get(row.poolAddress.toLowerCase());
        if (!pool) continue;
        try {
          await writeSnapshots(client, row, pool, now);
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
    SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active
    FROM solana_validated_cases`);

  const summary = {
    mode: "SOLANA_POST_VALIDATION",
    admission: {
      minPoolAgeMinutes: 15,
      maxPoolAgeMinutes: 60,
      minEntryLiquidityUsd: MIN_ENTRY_LIQUIDITY_USD,
      discoveryPages: DISCOVERY_PAGES.length,
    },
    decision: {
      plus10RoiMinPct: 25,
      momentum5To10MinPct: 0,
      jupiterRoundTripRequired: true,
      maxRoundTripLossPct: MAX_ROUND_TRIP_LOSS_PCT,
    },
    ...discovery,
    decisionsCreated: decisions,
    passesCreated: passes,
    pushesSent: pushes,
    totals: {
      cases: Number(counts.rows[0]?.cases ?? 0),
      active: Number(counts.rows[0]?.active ?? 0),
    },
    errors,
  };
  console.info("[solana-validated] cron finished", summary);
  client.close();
  return summary;
}

export async function handleSolanaValidatedCron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await runSolanaValidatedRadar()) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
