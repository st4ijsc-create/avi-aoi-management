/**
 * doc 44 W6-2 / G5.15 — canonical severity mapping (pure, node env).
 */
import { describe, it, expect } from "vitest";
import {
  toCanonicalSeverity,
  andonStateToCanonical,
  compareSeverity,
  severityAtLeast,
  severityMeta,
  SEVERITY_RANK,
} from "./severityCanonical";

describe("toCanonicalSeverity — all source dialects → 4-scale", () => {
  it("andon states", () => {
    expect(andonStateToCanonical("green")).toBe("info");
    expect(andonStateToCanonical("yellow")).toBe("warning");
    expect(andonStateToCanonical("red")).toBe("critical");
    expect(andonStateToCanonical("call")).toBe("critical"); // escalation
  });

  it("3-scale (mqtt / central DB enum)", () => {
    expect(toCanonicalSeverity("info")).toBe("info");
    expect(toCanonicalSeverity("warning")).toBe("warning");
    expect(toCanonicalSeverity("critical")).toBe("critical");
  });

  it("4-scale (UNS event bus canonical) is idempotent", () => {
    for (const s of ["info", "warning", "error", "critical"] as const) {
      expect(toCanonicalSeverity(s)).toBe(s);
    }
  });

  it("5-scale (mobile / federation: low/medium/high)", () => {
    expect(toCanonicalSeverity("low")).toBe("info");
    expect(toCanonicalSeverity("medium")).toBe("warning");
    expect(toCanonicalSeverity("high")).toBe("error");
    expect(toCanonicalSeverity("critical")).toBe("critical");
  });

  it("is case / whitespace insensitive", () => {
    expect(toCanonicalSeverity("  CRITICAL ")).toBe("critical");
    expect(toCanonicalSeverity("Warn")).toBe("warning");
  });

  it("numeric priorities (1 = highest)", () => {
    expect(toCanonicalSeverity("1")).toBe("critical");
    expect(toCanonicalSeverity("2")).toBe("error");
    expect(toCanonicalSeverity("3")).toBe("warning");
    expect(toCanonicalSeverity("9")).toBe("info");
  });

  it("unknown / nullish → warning (visible, never dropped), never throws", () => {
    expect(toCanonicalSeverity(null)).toBe("warning");
    expect(toCanonicalSeverity(undefined)).toBe("warning");
    expect(toCanonicalSeverity("")).toBe("warning");
    expect(toCanonicalSeverity("banana")).toBe("warning");
  });
});

describe("ordering + comparison", () => {
  it("rank is strictly increasing info < warning < error < critical", () => {
    expect(SEVERITY_RANK.info).toBeLessThan(SEVERITY_RANK.warning);
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.error);
    expect(SEVERITY_RANK.error).toBeLessThan(SEVERITY_RANK.critical);
  });

  it("compareSeverity works across dialects", () => {
    expect(compareSeverity("red", "yellow")).toBeGreaterThan(0); // critical > warning
    expect(compareSeverity("low", "high")).toBeLessThan(0); // info < error
    expect(compareSeverity("warning", "warn")).toBe(0);
  });

  it("severityAtLeast gate", () => {
    expect(severityAtLeast("high", "warning")).toBe(true); // error ≥ warning
    expect(severityAtLeast("info", "warning")).toBe(false);
    expect(severityAtLeast("critical", "critical")).toBe(true);
  });
});

describe("severityMeta", () => {
  it("returns theme-aware classes + labels for any raw source", () => {
    const m = severityMeta("red");
    expect(m.labelVi).toBe("Nghiêm trọng");
    expect(m.borderLeft).toContain("border-l-");
    expect(m.badge).toContain("text-");
    expect(m.dot).toContain("bg-");
  });
});
