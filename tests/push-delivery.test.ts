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

    const candidates = await selectPassPushCandidates(client);
    expect(candidates).toHaveLength(0);

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const summary = await processPushDeliveries({ client, sendPush });
    expect(summary.candidates).toBe(0);
    expect(summary.delivered).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
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

    const candidates = await selectPassPushCandidates(client);
    expect(candidates).toHaveLength(0);

    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const summary = await processPushDeliveries({ client, sendPush });
    expect(summary.candidates).toBe(0);
    expect(summary.delivered).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
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
    expect(payload.decisionStatus).toBe("PASS");
    expect(payload.decisionStage).toBe("PLUS_10");
  });

  it("processPushDeliveries sends once and marks delivered", async () => {
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

    const sent: PushPayload[] = [];
    const sendPush = vi.fn(async (payload: PushPayload) => {
      sent.push(payload);
    });

    const first = await processPushDeliveries({
      client,
      sendPush,
      now: () => BASE + 800_000,
    });
    expect(first.candidates).toBe(1);
    expect(first.delivered).toBe(1);
    expect(first.errors).toHaveLength(0);
    expect(sendPush).toHaveBeenCalledOnce();
    expect(sent[0]?.mint).toBe(MINT);
    expect(sent[0]?.url).toBe(`/cases/${tokenCase.id}`);
    expect(await hasPushDelivery(client, decision.id)).toBe(true);

    const second = await processPushDeliveries({ client, sendPush });
    expect(second.candidates).toBe(0);
    expect(second.delivered).toBe(0);
    expect(sendPush).toHaveBeenCalledOnce();
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

    await selectPassPushCandidates(client);
    await processPushDeliveries({ client, sendPush });

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
