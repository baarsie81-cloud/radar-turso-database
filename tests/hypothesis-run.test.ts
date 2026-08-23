import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  createHypothesisAsset,
  listHypothesisScoreSnapshots,
} from "../src/db/repositories/hypothesis";
import {
  acquireCollectionLock,
  DEFAULT_COLLECTION_LOCK_KEY,
  HYPOTHESIS_LOCK_KEY,
  LIFECYCLE_LOCK_KEY,
} from "../src/db/repositories/locks";
import { computeHypothesisScore } from "../src/hypothesis/score";
import { runHypothesisObservation } from "../src/hypothesis/run";

const BASE = 1_760_100_000_000;
const OWNER = "hypothesis-runner-test";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

function mint(tag: string): string {
  const safe = tag.replace(/[0OIl]/g, "x");
  return `SoHyp${safe.padEnd(39, "1")}`;
}

describe("runHypothesisObservation", () => {
  it("is disabled unless RADAR24_HYPOTHESIS_ENABLED === true", async () => {
    const client = await setup();
    await createHypothesisAsset(client, {
      mint: mint("DIS"),
      status: "WATCH",
      narrativeScore: 80,
      asymmetryScore: 70,
      catalystScore: 60,
      attentionScore: 50,
      liquidityScore: 40,
      updatedAt: BASE,
    });

    const unset = await runHypothesisObservation({
      client,
      owner: OWNER,
      now: () => BASE,
    });
    expect(unset.enabled).toBe(false);
    expect(unset.snapshotsWritten).toBe(0);

    const off = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "false" },
      now: () => BASE,
    });
    expect(off.enabled).toBe(false);
    expect(off.snapshotsWritten).toBe(0);

    const history = await listHypothesisScoreSnapshots(client, 1);
    expect(history).toHaveLength(0);
  });

  it("runs observation flow and appends score snapshots for universe assets", async () => {
    const client = await setup();
    const watch = await createHypothesisAsset(client, {
      mint: mint("WTC"),
      symbol: "WTC",
      status: "WATCH",
      narrativeScore: 80,
      asymmetryScore: 70,
      catalystScore: 60,
      attentionScore: 50,
      liquidityScore: 40,
      rank: 2,
      updatedAt: BASE,
    });
    const active = await createHypothesisAsset(client, {
      mint: mint("ACT"),
      symbol: "ACT",
      status: "ACTIVE",
      narrativeScore: 90,
      asymmetryScore: 85,
      catalystScore: 80,
      attentionScore: 75,
      liquidityScore: 70,
      rank: 1,
      updatedAt: BASE,
    });
    const invalidated = await createHypothesisAsset(client, {
      mint: mint("INV"),
      symbol: "INV",
      status: "INVALIDATED",
      narrativeScore: 99,
      asymmetryScore: 99,
      catalystScore: 99,
      attentionScore: 99,
      liquidityScore: 99,
      updatedAt: BASE,
    });

    const expectedWatch = computeHypothesisScore({
      narrative_score: 80,
      asymmetry_score: 70,
      catalyst_score: 60,
      attention_score: 50,
      liquidity_score: 40,
    });
    const expectedActive = computeHypothesisScore({
      narrative_score: 90,
      asymmetry_score: 85,
      catalyst_score: 80,
      attention_score: 75,
      liquidity_score: 70,
    });

    const summary = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 1_000,
      listAssets: async () => [watch, active],
    });

    expect(summary.enabled).toBe(true);
    expect(summary.assetsConsidered).toBe(2);
    expect(summary.snapshotsWritten).toBe(2);
    expect(summary.errors).toEqual([]);

    const watchHistory = await listHypothesisScoreSnapshots(client, watch.id);
    const activeHistory = await listHypothesisScoreSnapshots(client, active.id);
    const invalidHistory = await listHypothesisScoreSnapshots(
      client,
      invalidated.id,
    );

    expect(watchHistory).toHaveLength(1);
    expect(activeHistory).toHaveLength(1);
    expect(invalidHistory).toHaveLength(0);

    expect(watchHistory[0]).toMatchObject({
      hypothesisAssetId: watch.id,
      capturedAt: BASE + 1_000,
      hypothesisScore: expectedWatch.hypothesis_score,
      narrativeScore: expectedWatch.narrative_score,
      asymmetryScore: expectedWatch.asymmetry_score,
      catalystScore: expectedWatch.catalyst_score,
      attentionScore: expectedWatch.attention_score,
      liquidityScore: expectedWatch.liquidity_score,
      status: "WATCH",
      scoreVersion: expectedWatch.score_version,
    });
    expect(JSON.parse(watchHistory[0]!.inputsJson)).toMatchObject({
      source: "hypothesis_asset_passthrough",
      mint: watch.mint,
    });

    expect(activeHistory[0]).toMatchObject({
      hypothesisAssetId: active.id,
      hypothesisScore: expectedActive.hypothesis_score,
      status: "ACTIVE",
      rank: 1,
    });
    expect(watchHistory[0]!.rank).toBe(2);
  });

  it("is append-only and safe under replay", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("RPL"),
      status: "WATCH",
      narrativeScore: 50,
      asymmetryScore: 50,
      catalystScore: 50,
      attentionScore: 50,
      liquidityScore: 50,
      updatedAt: BASE,
    });

    const first = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 5_000,
      listAssets: async () => [asset],
    });
    expect(first.snapshotsWritten).toBe(1);

    const afterFirst = await listHypothesisScoreSnapshots(client, asset.id);
    expect(afterFirst).toHaveLength(1);
    const firstSnapshot = { ...afterFirst[0]! };

    const second = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 10_000,
      listAssets: async () => [asset],
    });
    expect(second.snapshotsWritten).toBe(1);

    const history = await listHypothesisScoreSnapshots(client, asset.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(firstSnapshot);
    expect(history[1]!.id).not.toBe(firstSnapshot.id);
    expect(history[1]!.capturedAt).toBe(BASE + 10_000);
  });

  it("fails closed when hypothesis lock is held; does not use collect/lifecycle keys", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("LCK"),
      status: "ACTIVE",
      narrativeScore: 40,
      asymmetryScore: 40,
      catalystScore: 40,
      attentionScore: 40,
      liquidityScore: 40,
      updatedAt: BASE,
    });

    const held = await acquireCollectionLock(client, {
      jobKey: HYPOTHESIS_LOCK_KEY,
      owner: "other-hypothesis-runner",
      lockedUntil: BASE + 60_000,
      startedAt: BASE,
    });
    expect(held).toBe(true);

    const blocked = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 1_000,
      listAssets: async () => [asset],
    });
    expect(blocked.enabled).toBe(true);
    expect(blocked.snapshotsWritten).toBe(0);
    expect(blocked.errors[0]?.phase).toBe("lock");
    expect(blocked.errors[0]?.message).toMatch(/hypothesis lock/i);
    expect(await listHypothesisScoreSnapshots(client, asset.id)).toHaveLength(0);

    // Foreign Radar locks must not block hypothesis observation.
    await acquireCollectionLock(client, {
      jobKey: DEFAULT_COLLECTION_LOCK_KEY,
      owner: "collect-owner",
      lockedUntil: BASE + 120_000,
      startedAt: BASE + 2_000,
    });
    await acquireCollectionLock(client, {
      jobKey: LIFECYCLE_LOCK_KEY,
      owner: "lifecycle-owner",
      lockedUntil: BASE + 120_000,
      startedAt: BASE + 2_000,
    });

    // Release hypothesis lock held by the other owner by waiting until expiry window.
    const afterExpiry = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 60_001,
      listAssets: async () => [asset],
    });
    expect(afterExpiry.snapshotsWritten).toBe(1);
    expect(afterExpiry.errors).toEqual([]);
  });
});
