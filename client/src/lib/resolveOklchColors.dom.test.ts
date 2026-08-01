// @vitest-environment jsdom
//
// DOM behaviour test for `resolvePrintColors`. Named `*.dom.test.ts` so it is
// NOT pulled into the default node-env run (no DOM library installed) — same
// convention as `lib/exportUtils.test.ts`. The pure string logic is covered in
// `resolveOklchColors.unit.test.ts`.

import { afterEach, describe, expect, it } from "vitest";
import { resolvePrintColors } from "./resolveOklchColors";

describe("resolvePrintColors (DOM)", () => {
  afterEach(() => {
    document.querySelectorAll("style").forEach((s) => s.remove());
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("style");
  });

  it("forces the light class, injects overrides, and rewrites hsl-var usages", () => {
    document.documentElement.classList.add("dark");
    const styleEl = document.createElement("style");
    styleEl.textContent = ".axis { color: hsl(var(--muted-foreground)); fill: var(--chart-2); }";
    document.head.appendChild(styleEl);

    resolvePrintColors(document);

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.querySelector("style[data-print-palette]")).not.toBeNull();
    expect(styleEl.textContent).toContain("#475569"); // muted-foreground
    expect(styleEl.textContent).toContain("#16a34a"); // chart-2
    expect(styleEl.textContent).not.toContain("hsl(var(");
  });

  it("rewrites inline styles and SVG fill/stroke attributes", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("fill", "var(--chart-3)");
    svg.setAttribute("stroke", "hsl(var(--border))");
    document.body.appendChild(svg);
    const div = document.createElement("div");
    div.setAttribute("style", "color: var(--foreground);");
    document.body.appendChild(div);

    resolvePrintColors(document);

    expect(svg.getAttribute("fill")).toBe("#d97706");
    expect(svg.getAttribute("stroke")).toBe("#e2e8f0");
    expect(div.getAttribute("style")).toContain("#0f172a");

    svg.remove();
    div.remove();
  });
});
