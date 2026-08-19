import type { Client, Row } from "@libsql/client";
import { num, numOrNull, str, strOrNull } from "../map";

export type WatermarkRow = {
  provider: string;
  capability: string;
  coverageThroughSourceAt: number | null;
  newestSeenSourceAt: number | null;
  lastEventKey: string | null;
  lastSuccessfulRunAt: number | null;
  updatedAt: number;
};

export type UpdateWatermarkInput = {
  provider: string;
  capability: string;
  coverageThroughSourceAt?: number | null;
  newestSeenSourceAt?: number | null;
  lastEventKey?: string | null;
  lastSuccessfulRunAt?: number | null;
  updatedAt?: number;
};

export function mapWatermarkRow(row: Row): WatermarkRow {
  return {
    provider: str(row.provider),
    capability: str(row.capability),
    coverageThroughSourceAt: numOrNull(row.coverage_through_source_at),
    newestSeenSourceAt: numOrNull(row.newest_seen_source_at),
    lastEventKey: strOrNull(row.last_event_key),
    lastSuccessfulRunAt: numOrNull(row.last_successful_run_at),
    updatedAt: num(row.updated_at),
  };
}

export async function getWatermark(
  client: Client,
  provider: string,
  capability: string,
): Promise<WatermarkRow | null> {
  const result = await client.execute({
    sql: `
      SELECT * FROM discovery_watermarks
      WHERE provider = ? AND capability = ?
    `,
    args: [provider, capability],
  });
  const row = result.rows[0];
  return row ? mapWatermarkRow(row) : null;
}

export async function updateWatermark(
  client: Client,
  input: UpdateWatermarkInput,
): Promise<WatermarkRow> {
  const updatedAt = input.updatedAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO discovery_watermarks (
        provider,
        capability,
        coverage_through_source_at,
        newest_seen_source_at,
        last_event_key,
        last_successful_run_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, capability) DO UPDATE SET
        coverage_through_source_at = excluded.coverage_through_source_at,
        newest_seen_source_at = excluded.newest_seen_source_at,
        last_event_key = excluded.last_event_key,
        last_successful_run_at = excluded.last_successful_run_at,
        updated_at = excluded.updated_at
      RETURNING *
    `,
    args: [
      input.provider,
      input.capability,
      input.coverageThroughSourceAt ?? null,
      input.newestSeenSourceAt ?? null,
      input.lastEventKey ?? null,
      input.lastSuccessfulRunAt ?? null,
      updatedAt,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to update watermark");
  }
  return mapWatermarkRow(row);
}
