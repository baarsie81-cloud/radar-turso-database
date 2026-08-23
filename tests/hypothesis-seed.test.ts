import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import {
  listHypothesisUniverseAssets,
} from "../src/db/repositories/hypothesis";
import {
  HYPOTHESIS_CATEGORIES,
  HYPOTHESIS_SCORE_VERSION,
  HYPOTHESIS_UNIVERSE_MAX,
} from "../src/domain/hypothesis";
import {
  HYPOTHESIS_SEED_UNIVERSE,
  seedHypothesisUniverse,
} from "../src/hypothesis/seedUniverse";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

describe("hypothesis seed universe", () => {
  it("seeds unique WATCH assets within the max 25 universe", async () => {
    const client = await setup();
    const assets = await listHypothesisUniverseAssets(client);

    expect(HYPOTHESIS_SEED_UNIVERSE.length).toBeGreaterThan(0);
    expect(HYPOTHESIS_SEED_UNIVERSE.length).toBeLessThanOrEqual(
      HYPOTHESIS_UNIVERSE_MAX,
    );
    expect(assets.length).toBe(HYPOTHESIS_SEED_UNIVERSE.length);
    expect(assets.length).toBeLessThanOrEqual(HYPOTHESIS_UNIVERSE_MAX);

    const mints = assets.map((row) => row.mint);
    expect(new Set(mints).size).toBe(mints.length);

    const symbols = assets.map((row) => row.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);

    for (const row of assets) {
      expect(row.status).toBe("WATCH");
      expect(row.scoreVersion).toBe(HYPOTHESIS_SCORE_VERSION);
      expect(row.activatedAt).toBeNull();
      expect(HYPOTHESIS_CATEGORIES).toContain(row.category);
      expect(row.narrativeSummary).toBeTruthy();
      expect(row.catalystSummary).toBeTruthy();
      const inputs = JSON.parse(row.inputsJson);
      expect(inputs.research_only).toBe(true);
      expect(inputs.not_a_trade_list).toBe(true);
      expect(String(row.inputsJson).toLowerCase()).not.toMatch(
        /\b(buy|entry|target|stop|signal)\b/,
      );
    }

    const categoriesUsed = new Set(assets.map((row) => row.category));
    for (const category of HYPOTHESIS_CATEGORIES) {
      expect(categoriesUsed.has(category)).toBe(true);
    }
  });

  it("defaults seeded assets to WATCH", async () => {
    const client = await setup();
    const assets = await listHypothesisUniverseAssets(client);
    expect(assets.every((row) => row.status === "WATCH")).toBe(true);
    expect(
      HYPOTHESIS_SEED_UNIVERSE.every((seed) => seed.category.length > 0),
    ).toBe(true);
  });

  it("prevents duplicate seed inserts on replay", async () => {
    const client = await setup();
    const before = await listHypothesisUniverseAssets(client);
    expect(before.length).toBe(HYPOTHESIS_SEED_UNIVERSE.length);

    const replay = await seedHypothesisUniverse(client);
    expect(replay.inserted).toBe(0);
    expect(replay.skipped).toBe(HYPOTHESIS_SEED_UNIVERSE.length);
    expect(replay.total).toBe(HYPOTHESIS_SEED_UNIVERSE.length);

    const after = await listHypothesisUniverseAssets(client);
    expect(after.length).toBe(before.length);
    expect(after.map((row) => row.mint).sort()).toEqual(
      before.map((row) => row.mint).sort(),
    );
  });
});
