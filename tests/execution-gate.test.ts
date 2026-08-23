import { describe, expect, it, vi } from "vitest";
import { validateJupiterExecution } from "../src/push/executionGate";

const MINT = "SoMintExecGate11111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";

function quoteResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validateJupiterExecution status split", () => {
  it("returns EXECUTION_PASS when buy and sell routes are valid", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("instructionVersion=V2");
      expect(url).not.toContain("restrictIntermediateTokens=false");
      return quoteResponse({
        outAmount: "1000",
        routePlan: [{ swapInfo: { label: "test" } }],
      });
    });

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_PASS");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.buyOutAmount).toBe("1000");
    expect(result.sellOutAmount).toBe("1000");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const buyUrl = String(fetchFn.mock.calls[0]?.[0]);
    expect(buyUrl).toContain(`inputMint=${SOL}`);
    expect(buyUrl).toContain(`outputMint=${MINT}`);
    expect(buyUrl).toContain("amount=10000000");
  });

  it("returns EXECUTION_FAIL when buy route is missing", async () => {
    const fetchFn = vi.fn(async () =>
      quoteResponse({ outAmount: "0", routePlan: [] }),
    );

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_FAIL");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("EXECUTION_FAIL_NO_BUY_ROUTE");
  });

  it("returns EXECUTION_FAIL when Jupiter reports token not tradable", async () => {
    const fetchFn = vi.fn(async () =>
      quoteResponse(
        {
          error: `The token ${MINT} is not tradable`,
          errorCode: "TOKEN_NOT_TRADABLE",
        },
        400,
      ),
    );

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_FAIL");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("EXECUTION_FAIL_TOKEN_NOT_TRADABLE");
  });

  it("returns EXECUTION_UNKNOWN on Jupiter provider HTTP errors", async () => {
    const fetchFn = vi.fn(async () =>
      quoteResponse({ error: "boom", errorCode: "INTERNAL" }, 503),
    );

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_UNKNOWN");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(
      /^EXECUTION_UNKNOWN_PROVIDER:Jupiter quote HTTP 503/,
    );
  });

  it("returns EXECUTION_UNKNOWN on free-tier unsupported parameter errors", async () => {
    const fetchFn = vi.fn(async () =>
      quoteResponse(
        {
          error:
            "Setting restrict_intermediate_tokens to false is not supported for free tier users",
          errorCode: "NOT_SUPPORTED",
        },
        400,
      ),
    );

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_UNKNOWN");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("NOT_SUPPORTED");
  });

  it("returns EXECUTION_UNKNOWN on timeout / thrown provider errors", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("REQUEST_TIMEOUT");
    });

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_UNKNOWN");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("EXECUTION_UNKNOWN_PROVIDER:REQUEST_TIMEOUT");
  });
});
