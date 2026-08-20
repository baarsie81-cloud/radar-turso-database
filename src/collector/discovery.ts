import type { Client } from "@libsql/client";
import { createSnapshotJobsForCase } from "../db/repositories/jobs";
import { upsertSnapshot } from "../db/repositories/snapshots";
import {
  createTokenCase,
  getOpenTokenCaseByMint,
  type TokenCaseRow,
} from "../db/repositories/tokenCases";
import type { SnapshotRow } from "../db/repositories/snapshots";
import type { DiscoveredToken } from "../providers/types";
import { buildSnapshotJobSchedule } from "./schedule";

export type PersistDiscoveredTokenResult =
  | {
      status: "created";
      mint: string;
      tokenCase: TokenCaseRow;
      initialSnapshot: SnapshotRow;
      jobCount: number;
    }
  | {
      status: "skipped";
      mint: string;
      reason: string;
    };

export type PersistDiscoveredTokensResult = {
  created: number;
  skipped: number;
  results: PersistDiscoveredTokenResult[];
};

const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateDiscoveredToken(token: DiscoveredToken): string | null {
  if (!SOLANA_MINT_PATTERN.test(token.mint)) {
    return "Invalid mint";
  }
  if (!Number.isFinite(token.firstSeenAt) || token.firstSeenAt <= 0) {
    return "Invalid firstSeenAt";
  }
  if (!Number.isFinite(token.price) || token.price <= 0) {
    return "Invalid price";
  }
  return null;
}

export async function persistDiscoveredToken(
  client: Client,
  token: DiscoveredToken,
  createdAt?: number,
): Promise<PersistDiscoveredTokenResult> {
  const validationError = validateDiscoveredToken(token);
  if (validationError) {
    return { status: "skipped", mint: token.mint, reason: validationError };
  }

  const existing = await getOpenTokenCaseByMint(client, token.mint);
  if (existing) {
    return {
      status: "skipped",
      mint: token.mint,
      reason: "OPEN case already exists",
    };
  }

  const now = createdAt ?? token.firstSeenAt;
  const tokenCase = await createTokenCase(client, {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    firstSeenAt: token.firstSeenAt,
    entryPrice: token.price,
    entryValid: true,
    stage: "INITIAL",
    caseStatus: "OPEN",
    createdAt: now,
  });

  const initialSnapshot = await upsertSnapshot(client, {
    tokenCaseId: tokenCase.id,
    stage: "INITIAL",
    capturedAt: token.firstSeenAt,
    price: token.price,
    roiPct: 0,
    marketCap: token.marketCap ?? null,
    liquidityUsd: token.liquidityUsd ?? null,
  });

  const jobs = await createSnapshotJobsForCase(client, {
    tokenCaseId: tokenCase.id,
    jobs: buildSnapshotJobSchedule(token.firstSeenAt),
    createdAt: now,
  });

  return {
    status: "created",
    mint: token.mint,
    tokenCase,
    initialSnapshot,
    jobCount: jobs.length,
  };
}

export async function persistDiscoveredTokens(
  client: Client,
  tokens: DiscoveredToken[],
  options: { createdAt?: number } = {},
): Promise<PersistDiscoveredTokensResult> {
  const results: PersistDiscoveredTokenResult[] = [];
  let created = 0;
  let skipped = 0;

  for (const token of tokens) {
    const result = await persistDiscoveredToken(client, token, options.createdAt);
    results.push(result);
    if (result.status === "created") {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, skipped, results };
}
