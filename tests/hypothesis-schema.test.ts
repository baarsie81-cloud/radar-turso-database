import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  claimHypothesisPushDelivery,
  createHypothesisAsset,
  hasHypothesisPushDelivery,
  insertHypothesisEvent,
  insertHypothesisScoreSnapshot,
  listHypothesisScoreSnapshots,
} from "../src/db/repositories/hypothesis";
import {
  HYPOTHESIS_SCORE_VERSION,
  HYPOTHESIS_SCORE_WEIGHTS,
} from "../src/domain/hypothesis";

describe("0005_hypothesis schema", () => {
  it("applies hypothesis tables and accepts a full asset + score + event path", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    const ran = await migrate(client);
    expect(ran).toContain("0005_hypothesis");

    const now = Date.now();
    const asset = await createHypothesisAsset(client, {
      mint: "SoHypMint111111111111111111111111111111111",
      symbol: "HYP",
      name: "Hypothesis Token",
      category: "solana-ecosystem",
      status: "WATCH",
      hypothesisScore: 70,
      narrativeScore: 80,
      asymmetryScore: 60,
      catalystScore: 70,
      attentionScore: 50,
      liquidityScore: 65,
      rank: 1,
      narrativeSummary: "Solana ecosystem narrative",
      catalystSummary: "Upcoming catalyst",
      enteredUniverseAt: now,
      updatedAt: now,
      inputsJson: JSON.stringify({ source: "test" }),
    });

    expect(asset.id).toBe(1);
    expect(asset.status).toBe("WATCH");
    expect(asset.scoreVersion).toBe(HYPOTHESIS_SCORE_VERSION);

    const snapshot = await insertHypothesisScoreSnapshot(client, {
      hypothesisAssetId: asset.id,
      capturedAt: now,
      hypothesisScore: asset.hypothesisScore,
      narrativeScore: asset.narrativeScore,
      asymmetryScore: asset.asymmetryScore,
      catalystScore: asset.catalystScore,
      attentionScore: asset.attentionScore,
      liquidityScore: asset.liquidityScore,
      status: asset.status,
      rank: asset.rank,
      inputsJson: asset.inputsJson,
    });
    expect(snapshot.hypothesisAssetId).toBe(asset.id);

    const history = await listHypothesisScoreSnapshots(client, asset.id);
    expect(history).toHaveLength(1);

    const event = await insertHypothesisEvent(client, {
      hypothesisAssetId: asset.id,
      eventType: "ENTERED",
      payloadJson: JSON.stringify({ rank: 1 }),
      createdAt: now,
    });
    expect(event.eventType).toBe("ENTERED");

    const claimed = await claimHypothesisPushDelivery(client, {
      eventId: event.id,
      eventType: "HYPOTHESIS_ACTIVATED",
      sentAt: now,
    });
    expect(claimed?.eventId).toBe(event.id);
    expect(await hasHypothesisPushDelivery(client, event.id)).toBe(true);

    const duplicate = await claimHypothesisPushDelivery(client, {
      eventId: event.id,
      eventType: "HYPOTHESIS_ACTIVATED",
      sentAt: now + 1,
    });
    expect(duplicate).toBeNull();
  });

  it("rejects invalid hypothesis status and duplicate open mint", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    await migrate(client);
    const now = Date.now();

    await expect(
      client.execute({
        sql: `
          INSERT INTO hypothesis_assets (mint, status, updated_at)
          VALUES (?, 'PENDING', ?)
        `,
        args: ["SoHypA", now],
      }),
    ).rejects.toThrow();

    await createHypothesisAsset(client, {
      mint: "SoHypDup111111111111111111111111111111111",
      status: "WATCH",
      updatedAt: now,
    });
    await expect(
      createHypothesisAsset(client, {
        mint: "SoHypDup111111111111111111111111111111111",
        status: "ACTIVE",
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("exposes h1.0 score weights that sum to 1", () => {
    const sum =
      HYPOTHESIS_SCORE_WEIGHTS.narrative
      + HYPOTHESIS_SCORE_WEIGHTS.asymmetry
      + HYPOTHESIS_SCORE_WEIGHTS.catalyst
      + HYPOTHESIS_SCORE_WEIGHTS.attention
      + HYPOTHESIS_SCORE_WEIGHTS.liquidity;
    expect(sum).toBeCloseTo(1, 10);
    expect(HYPOTHESIS_SCORE_WEIGHTS.narrative).toBe(0.25);
    expect(HYPOTHESIS_SCORE_WEIGHTS.asymmetry).toBe(0.25);
    expect(HYPOTHESIS_SCORE_WEIGHTS.catalyst).toBe(0.2);
    expect(HYPOTHESIS_SCORE_WEIGHTS.attention).toBe(0.15);
    expect(HYPOTHESIS_SCORE_WEIGHTS.liquidity).toBe(0.15);
  });
});
