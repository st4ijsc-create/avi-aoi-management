/**
 * Doc 69 Wave 2 / A1 — machineType as a first-class analytics dimension: phần THUẦN (không DB).
 *  `buildAnalyticsConditions` — the machineType condition is purely additive: it only appears when BOTH the call site opts in
 *  (ConditionOptions.machineType) AND the caller supplied params.machineType. Omitting it is byte-identical to before this task
 *  (proven at the condition-count level, no DB needed).
 * Phần tích hợp DB (getDefectTrend / getMachinePerformance / getByMachineTypeBreakdown / getCorrelationAnalysis / getRobotsSection /
 * generateComprehensiveReport) nằm ở `aiAnalyticsMachineType.db.test.ts` (giao dịch HOÀN TÁC) — tách ra vì tệp cũ INSERT thẳng vào `_test` mà không dọn.
 */
import { describe, it, expect } from "vitest";
import { buildAnalyticsConditions } from "./aiInspectionAnalytics";

// ─── (1) buildAnalyticsConditions — pure, no DB ────────────────────────────

describe("buildAnalyticsConditions — machineType is purely additive (doc69 Wave2/A1)", () => {
  const base = { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-01-02T00:00:00Z") };

  it("no machineType condition when params.machineType is absent, even if the call site opts in", () => {
    const optedIn = buildAnalyticsConditions(base, { machineType: true });
    const optedOut = buildAnalyticsConditions(base, {});
    expect(optedIn.length).toBe(2); // only the two date-range conditions
    expect(optedIn.length).toBe(optedOut.length);
  });

  it("no machineType condition when the call site does not opt in, even if params.machineType is set", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "AOI" }, {});
    expect(conditions.length).toBe(2);
  });

  it("exactly one extra condition when both the call site opts in AND params.machineType is set", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "AOI" }, { machineType: true });
    expect(conditions.length).toBe(3);
  });

  it("blank/whitespace machineType is treated as absent (mirrors productModel's .trim() handling)", () => {
    const conditions = buildAnalyticsConditions({ ...base, machineType: "   " }, { machineType: true });
    expect(conditions.length).toBe(2);
  });
});
