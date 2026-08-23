import { afterEach, describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { storeDecision } from "../src/db/repositories/decisions";
import {
  createPushDelivery,
  hasPushDelivery,
} from "../src/db/repositories/push";
import { createTokenCase } from "../src/db/repositories/tokenCases";
import * as engine from "../src/decisions/engine";
import {
  buildPassPushPayload,
  processPushDeliveries,
  selectPassPushCandidates,
} from "../src/push";
import type { PushPayload } from "../src/push";

const BASE = 1_700_000_000_000;
const MINT = "SoMintPush1111111111111111111111111111111";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

async function seedCase(
  client: Awaited<ReturnType<typeof setup>>,
  mint = MINT,
  symbol = "PUSH",
) {
  return createTokenCase(client, {
    mint,
    symbol,
    name: "Push Token",
    firstSeenAt: BASE,
    entryPrice: 0.001,
    entryValid: true,
    stage: "PLUS_10",
    caseStatus: "OPEN",
    createdAt: BASE,
  });
}

function executionOk() {
  return Promise.resolve({
    status: "EXECUTION_PASS" as const,
    ok: true,
    reason: null,
    buyOutAmount: "1000",
    sellOutAmount: "9900000",
    roundTripLossPct: 1,
  });
}

describe("V24 PASS-only push delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PASS @ PLUS_10 creates a push candidate", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      entryPrice: 0.001,
      plus5RoiPct: 20,
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    const candidates = await selectPassPushCandidates(client);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.decisionStatus).toBe("PASS");
    expect(candidates[0]?.decisionStage).toBe("PLUS_10");
    expect(candidates[0]?.radarVersion).toBe("2.4");
    expect(candidates[0]?.mint).toBe(MINT);
  });

  it("REJECT decisions are ignored", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client, `${MINT}R`, "REJ");
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "REJECT",
      rejectReason: "NEGATIVE_MOMENTUM_5_TO_10",
      plus5RoiPct: 40,
      plus10RoiPct: 30,
      momentum5To10Pct: -10,
      inputsJson: JSON.stringify({ reject: true }),
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(executionOk);
    const summary = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(summary.candidates).toBe(0);
    expect(summary.delivered).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
    expect(validateExecution).not.toHaveBeenCalled();
  });

  it("duplicate delivery is ignored", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    const decision = await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    await createPushDelivery(client, {
      decisionId: decision.id,
      tokenCaseId: tokenCase.id,
      sentAt: BASE + 700_000,
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(executionOk);
    const summary = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(summary.candidates).toBe(0);
    expect(summary.delivered).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
    expect(validateExecution).not.toHaveBeenCalled();
    expect(await hasPushDelivery(client, decision.id)).toBe(true);
  });

  it("payload contains mint address and case URL", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus5RoiPct: 20,
      plus10RoiPct: 35.5,
      momentum5To10Pct: 12.25,
      inputsJson: JSON.stringify({ plus10RoiPct: 35.5 }),
    });

    const [candidate] = await selectPassPushCandidates(client);
    expect(candidate).toBeDefined();
    const payload = buildPassPushPayload(candidate!);

    expect(payload.title).toBe("Radar V24 Signal");
    expect(payload.mint).toBe(MINT);
    expect(payload.url).toBe(`/cases/${tokenCase.id}`);
    expect(payload.body).toContain("PUSH");
    expect(payload.body).toContain("PASS");
    expect(payload.body).toContain("35.50%");
    expect(payload.body).toContain("12.25%");
  });

  it("sends actionable PASS once after executable route validation", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    const decision = await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(executionOk);

    const first = await processPushDeliveries({
      client,
      sendPush,
      validateExecution,
      now: () => BASE + 800_000,
    });
    expect(first.candidates).toBe(1);
    expect(first.delivered).toBe(1);
    expect(first.errors).toHaveLength(0);
    expect(validateExecution).toHaveBeenCalledWith(MINT);
    expect(sendPush).toHaveBeenCalledOnce();
    expect(await hasPushDelivery(client, decision.id)).toBe(true);

    const second = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(second.candidates).toBe(0);
    expect(second.delivered).toBe(0);
    expect(sendPush).toHaveBeenCalledOnce();
  });

  it("blocks PASS push when Jupiter has no executable sell route", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    const decision = await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 40,
      momentum5To10Pct: 15,
      inputsJson: JSON.stringify({ plus10RoiPct: 40 }),
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(async () => ({
      status: "EXECUTION_FAIL" as const,
      ok: false,
      reason: "EXECUTION_FAIL_NO_SELL_ROUTE",
      buyOutAmount: "1000",
      sellOutAmount: null,
      roundTripLossPct: null,
    }));

    const summary = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(summary.candidates).toBe(1);
    expect(summary.delivered).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([
      { decisionId: decision.id, message: "EXECUTION_FAIL_NO_SELL_ROUTE" },
    ]);
    expect(summary.unknown).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
    expect(await hasPushDelivery(client, decision.id)).toBe(false);
  });

  it("skips push on EXECUTION_UNKNOWN without labeling as FAIL", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    const decision = await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(async () => ({
      status: "EXECUTION_UNKNOWN" as const,
      ok: false,
      reason: "EXECUTION_UNKNOWN_PROVIDER:timeout",
      buyOutAmount: null,
      sellOutAmount: null,
      roundTripLossPct: null,
    }));

    const summary = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(summary.delivered).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(summary.unknown).toEqual([
      { decisionId: decision.id, message: "EXECUTION_UNKNOWN_PROVIDER:timeout" },
    ]);
    expect(sendPush).not.toHaveBeenCalled();
    expect(await hasPushDelivery(client, decision.id)).toBe(false);
  });

  it("fails closed when execution provider errors", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(async () => ({
      status: "EXECUTION_UNKNOWN" as const,
      ok: false,
      reason: "EXECUTION_UNKNOWN_PROVIDER:timeout",
      buyOutAmount: null,
      sellOutAmount: null,
      roundTripLossPct: null,
    }));

    const summary = await processPushDeliveries({ client, sendPush, validateExecution });
    expect(summary.delivered).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.unknown).toHaveLength(1);
    expect(summary.errors).toHaveLength(0);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("push layer does not call evaluateRadar24", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client);
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
    });

    const evaluateSpy = vi.spyOn(engine, "evaluateRadar24");
    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const validateExecution = vi.fn(executionOk);

    await processPushDeliveries({ client, sendPush, validateExecution });

    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalledOnce();
  });

  it("non-2.4 radar_version is ignored", async () => {
    const client = await setup();
    const tokenCase = await seedCase(client, `${MINT}V`, "OLD");
    await storeDecision(client, {
      tokenCaseId: tokenCase.id,
      decisionStage: "PLUS_10",
      decidedAt: BASE + 600_000,
      decisionStatus: "PASS",
      radarVersion: "2.3",
      plus10RoiPct: 40,
      momentum5To10Pct: 15,
      inputsJson: JSON.stringify({ plus10RoiPct: 40 }),
    });

    const candidates = await selectPassPushCandidates(client);
    expect(candidates).toHaveLength(0);
  });
});
