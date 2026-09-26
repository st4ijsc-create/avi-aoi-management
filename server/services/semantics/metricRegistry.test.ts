/**
 * Semantic Metric Registry tests — doc 44 Batch W2-A4 (G2.14 + G2.15).
 *
 * Covers:
 *   • loading + structural validation of contracts/metrics/*.yaml (the REAL
 *     governed files — this suite is also the CI gate for their structure),
 *   • computeMetric DELEGATION to the canonical implementations (oeeService /
 *     db/statistics mocked — the registry must never re-derive the math),
 *   • MetricResult shape per spec §10.2 incl. definition_version ("OEE@v1"),
 *   • honest errors: UNSUPPORTED_SCOPE / METRIC_NOT_FOUND / SCOPE_ID_REQUIRED /
 *     WINDOW_NOT_SUPPORTED, and honest-null value passthrough,
 *   • the INTEGRITY GUARD: the pinned formula-fingerprint snapshot below fails
 *     this suite if anyone edits a formula in contracts/metrics WITHOUT bumping
 *     `version` (bump the version AND re-pin here — that is the review gate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Canonical implementations are MOCKED: the registry must delegate, only. ──
vi.mock("../oeeService", () => ({
  getMachineOEELive: vi.fn(),
  getLineOEE: vi.fn(),
  resolveIdealCycleTimeSec: vi.fn(),
}));
vi.mock("../../db/statistics", () => ({
  getMachineStats: vi.fn(),
}));
const fakeDb = { execute: vi.fn() };
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import { getMachineOEELive, getLineOEE, resolveIdealCycleTimeSec } from "../oeeService";
import { getMachineStats } from "../../db/statistics";
// `getLineOEE` nay trả MẢNG CÓ NHÃN (`ScopedRows`) — giả lập phải dựng đúng hình dạng ấy, không
// phải một mảng trần. Đây chính là điều `tsconfig.tests.json` tồn tại để bắt: một giả lập lệch
// hình dạng so với hàm thật là lưới xanh vì lý do sai.
import { withScopeLabels, UNSCOPED_LABELS } from "../../_core/accessControlLabels";
import {
  listMetrics,
  getDefinition,
  computeMetric,
  parseMetricDefinitions,
  definitionFingerprints,
  verifyDefinitionsIntegrity,
  formulaHash,
  getMetricDefinitionVersion,
  MetricComputeError,
  _resetMetricRegistryForTests,
} from "./metricRegistry";

const mockMachineOee = vi.mocked(getMachineOEELive);
const mockLineOee = vi.mocked(getLineOEE);
const mockIdeal = vi.mocked(resolveIdealCycleTimeSec);
const mockMachineStats = vi.mocked(getMachineStats);

const HOUR = 3_600_000;
/** Trailing 24h window ending now (the shape the live equipment path supports). */
function trailingWindow(hours = 24): { from: Date; to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - hours * HOUR), to };
}

function liveOee(overrides: Partial<{
  availability: number | null; performance: number | null; quality: number | null; oee: number | null;
}> = {}) {
  return {
    machineId: 5,
    machineCode: "AOI-05",
    timestamp: new Date(),
    availability: 94 as number | null,
    performance: 95 as number | null,
    quality: 97 as number | null,
    oee: 86.65 as number | null,
    details: {
      windowHours: 24, onlineSeconds: 80000, offlineSeconds: 6000,
      totalCount: 100, goodCount: 97, rejectCount: 3,
      idealCycleTimeSec: 1.5, hasUptimeData: true, hasProductionData: true,
    },
    ...overrides,
  };
}

function lineOee(overrides: Record<string, unknown> = {}) {
  return {
    lineId: 3,
    lineName: "SMT Line 1",
    availability: 90 as number | null,
    performance: 80 as number | null,
    quality: 99 as number | null,
    oee: 71.28 as number | null,
    details: {
      from: new Date(0), to: new Date(), machineCount: 4,
      onlineSeconds: 1, offlineSeconds: 1, totalCount: 1234, goodCount: 1200,
      rejectCount: 34, hasUptimeData: true, hasProductionData: true, hasIdeal: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetMetricRegistryForTests();
  mockIdeal.mockResolvedValue(1.5);
});

// ════════════════════════════════════════════════════════════════════════════
// Loading + validation of the REAL governed files
// ════════════════════════════════════════════════════════════════════════════

describe("registry load (contracts/metrics/*.yaml)", () => {
  it("loads exactly the governed metric set with required fields", () => {
    const metrics = listMetrics();
    const names = metrics.map((m) => m.metric).sort();
    expect(names).toEqual(["Availability", "DPMO", "FPY", "OEE", "Performance", "Quality", "Throughput"]);
    for (const m of metrics) {
      expect(m.version).toBeGreaterThanOrEqual(1);
      expect(m.scope.length).toBeGreaterThan(0);
      expect(m.formula).toBeTruthy();
      expect(m.inputs && m.inputs.length).toBeTruthy(); // lineage is declared for every metric
      expect(m.definition_version).toBe(`${m.metric}@v${m.version}`);
    }
  });

  it("getDefinition is case-insensitive and carries the implementation pointer", () => {
    const def = getDefinition("oee");
    expect(def?.metric).toBe("OEE");
    expect(def?.implementation).toEqual({
      equipment: "oeeService.getMachineOEELive",
      line: "oeeService.getLineOEE",
    });
    expect(getDefinition("nope")).toBeUndefined();
  });

  it("getMetricDefinitionVersion is fail-safe provenance", () => {
    expect(getMetricDefinitionVersion("OEE")).toBe("OEE@v1");
    expect(getMetricDefinitionVersion("does-not-exist")).toBeNull();
  });
});

describe("parseMetricDefinitions — structural validation", () => {
  it("rejects a definition without version", () => {
    expect(() => parseMetricDefinitions("metric: X\nformula: a\nscope: [line]\nimplementation: f\n", "x.yaml"))
      .toThrow(/version/);
  });
  it("rejects a definition without metric name", () => {
    expect(() => parseMetricDefinitions("version: 1\nformula: a\nscope: [line]\nimplementation: f\n", "x.yaml"))
      .toThrow(/"metric"/);
  });
  it("rejects a definition without implementation", () => {
    expect(() => parseMetricDefinitions("metric: X\nversion: 1\nformula: a\nscope: [line]\n", "x.yaml"))
      .toThrow(/implementation/);
  });
  it("rejects an empty scope list and malformed inputs", () => {
    expect(() => parseMetricDefinitions("metric: X\nversion: 1\nformula: a\nscope: []\nimplementation: f\n", "x.yaml"))
      .toThrow(/scope/);
    expect(() =>
      parseMetricDefinitions(
        "metric: X\nversion: 1\nformula: a\nscope: [line]\nimplementation: f\ninputs:\n  - name: ok\n", "x.yaml"))
      .toThrow(/inputs\[0\]/);
  });
  it("parses multi-document YAML into multiple definitions", () => {
    const defs = parseMetricDefinitions(
      "metric: A\nversion: 1\nformula: x\nscope: [line]\nimplementation: f\n---\nmetric: B\nversion: 2\nformula: y\nscope: [line]\nimplementation: f\n",
      "multi.yaml",
    );
    expect(defs.map((d) => `${d.metric}@v${d.version}`)).toEqual(["A@v1", "B@v2"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeMetric — delegation to the canonical implementations
// ════════════════════════════════════════════════════════════════════════════

describe("computeMetric OEE (equipment) — delegates to oeeService.getMachineOEELive", () => {
  it("returns a spec §10.2 MetricResult with definition_version and fraction units", async () => {
    mockMachineOee.mockResolvedValue(liveOee() as any);
    const { from, to } = trailingWindow(24);
    const res = await computeMetric("OEE", { scope: "equipment", scopeId: 5, from, to });

    // Delegation — ideal resolved via the canonical resolver, then the canonical live fn.
    expect(mockIdeal).toHaveBeenCalledWith(5);
    expect(mockMachineOee).toHaveBeenCalledTimes(1);
    const arg = mockMachineOee.mock.calls[0][0];
    expect(arg.machineId).toBe(5);
    expect(arg.windowHours).toBeCloseTo(24, 3);
    expect(arg.idealCycleTimeSec).toBe(1.5);

    // MetricResult (§10.2): % from the service → normalized fractions.
    expect(res.metric).toBe("OEE");
    expect(res.scope).toBe("equipment");
    expect(res.path).toBe("AOI-05");
    expect(res.window.from).toBe(from.toISOString());
    expect(res.window.to).toBe(to.toISOString());
    expect(res.value).toBeCloseTo(0.8665, 4);
    expect(res.parts).toEqual({ availability: 0.94, performance: 0.95, quality: 0.97 });
    expect(res.definition_version).toBe("OEE@v1");
  });

  it("passes honest-null through untouched (never fabricates)", async () => {
    mockMachineOee.mockResolvedValue(
      liveOee({ availability: 94, performance: null, quality: 97, oee: null }) as any,
    );
    const { from, to } = trailingWindow();
    const res = await computeMetric("OEE", { scope: "equipment", scopeId: 5, from, to });
    expect(res.value).toBeNull();
    expect(res.parts).toEqual({ availability: 0.94, performance: null, quality: 0.97 });
  });

  it("rejects historical windows honestly (live path is trailing-only)", async () => {
    const to = new Date(Date.now() - 3 * 24 * HOUR);
    const from = new Date(to.getTime() - 24 * HOUR);
    await expect(computeMetric("OEE", { scope: "equipment", scopeId: 5, from, to }))
      .rejects.toMatchObject({ code: "WINDOW_NOT_SUPPORTED" });
    expect(mockMachineOee).not.toHaveBeenCalled();
  });

  it("requires scopeId for equipment scope", async () => {
    const { from, to } = trailingWindow();
    await expect(computeMetric("OEE", { scope: "equipment", from, to }))
      .rejects.toMatchObject({ code: "SCOPE_ID_REQUIRED" });
  });

  it("extracts a single part metric (Quality) from the same canonical call", async () => {
    mockMachineOee.mockResolvedValue(liveOee() as any);
    const { from, to } = trailingWindow();
    const res = await computeMetric("Quality", { scope: "equipment", scopeId: 5, from, to });
    expect(res.value).toBeCloseTo(0.97, 4);
    expect(res.parts).toBeUndefined();
    expect(res.definition_version).toBe("Quality@v1");
  });
});

describe("computeMetric OEE/Throughput (line) — delegates to oeeService.getLineOEE", () => {
  it("computes line OEE over an explicit historical window", async () => {
    mockLineOee.mockResolvedValue(withScopeLabels([lineOee() as any], UNSCOPED_LABELS));
    const to = new Date("2026-07-01T00:00:00Z");
    const from = new Date("2026-06-30T00:00:00Z");
    const res = await computeMetric("OEE", { scope: "line", scopeId: 3, from, to });
    expect(mockLineOee).toHaveBeenCalledWith({ lineId: 3, from, to });
    expect(res.value).toBeCloseTo(0.7128, 4);
    expect(res.path).toBe("SMT Line 1");
    expect(res.definition_version).toBe("OEE@v1");
  });

  it("line Throughput keeps its natural COUNT unit (not a fraction)", async () => {
    mockLineOee.mockResolvedValue(withScopeLabels([lineOee() as any], UNSCOPED_LABELS));
    const { from, to } = trailingWindow();
    const res = await computeMetric("Throughput", { scope: "line", scopeId: 3, from, to });
    expect(res.value).toBe(1234);
    expect(res.definition_version).toBe("Throughput@v1");
  });

  it("unknown line / no data → honest null", async () => {
    mockLineOee.mockResolvedValue(withScopeLabels([], UNSCOPED_LABELS));
    const { from, to } = trailingWindow();
    const res = await computeMetric("OEE", { scope: "line", scopeId: 999, from, to });
    expect(res.value).toBeNull();
    expect(res.parts).toEqual({ availability: null, performance: null, quality: null });
  });
});

describe("computeMetric FPY — delegates to canonical kpi math", () => {
  it("equipment scope via statisticsDb.getMachineStats (first-inspection counts)", async () => {
    mockMachineStats.mockResolvedValue({
      total: 500, ok: 430, ng: 40, ntf: 30, yieldRate: 92, fpy: 90, firstPass: 90, firstTotal: 100,
    } as any);
    const { from, to } = trailingWindow();
    const res = await computeMetric("FPY", { scope: "equipment", scopeId: 7, from, to });
    expect(mockMachineStats).toHaveBeenCalledWith(7, from, to);
    expect(res.value).toBeCloseTo(0.9, 4);
    expect(res.parts).toEqual({ first_pass: 90, first_total: 100 });
    expect(res.definition_version).toBe("FPY@v1");
  });

  it("equipment scope with zero first inspections → honest null", async () => {
    mockMachineStats.mockResolvedValue({
      total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0, fpy: 0, firstPass: 0, firstTotal: 0,
    } as any);
    const { from, to } = trailingWindow();
    const res = await computeMetric("FPY", { scope: "equipment", scopeId: 7, from, to });
    expect(res.value).toBeNull();
  });

  it("factory scope via kpi.fpyAggregateSql over the window", async () => {
    fakeDb.execute.mockResolvedValueOnce([{ first_total: 200, first_pass: 150 }]);
    const { from, to } = trailingWindow();
    const res = await computeMetric("FPY", { scope: "factory", from, to });
    expect(fakeDb.execute).toHaveBeenCalledTimes(1);
    expect(res.value).toBeCloseTo(0.75, 4);
    expect(res.parts).toEqual({ first_pass: 150, first_total: 200 });
  });
});

describe("computeMetric Throughput (equipment) + DPMO", () => {
  it("equipment Throughput = product_inspections count from getMachineStats", async () => {
    mockMachineStats.mockResolvedValue({
      total: 512, ok: 500, ng: 10, ntf: 2, yieldRate: 98, fpy: 97, firstPass: 485, firstTotal: 500,
    } as any);
    const { from, to } = trailingWindow();
    const res = await computeMetric("Throughput", { scope: "equipment", scopeId: 7, from, to });
    expect(res.value).toBe(512);
  });

  it("DPMO delegates the formula to kpi.dpmo over declared counts", async () => {
    fakeDb.execute.mockResolvedValueOnce([{ opportunities: 1_000_000, defects: 5 }]);
    const { from, to } = trailingWindow();
    const res = await computeMetric("DPMO", { scope: "factory", from, to });
    expect(res.value).toBe(5);
    expect(res.parts).toEqual({ defects: 5, opportunities: 1_000_000 });
    expect(res.definition_version).toBe("DPMO@v1");
  });

  it("DPMO with zero opportunities → honest null (no data ≠ zero defects)", async () => {
    fakeDb.execute.mockResolvedValueOnce([{ opportunities: 0, defects: 0 }]);
    const { from, to } = trailingWindow();
    const res = await computeMetric("DPMO", { scope: "factory", from, to });
    expect(res.value).toBeNull();
  });

  it("DPMO equipment scope requires scopeId", async () => {
    const { from, to } = trailingWindow();
    await expect(computeMetric("DPMO", { scope: "equipment", from, to }))
      .rejects.toMatchObject({ code: "SCOPE_ID_REQUIRED" });
  });
});

describe("honest errors", () => {
  it("UNSUPPORTED_SCOPE lists the supported scopes", async () => {
    const { from, to } = trailingWindow();
    const err = await computeMetric("OEE", { scope: "factory", from, to }).catch((e) => e);
    expect(err).toBeInstanceOf(MetricComputeError);
    expect(err.code).toBe("UNSUPPORTED_SCOPE");
    expect(err.message).toContain("[equipment, line]");

    await expect(computeMetric("DPMO", { scope: "line", scopeId: 1, from, to }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_SCOPE" });
  });

  it("METRIC_NOT_FOUND for an ungoverned metric", async () => {
    const { from, to } = trailingWindow();
    await expect(computeMetric("MTBF", { scope: "equipment", scopeId: 1, from, to }))
      .rejects.toMatchObject({ code: "METRIC_NOT_FOUND" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRITY GUARD — formula changed without a version bump
// ════════════════════════════════════════════════════════════════════════════

/**
 * PINNED SNAPSHOT of every governed formula, keyed by "<Metric>@v<version>".
 *
 * ⚠ IF THIS TEST FAILS after you edited contracts/metrics/*.yaml:
 *   changing a formula (its meaning) REQUIRES bumping `version` in the YAML
 *   (e.g. OEE@v1 → OEE@v2) AND adding the new pin here — never re-pin the SAME
 *   key with a new formula. That review step is the whole guard (SYNAPSE §9.3
 *   "as-code & versioned").
 */
const PINNED_FORMULAS: Record<string, string> = {
  "OEE@v1": "availability * performance * quality",
  "Availability@v1": "online_seconds / (online_seconds + offline_seconds)",
  "Performance@v1": "min(1, ideal_cycle_time_sec * total_count / online_seconds)",
  "Quality@v1": "(ok_count + ntf_count) / total_count",
  "FPY@v1": "first_pass / first_total",
  "Throughput@v1": "count(units inspected in window)",
  "DPMO@v1": "defects / opportunities * 1000000",
};
const PINNED_FINGERPRINTS: Record<string, string> = Object.fromEntries(
  Object.entries(PINNED_FORMULAS).map(([k, f]) => [k, formulaHash(f)]),
);

describe("verifyDefinitionsIntegrity — version-bump guard", () => {
  it("current definitions match the pinned snapshot exactly", () => {
    // Key set equality also catches silent renames/deletions of a governed metric.
    expect(Object.keys(definitionFingerprints()).sort()).toEqual(Object.keys(PINNED_FINGERPRINTS).sort());
    const check = verifyDefinitionsIntegrity(PINNED_FINGERPRINTS);
    expect(check.violations).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("flags a formula change that did NOT bump the version", () => {
    // Simulate: the pinned OEE@v1 fingerprint was for a DIFFERENT formula than
    // what the YAML now contains → the guard must scream.
    const tampered = { ...PINNED_FINGERPRINTS, "OEE@v1": formulaHash("availability * performance") };
    const check = verifyDefinitionsIntegrity(tampered);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.startsWith("OEE@v1") && v.includes("WITHOUT a version bump"))).toBe(true);
  });

  it("flags unpinned (new/bumped) definitions for deliberate review", () => {
    const withoutFpy: Record<string, string> = { ...PINNED_FINGERPRINTS };
    delete withoutFpy["FPY@v1"];
    const check = verifyDefinitionsIntegrity(withoutFpy);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.startsWith("FPY@v1") && v.includes("not pinned"))).toBe(true);
  });

  it("fingerprint is whitespace-stable", () => {
    expect(formulaHash("a *  b\n")).toBe(formulaHash("a * b"));
  });
});
