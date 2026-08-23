import { describe, expect, it, vi } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  claimHypothesisPushDelivery,
  createHypothesisAsset,
  hasHypothesisPushDelivery,
  insertHypothesisScoreSnapshot,
  listHypothesisEvents,
  listHypothesisScoreSnapshots,
} from "../src/db/repositories/hypothesis";
import {
  detectObservationChange,
  OBSERVATION_COMPONENT_DELTA_MIN,
  OBSERVATION_SCORE_DELTA_MIN,
} from "../src/hypothesis/observationChange";
import {
  buildHypothesisObservationPushPayload,
  deliverHypothesisObservationPush,
  HYPOTHESIS_OBSERVATION_PUSH_TITLE,
  type HypothesisObservationSendFn,
} from "../src/hypothesis/observationPush";
import { runHypothesisObservation } from "../src/hypothesis/run";

const BASE = 1_760_200_000_000;
const OWNER = "hypothesis-observation-push-test";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function mint(tag: string): string {
  const safe = tag.replace(/[0OIl]/g, "x");
  return `SoObs${safe.padEnd(39, "1")}`;
}

describe("detectObservationChange", () => {
  const base = {
    hypothesisScore: 50,
    rank: 10,
    narrativeScore: 50,
    asymmetryScore: 50,
    catalystScore: 50,
    attentionScore: 50,
    liquidityScore: 50,
    status: "WATCH" as const,
  };

  it("emits SCORE_CHANGE when research score moves by >= 5", () => {
    const change = detectObservationChange(base, {
      ...base,
      hypothesisScore: base.hypothesisScore + OBSERVATION_SCORE_DELTA_MIN,
    });
    expect(change?.kind).toBe("SCORE_CHANGE");
    expect(change?.scoreDelta).toBe(5);
  });

  it("does not emit on small score moves", () => {
    expect(
      detectObservationChange(base, {
        ...base,
        hypothesisScore: base.hypothesisScore + (OBSERVATION_SCORE_DELTA_MIN - 0.1),
      }),
    ).toBeNull();
  });

  it("emits OBSERVATION_UPDATE on rank change within top 25", () => {
    const change = detectObservationChange(base, {
      ...base,
      rank: 3,
    });
    expect(change?.kind).toBe("OBSERVATION_UPDATE");
    expect(change?.rankChangedInTop25).toBe(true);
  });

  it("emits SCORE_CHANGE when a component moves by >= 10", () => {
    const change = detectObservationChange(base, {
      ...base,
      liquidityScore: base.liquidityScore + OBSERVATION_COMPONENT_DELTA_MIN,
    });
    expect(change?.kind).toBe("SCORE_CHANGE");
    expect(change?.componentDeltas.liquidity_score).toBe(10);
  });

  it("does not emit on the first snapshot", () => {
    expect(detectObservationChange(null, base)).toBeNull();
  });
});

describe("hypothesis observation push payload", () => {
  it("builds research-only copy without trade language", () => {
    const payload = buildHypothesisObservationPushPayload({
      asset: {
        id: 1,
        mint: mint("PAY"),
        symbol: "OBS",
        name: "Observation Coin",
        status: "WATCH",
      },
      currentScore: 72,
      change: {
        kind: "SCORE_CHANGE",
        scoreDelta: 7,
        rankChangedInTop25: false,
        previousRank: 8,
        nextRank: 8,
        reasons: ["research score +7 — verder onderzoeken"],
        primaryReason: "research score +7 — verder onderzoeken",
        componentDeltas: {},
      },
      eventId: 9,
      eventType: "HYPOTHESIS_SCORE_CHANGE",
    });

    expect(payload.title).toBe(HYPOTHESIS_OBSERVATION_PUSH_TITLE);
    expect(payload.body).toContain("Coin: OBS");
    expect(payload.body).toContain("Research score: 72");
    expect(payload.body).toContain("Verandering:");
    expect(payload.body).toContain("Belangrijkste reden:");
    expect(payload.body).toContain("Status:");
    expect(payload.body.toLowerCase()).toMatch(/onderzoeken|volgen|observeren/);
    expect(payload.body.toLowerCase()).not.toMatch(/\b(buy|kopen|entry|target|stop|signal)\b/);
    expect(payload.url).toBe("/hypothesis");
  });
});

describe("deliverHypothesisObservationPush", () => {
  it("creates event and sends on meaningful score change; skips small deltas", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("CHG"),
      symbol: "CHG",
      status: "WATCH",
      narrativeScore: 50,
      asymmetryScore: 50,
      catalystScore: 50,
      attentionScore: 50,
      liquidityScore: 50,
      hypothesisScore: 50,
      rank: 5,
      updatedAt: BASE,
    });

    const previous = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE,
      hypothesisScore: 50,
      narrativeScore: 50,
      asymmetryScore: 50,
      catalystScore: 50,
      attentionScore: 50,
      liquidityScore: 50,
      status: "WATCH",
      rank: 5,
      inputsJson: "{}",
    });

    const small = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE + 1_000,
      hypothesisScore: 52,
      narrativeScore: 50,
      asymmetryScore: 50,
      catalystScore: 50,
      attentionScore: 50,
      liquidityScore: 50,
      status: "WATCH",
      rank: 5,
      inputsJson: "{}",
    });

    const sendPush = vi.fn<HypothesisObservationSendFn>(async () => undefined);

    const skipped = await deliverHypothesisObservationPush({
      client,
      asset,
      previous,
      current: small,
      env: { RADAR24_HYPOTHESIS_OBSERVATION_PUSH: "true" },
      sendPush,
      now: BASE + 1_000,
    });
    expect(skipped.skippedReason).toBe("no_change");
    expect(sendPush).not.toHaveBeenCalled();
    expect(await listHypothesisEvents(client, asset.id)).toHaveLength(0);

    const big = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE + 2_000,
      hypothesisScore: 58,
      narrativeScore: 50,
      asymmetryScore: 50,
      catalystScore: 50,
      attentionScore: 50,
      liquidityScore: 50,
      status: "WATCH",
      rank: 5,
      inputsJson: "{}",
    });

    const delivered = await deliverHypothesisObservationPush({
      client,
      asset,
      previous: small,
      current: big,
      env: { RADAR24_HYPOTHESIS_OBSERVATION_PUSH: "true" },
      sendPush,
      now: BASE + 2_000,
    });

    expect(delivered.notified).toBe(true);
    expect(delivered.pushEventType).toBe("HYPOTHESIS_SCORE_CHANGE");
    expect(sendPush).toHaveBeenCalledTimes(1);
    const payload = sendPush.mock.calls[0]?.[0];
    expect(payload?.title).toBe(HYPOTHESIS_OBSERVATION_PUSH_TITLE);
    expect(payload?.eventType).toBe("HYPOTHESIS_SCORE_CHANGE");
    expect(await hasHypothesisPushDelivery(client, delivered.eventId!)).toBe(true);

    const events = await listHypothesisEvents(client, asset.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("SCORE_CHANGE");
  });

  it("creates OBSERVATION_UPDATE on rank change and prevents duplicate delivery", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("RNK"),
      symbol: "RNK",
      status: "WATCH",
      narrativeScore: 60,
      asymmetryScore: 60,
      catalystScore: 60,
      attentionScore: 60,
      liquidityScore: 60,
      hypothesisScore: 60,
      rank: 12,
      updatedAt: BASE,
    });

    const previous = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE,
      hypothesisScore: 60,
      narrativeScore: 60,
      asymmetryScore: 60,
      catalystScore: 60,
      attentionScore: 60,
      liquidityScore: 60,
      status: "WATCH",
      rank: 12,
      inputsJson: "{}",
    });
    const current = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE + 1_000,
      hypothesisScore: 60,
      narrativeScore: 60,
      asymmetryScore: 60,
      catalystScore: 60,
      attentionScore: 60,
      liquidityScore: 60,
      status: "WATCH",
      rank: 4,
      inputsJson: "{}",
    });

    const sendPush = vi.fn(async () => undefined);
    const first = await deliverHypothesisObservationPush({
      client,
      asset,
      previous,
      current,
      env: { RADAR24_HYPOTHESIS_OBSERVATION_PUSH: "true" },
      sendPush,
      now: BASE + 1_000,
    });
    expect(first.notified).toBe(true);
    expect(first.pushEventType).toBe("HYPOTHESIS_OBSERVATION_UPDATE");

    // Same event cannot be claimed twice.
    const again = await claimHypothesisPushDelivery(client, {
      eventId: first.eventId!,
      eventType: "HYPOTHESIS_OBSERVATION_UPDATE",
      sentAt: BASE + 2_000,
    });
    expect(again).toBeNull();
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});

describe("runHypothesisObservation observation push wiring", () => {
  it("does not push when observation push flag is false", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("OFF"),
      status: "WATCH",
      narrativeScore: 40,
      asymmetryScore: 40,
      catalystScore: 40,
      attentionScore: 40,
      liquidityScore: 40,
      updatedAt: BASE,
    });
    await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: BASE,
      hypothesisScore: 40,
      narrativeScore: 40,
      asymmetryScore: 40,
      catalystScore: 40,
      attentionScore: 40,
      liquidityScore: 40,
      status: "WATCH",
      rank: 1,
      inputsJson: "{}",
    });

    const sendPush = vi.fn(async () => undefined);
    const summary = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: {
        RADAR24_HYPOTHESIS_ENABLED: "true",
        RADAR24_HYPOTHESIS_OBSERVATION_PUSH: "false",
      },
      now: () => BASE + 5_000,
      listAssets: async () => [
        {
          ...asset,
          narrativeScore: 80,
          asymmetryScore: 80,
          catalystScore: 80,
          attentionScore: 80,
          liquidityScore: 80,
        },
      ],
      sendObservationPush: sendPush,
    });

    expect(summary.snapshotsWritten).toBe(1);
    expect(summary.observationEvents).toBe(0);
    expect(summary.observationPushes).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
    expect(await listHypothesisEvents(client, asset.id)).toHaveLength(0);
    expect(await listHypothesisScoreSnapshots(client, asset.id)).toHaveLength(2);
  });
});
