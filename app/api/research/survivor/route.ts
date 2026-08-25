import { createTursoClient } from "../../../../src/db/client";
import { evaluateSurvivorObservation } from "../../../../src/research/survivor/evaluate";
import type { SnapshotStage } from "../../../../src/domain/types";
import type { SurvivorObservationInput, SurvivorChain, SurvivalHorizonMinutes } from "../../../../src/research/survivor/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type TableSet = {
  cases: string;
  snapshots: string;
  checks: string;
  cohort: "LEGACY" | "ACTIVE";
};

async function readTableSet(tableSet: TableSet) {
  const client = await createTursoClient();
  const casesResult = await client.execute(
    `SELECT id, chain, pool_address, symbol, launched_at, first_seen_at, entry_price,
            entry_liquidity_usd, status
       FROM ${tableSet.cases}
      ORDER BY chain, id`,
  );
  const snapshotsResult = await client.execute(
    `SELECT case_id, stage, captured_at, price, liquidity_usd
       FROM ${tableSet.snapshots}
      ORDER BY case_id, captured_at`,
  );
  const checksResult = await client.execute(
    `SELECT case_id, horizon_minutes, captured_at, tradeable, liquidity_usd
       FROM ${tableSet.checks}
      ORDER BY case_id, horizon_minutes`,
  );

  const snapshotsByCase = new Map<number, any[]>();
  for (const row of snapshotsResult.rows) {
    const caseId = Number(row.case_id);
    const rows = snapshotsByCase.get(caseId) ?? [];
    rows.push({
      stage: String(row.stage) as SnapshotStage,
      capturedAt: Number(row.captured_at),
      price: Number(row.price),
      liquidityUsd: num(row.liquidity_usd),
    });
    snapshotsByCase.set(caseId, rows);
  }

  const checksByCase = new Map<number, any[]>();
  for (const row of checksResult.rows) {
    const caseId = Number(row.case_id);
    const rows = checksByCase.get(caseId) ?? [];
    rows.push({
      horizonMinutes: Number(row.horizon_minutes) as SurvivalHorizonMinutes,
      capturedAt: Number(row.captured_at),
      tradeable: Number(row.tradeable) === 1,
      liquidityUsd: num(row.liquidity_usd),
    });
    checksByCase.set(caseId, rows);
  }

  return casesResult.rows.map((row) => {
    const id = Number(row.id);
    const input: SurvivorObservationInput = {
      chain: String(row.chain) as SurvivorChain,
      assetId: String(row.pool_address),
      symbol: row.symbol == null ? null : String(row.symbol),
      launchedAt: Number(row.launched_at),
      entryPrice: Number(row.entry_price),
      entryValid: true,
      snapshots: snapshotsByCase.get(id) ?? [],
      survivalChecks: checksByCase.get(id) ?? [],
    };
    const horizons = ([60, 360, 1440] as const).map((horizon) => {
      const result = evaluateSurvivorObservation(input, horizon);
      return {
        horizonMinutes: horizon,
        survivalStatus: result.survivalStatus,
        survivalLiquidityUsd: result.survivalLiquidityUsd,
        roiAtHorizonPct: result.roiAtHorizonPct,
      };
    });
    const decision = evaluateSurvivorObservation(input, 60).radarDecision;
    return {
      cohort: tableSet.cohort,
      id,
      chain: input.chain,
      symbol: input.symbol,
      poolAddress: input.assetId,
      firstSeenAt: Number(row.first_seen_at),
      entryPrice: input.entryPrice,
      entryLiquidityUsd: num(row.entry_liquidity_usd),
      status: String(row.status),
      snapshots: input.snapshots,
      radar: {
        status: decision.decisionStatus,
        rejectReason: decision.rejectReason,
        plus5RoiPct: decision.plus5RoiPct,
        plus10RoiPct: decision.plus10RoiPct,
        momentum5To10Pct: decision.momentum5To10Pct,
      },
      horizons,
    };
  });
}

export async function GET(): Promise<Response> {
  const legacy = await readTableSet({
    cases: "survivor_research_cases",
    snapshots: "survivor_research_snapshots",
    checks: "survivor_research_checks",
    cohort: "LEGACY",
  });

  let active: Awaited<ReturnType<typeof readTableSet>> = [];
  try {
    active = await readTableSet({
      cases: "survivor_research_cases_v2",
      snapshots: "survivor_research_snapshots_v2",
      checks: "survivor_research_checks_v2",
      cohort: "ACTIVE",
    });
  } catch {
    active = [];
  }

  const cases = [...legacy, ...active];
  const chains: SurvivorChain[] = ["SOLANA", "BNB", "BASE", "MONAD", "ARBITRUM"];
  const summary = chains.map((chain) => {
    const rows = cases.filter((row) => row.chain === chain);
    const pass = rows.filter((row) => row.radar.status === "PASS");
    const oneHour = rows.map((row) => row.horizons[0]);
    return {
      chain,
      cohort: rows[0]?.cohort ?? (chain === "SOLANA" || chain === "BNB" ? "LEGACY" : "ACTIVE"),
      cases: rows.length,
      withPlus10: rows.filter((row) => row.snapshots.some((s: any) => s.stage === "PLUS_10")).length,
      radarPass: pass.length,
      survived1h: oneHour.filter((h) => h.survivalStatus === "SURVIVED").length,
      failed1h: oneHour.filter((h) => h.survivalStatus === "FAILED").length,
      unknown1h: oneHour.filter((h) => h.survivalStatus === "UNKNOWN").length,
    };
  });

  return Response.json({
    ok: true,
    activeChains: ["BASE", "MONAD", "ARBITRUM"],
    legacyChains: ["SOLANA", "BNB"],
    summary,
    cases,
  });
}
