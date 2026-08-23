import type { Client, Row } from "@libsql/client";
import {
  HYPOTHESIS_SCORE_VERSION,
  type HypothesisStatus,
} from "../../../domain/hypothesis";
import { num, numOrNull, str, strOrNull } from "../../map";

export type CreateHypothesisAssetInput = {
  mint: string;
  tokenCaseId?: number | null;
  symbol?: string | null;
  name?: string | null;
  category?: string | null;
  status?: HypothesisStatus;
  hypothesisScore?: number;
  narrativeScore?: number;
  asymmetryScore?: number;
  catalystScore?: number;
  attentionScore?: number;
  liquidityScore?: number;
  rank?: number | null;
  narrativeSummary?: string | null;
  catalystSummary?: string | null;
  scoreVersion?: string;
  inputsJson?: string;
  activatedAt?: number | null;
  invalidatedAt?: number | null;
  enteredUniverseAt?: number | null;
  updatedAt?: number;
};

export type HypothesisAssetRow = {
  id: number;
  mint: string;
  tokenCaseId: number | null;
  symbol: string | null;
  name: string | null;
  category: string | null;
  status: HypothesisStatus;
  hypothesisScore: number;
  narrativeScore: number;
  asymmetryScore: number;
  catalystScore: number;
  attentionScore: number;
  liquidityScore: number;
  rank: number | null;
  narrativeSummary: string | null;
  catalystSummary: string | null;
  scoreVersion: string;
  inputsJson: string;
  activatedAt: number | null;
  invalidatedAt: number | null;
  enteredUniverseAt: number | null;
  updatedAt: number;
};

export function mapHypothesisAssetRow(row: Row): HypothesisAssetRow {
  return {
    id: num(row.id),
    mint: str(row.mint),
    tokenCaseId: numOrNull(row.token_case_id),
    symbol: strOrNull(row.symbol),
    name: strOrNull(row.name),
    category: strOrNull(row.category),
    status: str(row.status) as HypothesisStatus,
    hypothesisScore: num(row.hypothesis_score),
    narrativeScore: num(row.narrative_score),
    asymmetryScore: num(row.asymmetry_score),
    catalystScore: num(row.catalyst_score),
    attentionScore: num(row.attention_score),
    liquidityScore: num(row.liquidity_score),
    rank: numOrNull(row.rank),
    narrativeSummary: strOrNull(row.narrative_summary),
    catalystSummary: strOrNull(row.catalyst_summary),
    scoreVersion: str(row.score_version),
    inputsJson: str(row.inputs_json),
    activatedAt: numOrNull(row.activated_at),
    invalidatedAt: numOrNull(row.invalidated_at),
    enteredUniverseAt: numOrNull(row.entered_universe_at),
    updatedAt: num(row.updated_at),
  };
}

export async function createHypothesisAsset(
  client: Client,
  input: CreateHypothesisAssetInput,
): Promise<HypothesisAssetRow> {
  const updatedAt = input.updatedAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO hypothesis_assets (
        mint, token_case_id, symbol, name, category, status,
        hypothesis_score, narrative_score, asymmetry_score, catalyst_score,
        attention_score, liquidity_score, rank, narrative_summary, catalyst_summary,
        score_version, inputs_json, activated_at, invalidated_at, entered_universe_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    args: [
      input.mint,
      input.tokenCaseId ?? null,
      input.symbol ?? null,
      input.name ?? null,
      input.category ?? null,
      input.status ?? "WATCH",
      input.hypothesisScore ?? 0,
      input.narrativeScore ?? 0,
      input.asymmetryScore ?? 0,
      input.catalystScore ?? 0,
      input.attentionScore ?? 0,
      input.liquidityScore ?? 0,
      input.rank ?? null,
      input.narrativeSummary ?? null,
      input.catalystSummary ?? null,
      input.scoreVersion ?? HYPOTHESIS_SCORE_VERSION,
      input.inputsJson ?? "{}",
      input.activatedAt ?? null,
      input.invalidatedAt ?? null,
      input.enteredUniverseAt ?? null,
      updatedAt,
    ],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create hypothesis asset");
  }
  return mapHypothesisAssetRow(row);
}

export async function getHypothesisAsset(
  client: Client,
  id: number,
): Promise<HypothesisAssetRow | null> {
  const result = await client.execute({
    sql: "SELECT * FROM hypothesis_assets WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? mapHypothesisAssetRow(row) : null;
}

export async function listHypothesisAssetsByStatus(
  client: Client,
  status: HypothesisStatus,
): Promise<HypothesisAssetRow[]> {
  const result = await client.execute({
    sql: `
      SELECT * FROM hypothesis_assets
      WHERE status = ?
      ORDER BY rank IS NULL, rank ASC, id ASC
    `,
    args: [status],
  });
  return result.rows.map(mapHypothesisAssetRow);
}

/**
 * Open hypothesis universe for observation (WATCH + ACTIVE only).
 * INVALIDATED assets are excluded — research history stays in snapshots/events.
 */
export async function listHypothesisUniverseAssets(
  client: Client,
): Promise<HypothesisAssetRow[]> {
  const result = await client.execute({
    sql: `
      SELECT * FROM hypothesis_assets
      WHERE status IN ('WATCH', 'ACTIVE')
      ORDER BY rank IS NULL, rank ASC, id ASC
    `,
  });
  return result.rows.map(mapHypothesisAssetRow);
}
