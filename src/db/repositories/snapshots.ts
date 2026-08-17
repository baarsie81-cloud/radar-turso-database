import type { Client, Row } from "@libsql/client";
import type { SnapshotStage } from "../../domain/types";
import { num, numOrNull, str } from "../map";

export type UpsertSnapshotInput = {
  tokenCaseId: number;
  stage: SnapshotStage;
  capturedAt: number;
  price: number;
  roiPct?: number | null;
  marketCap?: number | null;
  liquidityUsd?: number | null;
};

export type SnapshotRow = {
  id: number;
  tokenCaseId: number;
  stage: SnapshotStage;
  capturedAt: number;
  price: number;
  roiPct: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
};

export function mapSnapshotRow(row: Row): SnapshotRow {
  return {
    id: num(row.id),
    tokenCaseId: num(row.token_case_id),
    stage: str(row.stage) as SnapshotStage,
    capturedAt: num(row.captured_at),
    price: num(row.price),
    roiPct: numOrNull(row.roi_pct),
    marketCap: numOrNull(row.market_cap),
    liquidityUsd: numOrNull(row.liquidity_usd),
  };
}

export async function upsertSnapshot(
  client: Client,
  input: UpsertSnapshotInput,
): Promise<SnapshotRow> {
  const result = await client.execute({
    sql: `
      INSERT INTO snapshots (
        token_case_id, stage, captured_at, price, roi_pct, market_cap, liquidity_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_case_id, stage) DO UPDATE SET
        captured_at = excluded.captured_at,
        price = excluded.price,
        roi_pct = excluded.roi_pct,
        market_cap = excluded.market_cap,
        liquidity_usd = excluded.liquidity_usd
      RETURNING *
    `,
    args: [
      input.tokenCaseId,
      input.stage,
      input.capturedAt,
      input.price,
      input.roiPct ?? null,
      input.marketCap ?? null,
      input.liquidityUsd ?? null,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to upsert snapshot");
  }
  return mapSnapshotRow(row);
}

export async function listSnapshotsByCase(
  client: Client,
  tokenCaseId: number,
): Promise<SnapshotRow[]> {
  const result = await client.execute({
    sql: "SELECT * FROM snapshots WHERE token_case_id = ? ORDER BY id",
    args: [tokenCaseId],
  });
  return result.rows.map(mapSnapshotRow);
}
