import { describe, expect, it, vi } from "vitest";
import { validateJupiterExecution } from "../src/push/executionGate";

const MINT = "SoMintExecGate11111111111111111111111111";

function quoteResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validateJupiterExecution status split", () => {
  it("returns EXECUTION_PASS when buy and sell routes are valid", async () => {
    const fetchFn = vi.fn(async () =>
      quoteResponse({
        outAmount: "1000",
        routePlan: [{ swapInfo: { label: "test" } }],
      }),
    );

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_PASS");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.buyOutAmount).toBe("1000");
    expect(result.sellOutAmount).toBe("1000");
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

  it("returns EXECUTION_UNKNOWN on Jupiter HTTP errors", async () => {
    const fetchFn = vi.fn(async () => quoteResponse({ error: "boom" }, 503));

    const result = await validateJupiterExecution(MINT, { fetchFn });
    expect(result.status).toBe("EXECUTION_UNKNOWN");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^EXECUTION_UNKNOWN_PROVIDER:Jupiter quote HTTP 503/);
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
