/**
 * W5-B1 (doc 44, gap G4.15) — cost-sensitive / risk-based threshold tests.
 *
 * Pure + deterministic (no DB). Verifies:
 *  (a) a SEVERE class lowers the effective decision threshold (recall-first);
 *  (b) the review deadband routes near-crossover cases to a human;
 *  (c) applyCostSensitiveTriage escalates over-confident AUTO_OK → NEEDS_REVIEW
 *      but NEVER relaxes an NG/review to OK (contract);
 *  (d) the flag defaults OFF and severity map building.
 */
import { describe, it, expect, afterEach } from "vitest";
import { normalizeLabel } from "../aiMetrics";
import {
  decideThreshold,
  applyCostSensitiveTriage,
  buildSeverityMap,
  defaultCostMatrix,
  isCostSensitiveThresholdEnabled,
  parseSeverityMapEnv,
  type CostMatrix,
} from "./costSensitiveThreshold";

const CM: CostMatrix = { falseNegative: 10, falsePositive: 1, review: 2 };

afterEach(() => {
  delete process.env.COST_SENSITIVE_THRESHOLD_ENABLED;
  delete process.env.NTF_DEFECT_SEVERITY_MAP;
  delete process.env.COST_FN;
});

describe("(a) severity lowers the effective threshold", () => {
  it("p* = fp/(fn·s+fp) shrinks as severity grows", () => {
    const benign = decideThreshold([{ label: "scratch", confidence: 0.3 }], CM, { scratch: 1 });
    const severe = decideThreshold([{ label: "crack", confidence: 0.3 }], CM, { crack: 5 });
    expect(severe.effectiveThreshold).toBeLessThan(benign.effectiveThreshold);
    expect(benign.effectiveThreshold).toBeCloseTo(1 / 11, 6);
    expect(severe.effectiveThreshold).toBeCloseTo(1 / 51, 6);
  });

  it("at the SAME low defect prob, a severe class flags while a benign one passes", () => {
    const severe = decideThreshold(
      [{ label: "crack", confidence: 0.05 }, { label: "OK", confidence: 0.95 }],
      CM, { crack: 5 }, { reviewBand: 0 },
    );
    const benign = decideThreshold(
      [{ label: "scratch", confidence: 0.05 }, { label: "OK", confidence: 0.95 }],
      CM, { scratch: 1 }, { reviewBand: 0 },
    );
    expect(severe.action).toBe("flag");
    expect(benign.action).toBe("pass");
  });

  it("no defect-class probability mass → pass (OK)", () => {
    const d = decideThreshold([{ label: "OK", confidence: 0.99 }], CM, { crack: 5 });
    expect(d.action).toBe("pass");
    expect(d.defectProbability).toBe(0);
    expect(d.severity).toBe(0);
  });
});

describe("(b) review deadband", () => {
  it("routes a near-crossover case to a human when review is the cheap option", () => {
    const r = decideThreshold(
      [{ label: "crack", confidence: 0.09 }, { label: "OK", confidence: 0.91 }],
      { falseNegative: 10, falsePositive: 1, review: 0.5 },
      { crack: 1 },
      { reviewBand: 0.05 },
    );
    expect(r.action).toBe("review");
  });
});

describe("(c) applyCostSensitiveTriage — recall-first, never relaxes", () => {
  it("escalates an over-confident AUTO_OK with a plausible severe defect to NEEDS_REVIEW", () => {
    const o = applyCostSensitiveTriage({
      baseDecision: "AUTO_OK",
      predictions: [{ label: "crack", confidence: 0.2 }, { label: "OK", confidence: 0.8 }],
      severityMap: { crack: 5 },
      costMatrix: CM,
    });
    expect(o.overridden).toBe(true);
    expect(o.decision).toBe("NEEDS_REVIEW");
    expect(o.reason).toMatch(/cost-sensitive/i);
  });

  it("keeps AUTO_OK when only a benign defect is barely plausible", () => {
    const o = applyCostSensitiveTriage({
      baseDecision: "AUTO_OK",
      predictions: [{ label: "scratch", confidence: 0.02 }, { label: "OK", confidence: 0.98 }],
      severityMap: { scratch: 1 },
      costMatrix: CM,
    });
    expect(o.overridden).toBe(false);
    expect(o.decision).toBe("AUTO_OK");
  });

  it("NEVER relaxes AUTO_NG or NEEDS_REVIEW to OK", () => {
    const ng = applyCostSensitiveTriage({
      baseDecision: "AUTO_NG",
      predictions: [{ label: "crack", confidence: 0.95 }],
      severityMap: { crack: 5 },
      costMatrix: CM,
    });
    expect(ng.decision).toBe("AUTO_NG");
    expect(ng.overridden).toBe(false);

    const rev = applyCostSensitiveTriage({
      baseDecision: "NEEDS_REVIEW",
      predictions: [{ label: "OK", confidence: 0.99 }],
      severityMap: { crack: 5 },
      costMatrix: CM,
    });
    expect(rev.decision).toBe("NEEDS_REVIEW");
    expect(rev.overridden).toBe(false);
  });
});

describe("(d) flag + severity map", () => {
  it("flag defaults OFF, honours true/1", () => {
    expect(isCostSensitiveThresholdEnabled()).toBe(false);
    process.env.COST_SENSITIVE_THRESHOLD_ENABLED = "true";
    expect(isCostSensitiveThresholdEnabled()).toBe(true);
    process.env.COST_SENSITIVE_THRESHOLD_ENABLED = "1";
    expect(isCostSensitiveThresholdEnabled()).toBe(true);
  });

  it("buildSeverityMap defaults NG labels to 1 and applies overrides case/diacritic-insensitively", () => {
    const m = buildSeverityMap(["scratch", "Crack"], { crack: 3 });
    expect(m[normalizeLabel("scratch")]).toBe(1);
    expect(m[normalizeLabel("crack")]).toBe(3);
  });

  it("parseSeverityMapEnv reads NTF_DEFECT_SEVERITY_MAP JSON (best-effort)", () => {
    process.env.NTF_DEFECT_SEVERITY_MAP = JSON.stringify({ crack: 4, junk: "x" });
    const m = parseSeverityMapEnv();
    expect(m.crack).toBe(4);
    expect(m.junk).toBeUndefined();
    process.env.NTF_DEFECT_SEVERITY_MAP = "not-json";
    expect(parseSeverityMapEnv()).toEqual({});
  });

  it("defaultCostMatrix encodes recall-first (fn ≫ fp)", () => {
    const cm = defaultCostMatrix();
    expect(cm.falseNegative).toBeGreaterThan(cm.falsePositive);
  });
});
