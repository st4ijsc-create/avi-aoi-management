/**
 * annotationComparisonRouter pure-helper tests (doc 32 §2 item 20).
 *
 * The `generatePdfReport` procedure was mis-named ("Pdf" but returned JSON); it
 * now renders a REAL PDF via renderReport. These tests cover the pure comparison
 * substance behind it (the DB/tRPC/PDF rendering are separately owned/tested):
 *  - buildMeasurementComparison: matching / different / only-in-1 / only-in-2.
 *  - detectComparisonPatterns: recurring (≥80% NG) vs intermittent (≥30% NG).
 */
import { describe, it, expect } from "vitest";
import { buildMeasurementComparison, detectComparisonPatterns } from "./annotationComparisonRouter";

const r = (pointDefId: number, result: string | null, measuredValue: string | null = null) => ({
  pointDefId,
  result,
  measuredValue,
});

describe("buildMeasurementComparison", () => {
  it("classifies matching / different / only-in-each", () => {
    const c = buildMeasurementComparison(
      [r(1, "OK"), r(2, "NG", "1.5"), r(3, "OK")], // 3 only in #1
      [r(1, "OK"), r(2, "OK", "0.9"), r(4, "NG")], // 4 only in #2
    );
    expect(c.matching).toBe(1); // point 1
    expect(c.different).toBe(1); // point 2 (NG vs OK)
    expect(c.onlyIn1).toBe(1); // point 3
    expect(c.onlyIn2).toBe(1); // point 4
    expect(c.details).toHaveLength(4);

    const p2 = c.details.find((d) => d.pointId === 2)!;
    expect(p2.status).toBe("different");
    expect(p2.value1).toBe("1.5");
    expect(p2.value2).toBe("0.9");
    expect(c.details.find((d) => d.pointId === 3)!.status).toBe("only1");
    expect(c.details.find((d) => d.pointId === 4)!.status).toBe("only2");
  });

  it("handles empty inputs", () => {
    const c = buildMeasurementComparison([], []);
    expect(c).toMatchObject({ matching: 0, different: 0, onlyIn1: 0, onlyIn2: 0 });
    expect(c.details).toHaveLength(0);
  });
});

describe("detectComparisonPatterns", () => {
  it("flags a recurring defect at ≥80% NG and intermittent at ≥30%", () => {
    const results = [
      // point 7: 4/5 NG = 80% → recurring
      r(7, "NG"), r(7, "NG"), r(7, "NG"), r(7, "NG"), r(7, "OK"),
      // point 8: 2/5 NG = 40% → intermittent
      r(8, "NG"), r(8, "NG"), r(8, "OK"), r(8, "OK"), r(8, "OK"),
      // point 9: 0 NG → nothing
      r(9, "OK"), r(9, "OK"),
    ];
    const patterns = detectComparisonPatterns(results);
    const p7 = patterns.find((p) => p.description.includes("Point 7"))!;
    const p8 = patterns.find((p) => p.description.includes("Point 8"))!;
    expect(p7.type).toBe("Recurring Defect");
    expect(p7.severity).toBe("Critical");
    expect(p8.type).toBe("Intermittent Defect");
    expect(patterns.find((p) => p.description.includes("Point 9"))).toBeUndefined();
  });
});
