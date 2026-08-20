import type { MarketSnapshotInput } from "../lifecycle/types";

const DEXSCREENER_TOKENS_URL =
  "https://api.dexscreener.com/tokens/v1/solana";
const DEFAULT_TIMEOUT_MS = 10_000;
const SOLANA_CHAIN_ID = "solana";

export class DexScreenerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DexScreenerError";
  }
}

export class DexScreenerFetchError extends DexScreenerError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DexScreenerFetchError";
  }
}

export class DexScreenerParseError extends DexScreenerError {
  constructor(message: string) {
    super(message);
    this.name = "DexScreenerParseError";
  }
}

export type FetchMarketSnapshotOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  capturedAt?: number;
};

type CandidatePair = {
  price: number;
  marketCap: number | null;
  liquidityUsd: number | null;
  mintIsBase: boolean;
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

function extractPairs(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (isRecord(raw) && Array.isArray(raw.pairs)) {
    return raw.pairs;
  }
  throw new DexScreenerParseError(
    "DexScreener response must be a pairs array or an object with a pairs array",
  );
}

function liquidityRank(liquidityUsd: number | null): number {
  return liquidityUsd ?? Number.NEGATIVE_INFINITY;
}

function isBetterCandidate(next: CandidatePair, current: CandidatePair): boolean {
  const nextLiq = liquidityRank(next.liquidityUsd);
  const currentLiq = liquidityRank(current.liquidityUsd);
  if (nextLiq !== currentLiq) {
    return nextLiq > currentLiq;
  }
  if (next.mintIsBase !== current.mintIsBase) {
    return next.mintIsBase;
  }
  return false;
}

function parsePairCandidate(pair: unknown, mint: string): CandidatePair | null {
  if (!isRecord(pair)) {
    return null;
  }

  const chainId = readString(pair.chainId);
  if (chainId !== SOLANA_CHAIN_ID) {
    return null;
  }

  const baseToken = isRecord(pair.baseToken) ? pair.baseToken : null;
  const quoteToken = isRecord(pair.quoteToken) ? pair.quoteToken : null;
  const baseAddress = baseToken ? readString(baseToken.address) : null;
  const quoteAddress = quoteToken ? readString(quoteToken.address) : null;

  const mintIsBase = baseAddress === mint;
  const mintIsQuote = quoteAddress === mint;
  if (!mintIsBase && !mintIsQuote) {
    return null;
  }

  const price = readNumber(pair.priceUsd);
  if (price == null || price <= 0) {
    return null;
  }

  const liquidity = isRecord(pair.liquidity) ? pair.liquidity : null;
  const liquidityUsd = liquidity ? readNumber(liquidity.usd) : null;
  const marketCap = readNumber(pair.marketCap) ?? readNumber(pair.fdv);

  return {
    price,
    marketCap,
    liquidityUsd,
    mintIsBase,
  };
}

export function parseDexScreenerTokenPairs(
  raw: unknown,
  mint: string,
  capturedAt: number = Date.now(),
): MarketSnapshotInput {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) {
    throw new DexScreenerParseError("capturedAt must be a positive finite number");
  }
  if (typeof mint !== "string" || mint.length === 0) {
    throw new DexScreenerParseError("mint must be a non-empty string");
  }

  const pairs = extractPairs(raw);
  let best: CandidatePair | null = null;

  for (const pair of pairs) {
    const candidate = parsePairCandidate(pair, mint);
    if (candidate == null) {
      continue;
    }
    if (best == null || isBetterCandidate(candidate, best)) {
      best = candidate;
    }
  }

  if (best == null) {
    throw new DexScreenerParseError(
      `No usable Solana pairs found for mint ${mint}`,
    );
  }

  return {
    price: best.price,
    capturedAt,
    marketCap: best.marketCap,
    liquidityUsd: best.liquidityUsd,
  };
}

function buildUrl(mint: string): string {
  return `${DEXSCREENER_TOKENS_URL}/${encodeURIComponent(mint)}`;
}

export async function fetchMarketSnapshotByMint(
  mint: string,
  options: FetchMarketSnapshotOptions = {},
): Promise<MarketSnapshotInput> {
  if (typeof mint !== "string" || mint.length === 0) {
    throw new DexScreenerParseError("mint must be a non-empty string");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const capturedAt = options.capturedAt ?? Date.now();
  const url = buildUrl(mint);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "radar-v24/2.4 market",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DexScreenerFetchError(`DexScreener request failed: ${message}`);
  }

  if (!response.ok) {
    throw new DexScreenerFetchError(
      `DexScreener request failed with status ${response.status}`,
      response.status,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DexScreenerParseError("DexScreener response is not valid JSON");
  }

  return parseDexScreenerTokenPairs(raw, mint, capturedAt);
}
