// @vitest-environment jsdom
//
// DOM orchestration test for the off-screen print-view capture. Named
// `*.dom.test.ts` so it is NOT pulled into the default node-env run (which has
// no DOM library installed) — same convention as `lib/exportUtils.test.ts`.
// Run with a jsdom environment available to exercise it.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";

// Mock html2canvas so the orchestration runs without a real rasteriser.
vi.mock("html2canvas", () => ({
  default: vi.fn(async (el: HTMLElement) => ({
    // Echo the chart key so we can prove each wrapper was captured.
    toDataURL: () => `data:image/png;base64,${el.getAttribute("data-chart-key")}`,
  })),
}));

import { capturePrintCharts, normalizeCaptureOptions, PRINT_VIEW_WIDTH } from "./reportPrintView";

describe("normalizeCaptureOptions", () => {
  it("applies defaults", () => {
    expect(normalizeCaptureOptions()).toEqual({
      width: PRINT_VIEW_WIDTH,
      settleMs: 180,
      scale: 2,
      backgroundColor: "#ffffff",
    });
  });
  it("honours overrides", () => {
    expect(normalizeCaptureOptions({ width: 800, scale: 3 })).toMatchObject({ width: 800, scale: 3 });
  });
});

describe("capturePrintCharts", () => {
  it("returns {} and touches no DOM for an empty list", async () => {
    const before = document.body.childElementCount;
    const res = await capturePrintCharts([]);
    expect(res).toEqual({});
    expect(document.body.childElementCount).toBe(before);
  });

  it("mounts all charts off-screen, captures each, then unmounts/cleans up", async () => {
    const res = await capturePrintCharts(
      [
        { key: "chart-a", render: () => createElement("div", null, "A") },
        { key: "chart-b", render: () => createElement("div", null, "B"), height: 240 },
      ],
      { settleMs: 0 },
    );

    expect(Object.keys(res).sort()).toEqual(["chart-a", "chart-b"]);
    expect(res["chart-a"]).toBe("data:image/png;base64,chart-a");
    expect(res["chart-b"]).toBe("data:image/png;base64,chart-b");

    // The off-screen host is removed after capture (no leak).
    expect(document.querySelector("[data-report-print-view]")).toBeNull();
  });
});
