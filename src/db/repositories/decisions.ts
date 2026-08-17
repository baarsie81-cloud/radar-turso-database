import type { Client, Row } from "@libsql/client";
import { RADAR_VERSION } from "../../domain/types";
import type { DecisionStatus, RejectReason, SnapshotStage } from "../../domain/types";
import { num, numOrNull, str, strOrNull } from "../map";

export type StoreDecisionInput = {
  tokenCaseId: number;
  decisionStage: SnapshotStage;
  decidedAt: number;
  decisionStatus: DecisionStatus;
  rejectReason?: RejectReason | string | null;
  radarVersion?: string;
  entryPrice?: number | null;
  plus5RoiPct?: number | null;
  plus10RoiPct?: number | null;
  momentum5To10Pct?: number | null;
  inputsJson: string;
};

export type DecisionRow = {
  id: number;
  tokenCaseId: number;
  decisionStage: SnapshotStage;
  decidedAt: number;
  decisionStatus: DecisionStatus;
  rejectReason: string | null;
  radarVersion: string;
  entryPrice: number | null;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum5To10Pct: number | null;
  inputsJson: string;
};

export type DecisionReplay = DecisionRow & {
  inputs: unknown | null;
  inputsError: string | null;
};

export function parseInputsJson(inputsJson: string): unknown {
  try {
    return JSON.parse(inputsJson) as unknown;
  } catch {
    throw new Error("inputsJson must be valid JSON");
  }
}

export function mapDecisionRow(row: Row): DecisionRow {
  return {
    id: num(row.id),
    tokenCaseId: num(row.token_case_id),
    decisionStage: str(row.decision_stage) as SnapshotStage,
    decidedAt: num(row.decided_at),
    decisionStatus: str(row.decision_status) as DecisionStatus,
    rejectReason: strOrNull(row.reject_reason),
    radarVersion: str(row.radar_version),
    entryPrice: numOrNull(row.entry_price),
    plus5RoiPct: numOrNull(row.plus5_roi_pct),
    plus10RoiPct: numOrNull(row.plus10_roi_pct),
    momentum5To10Pct: numOrNull(row.momentum_5_to_10_pct),
    inputsJson: str(row.inputs_json),
  };
}

export async function storeDecision(
  client: Client,
  input: StoreDecisionInput,
): Promise<DecisionRow> {
  parseInputsJson(input.inputsJson);

  const result = await client.execute({
    sql: `
      INSERT INTO decisions (
        token_case_id, decision_stage, decided_at, decision_status, reject_reason,
        radar_version, entry_price, plus5_roi_pct, plus10_roi_pct, momentum_5_to_10_pct,
        inputs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_case_id, radar_version, decision_stage) DO UPDATE SET
        decided_at = excluded.decided_at,
        decision_status = excluded.decision_status,
        reject_reason = excluded.reject_reason,
        entry_price = excluded.entry_price,
        plus5_roi_pct = excluded.plus5_roi_pct,
        plus10_roi_pct = excluded.plus10_roi_pct,
        momentum_5_to_10_pct = excluded.momentum_5_to_10_pct,
        inputs_json = excluded.inputs_json
      RETURNING *
    `,
    args: [
      input.tokenCaseId,
      input.decisionStage,
      input.decidedAt,
      input.decisionStatus,
      input.rejectReason ?? null,
      input.radarVersion ?? RADAR_VERSION,
      input.entryPrice ?? null,
      input.plus5RoiPct ?? null,
      input.plus10RoiPct ?? null,
      input.momentum5To10Pct ?? null,
      input.inputsJson,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to store decision");
  }
  return mapDecisionRow(row);
}

export async function getDecisionReplay(
  client: Client,
  args: {
    tokenCaseId: number;
    decisionStage: SnapshotStage;
    radarVersion?: string;
  },
): Promise<DecisionReplay | null> {
  const result = await client.execute({
    sql: `
      SELECT * FROM decisions
      WHERE token_case_id = ? AND radar_version = ? AND decision_stage = ?
    `,
    args: [args.tokenCaseId, args.radarVersion ?? RADAR_VERSION, args.decisionStage],
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const decision = mapDecisionRow(row);
  try {
    return {
      ...decision,
      inputs: JSON.parse(decision.inputsJson) as unknown,
      inputsError: null,
    };
  } catch (error) {
    return {
      ...decision,
      inputs: null,
      inputsError:
        error instanceof Error ? error.message : "inputsJson is not valid JSON",
    };
  }
}

export async function listDecisionsByCase(
  client: Client,
  tokenCaseId: number,
): Promise<DecisionRow[]> {
  const result = await client.execute({
    sql: "SELECT * FROM decisions WHERE token_case_id = ? ORDER BY decided_at, id",
    args: [tokenCaseId],
  });
  return result.rows.map(mapDecisionRow);
}
