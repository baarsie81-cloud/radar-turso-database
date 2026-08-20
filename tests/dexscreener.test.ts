import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DexScreenerFetchError,
  DexScreenerParseError,
  fetchMarketSnapshotByMint,
  parseDexScreenerTokenPairs,
} from "../src/providers/dexscreener";

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALID_FIXTURE = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, "fixtures/dexscreener-token-pairs.json"), "utf8"),
) as unknown;
const MINT = "SoMint1111111111111111111111111111111111111";
const CAPTURED_AT = Date.parse("2026-08-20T08:00:00.000Z");

describe("DexScreener provider", () => {
  it("parses a valid pair into MarketSnapshotInput", () => {
    const snapshot = parseDexScreenerTokenPairs(
      [
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0.00123",
          marketCap: 50000,
          liquidity: { usd: 12000 },
        },
      ],
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot).toEqual({
      price: 0.00123,
      capturedAt: CAPTURED_AT,
      marketCap: 50000,
      liquidityUsd: 12000,
    });
  });

  it("selects the highest liquidity pair among multiple candidates", () => {
    const snapshot = parseDexScreenerTokenPairs(VALID_FIXTURE, MINT, CAPTURED_AT);

    expect(snapshot).toEqual({
      price: 0.00123,
      capturedAt: CAPTURED_AT,
      marketCap: 50000,
      liquidityUsd: 12000,
    });
  });

  it("prefers baseToken mint match when liquidity is equal", () => {
    const snapshot = parseDexScreenerTokenPairs(
      [
        {
          chainId: "solana",
          baseToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          quoteToken: { address: MINT, symbol: "NEW" },
          priceUsd: "0.002",
          marketCap: 1000,
          liquidity: { usd: 5000 },
        },
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0.003",
          marketCap: 2000,
          liquidity: { usd: 5000 },
        },
      ],
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot.price).toBe(0.003);
    expect(snapshot.marketCap).toBe(2000);
    expect(snapshot.liquidityUsd).toBe(5000);
  });

  it("skips invalid prices", () => {
    const snapshot = parseDexScreenerTokenPairs(
      [
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0",
          marketCap: 1,
          liquidity: { usd: 99999 },
        },
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "-1",
          marketCap: 1,
          liquidity: { usd: 99998 },
        },
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0.42",
          marketCap: 4200,
          liquidity: { usd: 100 },
        },
      ],
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot.price).toBe(0.42);
    expect(snapshot.liquidityUsd).toBe(100);
  });

  it("skips wrong chain pairs", () => {
    const snapshot = parseDexScreenerTokenPairs(
      [
        {
          chainId: "ethereum",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: { address: "0xQuote", symbol: "WETH" },
          priceUsd: "9.99",
          marketCap: 999999,
          liquidity: { usd: 999999 },
        },
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0.01",
          marketCap: 100,
          liquidity: { usd: 50 },
        },
      ],
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot.price).toBe(0.01);
    expect(snapshot.liquidityUsd).toBe(50);
  });

  it("rejects empty usable pairs", () => {
    expect(() => parseDexScreenerTokenPairs([], MINT, CAPTURED_AT))
      .toThrow(DexScreenerParseError);

    expect(() => parseDexScreenerTokenPairs(
      [
        {
          chainId: "ethereum",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: { address: "0xQuote", symbol: "WETH" },
          priceUsd: "1",
          liquidity: { usd: 1000 },
        },
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0",
          liquidity: { usd: 1000 },
        },
      ],
      MINT,
      CAPTURED_AT,
    )).toThrow(DexScreenerParseError);
  });

  it("rejects invalid response shapes", () => {
    expect(() => parseDexScreenerTokenPairs(null, MINT, CAPTURED_AT))
      .toThrow(DexScreenerParseError);
    expect(() => parseDexScreenerTokenPairs({ pairs: "nope" }, MINT, CAPTURED_AT))
      .toThrow(DexScreenerParseError);
  });

  it("accepts wrapped { pairs } responses", () => {
    const snapshot = parseDexScreenerTokenPairs(
      { pairs: VALID_FIXTURE },
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot.price).toBe(0.00123);
    expect(snapshot.liquidityUsd).toBe(12000);
  });

  it("falls back to fdv when marketCap is missing", () => {
    const snapshot = parseDexScreenerTokenPairs(
      [
        {
          chainId: "solana",
          baseToken: { address: MINT, symbol: "NEW" },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: "0.5",
          fdv: 7777,
          liquidity: { usd: 200 },
        },
      ],
      MINT,
      CAPTURED_AT,
    );

    expect(snapshot.marketCap).toBe(7777);
  });

  it("fetchMarketSnapshotByMint uses an injected fetch implementation", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(VALID_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const snapshot = await fetchMarketSnapshotByMint(MINT, {
      fetchImpl,
      capturedAt: CAPTURED_AT,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.dexscreener.com/tokens/v1/solana/${MINT}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
        }),
      }),
    );
    expect(snapshot).toEqual({
      price: 0.00123,
      capturedAt: CAPTURED_AT,
      marketCap: 50000,
      liquidityUsd: 12000,
    });
  });

  it("surfaces HTTP 429 as fetch errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));

    await expect(fetchMarketSnapshotByMint(MINT, { fetchImpl })).rejects.toMatchObject({
      name: "DexScreenerFetchError",
      status: 429,
    });
    await expect(fetchMarketSnapshotByMint(MINT, { fetchImpl })).rejects.toBeInstanceOf(
      DexScreenerFetchError,
    );
  });

  it("surfaces invalid JSON as parse errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(fetchMarketSnapshotByMint(MINT, { fetchImpl })).rejects.toBeInstanceOf(
      DexScreenerParseError,
    );
  });
});
