import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatRadarFetchedAt,
  RadarRefreshBar,
} from "../components/radar-refresh";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("RadarRefreshBar", () => {
  it("formats fetchedAt timestamp", () => {
    const ts = Date.UTC(2026, 7, 22, 18, 30, 0);
    const formatted = formatRadarFetchedAt(ts);
    expect(formatted).not.toBe("—");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatRadarFetchedAt(0)).toBe("—");
    expect(formatRadarFetchedAt(Number.NaN)).toBe("—");
  });

  it("renders Last updated label and Refresh button", () => {
    const fetchedAt = Date.UTC(2026, 7, 22, 18, 30, 0);
    const html = renderToStaticMarkup(
      createElement(RadarRefreshBar, { fetchedAt }),
    );

    expect(html).toContain('data-testid="radar-refresh"');
    expect(html).toContain("Last updated:");
    expect(html).toContain(formatRadarFetchedAt(fetchedAt));
    expect(html).toContain('data-testid="radar-refresh-button"');
    expect(html).toContain(">Refresh</button>");
  });
});
