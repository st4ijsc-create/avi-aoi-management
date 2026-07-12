// doc 44 W5-A2 (G4.18/G4.19/G4.20) — parameter guardrail PURE decision tests.
// Mirrors twinFidelityService.test.ts: exercise the pure logic (no DB/IO).
import { describe, it, expect } from "vitest";
import {
  coerceNumber,
  checkAgainstGuardrail,
  decideTwinValidation,
  compareMetrics,
} from "./parameterGuardrailService";

const G = { minValue: 1.6, maxValue: 1.9, maxStep: 0.1, unit: "Nm" };

describe("coerceNumber", () => {
  it("numbers pass, non-finite → null", () => {
    expect(coerceNumber(1.75)).toBe(1.75);
    expect(coerceNumber(NaN)).toBeNull();
    expect(coerceNumber(Infinity)).toBeNull();
  });
  it("numeric strings coerce, blank/junk → null", () => {
    expect(coerceNumber("2.5")).toBe(2.5);
    expect(coerceNumber("")).toBeNull();
    expect(coerceNumber("abc")).toBeNull();
  });
  it("booleans have no numeric range → null", () => {
    expect(coerceNumber(true)).toBeNull();
    expect(coerceNumber(false)).toBeNull();
  });
});

describe("checkAgainstGuardrail — hard min/max (G4.18)", () => {
  it("within range → ok", () => {
    expect(checkAgainstGuardrail(G, 1.75)).toEqual({ ok: true });
  });

  it("below min → OUT_OF_RANGE (honest reject, no clamp) + range surfaced", () => {
    const r = checkAgainstGuardrail(G, 1.4);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("OUT_OF_RANGE");
      expect(r.guardrail).toEqual({ min: 1.6, max: 1.9, maxStep: 0.1, unit: "Nm" });
      expect(r.detail).toContain("[1.6, 1.9]");
    }
  });

  it("above max → OUT_OF_RANGE", () => {
    const r = checkAgainstGuardrail(G, 2.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OUT_OF_RANGE");
  });

  it("numeric string over max → OUT_OF_RANGE", () => {
    const r = checkAgainstGuardrail(G, "9");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OUT_OF_RANGE");
  });
});

describe("checkAgainstGuardrail — max-step (G4.18, §9.2 bước nhỏ)", () => {
  it("step within maxStep → ok", () => {
    expect(checkAgainstGuardrail(G, 1.75, 1.7)).toEqual({ ok: true });
  });
  it("step over maxStep → STEP_TOO_LARGE", () => {
    const r = checkAgainstGuardrail(G, 1.9, 1.65); // step 0.25 > 0.1, both in range
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("STEP_TOO_LARGE");
      expect(r.detail).toContain("0.1");
    }
  });
  it("no oldValue → step not checked (range still enforced)", () => {
    expect(checkAgainstGuardrail(G, 1.75)).toEqual({ ok: true });
  });
  it("out-of-range wins over step", () => {
    const r = checkAgainstGuardrail(G, 3.0, 2.99);
    if (!r.ok) expect(r.code).toBe("OUT_OF_RANGE");
  });
});

describe("checkAgainstGuardrail — strict / no-guardrail (G4.18)", () => {
  it("no guardrail + strict OFF → ok (caller logs)", () => {
    expect(checkAgainstGuardrail(null, 999)).toEqual({ ok: true });
  });
  it("no guardrail + strict ON → NO_GUARDRAIL reject", () => {
    const r = checkAgainstGuardrail(null, 999, undefined, { strict: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_GUARDRAIL");
  });
  it("non-numeric value with a guardrail → ok (no numeric range applies)", () => {
    expect(checkAgainstGuardrail(G, true)).toEqual({ ok: true });
    expect(checkAgainstGuardrail(G, "AUTO")).toEqual({ ok: true });
  });
});

describe("decideTwinValidation — twin-first verdict (G4.19)", () => {
  it("not required → undefined (attach nothing)", () => {
    expect(decideTwinValidation(false, 7, true)).toBeUndefined();
    expect(decideTwinValidation(false, null, null)).toBeUndefined();
  });
  it("required + no line resolvable → skipped (honest)", () => {
    expect(decideTwinValidation(true, null, null)).toBe("skipped");
  });
  it("required + twin trusted → passed", () => {
    expect(decideTwinValidation(true, 7, true)).toBe("passed");
  });
  it("required + twin untrusted/unknown → untrusted", () => {
    expect(decideTwinValidation(true, 7, false)).toBe("untrusted");
    expect(decideTwinValidation(true, 7, null)).toBe("untrusted");
  });
});

describe("compareMetrics — closed-loop verdict (G4.20)", () => {
  const before = { ngRatePct: 5, total: 100 };
  it("NG-rate drops materially → improved", () => {
    expect(compareMetrics(before, { ngRatePct: 2, total: 100 }, 0.5)).toBe("improved");
  });
  it("NG-rate rises materially → degraded", () => {
    expect(compareMetrics(before, { ngRatePct: 9, total: 100 }, 0.5)).toBe("degraded");
  });
  it("within epsilon → neutral", () => {
    expect(compareMetrics(before, { ngRatePct: 5.2, total: 100 }, 0.5)).toBe("neutral");
  });
  it("insufficient data (missing rate or zero sample) → neutral (honest)", () => {
    expect(compareMetrics(before, { total: 0 }, 0.5)).toBe("neutral");
    expect(compareMetrics(null, { ngRatePct: 2, total: 100 }, 0.5)).toBe("neutral");
    expect(compareMetrics({ ngRatePct: 5, total: 0 }, { ngRatePct: 2, total: 100 }, 0.5)).toBe("neutral");
  });
});
