import type { Client } from "@libsql/client";
import { createTursoClient } from "../../db/client";

const NETWORKS = [
  { chain: "SOLANA", network: "solana" },
  { chain: "BNB", network: "bsc" },
] as const;

const MAX_ACTIVE_PER_CHAIN = 8;
const MIN_SURVIVAL_LIQUIDITY_USD = 15_000;
const MAX_DISCOVERY_AGE_MS = 90 * 60_000;
const STAGES = [
  ["PLUS_5", 5],
  ["PLUS_10", 10],
  ["PLUS_15", 15],
  ["PLUS_30", 30],
  ["PLUS_60", 60],
] as const;
const SURVIVAL_HORIZONS = [60, 360, 1440] as const;

type Pool = {
  address: string;
  name: string | null;
  createdAt: number;
  price: number;
  liquidityUsd: number | null;
};

type CaseRow = {
  id: number;
  chain: "SOLANA" | "BNB";
  network: string;
  poolAddress: string;
  firstSeenAt: number;
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
  const created = Date.parse(String(attributes.pool_created_at ?? ""));
  const price = asNumber(attributes.base_token_price_usd);
  if (!address || !Number.isFinite(created) || price == null || price <= 0) {
    return null;
  }
  return {
    address,
    name: typeof attributes.name === "string" ? attributes.name : null,
    createdAt: created,
    price,
    liquidityUsd: asNumber(attributes.reserve_in_usd),
  };
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`GeckoTerminal ${response.status} for ${url}`);
  }
  return response.json();
}

async function discoverPools(network: string): Promise<Pool[]> {
  const json = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`,
  );
  return Array.isArray(json?.data)
    ? json.data.map(poolFromResource).filter((pool: Pool | null): pool is Pool => pool != null)
    : [];
}

async function fetchPools(
  network: string,
  poolAddresses: string[],
): Promise<Map<string, Pool>> {
  if (poolAddresses.length === 0) {
    return new Map();
  }

  const encodedAddresses = poolAddresses.map(encodeURIComponent).join(",");
  const json = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${network}/pools/multi/${encodedAddresses}`,
  );
  const pools: Pool[] = Array.isArray(json?.data)
    ? json.data.map(poolFromResource).filter((pool: Pool | null): pool is Pool => pool != null)
    : [];
  return new Map(pools.map((pool: Pool) => [pool.address.toLowerCase(), pool]));
}

async function ensureSchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS survivor_research_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL CHECK (chain IN ('SOLANA','BNB')),
      network TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      symbol TEXT,
      launched_at INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      entry_liquidity_usd REAL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
      UNIQUE(chain, pool_address)
    )`,
    `CREATE TABLE IF NOT EXISTS survivor_research_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES survivor_research_cases(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      price REAL NOT NULL,
      liquidity_usd REAL,
      UNIQUE(case_id, stage)
    )`,
    `CREATE TABLE IF NOT EXISTS survivor_research_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES survivor_research_cases(id) ON DELETE CASCADE,
      horizon_minutes INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      tradeable INTEGER NOT NULL CHECK (tradeable IN (0,1)),
      liquidity_usd REAL,
      UNIQUE(case_id, horizon_minutes)
    )`,
  ], "write");
}

function firstSymbol(name: string | null): string | null {
  if (!name) return null;
  const symbol = name.split("/")[0]?.trim();
  return symbol || null;
}

async function seedNewCases(client: Client, now: number): Promise<number> {
  let inserted = 0;
  for (const source of NETWORKS) {
    const countResult = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM survivor_research_cases WHERE chain = ? AND status = 'ACTIVE'",
      args: [source.chain],
    });
    const active = Number(countResult.rows[0]?.count ?? 0);
    const slots = Math.max(0, MAX_ACTIVE_PER_CHAIN - active);
    if (slots === 0) continue;

    const pools = await discoverPools(source.network);
    const eligible = pools
      .filter((pool) => now - pool.createdAt >= 0 && now - pool.createdAt <= MAX_DISCOVERY_AGE_MS)
      .sort((a, b) => b.createdAt - a.createdAt);

    let insertedForChain = 0;
    for (const pool of eligible) {
      if (insertedForChain >= slots) break;
      const result = await client.execute({
        sql: `INSERT OR IGNORE INTO survivor_research_cases
          (chain, network, pool_address, symbol, launched_at, first_seen_at, entry_price, entry_liquidity_usd)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          source.chain,
          source.network,
          pool.address,
          firstSymbol(pool.name),
          pool.createdAt,
          now,
          pool.price,
          pool.liquidityUsd,
        ],
      });
      if (result.rowsAffected > 0) {
        const idResult = await client.execute("SELECT last_insert_rowid() AS id");
        const caseId = Number(idResult.rows[0]?.id);
        await client.execute({
          sql: `INSERT OR IGNORE INTO survivor_research_snapshots
            (case_id, stage, captured_at, price, liquidity_usd) VALUES (?, 'INITIAL', ?, ?, ?)`,
          args: [caseId, now, pool.price, pool.liquidityUsd],
        });
        inserted += 1;
        insertedForChain += 1;
      }
    }
  }
  return inserted;
}

async function listActiveCases(client: Client): Promise<CaseRow[]> {
  const result = await client.execute(
    "SELECT id, chain, network, pool_address, first_seen_at FROM survivor_research_cases WHERE status = 'ACTIVE' ORDER BY id",
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    chain: String(row.chain) as CaseRow["chain"],
    network: String(row.network),
    poolAddress: String(row.pool_address),
    firstSeenAt: Number(row.first_seen_at),
  }));
}

async function observeCase(
  client: Client,
  row: CaseRow,
  pool: Pool,
  now: number,
): Promise<void> {
  const ageMinutes = (now - row.firstSeenAt) / 60_000;

  for (const [stage, dueMinutes] of STAGES) {
    if (ageMinutes < dueMinutes) continue;
    await client.execute({
      sql: `INSERT OR IGNORE INTO survivor_research_snapshots
        (case_id, stage, captured_at, price, liquidity_usd) VALUES (?, ?, ?, ?, ?)`,
      args: [row.id, stage, now, pool.price, pool.liquidityUsd],
    });
  }

  for (const horizonMinutes of SURVIVAL_HORIZONS) {
    if (ageMinutes < horizonMinutes) continue;
    const tradeable = pool.price > 0
      && pool.liquidityUsd != null
      && pool.liquidityUsd >= MIN_SURVIVAL_LIQUIDITY_USD;
    await client.execute({
      sql: `INSERT OR IGNORE INTO survivor_research_checks
        (case_id, horizon_minutes, captured_at, tradeable, liquidity_usd) VALUES (?, ?, ?, ?, ?)`,
      args: [row.id, horizonMinutes, now, tradeable ? 1 : 0, pool.liquidityUsd],
    });
  }

  if (ageMinutes >= 1440) {
    await client.execute({
      sql: "UPDATE survivor_research_cases SET status = 'CLOSED' WHERE id = ?",
      args: [row.id],
    });
  }
}

export async function runSurvivorResearchCron(): Promise<Record<string, unknown>> {
  const client = await createTursoClient();
  const now = Date.now();
  await ensureSchema(client);
  const discovered = await seedNewCases(client, now);
  const active = await listActiveCases(client);
  const errors: Array<{ caseId: number; message: string }> = [];
  let observed = 0;

  for (const source of NETWORKS) {
    const rows = active.filter((row) => row.chain === source.chain);
    if (rows.length === 0) continue;

    try {
      const pools = await fetchPools(
        source.network,
        rows.map((row) => row.poolAddress),
      );
      for (const row of rows) {
        const pool = pools.get(row.poolAddress.toLowerCase());
        if (!pool) {
          errors.push({ caseId: row.id, message: "Pool missing from GeckoTerminal batch response" });
          continue;
        }
        try {
          await observeCase(client, row, pool, now);
          observed += 1;
        } catch (error) {
          errors.push({
            caseId: row.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of rows) {
        errors.push({ caseId: row.id, message });
      }
    }
  }

  const counts = await client.execute(
    `SELECT chain, COUNT(*) AS cases,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
     FROM survivor_research_cases GROUP BY chain`,
  );
  const summary = {
    enabled: true,
    discovered,
    observed,
    minSurvivalLiquidityUsd: MIN_SURVIVAL_LIQUIDITY_USD,
    counts: counts.rows.map((row) => ({
      chain: String(row.chain),
      cases: Number(row.cases),
      active: Number(row.active),
    })),
    errors,
  };
  console.info("[survivor] cron finished", summary);
  return summary;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleSurvivorResearchCron(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runSurvivorResearchCron();
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[survivor] cron failed", { message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
