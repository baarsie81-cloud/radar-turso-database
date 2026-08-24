import webpush from "web-push";
import type { Client, Row } from "@libsql/client";
import { createTursoClient } from "../db/client";
import { getPushSubscriptions } from "../db/repositories/push";
import { validateJupiterExecution } from "../push/executionGate";
import { readVapidConfig } from "../push/webpush";

const MIN_PLUS5_ROI_PCT = 20;
const MAX_PLUS5_ROI_PCT = 250;
const MIN_LIQUIDITY_USD = 15_000;
const MAX_ROUND_TRIP_LOSS_PCT = 3;
const MAX_SIGNAL_AGE_MS = 12 * 60_000;

export type EarlyCandidate = {
  tokenCaseId: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  capturedAt: number;
  plus5RoiPct: number;
  liquidityUsd: number;
};

async function ensureEarlySchema(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS early_shadow_deliveries (
      token_case_id INTEGER PRIMARY KEY REFERENCES token_cases(id),
      sent_at INTEGER NOT NULL,
      plus5_roi_pct REAL NOT NULL,
      liquidity_usd REAL NOT NULL,
      round_trip_loss_pct REAL NOT NULL
    )
  `);
}

function toCandidate(row: Row): EarlyCandidate {
  return {
    tokenCaseId: Number(row.token_case_id),
    mint: String(row.mint),
    symbol: row.symbol == null ? null : String(row.symbol),
    name: row.name == null ? null : String(row.name),
    capturedAt: Number(row.captured_at),
    plus5RoiPct: Number(row.roi_pct),
    liquidityUsd: Number(row.liquidity_usd),
  };
}

async function listCandidates(client: Client, now: number): Promise<EarlyCandidate[]> {
  const result = await client.execute({
    sql: `
      SELECT
        tc.id AS token_case_id,
        tc.mint,
        tc.symbol,
        tc.name,
        s.captured_at,
        s.roi_pct,
        s.liquidity_usd
      FROM snapshots s
      INNER JOIN token_cases tc ON tc.id = s.token_case_id
      WHERE s.stage = 'PLUS_5'
        AND tc.case_status = 'OPEN'
        AND s.roi_pct >= ?
        AND s.roi_pct <= ?
        AND s.liquidity_usd >= ?
        AND s.captured_at >= ?
        AND NOT EXISTS (
          SELECT 1 FROM early_shadow_deliveries e
          WHERE e.token_case_id = tc.id
        )
      ORDER BY s.captured_at ASC
      LIMIT 25
    `,
    args: [
      MIN_PLUS5_ROI_PCT,
      MAX_PLUS5_ROI_PCT,
      MIN_LIQUIDITY_USD,
      now - MAX_SIGNAL_AGE_MS,
    ],
  });
  return result.rows.map(toCandidate);
}

async function sendEarlyPush(client: Client, candidate: EarlyCandidate, roundTripLossPct: number): Promise<void> {
  const vapid = readVapidConfig({
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  });
  if (!vapid) throw new Error("VAPID is not configured");

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const subscriptions = await getPushSubscriptions(client);
  if (subscriptions.length === 0) throw new Error("No push subscriptions configured");

  const coin = candidate.symbol ?? candidate.name ?? candidate.mint.slice(0, 8);
  const body = JSON.stringify({
    title: "⚡ Radar EARLY · Shadow",
    body: [
      `Coin: ${coin}`,
      `+5 ROI: ${candidate.plus5RoiPct.toFixed(1)}%`,
      `Liquidity: $${Math.round(candidate.liquidityUsd).toLocaleString("en-US")}`,
      `Round-trip loss: ${roundTripLossPct.toFixed(2)}%`,
      "Experimenteel vroeg signaal — nog geen V24 PASS.",
    ].join("\n"),
    url: `/cases/${candidate.tokenCaseId}`,
    mint: candidate.mint,
  });

  const errors: string[] = [];
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        { TTL: 60 * 30 },
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length === subscriptions.length) {
    throw new Error(`EARLY web push failed for all subscriptions: ${errors.join("; ")}`);
  }
}

export async function runEarlyShadow(client: Client): Promise<{
  candidates: number;
  delivered: number;
  blocked: number;
  unknown: number;
  errors: string[];
}> {
  await ensureEarlySchema(client);
  const now = Date.now();
  const candidates = await listCandidates(client, now);
  let delivered = 0;
  let blocked = 0;
  let unknown = 0;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const execution = await validateJupiterExecution(candidate.mint);
      if (execution.status === "EXECUTION_UNKNOWN") {
        unknown += 1;
        continue;
      }
      if (!execution.ok || execution.roundTripLossPct == null) {
        blocked += 1;
        continue;
      }
      if (execution.roundTripLossPct > MAX_ROUND_TRIP_LOSS_PCT) {
        blocked += 1;
        continue;
      }

      await sendEarlyPush(client, candidate, execution.roundTripLossPct);
      await client.execute({
        sql: `
          INSERT OR IGNORE INTO early_shadow_deliveries (
            token_case_id, sent_at, plus5_roi_pct, liquidity_usd, round_trip_loss_pct
          ) VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          candidate.tokenCaseId,
          Date.now(),
          candidate.plus5RoiPct,
          candidate.liquidityUsd,
          execution.roundTripLossPct,
        ],
      });
      delivered += 1;
    } catch (error) {
      errors.push(`case ${candidate.tokenCaseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { candidates: candidates.length, delivered, blocked, unknown, errors };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleEarlyCron(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.TURSO_DATABASE_URL) {
    return Response.json({ error: "TURSO_DATABASE_URL is required" }, { status: 500 });
  }

  const client = await createTursoClient();
  try {
    const summary = await runEarlyShadow(client);
    console.info("[early] cron finished", summary);
    return Response.json({ enabled: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[early] cron failed", { message });
    return Response.json({ enabled: true, error: message }, { status: 500 });
  } finally {
    client.close();
  }
}
