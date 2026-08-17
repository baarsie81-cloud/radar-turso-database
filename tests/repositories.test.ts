import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { getDecisionReplay, storeDecision } from "../src/db/repositories/decisions";
import { listSnapshotsByCase, upsertSnapshot } from "../src/db/repositories/snapshots";
import { storeSocialCall } from "../src/db/repositories/socialCalls";
import {
  closeCase,
  createTokenCase,
  getCaseSummary,
  listCaseSummaries,
  listTokenCases,
} from "../src/db/repositories/tokenCases";
import { evaluateRadar24 } from "../src/decisions/engine";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

describe("repositories", () => {
  it("creates a token case, upserts snapshots, stores a decision, and reads summary plus replay inputs", async () => {
    const client = await setup();
    const now = 1_700_000_000_000;

    const tokenCase = await createTokenCase(client, {
      mint: "SoMint1111111111111111111111111111111111111",
      symbol: "TEST",
      firstSeenAt: now,
      entryPrice: 100,
      entryValid: true,
    });

    expect(tokenCase.id).toBe(1);
    expect(tokenCase.caseStatus).toBe("OPEN");
    expect(tokenCase.stage).toBe("INITIAL");

    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "INITIAL",
      capturedAt: now,
      price: 100,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_5",
      capturedAt: now + 5 * 60_000,
      price: 120,
      roiPct: 20,
    });
    const plus10 = await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      capturedAt: now + 10 * 60_000,
      price: 125,
      roiPct: 25,
    });
    const plus10Updated = await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "PLUS_10",
      capturedAt: now + 10 * 60_000,
      price: 130,
      roiPct: 30,
    });

    expect(plus10Updated.id).toBe(plus10.id);
    expect(plus10Updated.price).toBe(130);

    const snapshots = await listSnapshotsByCase(client, tokenCase.id);
    expect(snapshots).toHaveLength(3);

    const evaluated = evaluateRadar24({
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: now + 10 * 60_000,
      entry: { entryPrice: tokenCase.entryPrice, entryValid: tokenCase.entryValid },
      snapshots: {
        INITIAL: { stage: "INITIAL", capturedAt: now, price: 100 },
        PLUS_5: { stage: "PLUS_5", capturedAt: now + 5 * 60_000, price: 120 },
        PLUS_10: { stage: "PLUS_10", capturedAt: now + 10 * 60_000, price: 130 },
      },
    });

    await storeDecision(client, {
      tokenCaseId: evaluated.tokenCaseId,
      decisionStage: evaluated.decisionStage,
      decidedAt: evaluated.decidedAt,
      decisionStatus: evaluated.decisionStatus,
      rejectReason: evaluated.rejectReason,
      radarVersion: evaluated.radarVersion,
      entryPrice: evaluated.entryPrice,
      plus5RoiPct: evaluated.plus5RoiPct,
      plus10RoiPct: evaluated.plus10RoiPct,
      momentum5To10Pct: evaluated.momentum5To10Pct,
      inputsJson: evaluated.inputsJson,
    });

    const replay = await getDecisionReplay(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
    });

    expect(replay).not.toBeNull();
    expect(replay?.decisionStatus).toBe("PASS");
    expect(replay?.plus5RoiPct).toBe(20);
    expect(replay?.plus10RoiPct).toBe(30);
    expect(replay?.momentum5To10Pct).toBe(10);
    expect(replay?.inputs).toEqual(evaluated.inputs);
    expect(replay?.inputsError).toBeNull();

    await storeSocialCall(client, {
      source: "twitter",
      externalId: "tweet-1",
      calledAt: now,
      mint: tokenCase.mint,
      tokenCaseId: tokenCase.id,
      callPrice: 110,
      collapseBefore: true,
      collapseAfter: false,
      collapseWindowMinutes: 15,
      notesJson: JSON.stringify({ note: "audit only" }),
    });

    const summary = await getCaseSummary(client, tokenCase.id);
    expect(summary?.tokenCase.mint).toBe(tokenCase.mint);
    expect(summary?.snapshots.map((row) => row.stage)).toEqual([
      "INITIAL",
      "PLUS_5",
      "PLUS_10",
    ]);
    expect(summary?.decisions).toHaveLength(1);
    expect(summary?.decisions[0]?.inputsJson).toBe(evaluated.inputsJson);
    expect(summary?.socialCalls).toHaveLength(1);
    expect(summary?.socialCalls[0]?.collapseBefore).toBe(true);
  });

  it("dedupes social calls by source and external_id", async () => {
    const client = await setup();
    const now = Date.now();

    const first = await storeSocialCall(client, {
      source: "twitter",
      externalId: "tweet-1",
      calledAt: now,
      mint: "SoMint",
    });
    const second = await storeSocialCall(client, {
      source: "twitter",
      externalId: "tweet-1",
      calledAt: now + 1000,
      mint: "OtherMint",
    });

    expect(second.id).toBe(first.id);
    expect(second.mint).toBe("SoMint");

    const otherSource = await storeSocialCall(client, {
      source: "telegram",
      externalId: "tweet-1",
      calledAt: now,
    });
    expect(otherSource.id).not.toBe(first.id);
  });

  it("treats empty externalId as NULL and allows multiple NULL ids", async () => {
    const client = await setup();
    const now = Date.now();

    const first = await storeSocialCall(client, {
      source: "twitter",
      externalId: "   ",
      calledAt: now,
    });
    const second = await storeSocialCall(client, {
      source: "twitter",
      externalId: "",
      calledAt: now + 1,
    });

    expect(first.externalId).toBeNull();
    expect(second.externalId).toBeNull();
    expect(second.id).not.toBe(first.id);
  });

  it("returns the existing social call on concurrent duplicate writes", async () => {
    const client = await setup();
    const now = Date.now();
    const input = {
      source: "twitter" as const,
      externalId: "tweet-race",
      calledAt: now,
    };

    const [first, second] = await Promise.all([
      storeSocialCall(client, input),
      storeSocialCall(client, input),
    ]);

    expect(first.id).toBe(second.id);

    const count = await client.execute(
      "SELECT COUNT(*) AS n FROM social_calls WHERE source = 'twitter' AND external_id = 'tweet-race'",
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it("rejects invalid inputsJson before storing a decision", async () => {
    const client = await setup();
    const tokenCase = await createTokenCase(client, {
      mint: "SoMint",
      firstSeenAt: Date.now(),
    });

    await expect(
      storeDecision(client, {
        tokenCaseId: tokenCase.id,
        decisionStage: "PLUS_10",
        decidedAt: Date.now(),
        decisionStatus: "PASS",
        inputsJson: "{not-json",
      }),
    ).rejects.toThrow("inputsJson must be valid JSON");
  });

  it("returns a controlled replay error for corrupt stored JSON", async () => {
    const client = await setup();
    const now = Date.now();
    const tokenCase = await createTokenCase(client, {
      mint: "SoMint",
      firstSeenAt: now,
    });

    await client.execute({
      sql: `
        INSERT INTO decisions (
          token_case_id, decision_stage, decided_at, decision_status, radar_version, inputs_json
        ) VALUES (?, 'PLUS_10', ?, 'PASS', '2.4', ?)
      `,
      args: [tokenCase.id, now, "{not-json"],
    });

    const replay = await getDecisionReplay(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
    });

    expect(replay?.decisionStatus).toBe("PASS");
    expect(replay?.inputs).toBeNull();
    expect(replay?.inputsError).toBeTruthy();
  });

  it("lists token cases by case_status, stage, and optional mint", async () => {
    const client = await setup();
    const now = Date.now();

    await createTokenCase(client, {
      mint: "MintA",
      firstSeenAt: now,
      stage: "PLUS_10",
      caseStatus: "OPEN",
    });
    await createTokenCase(client, {
      mint: "MintB",
      firstSeenAt: now + 1,
      stage: "PLUS_10",
      caseStatus: "CLOSED",
    });
    await createTokenCase(client, {
      mint: "MintA",
      firstSeenAt: now + 2,
      stage: "PLUS_5",
      caseStatus: "OPEN",
    });

    const open = await listTokenCases(client, { caseStatus: "OPEN" });
    expect(open.map((row) => row.mint)).toEqual(["MintA", "MintA"]);

    const plus10 = await listTokenCases(client, { stage: "PLUS_10" });
    expect(plus10.map((row) => row.mint)).toEqual(["MintA", "MintB"]);

    const openPlus10 = await listTokenCases(client, {
      caseStatus: "OPEN",
      stage: "PLUS_10",
    });
    expect(openPlus10).toHaveLength(1);
    expect(openPlus10[0]?.mint).toBe("MintA");

    const mintA = await listTokenCases(client, { mint: "MintA" });
    expect(mintA).toHaveLength(2);

    const mintAOpenPlus10 = await listTokenCases(client, {
      caseStatus: "OPEN",
      stage: "PLUS_10",
      mint: "MintA",
    });
    expect(mintAOpenPlus10).toHaveLength(1);

    const none = await listTokenCases(client, { mint: "MintZ" });
    expect(none).toEqual([]);

    const all = await listTokenCases(client);
    expect(all).toHaveLength(3);
  });

  it("lists case summaries with related snapshots, decisions, and social calls", async () => {
    const client = await setup();
    const now = 1_700_000_000_000;

    const mintA = await createTokenCase(client, {
      mint: "MintA",
      firstSeenAt: now,
      stage: "PLUS_10",
      caseStatus: "OPEN",
    });
    const mintB = await createTokenCase(client, {
      mint: "MintB",
      firstSeenAt: now + 1,
      stage: "PLUS_10",
      caseStatus: "CLOSED",
    });

    await upsertSnapshot(client, {
      tokenCaseId: mintA.id,
      stage: "INITIAL",
      capturedAt: now,
      price: 100,
    });
    await storeDecision(client, {
      tokenCaseId: mintA.id,
      decisionStage: "PLUS_10",
      decidedAt: now + 10 * 60_000,
      decisionStatus: "PASS",
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });
    await storeSocialCall(client, {
      source: "twitter",
      externalId: "tweet-summary",
      calledAt: now,
      tokenCaseId: mintA.id,
      mint: "MintA",
    });

    const all = await listCaseSummaries(client);
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.tokenCase.id)).toEqual([mintA.id, mintB.id]);

    const [summaryA, summaryB] = all;
    expect(summaryA?.snapshots).toHaveLength(1);
    expect(summaryA?.decisions).toHaveLength(1);
    expect(summaryA?.socialCalls).toHaveLength(1);
    expect(summaryB?.snapshots).toEqual([]);
    expect(summaryB?.decisions).toEqual([]);
    expect(summaryB?.socialCalls).toEqual([]);

    const open = await listCaseSummaries(client, { caseStatus: "OPEN" });
    expect(open).toHaveLength(1);
    expect(open[0]?.tokenCase.mint).toBe("MintA");
    expect(open[0]?.snapshots).toHaveLength(1);

    const none = await listCaseSummaries(client, { mint: "MintZ" });
    expect(none).toEqual([]);
  });

  it("persists closeCase outcome labels and leaves incomplete closes unlabeled", async () => {
    const client = await setup();
    const now = 1_700_000_000_000;

    async function seedCase(mint: string, plus60Price: number | null) {
      const tokenCase = await createTokenCase(client, {
        mint,
        firstSeenAt: now,
        entryPrice: 100,
        entryValid: true,
        stage: "PLUS_60",
      });
      await upsertSnapshot(client, {
        tokenCaseId: tokenCase.id,
        stage: "PLUS_15",
        capturedAt: now + 15 * 60_000,
        price: 110,
      });
      if (plus60Price != null) {
        await upsertSnapshot(client, {
          tokenCaseId: tokenCase.id,
          stage: "PLUS_60",
          capturedAt: now + 60 * 60_000,
          price: plus60Price,
        });
      }
      return tokenCase;
    }

    const runnerCase = await seedCase("MintRunner", 250);
    const smallWinCase = await seedCase("MintSmall", 140);
    const noResultCase = await seedCase("MintNone", 110);
    const incompleteCase = await seedCase("MintIncomplete", null);

    const closedRunner = await closeCase(client, runnerCase.id, now + 1);
    expect(closedRunner.caseStatus).toBe("CLOSED");
    expect(closedRunner.stage).toBe("CLOSED");
    expect(closedRunner.outcomeLabel).toBe("RUNNER");
    expect(closedRunner.outcomeLabeledAt).toBe(now + 1);
    expect(JSON.parse(closedRunner.outcomeInputsJson ?? "")).toMatchObject({
      peakRoiPct: 150,
      terminalRoiPct: 150,
    });

    const closedSmall = await closeCase(client, smallWinCase.id, now + 2);
    expect(closedSmall.outcomeLabel).toBe("SMALL_WIN");
    expect(closedSmall.outcomeLabeledAt).toBe(now + 2);

    const closedNone = await closeCase(client, noResultCase.id, now + 3);
    expect(closedNone.outcomeLabel).toBe("NO_RESULT");
    expect(closedNone.outcomeLabeledAt).toBe(now + 3);

    const closedIncomplete = await closeCase(client, incompleteCase.id, now + 4);
    expect(closedIncomplete.caseStatus).toBe("CLOSED");
    expect(closedIncomplete.stage).toBe("CLOSED");
    expect(closedIncomplete.outcomeLabel).toBeNull();
    expect(closedIncomplete.outcomeLabeledAt).toBeNull();
    expect(closedIncomplete.outcomeInputsJson).toBeNull();

    const reloaded = await getCaseSummary(client, incompleteCase.id);
    expect(reloaded?.tokenCase.caseStatus).toBe("CLOSED");
    expect(reloaded?.tokenCase.outcomeLabel).toBeNull();
    expect(reloaded?.snapshots.map((row) => row.stage)).toEqual(["PLUS_15"]);

    await expect(closeCase(client, 9999)).rejects.toThrow("Token case not found");
  });
});
