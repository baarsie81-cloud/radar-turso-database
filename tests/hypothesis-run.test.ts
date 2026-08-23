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
import { upsertSnapshot } from "../src/db/repositories/snapshots";
import { createTokenCase } from "../src/db/repositories/tokenCases";
import {
  mapAbsPctToAttentionScore,
  mapLiquidityUsdToScore,
  mapMarketCapToAsymmetryScore,
} from "../src/hypothesis/marketAdapter";
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
      source: "hypothesis_market_adapter",
      mint: watch.mint,
      market_resolution: "none",
      components: {
        narrative_score: "seed_retained",
        catalyst_score: "seed_retained",
        asymmetry_score: "seed_fallback",
        attention_score: "seed_fallback",
        liquidity_score: "seed_fallback",
      },
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

  it("uses market adapter with existing radar snapshot data", async () => {
    const client = await setup();

    const tokenCase = await createTokenCase(client, {
      mint: mint("MKT"),
      symbol: "MKT",
      firstSeenAt: BASE,
      entryPrice: 1,
      entryValid: true,
      stage: "INITIAL",
      caseStatus: "OPEN",
      createdAt: BASE,
    });
    await upsertSnapshot(client, {
      tokenCaseId: tokenCase.id,
      stage: "INITIAL",
      capturedAt: BASE,
      price: 1,
      roiPct: 20,
      marketCap: 1_000_000,
      liquidityUsd: 100_000,
    });

    const asset = await createHypothesisAsset(client, {
      mint: mint("MKT"),
      symbol: "MKT",
      status: "WATCH",
      tokenCaseId: tokenCase.id,
      narrativeScore: 70,
      asymmetryScore: 40,
      catalystScore: 55,
      attentionScore: 35,
      liquidityScore: 30,
      updatedAt: BASE,
    });

    const summary = await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 2_000,
      listAssets: async () => [asset],
    });
    expect(summary.snapshotsWritten).toBe(1);

    const [snap] = await listHypothesisScoreSnapshots(client, asset.id);
    expect(snap).toBeTruthy();
    expect(snap!.narrativeScore).toBe(70);
    expect(snap!.catalystScore).toBe(55);
    expect(snap!.liquidityScore).toBe(mapLiquidityUsdToScore(100_000));
    expect(snap!.asymmetryScore).toBe(mapMarketCapToAsymmetryScore(1_000_000));
    expect(snap!.attentionScore).toBe(mapAbsPctToAttentionScore(20));

    const expected = computeHypothesisScore({
      narrative_score: 70,
      catalyst_score: 55,
      asymmetry_score: snap!.asymmetryScore,
      attention_score: snap!.attentionScore,
      liquidity_score: snap!.liquidityScore,
    });
    expect(snap!.hypothesisScore).toBe(expected.hypothesis_score);

    const provenance = JSON.parse(snap!.inputsJson);
    expect(provenance.source).toBe("hypothesis_market_adapter");
    expect(provenance.market_resolution).toBe("token_case_id_snapshot");
    expect(provenance.data_sources).toContain("radar_snapshots");
    expect(provenance.components.liquidity_score).toBe("market");
    expect(provenance.components.asymmetry_score).toBe("market");
    expect(provenance.components.attention_score).toBe("market");
    expect(provenance.attention_basis).toBe("roiPct");
    expect(provenance.missing_fields).toEqual(
      expect.arrayContaining(["volumeUsd", "priceChangePct", "momentumPct"]),
    );
  });

  it("falls back via market adapter when no market rows exist", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("FBK"),
      status: "WATCH",
      narrativeScore: 66,
      asymmetryScore: 44,
      catalystScore: 55,
      attentionScore: 33,
      liquidityScore: 22,
      updatedAt: BASE,
    });

    await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 3_000,
      listAssets: async () => [asset],
    });

    const [snap] = await listHypothesisScoreSnapshots(client, asset.id);
    const expected = computeHypothesisScore({
      narrative_score: 66,
      asymmetry_score: 44,
      catalyst_score: 55,
      attention_score: 33,
      liquidity_score: 22,
    });
    expect(snap).toMatchObject({
      hypothesisScore: expected.hypothesis_score,
      narrativeScore: 66,
      asymmetryScore: 44,
      catalystScore: 55,
      attentionScore: 33,
      liquidityScore: 22,
    });

    const provenance = JSON.parse(snap!.inputsJson);
    expect(provenance.source).toBe("hypothesis_market_adapter");
    expect(provenance.market_resolution).toBe("none");
    expect(provenance.data_sources).toEqual([]);
    expect(provenance.components.liquidity_score).toBe("seed_fallback");
    expect(provenance.missing_fields).toContain("liquidityUsd");
  });

  it("replay with same market inputs yields the same score", async () => {
    const client = await setup();
    const asset = await createHypothesisAsset(client, {
      mint: mint("DET"),
      status: "ACTIVE",
      narrativeScore: 60,
      asymmetryScore: 50,
      catalystScore: 40,
      attentionScore: 30,
      liquidityScore: 20,
      updatedAt: BASE,
    });

    const gatherMarket = async () => ({
      market: {
        price: 2,
        marketCap: 5_000_000,
        liquidityUsd: 250_000,
        roiPct: 12,
      },
      dataSources: ["test_fixture"],
      missingFields: ["volumeUsd", "priceChangePct", "momentumPct"],
      resolution: "none" as const,
      snapshotId: null,
      tokenCaseId: null,
    });

    await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 4_000,
      listAssets: async () => [asset],
      gatherMarket,
    });
    await runHypothesisObservation({
      client,
      owner: OWNER,
      env: { RADAR24_HYPOTHESIS_ENABLED: "true" },
      now: () => BASE + 5_000,
      listAssets: async () => [asset],
      gatherMarket,
    });

    const history = await listHypothesisScoreSnapshots(client, asset.id);
    expect(history).toHaveLength(2);
    expect(history[0]!.hypothesisScore).toBe(history[1]!.hypothesisScore);
    expect(history[0]!.narrativeScore).toBe(history[1]!.narrativeScore);
    expect(history[0]!.asymmetryScore).toBe(history[1]!.asymmetryScore);
    expect(history[0]!.catalystScore).toBe(history[1]!.catalystScore);
    expect(history[0]!.attentionScore).toBe(history[1]!.attentionScore);
    expect(history[0]!.liquidityScore).toBe(history[1]!.liquidityScore);

    const firstInputs = JSON.parse(history[0]!.inputsJson);
    const secondInputs = JSON.parse(history[1]!.inputsJson);
    expect(firstInputs.score_input).toEqual(secondInputs.score_input);
    expect(firstInputs.components).toEqual(secondInputs.components);
  });
});
