import type { Client, Row } from "@libsql/client";
import { RADAR_VERSION } from "../../domain/types";
import type { CaseStatus, LifecycleStage } from "../../domain/types";
import { bool01, num, numOrNull, str, strOrNull } from "../map";
import { listDecisionsByCase, type DecisionRow } from "./decisions";
import { listSnapshotsByCase, type SnapshotRow } from "./snapshots";
import { listSocialCallsByCase, type SocialCallRow } from "./socialCalls";

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
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
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

export async function getCaseSummary(
  client: Client,
  tokenCaseId: number,
): Promise<CaseSummary | null> {
  const tokenCase = await getTokenCase(client, tokenCaseId);
  if (!tokenCase) {
    return null;
  }

  const [snapshots, decisions, socialCalls] = await Promise.all([
    listSnapshotsByCase(client, tokenCaseId),
    listDecisionsByCase(client, tokenCaseId),
    listSocialCallsByCase(client, tokenCaseId),
  ]);

  return { tokenCase, snapshots, decisions, socialCalls };
}
