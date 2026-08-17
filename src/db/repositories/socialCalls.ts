import type { Client, Row } from "@libsql/client";
import { bool01OrNull, num, numOrNull, str, strOrNull, to01 } from "../map";

export type StoreSocialCallInput = {
  source: string;
  externalId?: string | null;
  calledAt: number;
  mint?: string | null;
  tokenCaseId?: number | null;
  callPrice?: number | null;
  callMarketCap?: number | null;
  collapseBefore?: boolean | null;
  collapseAfter?: boolean | null;
  collapseWindowMinutes?: number | null;
  notesJson?: string | null;
  createdAt?: number;
};

export type SocialCallRow = {
  id: number;
  source: string;
  externalId: string | null;
  calledAt: number;
  mint: string | null;
  tokenCaseId: number | null;
  callPrice: number | null;
  callMarketCap: number | null;
  collapseBefore: boolean | null;
  collapseAfter: boolean | null;
  collapseWindowMinutes: number | null;
  notesJson: string | null;
  createdAt: number;
};

export function normalizeExternalId(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed/i.test(message);
}

export function mapSocialCallRow(row: Row): SocialCallRow {
  return {
    id: num(row.id),
    source: str(row.source),
    externalId: strOrNull(row.external_id),
    calledAt: num(row.called_at),
    mint: strOrNull(row.mint),
    tokenCaseId: numOrNull(row.token_case_id),
    callPrice: numOrNull(row.call_price),
    callMarketCap: numOrNull(row.call_market_cap),
    collapseBefore: bool01OrNull(row.collapse_before),
    collapseAfter: bool01OrNull(row.collapse_after),
    collapseWindowMinutes: numOrNull(row.collapse_window_minutes),
    notesJson: strOrNull(row.notes_json),
    createdAt: num(row.created_at),
  };
}

async function getSocialCallBySourceExternalId(
  client: Client,
  source: string,
  externalId: string,
): Promise<SocialCallRow | null> {
  const result = await client.execute({
    sql: "SELECT * FROM social_calls WHERE source = ? AND external_id = ?",
    args: [source, externalId],
  });
  const row = result.rows[0];
  return row ? mapSocialCallRow(row) : null;
}

export async function storeSocialCall(
  client: Client,
  input: StoreSocialCallInput,
): Promise<SocialCallRow> {
  const externalId = normalizeExternalId(input.externalId);
  const now = input.createdAt ?? Date.now();
  const args = [
    input.source,
    externalId,
    input.calledAt,
    input.mint ?? null,
    input.tokenCaseId ?? null,
    input.callPrice ?? null,
    input.callMarketCap ?? null,
    to01(input.collapseBefore),
    to01(input.collapseAfter),
    input.collapseWindowMinutes ?? null,
    input.notesJson ?? null,
    now,
  ];

  const insertSql =
    externalId == null
      ? `
        INSERT INTO social_calls (
          source, external_id, called_at, mint, token_case_id, call_price, call_market_cap,
          collapse_before, collapse_after, collapse_window_minutes, notes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `
      : `
        INSERT INTO social_calls (
          source, external_id, called_at, mint, token_case_id, call_price, call_market_cap,
          collapse_before, collapse_after, collapse_window_minutes, notes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, external_id) WHERE external_id IS NOT NULL DO NOTHING
        RETURNING *
      `;

  try {
    const result = await client.execute({ sql: insertSql, args });
    const row = result.rows[0];
    if (row) {
      return mapSocialCallRow(row);
    }
  } catch (error) {
    if (externalId == null || !isUniqueConstraintError(error)) {
      throw error;
    }
  }

  if (externalId != null) {
    const existing = await getSocialCallBySourceExternalId(client, input.source, externalId);
    if (existing) {
      return existing;
    }
  }

  throw new Error("Failed to store social call");
}

export async function listSocialCallsByCase(
  client: Client,
  tokenCaseId: number,
): Promise<SocialCallRow[]> {
  const result = await client.execute({
    sql: "SELECT * FROM social_calls WHERE token_case_id = ? ORDER BY called_at, id",
    args: [tokenCaseId],
  });
  return result.rows.map(mapSocialCallRow);
}
