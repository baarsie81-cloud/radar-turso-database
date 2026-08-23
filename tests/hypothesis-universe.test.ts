import { describe, expect, it } from "vitest";
import {
  ACTIVE_UNIVERSE_MAX,
  rankHypothesisAssets,
  selectHypothesisUniverse,
  shouldReplaceAsset,
  type HypothesisUniverseAsset,
} from "../src/hypothesis/universe";
import {
  HYPOTHESIS_REPLACEMENT_MARGIN,
  HYPOTHESIS_UNIVERSE_MAX,
} from "../src/domain/hypothesis";

function asset(
  overrides: Partial<HypothesisUniverseAsset> & Pick<HypothesisUniverseAsset, "id" | "hypothesis_score">,
): HypothesisUniverseAsset {
  const id = overrides.id;
  return {
    mint: overrides.mint ?? id,
    status: overrides.status ?? "WATCH",
    ...overrides,
    id,
  };
}

function ids(assets: readonly { id: string }[]): string[] {
  return assets.map((a) => a.id);
}

describe("rankHypothesisAssets", () => {
  it("ranks by hypothesis_score descending", () => {
    const ranked = rankHypothesisAssets([
      asset({ id: "a", hypothesis_score: 40 }),
      asset({ id: "b", hypothesis_score: 90 }),
      asset({ id: "c", hypothesis_score: 70 }),
    ]);

    expect(ranked.map((row) => ({ id: row.id, rank: row.rank }))).toEqual([
      { id: "b", rank: 1 },
      { id: "c", rank: 2 },
      { id: "a", rank: 3 },
    ]);
  });
});

describe("shouldReplaceAsset", () => {
  it("replaces only when candidate beats weakest by replacement margin", () => {
    expect(
      shouldReplaceAsset({
        candidateScore: 55,
        weakestScore: 50,
        replacementMargin: HYPOTHESIS_REPLACEMENT_MARGIN,
      }),
    ).toBe(true);

    expect(
      shouldReplaceAsset({
        candidateScore: 54.9,
        weakestScore: 50,
      }),
    ).toBe(false);

    expect(
      shouldReplaceAsset({
        candidateScore: 54,
        weakestScore: 50,
      }),
    ).toBe(false);
  });
});

describe("selectHypothesisUniverse", () => {
  it("selects at most top 25 assets", () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      asset({
        id: `c${String(i).padStart(2, "0")}`,
        hypothesis_score: 100 - i,
      }),
    );

    const selected = selectHypothesisUniverse([], candidates);
    expect(ACTIVE_UNIVERSE_MAX).toBe(25);
    expect(HYPOTHESIS_UNIVERSE_MAX).toBe(25);
    expect(selected).toHaveLength(25);
    expect(selected[0]?.id).toBe("c00");
    expect(selected[0]?.rank).toBe(1);
    expect(selected[24]?.id).toBe("c24");
    expect(selected[24]?.rank).toBe(25);
  });

  it("ranks the selected universe by score", () => {
    const selected = selectHypothesisUniverse(
      [],
      [
        asset({ id: "low", hypothesis_score: 10 }),
        asset({ id: "high", hypothesis_score: 90 }),
        asset({ id: "mid", hypothesis_score: 50 }),
      ],
    );

    expect(ids(selected)).toEqual(["high", "mid", "low"]);
    expect(selected.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("lets a candidate replace the weakest only with +5 margin", () => {
    const current = Array.from({ length: 25 }, (_, i) =>
      asset({
        id: `u${String(i).padStart(2, "0")}`,
        hypothesis_score: 60 - i * 0.1,
        status: "ACTIVE",
      }),
    );
    // Weakest ~ 60 - 2.4 = 57.6
    const weakest = current[current.length - 1]!;
    const candidate = asset({
      id: "challenger",
      hypothesis_score: weakest.hypothesis_score + 5,
      status: "WATCH",
    });

    const selected = selectHypothesisUniverse(current, [...current, candidate]);
    expect(selected).toHaveLength(25);
    expect(ids(selected)).toContain("challenger");
    expect(ids(selected)).not.toContain(weakest.id);
  });

  it("does not replace the weakest when the score gap is below +5", () => {
    const current = Array.from({ length: 25 }, (_, i) =>
      asset({
        id: `u${String(i).padStart(2, "0")}`,
        hypothesis_score: 60 - i * 0.1,
        status: "ACTIVE",
      }),
    );
    const weakest = current[current.length - 1]!;
    const candidate = asset({
      id: "almost",
      hypothesis_score: weakest.hypothesis_score + 4.9,
      status: "WATCH",
    });

    const selected = selectHypothesisUniverse(current, [...current, candidate]);
    expect(selected).toHaveLength(25);
    expect(ids(selected)).not.toContain("almost");
    expect(ids(selected)).toContain(weakest.id);
  });

  it("keeps existing WATCH/ACTIVE members sticky when not clearly beaten", () => {
    const current = [
      asset({ id: "sticky-a", hypothesis_score: 40, status: "WATCH" }),
      asset({ id: "sticky-b", hypothesis_score: 41, status: "ACTIVE" }),
    ];
    const candidates = [
      asset({ id: "outsider", hypothesis_score: 44, status: "WATCH" }),
      ...current,
    ];

    // Universe not full: outsider fills a vacancy; sticky members remain.
    const selected = selectHypothesisUniverse(current, candidates);
    expect(ids(selected).sort()).toEqual(["outsider", "sticky-a", "sticky-b"].sort());

    const fullCurrent = Array.from({ length: 25 }, (_, i) =>
      asset({
        id: `keep${String(i).padStart(2, "0")}`,
        hypothesis_score: 70 - i,
        status: i % 2 === 0 ? "WATCH" : "ACTIVE",
      }),
    );
    const weakChallenger = asset({
      id: "nope",
      hypothesis_score: fullCurrent[fullCurrent.length - 1]!.hypothesis_score + 1,
    });
    const fullSelected = selectHypothesisUniverse(fullCurrent, [
      ...fullCurrent,
      weakChallenger,
    ]);
    expect(ids(fullSelected).sort()).toEqual(ids(fullCurrent).sort());
    expect(ids(fullSelected)).not.toContain("nope");
  });

  it("handles empty lists and fewer than 25 assets", () => {
    expect(selectHypothesisUniverse([], [])).toEqual([]);

    const few = [
      asset({ id: "one", hypothesis_score: 10 }),
      asset({ id: "two", hypothesis_score: 20 }),
    ];
    const selected = selectHypothesisUniverse([], few);
    expect(selected).toHaveLength(2);
    expect(ids(selected)).toEqual(["two", "one"]);

    const withInvalid = selectHypothesisUniverse(
      [asset({ id: "gone", hypothesis_score: 99, status: "INVALIDATED" })],
      [asset({ id: "ok", hypothesis_score: 50, status: "WATCH" })],
    );
    expect(ids(withInvalid)).toEqual(["ok"]);
  });

  it("drops members below the score floor", () => {
    const selected = selectHypothesisUniverse(
      [
        asset({ id: "keep", hypothesis_score: 30, status: "WATCH" }),
        asset({ id: "edge", hypothesis_score: 10, status: "ACTIVE" }),
        asset({ id: "drop", hypothesis_score: 9.9, status: "ACTIVE" }),
      ],
      [],
      { scoreFloor: 10 },
    );
    expect(ids(selected).sort()).toEqual(["edge", "keep"].sort());
  });
});
