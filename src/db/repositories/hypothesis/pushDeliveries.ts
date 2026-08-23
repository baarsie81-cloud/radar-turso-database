import type { Client, Row } from "@libsql/client";
import type { HypothesisPushEventType } from "../../../domain/hypothesis";
import { num, str } from "../../map";

export type CreateHypothesisPushDeliveryInput = {
  eventId: number;
  eventType: HypothesisPushEventType;
  sentAt?: number;
};

export type HypothesisPushDeliveryRow = {
  id: number;
  eventId: number;
  eventType: HypothesisPushEventType;
  sentAt: number;
};

export function mapHypothesisPushDeliveryRow(row: Row): HypothesisPushDeliveryRow {
  return {
    id: num(row.id),
    eventId: num(row.event_id),
    eventType: str(row.event_type) as HypothesisPushEventType,
    sentAt: num(row.sent_at),
  };
}

/**
 * Claim a hypothesis event for push delivery (dedupe by event_id).
 * Returns null when already delivered.
 */
export async function claimHypothesisPushDelivery(
  client: Client,
  input: CreateHypothesisPushDeliveryInput,
): Promise<HypothesisPushDeliveryRow | null> {
  const sentAt = input.sentAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO hypothesis_push_deliveries (event_id, event_type, sent_at)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
      RETURNING *
    `,
    args: [input.eventId, input.eventType, sentAt],
  });
  const row = result.rows[0];
  return row ? mapHypothesisPushDeliveryRow(row) : null;
}

export async function hasHypothesisPushDelivery(
  client: Client,
  eventId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 AS ok FROM hypothesis_push_deliveries WHERE event_id = ? LIMIT 1",
    args: [eventId],
  });
  return result.rows.length > 0;
}

/** Remove a claim so a failed send can be retried. */
export async function deleteHypothesisPushDelivery(
  client: Client,
  eventId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: `
      DELETE FROM hypothesis_push_deliveries
      WHERE event_id = ?
      RETURNING event_id
    `,
    args: [eventId],
  });
  return result.rows.length > 0;
}
