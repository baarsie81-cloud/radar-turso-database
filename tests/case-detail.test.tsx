import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseDetailView } from "../components/case-detail";
import type { CaseSummary } from "../src/db/repositories/tokenCases";
import type { DecisionRow } from "../src/db/repositories/decisions";
import type { TokenCaseRow } from "../src/db/repositories/tokenCases";

const BASE = 1_700_000_000_000;
const MINT = "SoMint1111111111111111111111111111111111111";

function makeTokenCase(overrides: Partial<TokenCaseRow> = {}): TokenCaseRow {
  return {
    id: 42,
    mint: MINT,
    symbol: "RADAR",
    name: "Radar Token",
    firstSeenAt: BASE,
    entryPrice: 0.001,
    entryValid: true,
    stage: "PLUS_10",
    caseStatus: "OPEN",
    radarVersion: "2.4",
    outcomeLabel: null,
    outcomeLabeledAt: null,
    outcomeInputsJson: null,
    createdAt: BASE,
    updatedAt: BASE,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 7,
    tokenCaseId: 42,
    decisionStage: "PLUS_10",
    decidedAt: BASE + 600_000,
    decisionStatus: "PASS",
    rejectReason: null,
    radarVersion: "2.4",
    entryPrice: 0.001,
    plus5RoiPct: 20,
    plus10RoiPct: 30,
    momentum5To10Pct: 10,
    inputsJson: JSON.stringify({ entryPrice: 0.001, plus5RoiPct: 20 }),
    ...overrides,
  };
}

function makeSummary(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    tokenCase: makeTokenCase(),
    snapshots: [],
    decisions: [],
    socialCalls: [],
    ...overrides,
  };
}

function render(summary: CaseSummary): string {
  return renderToStaticMarkup(createElement(CaseDetailView, { summary }));
}

describe("CaseDetailView", () => {
  it("renders Observation mode indicator", () => {
    const html = render(makeSummary());
    expect(html).toContain("Observation mode");
    expect(html).toContain('data-testid="observation-mode"');
  });

  it("renders token information with Mint Address clearly labeled", () => {
    const html = render(makeSummary());

    expect(html).toContain("Token information");
    expect(html).toContain("Token name");
    expect(html).toContain("Radar Token");
    expect(html).toContain("Symbol");
    expect(html).toContain("RADAR");
    expect(html).toContain("Mint Address");
    expect(html).toContain(MINT);
    expect(html).toContain('data-testid="mint-address-value"');
    expect(html).toContain(">Copy</button>");
  });

  it("renders decision status, stage, metrics, and timestamp", () => {
    const html = render(
      makeSummary({
        decisions: [makeDecision()],
      }),
    );

    expect(html).toContain('data-testid="decision-section"');
    expect(html).toContain("Decision status");
    expect(html).toContain("PASS");
    expect(html).toContain("Decision stage");
    expect(html).toContain("PLUS_10");
    expect(html).toContain("Radar version");
    expect(html).toContain("2.4");
    expect(html).toContain("Decided timestamp");
    expect(html).toContain(new Date(BASE + 600_000).toISOString());
    expect(html).toContain("Entry price");
    expect(html).toContain("0.001");
    expect(html).toContain("Plus5 ROI");
    expect(html).toContain("20.00%");
    expect(html).toContain("Plus10 ROI");
    expect(html).toContain("30.00%");
    expect(html).toContain("Momentum");
    expect(html).toContain("10.00%");
    expect(html).not.toContain("Reject reason");
  });

  it("renders reject reason when available", () => {
    const html = render(
      makeSummary({
        decisions: [
          makeDecision({
            decisionStatus: "REJECT",
            rejectReason: "NEGATIVE_MOMENTUM_5_TO_10",
            plus5RoiPct: 40,
            plus10RoiPct: 30,
            momentum5To10Pct: -10,
          }),
        ],
      }),
    );

    expect(html).toContain("Decision status");
    expect(html).toContain("REJECT");
    expect(html).toContain("Reject reason");
    expect(html).toContain("NEGATIVE_MOMENTUM_5_TO_10");
  });

  it("shows empty decision state when none recorded", () => {
    const html = render(makeSummary({ decisions: [] }));
    expect(html).toContain("No decision recorded yet.");
  });
});
