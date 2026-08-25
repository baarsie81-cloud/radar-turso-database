export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenAddress(resource: any): string | null {
  const id = resource?.relationships?.base_token?.data?.id;
  if (typeof id !== "string") return null;
  const address = id.replace(/^base_/, "");
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address : null;
}

function dexId(resource: any): string | null {
  const id = resource?.relationships?.dex?.data?.id;
  return typeof id === "string" ? id.toLowerCase() : null;
}

export async function GET(): Promise<Response> {
  const response = await fetch("https://api.geckoterminal.com/api/v2/networks/base/new_pools?page=1", {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return Response.json({ ok: false, status: response.status }, { status: 502 });
  const json = await response.json();
  const now = Date.now();
  const rows = Array.isArray(json?.data) ? json.data : [];
  const mapped = rows.map((r: any) => {
    const a = r?.attributes ?? {};
    const createdAt = Date.parse(String(a.pool_created_at ?? ""));
    const liq = asNumber(a.reserve_in_usd);
    const vol = asNumber(a.volume_usd?.h1) ?? 0;
    const buys = Number(a.transactions?.h1?.buys ?? 0) || 0;
    const sells = Number(a.transactions?.h1?.sells ?? 0) || 0;
    const dex = dexId(r);
    return {
      symbol: typeof a.name === "string" ? a.name.split("/")[0]?.trim() : null,
      ageMin: Number.isFinite(createdAt) ? (now - createdAt) / 60000 : null,
      liq,
      vol,
      tx: buys + sells,
      token: tokenAddress(r),
      dex,
      uniswap: dex?.includes("uniswap") ?? false,
    };
  });
  const age15 = mapped.filter((r: any) => r.ageMin != null && r.ageMin >= 0 && r.ageMin <= 15);
  const liq10k = age15.filter((r: any) => r.liq != null && r.liq >= 10000);
  const activity = liq10k.filter((r: any) => r.vol > 0 && r.tx > 0);
  const tokenOk = activity.filter((r: any) => r.token != null);
  const uniswap = tokenOk.filter((r: any) => r.uniswap);
  return Response.json({
    ok: true,
    total: mapped.length,
    age15: age15.length,
    liq10k: liq10k.length,
    activity: activity.length,
    tokenAddress: tokenOk.length,
    uniswap: uniswap.length,
    candidates: tokenOk.slice(0, 12),
  });
}
