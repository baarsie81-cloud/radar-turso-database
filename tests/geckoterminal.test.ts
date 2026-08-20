import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  fetchNewSolanaPools,
  GeckoTerminalFetchError,
  GeckoTerminalParseError,
  parseGeckoTerminalNewPoolsResponse,
} from "../src/providers/geckoterminal";

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALID_FIXTURE = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, "fixtures/geckoterminal-new-pools.json"), "utf8"),
) as unknown;
const FETCHED_AT = Date.parse("2026-08-19T10:00:00.000Z");

describe("GeckoTerminal provider", () => {
  it("parses a valid new pools response", () => {
    const tokens = parseGeckoTerminalNewPoolsResponse(VALID_FIXTURE, FETCHED_AT);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({
      mint: "SoMint1111111111111111111111111111111111111",
      symbol: "NEW",
      name: "New Token",
      firstSeenAt: FETCHED_AT,
      price: 0.00123,
      marketCap: 50000,
      liquidityUsd: 12000,
      sourceEventId: "solana_pool_1",
    });
  });

  it("rejects invalid response shapes", () => {
    expect(() => parseGeckoTerminalNewPoolsResponse(null, FETCHED_AT))
      .toThrow(GeckoTerminalParseError);
    expect(() => parseGeckoTerminalNewPoolsResponse({ data: "nope" }, FETCHED_AT))
      .toThrow(GeckoTerminalParseError);
  });

  it("skips pools without a valid base token or price", () => {
    const tokens = parseGeckoTerminalNewPoolsResponse({
      data: [
        {
          id: "pool-no-token",
          attributes: {
            address: "PoolMissing",
            base_token_price_usd: "1.5",
          },
          relationships: {
            base_token: { data: { id: "missing-token" } },
          },
        },
        {
          id: "pool-no-price",
          attributes: {
            address: "PoolNoPrice",
            base_token_price_usd: "0",
          },
          relationships: {
            base_token: { data: { id: "solana_token_1" } },
          },
        },
      ],
      included: (VALID_FIXTURE as { included: unknown[] }).included,
    }, FETCHED_AT);

    expect(tokens).toEqual([]);
  });

  it("fetchNewSolanaPools uses an injected fetch implementation", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(VALID_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const tokens = await fetchNewSolanaPools({
      fetchImpl,
      fetchedAt: FETCHED_AT,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.mint).toBe("SoMint1111111111111111111111111111111111111");
  });

  it("surfaces HTTP failures as fetch errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));

    await expect(fetchNewSolanaPools({ fetchImpl })).rejects.toBeInstanceOf(
      GeckoTerminalFetchError,
    );
  });

  it("surfaces invalid JSON as parse errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(fetchNewSolanaPools({ fetchImpl })).rejects.toBeInstanceOf(
      GeckoTerminalParseError,
    );
  });
});
