import { runBaseRadar } from "../../../../src/research/survivor/baseRadar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM = "base-radar-smoke-20260825";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  try {
    return Response.json({ ok: true, ...(await runBaseRadar()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
