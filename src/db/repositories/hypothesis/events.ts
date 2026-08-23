import type { Client, Row } from "@libsql/client";
import type { HypothesisEventType } from "../../../domain/hypothesis";
import { num, str } from "../../map";

export type InsertHypothesisEventInput = {
  hypothesisAssetId: number;
  eventType: HypothesisEventType;
  payloadJson?: string;
  createdAt?: number;
};

export type HypothesisEventRow = {
  id: number;
  hypothesisAssetId: number;
  eventType: HypothesisEventType;
  payloadJson: string;
  createdAt: number;
};

export function mapHypothesisEventRow(row: Row): HypothesisEventRow {
  return {
    id: num(row.id),
    hypothesisAssetId: num(row.hypothesis_asset_id),
    eventType: str(row.event_type) as HypothesisEventType,
    payloadJson: str(row.payload_json),
    createdAt: num(row.created_at),
  };
}

export async function insertHypothesisEvent(
  client: Client,
  input: InsertHypothesisEventInput,
): Promise<HypothesisEventRow> {
  const createdAt = input.createdAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO hypothesis_events (
        hypothesis_asset_id, event_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?)
      RETURNING *
    `,
    args: [
      input.hypothesisAssetId,
      input.eventType,
      input.payloadJson ?? "{}",
      createdAt,
    ],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert hypothesis event");
  }
  return mapHypothesisEventRow(row);
}

export async function listHypothesisEvents(
  client: Client,
  hypothesisAssetId: number,
): Promise<HypothesisEventRow[]> {
  const result = await client.execute({
    sql: `
      SELECT * FROM hypothesis_events
      WHERE hypothesis_asset_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    args: [hypothesisAssetId],
  });
  return result.rows.map(mapHypothesisEventRow);
}

export async function getHypothesisEvent(
  client: Client,
  id: number,
): Promise<HypothesisEventRow | null> {
  const result = await client.execute({
    sql: "SELECT * FROM hypothesis_events WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? mapHypothesisEventRow(row) : null;
}
