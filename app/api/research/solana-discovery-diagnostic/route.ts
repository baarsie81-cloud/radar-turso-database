export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  const now = Date.now();
  const pages = [] as any[];
  for (const page of [10, 15, 20, 25, 30]) {
    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=${page}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const json = await response.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    const mapped = rows.map((r: any) => {
      const a = r?.attributes ?? {};
      const createdAt = Date.parse(String(a.pool_created_at ?? ""));
      const ageMin = Number.isFinite(createdAt) ? (now - createdAt) / 60000 : null;
      const liq = num(a.reserve_in_usd);
      const vol = num(a.volume_usd?.h1) ?? 0;
      const buys = Number(a.transactions?.h1?.buys ?? 0) || 0;
      const sells = Number(a.transactions?.h1?.sells ?? 0) || 0;
      return { ageMin, liq, vol, tx: buys + sells, name: a.name ?? null };
    });
    pages.push({
      page,
      count: mapped.length,
      youngestMin: Math.min(...mapped.filter((x:any)=>x.ageMin!=null).map((x:any)=>x.ageMin), Infinity),
      oldestMin: Math.max(...mapped.filter((x:any)=>x.ageMin!=null).map((x:any)=>x.ageMin), -Infinity),
      age15to60: mapped.filter((x:any)=>x.ageMin!=null&&x.ageMin>=15&&x.ageMin<=60).length,
      age15to60Liq25k: mapped.filter((x:any)=>x.ageMin!=null&&x.ageMin>=15&&x.ageMin<=60&&(x.liq??0)>=25000).length,
      age15to60Liq25kActivity: mapped.filter((x:any)=>x.ageMin!=null&&x.ageMin>=15&&x.ageMin<=60&&(x.liq??0)>=25000&&x.vol>0&&x.tx>0).length,
      sample: mapped.slice(0,5),
    });
  }
  return Response.json({ ok: true, pages });
}
