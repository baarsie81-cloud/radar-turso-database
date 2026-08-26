import { runSolanaValidatedRadar } from "../../../../src/solanaValidated/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await runSolanaValidatedRadar();
      return Response.json({ ok: true, ...result, retryAttempt: attempt });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[solana-validated] cron attempt failed", { attempt, message });
      if (!message.includes("GeckoTerminal 429") || attempt === 3) break;
      await sleep(4_000 * attempt);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return Response.json({ ok: false, error: message }, { status: 500 });
}
