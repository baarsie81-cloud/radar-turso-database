const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_TEST_LAMPORTS = 10_000_000; // 0.01 SOL
const DEFAULT_SLIPPAGE_BPS = 100;
const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";

export type ExecutionGateResult = {
  ok: boolean;
  reason: string | null;
  buyOutAmount: string | null;
  sellOutAmount: string | null;
  roundTripLossPct: number | null;
};

export type ExecutionGateDeps = {
  fetchFn?: typeof fetch;
  testLamports?: number;
  slippageBps?: number;
};

type JupiterQuote = {
  outAmount?: string;
  routePlan?: unknown[];
  error?: string;
};

function validQuote(quote: JupiterQuote): quote is JupiterQuote & { outAmount: string } {
  return typeof quote.outAmount === "string"
    && quote.outAmount.length > 0
    && Number(quote.outAmount) > 0
    && Array.isArray(quote.routePlan)
    && quote.routePlan.length > 0;
}

async function fetchQuote(
  fetchFn: typeof fetch,
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
): Promise<JupiterQuote> {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", String(slippageBps));
  url.searchParams.set("instructionVersion", "V2");
  url.searchParams.set("restrictIntermediateTokens", "false");

  const response = await fetchFn(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Jupiter quote HTTP ${response.status}`);
  }

  return response.json() as Promise<JupiterQuote>;
}

/**
 * Fail-closed executable-route check for an otherwise valid PLUS_10 PASS.
 * Simulates 0.01 SOL -> token and immediately the quoted token amount -> SOL.
 * It never submits a swap and does not apply a round-trip-loss threshold yet.
 */
export async function validateJupiterExecution(
  mint: string,
  deps: ExecutionGateDeps = {},
): Promise<ExecutionGateResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const testLamports = deps.testLamports ?? DEFAULT_TEST_LAMPORTS;
  const slippageBps = deps.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  try {
    const buy = await fetchQuote(
      fetchFn,
      SOL_MINT,
      mint,
      String(testLamports),
      slippageBps,
    );

    if (!validQuote(buy)) {
      return {
        ok: false,
        reason: "EXECUTION_FAIL_NO_BUY_ROUTE",
        buyOutAmount: buy.outAmount ?? null,
        sellOutAmount: null,
        roundTripLossPct: null,
      };
    }

    const sell = await fetchQuote(
      fetchFn,
      mint,
      SOL_MINT,
      buy.outAmount,
      slippageBps,
    );

    if (!validQuote(sell)) {
      return {
        ok: false,
        reason: "EXECUTION_FAIL_NO_SELL_ROUTE",
        buyOutAmount: buy.outAmount,
        sellOutAmount: sell.outAmount ?? null,
        roundTripLossPct: null,
      };
    }

    const sellLamports = Number(sell.outAmount);
    const roundTripLossPct = ((testLamports - sellLamports) / testLamports) * 100;

    return {
      ok: true,
      reason: null,
      buyOutAmount: buy.outAmount,
      sellOutAmount: sell.outAmount,
      roundTripLossPct: Number.isFinite(roundTripLossPct) ? roundTripLossPct : null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `EXECUTION_FAIL_PROVIDER:${error instanceof Error ? error.message : String(error)}`,
      buyOutAmount: null,
      sellOutAmount: null,
      roundTripLossPct: null,
    };
  }
}
