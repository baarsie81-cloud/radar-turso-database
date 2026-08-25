import type { Client } from "@libsql/client";
import { createTursoClient } from "../../db/client";
import { getPushSubscriptions } from "../../db/repositories/push";
import { evaluateRadar24 } from "../../decisions/engine";
import { createWebPushSender } from "../../push/webpush";
import type { PushPayload } from "../../push/types";

const BASE_CHAIN = "BASE";
const MIN_PLUS10_LIQUIDITY_USD = 15_000;
const MAX_SIGNAL_AGE_MS = 15 * 60_000;

type Row = {
  id: number;
  symbol: string | null;
  poolAddress: string;
  entryPrice: number;
  initialCapturedAt: number;
  plus5CapturedAt: number;
  plus5Price: number;
  plus10CapturedAt: number;
  plus10Price: number;
  plus10LiquidityUsd: number | null;
};

async function ensureDeliveryTable(client: Client): Promise<void> {
  await client.execute(`CREATE TABLE IF NOT EXISTS base_radar_test_push_deliveries (
    case_id INTEGER PRIMARY KEY,
    sent_at INTEGER NOT NULL
  )`);
}

async function listCandidates(client: Client): Promise<Row[]> {
  const result = await client.execute({
    sql: `
      SELECT
        c.id,
        c.symbol,
        c.pool_address,
        c.entry_price,
        i.captured_at AS initial_captured_at,
        p5.captured_at AS plus5_captured_at,
        p5.price AS plus5_price,
        p10.captured_at AS plus10_captured_at,
        p10.price AS plus10_price,
        p10.liquidity_usd AS plus10_liquidity_usd
      FROM survivor_research_cases_v2 c
      INNER JOIN survivor_research_snapshots_v2 i
        ON i.case_id = c.id AND i.stage = 'INITIAL'
      INNER JOIN survivor_research_snapshots_v2 p5
        ON p5.case_id = c.id AND p5.stage = 'PLUS_5'
      INNER JOIN survivor_research_snapshots_v2 p10
        ON p10.case_id = c.id AND p10.stage = 'PLUS_10'
      WHERE c.chain = ?
        AND c.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM base_radar_test_push_deliveries d
          WHERE d.case_id = c.id
        )
      ORDER BY p10.captured_at ASC, c.id ASC
      LIMIT 50
    `,
    args: [BASE_CHAIN],
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    symbol: row.symbol == null ? null : String(row.symbol),
    poolAddress: String(row.pool_address),
    entryPrice: Number(row.entry_price),
    initialCapturedAt: Number(row.initial_captured_at),
    plus5CapturedAt: Number(row.plus5_captured_at),
    plus5Price: Number(row.plus5_price),
    plus10CapturedAt: Number(row.plus10_captured_at),
    plus10Price: Number(row.plus10_price),
    plus10LiquidityUsd:
      row.plus10_liquidity_usd == null ? null : Number(row.plus10_liquidity_usd),
  }));
}

function buildDecision(row: Row) {
  return evaluateRadar24({
    tokenCaseId: row.id,
    decisionStage: "PLUS_10",
    decidedAt: row.plus10CapturedAt,
    radarVersion: "2.4-base-test",
    entry: {
      entryPrice: row.entryPrice,
      entryValid: Number.isFinite(row.entryPrice) && row.entryPrice > 0,
    },
    snapshots: {
      INITIAL: {
        stage: "INITIAL",
        capturedAt: row.initialCapturedAt,
        price: row.entryPrice,
        marketCap: null,
        liquidityUsd: null,
      },
      PLUS_5: {
        stage: "PLUS_5",
        capturedAt: row.plus5CapturedAt,
        price: row.plus5Price,
        marketCap: null,
        liquidityUsd: null,
      },
      PLUS_10: {
        stage: "PLUS_10",
        capturedAt: row.plus10CapturedAt,
        price: row.plus10Price,
        marketCap: null,
        liquidityUsd: row.plus10LiquidityUsd,
      },
    },
  });
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export async function runBaseRadarTestPush(): Promise<Record<string, unknown>> {
  const client = await createTursoClient();
  await ensureDeliveryTable(client);
  const rows = await listCandidates(client);
  const sendPush = createWebPushSender({
    getSubscriptions: () => getPushSubscriptions(client),
  });
  const now = Date.now();

  let delivered = 0;
  let rejected = 0;
  let liquidityBlocked = 0;
  let stale = 0;
  const errors: Array<{ caseId: number; message: string }> = [];

  try {
    for (const row of rows) {
      const decision = buildDecision(row);
      if (decision.decisionStatus !== "PASS") {
        rejected += 1;
        continue;
      }

      if (
        row.plus10LiquidityUsd == null
        || !Number.isFinite(row.plus10LiquidityUsd)
        || row.plus10LiquidityUsd < MIN_PLUS10_LIQUIDITY_USD
      ) {
        liquidityBlocked += 1;
        continue;
      }

      if (now - row.plus10CapturedAt > MAX_SIGNAL_AGE_MS) {
        stale += 1;
        continue;
      }

      const claim = await client.execute({
        sql: `INSERT OR IGNORE INTO base_radar_test_push_deliveries (case_id, sent_at)
              VALUES (?, ?)`,
        args: [row.id, now],
      });
      if (claim.rowsAffected === 0) continue;

      const payload: PushPayload = {
        title: "🧪 Base Radar TEST",
        body: `${row.symbol ?? "BASE token"} | +10 ${decision.plus10RoiPct?.toFixed(1) ?? "?"}% | momentum ${decision.momentum5To10Pct?.toFixed(1) ?? "?"}% | liq ${formatUsd(row.plus10LiquidityUsd)}`,
        url: "/api/research/survivor",
        mint: row.poolAddress,
        decisionId: row.id,
        tokenCaseId: row.id,
        decisionStatus: "PASS",
        decisionStage: "PLUS_10",
        plus10RoiPct: decision.plus10RoiPct,
        momentum5To10Pct: decision.momentum5To10Pct,
        symbol: row.symbol,
      };

      try {
        await sendPush(payload);
        delivered += 1;
        console.info("[base-radar] TEST push sent", {
          caseId: row.id,
          symbol: row.symbol,
          plus10RoiPct: decision.plus10RoiPct,
          momentum5To10Pct: decision.momentum5To10Pct,
          plus10LiquidityUsd: row.plus10LiquidityUsd,
        });
      } catch (error) {
        await client.execute({
          sql: "DELETE FROM base_radar_test_push_deliveries WHERE case_id = ?",
          args: [row.id],
        });
        errors.push({
          caseId: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      enabled: true,
      chain: BASE_CHAIN,
      candidates: rows.length,
      delivered,
      rejected,
      liquidityBlocked,
      stale,
      minPlus10LiquidityUsd: MIN_PLUS10_LIQUIDITY_USD,
      errors,
    };
    console.info("[base-radar] cron finished", summary);
    return summary;
  } finally {
    client.close();
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleBaseRadarTestCron(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runBaseRadarTestPush();
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[base-radar] cron failed", { message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
