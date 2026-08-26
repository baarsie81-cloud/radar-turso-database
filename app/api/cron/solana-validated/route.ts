import { runSolanaValidatedRadar } from "../../../../src/solanaValidated/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSolanaValidatedRadar();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[solana-validated] cron failed", { message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
