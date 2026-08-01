import { describe, expect, it } from "vitest";
import { transformPrintColors, hexToRgba, PRINT_PALETTE } from "./resolveOklchColors";

/**
 * Pure (node-env) coverage for the print-colour resolver. The DOM-driven
 * `resolvePrintColors` behaviour is covered in `resolveOklchColors.dom.test.ts`
 * (needs a jsdom environment — see note in the final report).
 */

/** Deterministic stub for the oklch → rgb browser probe (no browser needed). */
const fakeOklch = (m: string): string => (m.includes("oklch") ? "rgb(1, 2, 3)" : m);

describe("hexToRgba", () => {
  it("converts #rrggbb + alpha to rgba", () => {
    expect(hexToRgba("#e2e8f0", 0.5)).toBe("rgba(226, 232, 240, 0.5)");
    expect(hexToRgba("475569", 1)).toBe("rgba(71, 85, 105, 1)");
  });
  it("clamps alpha and passes through invalid hex", () => {
    expect(hexToRgba("#000000", 2)).toBe("rgba(0, 0, 0, 1)");
    expect(hexToRgba("not-a-hex", 0.5)).toBe("not-a-hex");
  });
});

describe("transformPrintColors — oklch + hsl-var + var → hex", () => {
  it("resolves hsl(var(--token)) to the print-palette hex", () => {
    // The StationAnalysis.tsx:850 bug — hsl(oklch()) is invalid CSS and renders wrong.
    expect(transformPrintColors("color: hsl(var(--muted-foreground));", PRINT_PALETTE, fakeOklch))
      .toBe("color: #475569;");
  });

  it("handles hsl(var(--token) / alpha) → rgba (fraction and percent)", () => {
    expect(transformPrintColors("fill: hsl(var(--border) / 0.5);", PRINT_PALETTE, fakeOklch))
      .toBe("fill: rgba(226, 232, 240, 0.5);");
    expect(transformPrintColors("fill: hsl(var(--border) / 50%);", PRINT_PALETTE, fakeOklch))
      .toBe("fill: rgba(226, 232, 240, 0.5);");
  });

  it("resolves bare var(--colortoken) to the print hex", () => {
    expect(transformPrintColors("stroke: var(--chart-1);", PRINT_PALETTE, fakeOklch))
      .toBe("stroke: #0e7490;");
  });

  it("leaves non-colour tokens (e.g. --radius) untouched", () => {
    expect(transformPrintColors("border-radius: var(--radius);", PRINT_PALETTE, fakeOklch))
      .toBe("border-radius: var(--radius);");
  });

  it("resolves oklch() via the injected resolver", () => {
    expect(transformPrintColors("color: oklch(0.65 0.02 260);", PRINT_PALETTE, fakeOklch))
      .toBe("color: rgb(1, 2, 3);");
  });

  it("rewrites a mixed declaration in one pass", () => {
    const input = "border: 1px solid hsl(var(--border)); color: var(--foreground); background: oklch(0.9 0 0);";
    expect(transformPrintColors(input, PRINT_PALETTE, fakeOklch))
      .toBe("border: 1px solid #e2e8f0; color: #0f172a; background: rgb(1, 2, 3);");
  });

  it("has a light, high-contrast value for every core colour token", () => {
    for (const tok of ["foreground", "muted-foreground", "border", "card", "chart-1", "chart-5"]) {
      expect(PRINT_PALETTE[tok]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(PRINT_PALETTE.background).toBe("#ffffff");
  });
});
