import type { DiscoveredToken } from "./types";

const GECKO_NEW_POOLS_URL =
  "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,quote_token,dex";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGE = 10;
const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class GeckoTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeckoTerminalError";
  }
}

export class GeckoTerminalFetchError extends GeckoTerminalError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeckoTerminalFetchError";
  }
}

export class GeckoTerminalParseError extends GeckoTerminalError {
  constructor(message: string) {
    super(message);
    this.name = "GeckoTerminalParseError";
  }
}

export type FetchNewSolanaPoolsOptions = {
  page?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  fetchedAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function readRelationshipId(
  relationships: Record<string, unknown>,
  key: string,
): string | null {
  const relation = relationships[key];
  if (!isRecord(relation)) {
    return null;
  }
  const data = relation.data;
  if (!isRecord(data)) {
    return null;
  }
  return readString(data.id);
}

function parseIncludedTokens(
  included: unknown[],
): Map<string, { address: string; symbol: string | null; name: string | null }> {
  const tokens = new Map<string, { address: string; symbol: string | null; name: string | null }>();
  for (const item of included) {
    if (!isRecord(item) || item.type !== "token" || !isRecord(item.attributes)) {
      continue;
    }
    const id = readString(item.id);
    const address = readString(item.attributes.address);
    if (id == null || address == null) {
      continue;
    }
    tokens.set(id, {
      address,
      symbol: readString(item.attributes.symbol),
      name: readString(item.attributes.name),
    });
  }
  return tokens;
}

function parsePoolCreatedAtMs(value: unknown, fallbackMs: number): number {
  const raw = readString(value);
  if (raw == null) {
    return fallbackMs;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

export function parseGeckoTerminalNewPoolsResponse(
  raw: unknown,
  fetchedAt: number = Date.now(),
): DiscoveredToken[] {
  if (!isRecord(raw) || !Array.isArray(raw.data)) {
    throw new GeckoTerminalParseError("GeckoTerminal response must include a data array");
  }

  const included = Array.isArray(raw.included) ? raw.included : [];
  const tokens = parseIncludedTokens(included);
  const discovered: DiscoveredToken[] = [];

  for (const pool of raw.data) {
    if (!isRecord(pool) || !isRecord(pool.attributes) || !isRecord(pool.relationships)) {
      continue;
    }

    const baseTokenId = readRelationshipId(pool.relationships, "base_token");
    if (baseTokenId == null) {
      continue;
    }

    const baseToken = tokens.get(baseTokenId);
    if (!baseToken || !SOLANA_MINT_PATTERN.test(baseToken.address)) {
      continue;
    }

    const price = readNumber(pool.attributes.base_token_price_usd);
    if (price == null || price <= 0) {
      continue;
    }

    const poolAddress = readString(pool.attributes.address);
    const poolId = readString(pool.id);
    discovered.push({
      mint: baseToken.address,
      symbol: baseToken.symbol,
      name: baseToken.name ?? baseToken.symbol,
      firstSeenAt: parsePoolCreatedAtMs(pool.attributes.pool_created_at, fetchedAt),
      price,
      marketCap: readNumber(pool.attributes.market_cap_usd)
        ?? readNumber(pool.attributes.fdv_usd),
      liquidityUsd: readNumber(pool.attributes.reserve_in_usd),
      sourceEventId: poolId ?? (poolAddress ? `new-pool:${poolAddress}` : null),
    });
  }

  return discovered;
}

function buildUrl(page: number): string {
  const safePage = Math.max(1, Math.min(MAX_PAGE, Math.floor(page)));
  return `${GECKO_NEW_POOLS_URL}&page=${safePage}`;
}

export async function fetchNewSolanaPools(
  options: FetchNewSolanaPoolsOptions = {},
): Promise<DiscoveredToken[]> {
  const page = options.page ?? 1;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? Date.now();
  const url = buildUrl(page);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "radar-v24/2.4 discovery",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GeckoTerminalFetchError(`GeckoTerminal request failed: ${message}`);
  }

  if (!response.ok) {
    throw new GeckoTerminalFetchError(
      `GeckoTerminal request failed with status ${response.status}`,
      response.status,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new GeckoTerminalParseError("GeckoTerminal response is not valid JSON");
  }

  return parseGeckoTerminalNewPoolsResponse(raw, fetchedAt);
}
