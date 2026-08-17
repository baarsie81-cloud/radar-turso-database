import type { Client, Row } from "@libsql/client";
import { RADAR_VERSION } from "../../domain/types";
import type {
  CaseStatus,
  LifecycleStage,
  OutcomeLabel,
  Snapshot,
  SnapshotStage,
} from "../../domain/types";
import { labelOutcome } from "../../outcomes/label";
import { bool01, num, numOrNull, str, strOrNull } from "../map";
import { mapDecisionRow, type DecisionRow } from "./decisions";
import { listSnapshotsByCase, mapSnapshotRow, type SnapshotRow } from "./snapshots";
import { mapSocialCallRow, type SocialCallRow } from "./socialCalls";

export type CreateTokenCaseInput = {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  firstSeenAt: number;
  entryPrice?: number | null;
  entryValid?: boolean;
  stage?: LifecycleStage;
  caseStatus?: CaseStatus;
  radarVersion?: string;
  createdAt?: number;
};

export type TokenCaseRow = {
  id: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  firstSeenAt: number;
  entryPrice: number | null;
  entryValid: boolean;
  stage: LifecycleStage;
  caseStatus: CaseStatus;
  radarVersion: string;
  outcomeLabel: OutcomeLabel | null;
  outcomeLabeledAt: number | null;
  outcomeInputsJson: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CaseSummary = {
  tokenCase: TokenCaseRow;
  snapshots: SnapshotRow[];
  decisions: DecisionRow[];
  socialCalls: SocialCallRow[];
};

export function mapTokenCaseRow(row: Row): TokenCaseRow {
  return {
    id: num(row.id),
    mint: str(row.mint),
    symbol: strOrNull(row.symbol),
    name: strOrNull(row.name),
    firstSeenAt: num(row.first_seen_at),
    entryPrice: numOrNull(row.entry_price),
    entryValid: bool01(row.entry_valid),
    stage: str(row.stage) as LifecycleStage,
    caseStatus: str(row.case_status) as CaseStatus,
    radarVersion: str(row.radar_version),
    outcomeLabel: strOrNull(row.outcome_label) as OutcomeLabel | null,
    outcomeLabeledAt: numOrNull(row.outcome_labeled_at),
    outcomeInputsJson: strOrNull(row.outcome_inputs_json),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function snapshotsByStage(
  rows: SnapshotRow[],
): Partial<Record<SnapshotStage, Snapshot>> {
  const mapped: Partial<Record<SnapshotStage, Snapshot>> = {};
  for (const row of rows) {
    mapped[row.stage] = {
      stage: row.stage,
      capturedAt: row.capturedAt,
      price: row.price,
      roiPct: row.roiPct,
      marketCap: row.marketCap,
      liquidityUsd: row.liquidityUsd,
    };
  }
  return mapped;
}

export async function closeCase(
  client: Client,
  tokenCaseId: number,
  closedAt: number = Date.now(),
): Promise<TokenCaseRow> {
  const tokenCase = await getTokenCase(client, tokenCaseId);
  if (!tokenCase) {
    throw new Error("Token case not found");
  }

  const snapshots = await listSnapshotsByCase(client, tokenCaseId);
  const outcome = labelOutcome(
    { entryPrice: tokenCase.entryPrice, entryValid: tokenCase.entryValid },
    snapshotsByStage(snapshots),
  );

  const result = await client.execute({
    sql: `
      UPDATE token_cases SET
        stage = 'CLOSED',
        case_status = 'CLOSED',
        outcome_label = ?,
        outcome_labeled_at = ?,
        outcome_inputs_json = ?,
        updated_at = ?
      WHERE id = ?
      RETURNING *
    `,
    args: [
      outcome.outcomeLabel,
      outcome.outcomeLabel == null ? null : closedAt,
      outcome.inputsJson,
      closedAt,
      tokenCaseId,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to close token case");
  }
  return mapTokenCaseRow(row);
}

export async function createTokenCase(
  client: Client,
  input: CreateTokenCaseInput,
): Promise<TokenCaseRow> {
  const now = input.createdAt ?? Date.now();
  const result = await client.execute({
    sql: `
      INSERT INTO token_cases (
        mint, symbol, name, first_seen_at, entry_price, entry_valid,
        stage, case_status, radar_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    args: [
      input.mint,
      input.symbol ?? null,
      input.name ?? null,
      input.firstSeenAt,
      input.entryPrice ?? null,
      input.entryValid === true ? 1 : 0,
      input.stage ?? "INITIAL",
      input.caseStatus ?? "OPEN",
      input.radarVersion ?? RADAR_VERSION,
      now,
      now,
    ],
  });

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create token case");
  }
  return mapTokenCaseRow(row);
}

export async function getTokenCase(
  client: Client,
  id: number,
): Promise<TokenCaseRow | null> {
  const result = await client.execute({
    sql: "SELECT * FROM token_cases WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? mapTokenCaseRow(row) : null;
}

export type ListTokenCasesFilter = {
  caseStatus?: CaseStatus;
  stage?: LifecycleStage;
  mint?: string;
};

export async function listTokenCases(
  client: Client,
  filter: ListTokenCasesFilter = {},
): Promise<TokenCaseRow[]> {
  const clauses: string[] = [];
  const args: Array<string> = [];

  if (filter.caseStatus != null) {
    clauses.push("case_status = ?");
    args.push(filter.caseStatus);
  }
  if (filter.stage != null) {
    clauses.push("stage = ?");
    args.push(filter.stage);
  }
  if (filter.mint != null && filter.mint !== "") {
    clauses.push("mint = ?");
    args.push(filter.mint);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await client.execute({
    sql: `SELECT * FROM token_cases ${where} ORDER BY id`,
    args,
  });
  return result.rows.map(mapTokenCaseRow);
}

type CaseRelations = {
  snapshots: SnapshotRow[];
  decisions: DecisionRow[];
  socialCalls: SocialCallRow[];
};

async function loadCaseRelationsByIds(
  client: Client,
  tokenCaseIds: number[],
): Promise<Map<number, CaseRelations>> {
  const grouped = new Map<number, CaseRelations>(
    tokenCaseIds.map((id) => [
      id,
      { snapshots: [], decisions: [], socialCalls: [] },
    ]),
  );
  if (tokenCaseIds.length === 0) {
    return grouped;
  }

  const placeholders = tokenCaseIds.map(() => "?").join(", ");
  const [snapshotResult, decisionResult, socialResult] = await Promise.all([
    client.execute({
      sql: `SELECT * FROM snapshots WHERE token_case_id IN (${placeholders}) ORDER BY id`,
      args: tokenCaseIds,
    }),
    client.execute({
      sql: `SELECT * FROM decisions WHERE token_case_id IN (${placeholders}) ORDER BY decided_at, id`,
      args: tokenCaseIds,
    }),
    client.execute({
      sql: `SELECT * FROM social_calls WHERE token_case_id IN (${placeholders}) ORDER BY called_at, id`,
      args: tokenCaseIds,
    }),
  ]);

  for (const row of snapshotResult.rows) {
    const mapped = mapSnapshotRow(row);
    grouped.get(mapped.tokenCaseId)?.snapshots.push(mapped);
  }
  for (const row of decisionResult.rows) {
    const mapped = mapDecisionRow(row);
    grouped.get(mapped.tokenCaseId)?.decisions.push(mapped);
  }
  for (const row of socialResult.rows) {
    const mapped = mapSocialCallRow(row);
    if (mapped.tokenCaseId != null) {
      grouped.get(mapped.tokenCaseId)?.socialCalls.push(mapped);
    }
  }

  return grouped;
}

function toCaseSummary(
  tokenCase: TokenCaseRow,
  relations: Map<number, CaseRelations>,
): CaseSummary {
  const related = relations.get(tokenCase.id) ?? {
    snapshots: [],
    decisions: [],
    socialCalls: [],
  };
  return { tokenCase, ...related };
}

export async function getCaseSummary(
  client: Client,
  tokenCaseId: number,
): Promise<CaseSummary | null> {
  const tokenCase = await getTokenCase(client, tokenCaseId);
  if (!tokenCase) {
    return null;
  }

  const relations = await loadCaseRelationsByIds(client, [tokenCase.id]);
  return toCaseSummary(tokenCase, relations);
}

export async function listCaseSummaries(
  client: Client,
  filter: ListTokenCasesFilter = {},
): Promise<CaseSummary[]> {
  const tokenCases = await listTokenCases(client, filter);
  const relations = await loadCaseRelationsByIds(
    client,
    tokenCases.map((row) => row.id),
  );
  return tokenCases.map((tokenCase) => toCaseSummary(tokenCase, relations));
}
