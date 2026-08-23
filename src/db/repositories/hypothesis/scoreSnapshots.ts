import type { Client, Row } from "@libsql/client";
import {
  HYPOTHESIS_SCORE_VERSION,
  type HypothesisStatus,
} from "../../../domain/hypothesis";
import { num, numOrNull, str } from "../../map";

export type InsertHypothesisScoreSnapshotInput = {
  hypothesisAssetId: number;
  capturedAt?: number;
  hypothesisScore: number;
  narrativeScore: number;
  asymmetryScore: number;
  catalystScore: number;
  attentionScore: number;
  liquidityScore: number;
  status: HypothesisStatus;
  rank?: number | null;
  inputsJson: string;
  scoreVersion?: string;
};

export type HypothesisScoreSnapshotRow = {
  id: number;
  hypothesisAssetId: number;
  capturedAt: number;
  hypothesisScore: number;
  narrativeScore: number;
  asymmetryScore: number;
  catalystScore: number;
  attentionScore: number;
  liquidityScore: number;
  status: HypothesisStatus;
  rank: number | null;
  inputsJson: string;
  scoreVersion: string;
};

export function mapHypothesisScoreSnapshotRow(row: Row): HypothesisScoreSnapshotRow {
  return {
    id: num(row.id),
    hypothesisAssetId: num(row.hypothesis_asset_id),
    capturedAt: num(row.captured_at),
    hypothesisScore: num(row.hypothesis_score),
    narrativeScore: num(row.narrative_score),
    asymmetryScore: num(row.asymmetry_score),
    catalystScore: num(row.catalyst_score),
    attentionScore: num(row.attention_score),
    liquidityScore: num(row.liquidity_score),
    status: str(row.status) as HypothesisStatus,
    rank: numOrNull(row.rank),
    inputsJson: str(row.inputs_json),
    scoreVersion: str(row.score_version),
  };
}

export async function insertHypothesisScoreSnapshot(
  client: Client,
  input: InsertHypothesisScoreSnapshotInput,
): Promise<HypothesisScoreSnapshotRow> {
  const capturedAt = input.capturedAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO hypothesis_score_snapshots (
        hypothesis_asset_id, captured_at, hypothesis_score,
        narrative_score, asymmetry_score, catalyst_score, attention_score, liquidity_score,
        status, rank, inputs_json, score_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    args: [
      input.hypothesisAssetId,
      capturedAt,
      input.hypothesisScore,
      input.narrativeScore,
      input.asymmetryScore,
      input.catalystScore,
      input.attentionScore,
      input.liquidityScore,
      input.status,
      input.rank ?? null,
      input.inputsJson,
      input.scoreVersion ?? HYPOTHESIS_SCORE_VERSION,
    ],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert hypothesis score snapshot");
  }
  return mapHypothesisScoreSnapshotRow(row);
}

export async function listHypothesisScoreSnapshots(
  client: Client,
  hypothesisAssetId: number,
): Promise<HypothesisScoreSnapshotRow[]> {
  const result = await client.execute({
    sql: `
      SELECT * FROM hypothesis_score_snapshots
      WHERE hypothesis_asset_id = ?
      ORDER BY captured_at ASC, id ASC
    `,
    args: [hypothesisAssetId],
  });
  return result.rows.map(mapHypothesisScoreSnapshotRow);
}
