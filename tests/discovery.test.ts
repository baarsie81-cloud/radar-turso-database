import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { persistDiscoveredToken, persistDiscoveredTokens, DISCOVERY_LIMIT_SKIP_REASON } from "../src/collector/discovery";
import { listSnapshotsByCase } from "../src/db/repositories/snapshots";
import { createTokenCase } from "../src/db/repositories/tokenCases";
import type { DiscoveredToken } from "../src/providers/types";

const BASE = 1_700_000_000_000;

function discoveryMint(index: number): string {
  const body = (index + 1).toString(36).toUpperCase().replace(/[^1-9A-HJ-NP-Za-km-z]/g, "X");
  return `SoMint${body.padEnd(37, "1")}`.slice(0, 44);
}

function sampleToken(overrides: Partial<DiscoveredToken> = {}): DiscoveredToken {
  return {
    mint: "SoMint1111111111111111111111111111111111111",
    symbol: "NEW",
    name: "New Token",
    firstSeenAt: BASE,
    price: 0.00123,
    marketCap: 50_000,
    liquidityUsd: 12_000,
    sourceEventId: "solana_pool_1",
    ...overrides,
  };
}

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

describe("discovery service", () => {
  it("creates a case, INITIAL snapshot, and five lifecycle jobs", async () => {
    const client = await setup();
    const token = sampleToken();

    const result = await persistDiscoveredToken(client, token, BASE);

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      return;
    }

    expect(result.tokenCase.mint).toBe(token.mint);
    expect(result.tokenCase.stage).toBe("INITIAL");
    expect(result.tokenCase.caseStatus).toBe("OPEN");
    expect(result.tokenCase.entryPrice).toBe(token.price);
    expect(result.tokenCase.entryValid).toBe(true);
    expect(result.jobCount).toBe(5);

    expect(result.initialSnapshot.stage).toBe("INITIAL");
    expect(result.initialSnapshot.price).toBe(token.price);
    expect(result.initialSnapshot.capturedAt).toBe(BASE);
    expect(result.initialSnapshot.roiPct).toBe(0);
    expect(result.initialSnapshot.marketCap).toBe(50_000);
    expect(result.initialSnapshot.liquidityUsd).toBe(12_000);

    const snapshots = await listSnapshotsByCase(client, result.tokenCase.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.stage).toBe("INITIAL");

    const jobs = await client.execute({
      sql: "SELECT stage, scheduled_for, deadline_at FROM snapshot_jobs WHERE token_case_id = ? ORDER BY id",
      args: [result.tokenCase.id],
    });
    expect(jobs.rows.map((row) => String(row.stage))).toEqual([
      "PLUS_5",
      "PLUS_10",
      "PLUS_15",
      "PLUS_30",
      "PLUS_60",
    ]);
    expect(Number(jobs.rows[0]?.scheduled_for)).toBe(BASE + 300_000);
    expect(Number(jobs.rows[4]?.deadline_at)).toBe(BASE + 5_400_000);
  });

  it("skips duplicate OPEN mints", async () => {
    const client = await setup();
    const token = sampleToken();

    const first = await persistDiscoveredToken(client, token, BASE);
    const second = await persistDiscoveredToken(client, token, BASE + 1);

    expect(first.status).toBe("created");
    expect(second).toEqual({
      status: "skipped",
      mint: token.mint,
      reason: "OPEN case already exists",
    });
  });

  it("allows a new OPEN case after the previous case is CLOSED", async () => {
    const client = await setup();
    const token = sampleToken();

    const first = await persistDiscoveredToken(client, token, BASE);
    expect(first.status).toBe("created");

    await client.execute({
      sql: `
        UPDATE token_cases
        SET case_status = 'CLOSED', stage = 'CLOSED', updated_at = ?
        WHERE mint = ?
      `,
      args: [BASE + 1, token.mint],
    });

    const second = await persistDiscoveredToken(client, {
      ...token,
      firstSeenAt: BASE + 2,
      price: 0.002,
      sourceEventId: "solana_pool_2",
    }, BASE + 2);

    expect(second.status).toBe("created");
    if (second.status !== "created") {
      return;
    }

    expect(second.tokenCase.id).not.toBe(
      first.status === "created" ? first.tokenCase.id : null,
    );
    expect(second.tokenCase.caseStatus).toBe("OPEN");
  });

  it("persists multiple tokens and reports created vs skipped counts", async () => {
    const client = await setup();

    await createTokenCase(client, {
      mint: "SoMint2222222222222222222222222222222222222",
      firstSeenAt: BASE,
      stage: "INITIAL",
      caseStatus: "OPEN",
    });

    const summary = await persistDiscoveredTokens(client, [
      sampleToken(),
      sampleToken({
        mint: "SoMint2222222222222222222222222222222222222",
        symbol: "OLD",
      }),
      sampleToken({
        mint: "SoMint3333333333333333333333333333333333333",
        symbol: "ALT",
        firstSeenAt: BASE + 3,
      }),
    ], { createdAt: BASE });

    expect(summary.offered).toBe(3);
    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.results.filter((row) => row.status === "created")).toHaveLength(2);
  });

  it("limit 1 creates one case from many offered tokens", async () => {
    const client = await setup();
    const tokens = Array.from({ length: 20 }, (_, index) =>
      sampleToken({
        mint: discoveryMint(index),
        symbol: `T${index}`,
        firstSeenAt: BASE + index,
        sourceEventId: `pool_${index}`,
      }),
    );

    const summary = await persistDiscoveredTokens(client, tokens, {
      createdAt: BASE,
      maxNewCasesPerRun: 1,
    });

    expect(summary.offered).toBe(20);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(19);
    expect(summary.results[0]?.status).toBe("created");
    expect(summary.results.slice(1).every(
      (row) =>
        row.status === "skipped"
        && row.reason === DISCOVERY_LIMIT_SKIP_REASON,
    )).toBe(true);
  });

  it("limit 5 creates five cases from many offered tokens", async () => {
    const client = await setup();
    const tokens = Array.from({ length: 12 }, (_, index) =>
      sampleToken({
        mint: discoveryMint(100 + index),
        symbol: `F${index}`,
        firstSeenAt: BASE + index,
        sourceEventId: `pool_f_${index}`,
      }),
    );

    const summary = await persistDiscoveredTokens(client, tokens, {
      createdAt: BASE,
      maxNewCasesPerRun: 5,
    });

    expect(summary.offered).toBe(12);
    expect(summary.created).toBe(5);
    expect(summary.skipped).toBe(7);
  });

  it("duplicate OPEN mints are skipped without consuming the new-case limit", async () => {
    const client = await setup();

    await createTokenCase(client, {
      mint: "SoMint2222222222222222222222222222222222222",
      firstSeenAt: BASE,
      stage: "INITIAL",
      caseStatus: "OPEN",
    });

    const summary = await persistDiscoveredTokens(client, [
      sampleToken({
        mint: "SoMint2222222222222222222222222222222222222",
        symbol: "OLD",
      }),
      sampleToken({
        mint: "SoMint3333333333333333333333333333333333333",
        symbol: "NEW",
      }),
    ], {
      createdAt: BASE,
      maxNewCasesPerRun: 1,
    });

    expect(summary.offered).toBe(2);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0]).toEqual({
      status: "skipped",
      mint: "SoMint2222222222222222222222222222222222222",
      reason: "OPEN case already exists",
    });
    expect(summary.results[1]?.status).toBe("created");
  });
});
