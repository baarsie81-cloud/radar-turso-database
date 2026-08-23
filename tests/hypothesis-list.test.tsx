import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HYPOTHESIS_STATUS_LABELS,
  HypothesisList,
  type HypothesisListRow,
} from "../components/hypothesis-list";

function row(
  overrides: Partial<HypothesisListRow> & Pick<HypothesisListRow, "id">,
): HypothesisListRow {
  return {
    coin: "Example Coin",
    symbol: "EXM",
    category: "narrative",
    hypothesis_score: 72,
    status: "WATCH",
    rank: 1,
    narrative_score: 70,
    asymmetry_score: 65,
    catalyst_score: 60,
    attention_score: 55,
    liquidity_score: 50,
    updated_at: Date.UTC(2026, 7, 23, 12, 0, 0),
    ...overrides,
  };
}

describe("HypothesisList", () => {
  it("renders empty research placeholder when there are no rows", () => {
    const html = renderToStaticMarkup(createElement(HypothesisList, { rows: [] }));

    expect(html).toContain('data-testid="hypothesis-empty"');
    expect(html).toContain("Nog geen hypotheses");
    expect(html).toContain("handmatig onderzoeken");
    expect(html.toLowerCase()).not.toContain("buy");
    expect(html.toLowerCase()).not.toContain("entry");
    expect(html.toLowerCase()).not.toContain("target");
    expect(html.toLowerCase()).not.toContain("stop");
    expect(html.toLowerCase()).not.toMatch(/\bsignal\b/);
  });

  it("renders research columns and clear status labels", () => {
    const html = renderToStaticMarkup(
      createElement(HypothesisList, {
        rows: [
          row({ id: "1", status: "WATCH" }),
          row({ id: "2", status: "ACTIVE", symbol: "ACT", rank: 2 }),
          row({ id: "3", status: "INVALIDATED", symbol: "INV", rank: null }),
        ],
      }),
    );

    expect(html).toContain('data-testid="hypothesis-table"');
    expect(html).toContain(">coin<");
    expect(html).toContain(">symbol<");
    expect(html).toContain(">category<");
    expect(html).toContain(">research score<");
    expect(html).toContain(">status<");
    expect(html).toContain(">rank<");
    expect(html).toContain(">narrative_score<");
    expect(html).toContain(">asymmetry_score<");
    expect(html).toContain(">catalyst_score<");
    expect(html).toContain(">attention_score<");
    expect(html).toContain(">liquidity_score<");
    expect(html).toContain(">updated_at<");
    expect(html).toContain(HYPOTHESIS_STATUS_LABELS.WATCH);
    expect(html).toContain(HYPOTHESIS_STATUS_LABELS.ACTIVE);
    expect(html).toContain(HYPOTHESIS_STATUS_LABELS.INVALIDATED);
    expect(html).toContain("EXM");
    expect(html).toContain("72");
    expect(html.toLowerCase()).not.toContain("buy");
    expect(html.toLowerCase()).not.toContain("entry");
    expect(html.toLowerCase()).not.toContain("target");
    expect(html.toLowerCase()).not.toContain("stop");
    expect(html.toLowerCase()).not.toMatch(/\bsignal\b/);
  });
});
