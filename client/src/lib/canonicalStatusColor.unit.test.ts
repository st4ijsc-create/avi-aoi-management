/**
 * doc 44 W6-1 (G5.12) — canonical status → color mapper tests (pure).
 * Named *.unit.test.ts so it runs in vitest's node env (no jsdom needed).
 */
import { describe, it, expect } from "vitest";
import {
  canonicalizeStatus,
  statusTone,
  canonicalBadgeTone,
  canonicalDotClass,
  canonicalTextClass,
  canonicalBadgeClass,
  canonicalToneCssVar,
  CANONICAL_STATUSES,
  type CanonicalStatus,
  type SemanticTone,
} from "./canonicalStatusColor";

describe("canonicalizeStatus", () => {
  it("passes through exact canonical tokens", () => {
    expect(canonicalizeStatus("EXECUTE")).toBe("EXECUTE");
    expect(canonicalizeStatus("held")).toBe("HELD");
    expect(canonicalizeStatus("Faulted")).toBe("FAULTED");
  });
  it("resolves common aliases", () => {
    expect(canonicalizeStatus("running")).toBe("RUNNING");
    expect(canonicalizeStatus("online")).toBe("RUNNING");
    expect(canonicalizeStatus("ng")).toBe("FAULT");
    expect(canonicalizeStatus("offline")).toBe("OFFLINE");
    expect(canonicalizeStatus("paused")).toBe("HELD");
    expect(canonicalizeStatus("setup")).toBe("CHANGEOVER");
  });
  it("normalizes separators/case", () => {
    expect(canonicalizeStatus("lost connection")).toBe("OFFLINE");
    expect(canonicalizeStatus("change-over")).toBe("CHANGEOVER");
  });
  it("substring rescue for prefixed labels", () => {
    expect(canonicalizeStatus("MACHINE_FAULTED")).toBe("FAULTED");
    expect(canonicalizeStatus("LINE_PRODUCING")).toBe("PRODUCING");
  });
  it("fail-safe → UNKNOWN, never throws", () => {
    expect(canonicalizeStatus("")).toBe("UNKNOWN");
    expect(canonicalizeStatus(null)).toBe("UNKNOWN");
    expect(canonicalizeStatus(undefined)).toBe("UNKNOWN");
    expect(canonicalizeStatus("qwerty")).toBe("UNKNOWN");
    expect(canonicalizeStatus(12345)).toBe("UNKNOWN");
  });
});

describe("statusTone (ISA-101 semantics)", () => {
  const cases: Array<[string, SemanticTone]> = [
    ["EXECUTE", "success"],
    ["RUNNING", "success"],
    ["PRODUCING", "success"],
    ["READY", "info"],
    ["COMPLETING", "info"],
    ["MAINTENANCE", "info"],
    ["HELD", "warning"],
    ["SUSPENDED", "warning"],
    ["CHANGEOVER", "warning"],
    ["STOPPED", "warning"],
    ["FAULTED", "danger"],
    ["FAULT", "danger"],
    ["ABORTED", "danger"],
    ["DOWN", "danger"],
    ["IDLE", "neutral"],
    ["OFFLINE", "neutral"],
    ["UNKNOWN", "neutral"],
  ];
  it.each(cases)("%s → %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("every canonical status has a defined tone", () => {
    for (const s of CANONICAL_STATUSES) {
      const tone = statusTone(s);
      expect(["neutral", "success", "info", "warning", "danger"]).toContain(tone);
    }
  });
});

describe("class + badge-tone helpers", () => {
  it("canonicalBadgeTone maps to StatusBadge tones", () => {
    expect(canonicalBadgeTone("EXECUTE")).toBe("success");
    expect(canonicalBadgeTone("FAULTED")).toBe("error"); // danger → error (StatusBadge tone)
    expect(canonicalBadgeTone("IDLE")).toBe("default");   // neutral → default
    expect(canonicalBadgeTone("HELD")).toBe("warning");
    expect(canonicalBadgeTone("READY")).toBe("info");
  });
  it("class helpers use semantic tokens (no hex)", () => {
    const all = [
      ...CANONICAL_STATUSES.map(canonicalDotClass),
      ...CANONICAL_STATUSES.map(canonicalTextClass),
      ...CANONICAL_STATUSES.map(canonicalBadgeClass),
    ];
    for (const cls of all) {
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/); // no hex
      expect(cls.length).toBeGreaterThan(0);
    }
    expect(canonicalDotClass("EXECUTE")).toContain("bg-success");
    expect(canonicalTextClass("FAULTED")).toContain("text-destructive");
    expect(canonicalBadgeClass("IDLE")).toContain("muted");
  });
  it("canonicalToneCssVar returns a CSS custom property name", () => {
    expect(canonicalToneCssVar("EXECUTE")).toBe("--success");
    expect(canonicalToneCssVar("FAULTED")).toBe("--destructive");
    expect(canonicalToneCssVar("IDLE")).toBe("--muted-foreground");
  });
});
