/**
 * doc 69 T9 (security fast-follow) — unit tests for the NEW factory-scoping logic added
 * to `server/services/aiExecutiveReport.ts` itself (STEP 0 found the underlying KPI
 * sources genuinely support factory filtering: `product_inspections` has a native,
 * indexed `factoryCode` column; `getYieldTrendData` already accepts one; `paretoByDefectType`
 * accepts a numeric `factoryId`; machines can be joined to their owning factory).
 *
 * Covers only the BESPOKE logic this task added (not `getYieldTrendData`'s own
 * pre-existing factoryCode filter, which is exercised by its own suite):
 *  - pareto: factoryCode → factoryId resolution, threaded to paretoByDefectType.
 *  - pareto FAILS CLOSED on an unresolvable factoryCode (never silently falls through to
 *    an unscoped/all-factory query — that would re-open the leak for an edge case).
 *  - PdM risk machines are drawn from the factory-filtered machine list
 *    (getMachinesForFactory / getMachinesWithHierarchy), not the global getMachines(),
 *    when a bundle is factory-scoped.
 *  - persistExecutiveSummary tags `contextJson.reportFactoryCode` from `kpis.factoryCode`
 *    (undefined/global → `null`, matching the pre-existing `reportPeriod` convention).
 *  - getExecutiveSummaries maps a persisted row's `reportFactoryCode` back onto the
 *    returned `PersistedExecSummary.factoryCode`.
 *  - generateExecutiveSummary({skipLlm:true}) never touches the LLM narrative path.
 *
 * The router-level suite (server/routers/executiveReportScope.test.ts) proves the
 * end-to-end behavior (list/latest narrowing, admin passthrough, rate limit, on-demand
 * generation) against a MOCKED service boundary; this file proves the service itself
 * does what that mock stands in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDb = vi.fn();
const getYieldTrendData = vi.fn();
const paretoByDefectType = vi.fn();
const getMachines = vi.fn();
const getMachinesWithHierarchy = vi.fn();
const getFactoryByCode = vi.fn();
const computeFailureRisk = vi.fn();
const generateNarrative = vi.fn();
const route = vi.fn();

vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../db/statistics", () => ({ getYieldTrendData: (...a: unknown[]) => getYieldTrendData(...a) }));
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: (...a: unknown[]) => paretoByDefectType(...a) }));
vi.mock("../db/hierarchy", () => ({
  getMachines: (...a: unknown[]) => getMachines(...a),
  getMachinesWithHierarchy: (...a: unknown[]) => getMachinesWithHierarchy(...a),
  getFactoryByCode: (...a: unknown[]) => getFactoryByCode(...a),
}));
vi.mock("./predictiveMaintenanceService", () => ({ computeFailureRisk: (...a: unknown[]) => computeFailureRisk(...a) }));
vi.mock("./aiProviderRouter", () => ({ generateNarrative: (...a: unknown[]) => generateNarrative(...a) }));
vi.mock("./aiModelRouter", () => ({ route: (...a: unknown[]) => route(...a) }));

import { gatherKpis, generateExecutiveSummary, persistExecutiveSummary, getExecutiveSummaries } from "./aiExecutiveReport";

/** Minimal totals-only db stub — matches the shape collectInspectionTotals needs. */
function totalsDbStub(totals = { total: 100, ok: 90, ng: 10 }) {
  const sel: any = { from: () => sel, where: () => Promise.resolve([totals]) };
  return { select: () => sel };
}

beforeEach(() => {
  vi.clearAllMocks();
  route.mockReturnValue({ maxTokens: 800, temperature: 0.3, tier: 2 });
  getDb.mockResolvedValue(totalsDbStub());
  getYieldTrendData.mockResolvedValue([]);
  paretoByDefectType.mockResolvedValue({ items: [] });
  getMachines.mockResolvedValue([]);
  getMachinesWithHierarchy.mockResolvedValue([]);
});

describe("gatherKpis — factory scoping (doc 69 T9)", () => {
  it("threads factoryCode to getYieldTrendData", async () => {
    await gatherKpis("day", "vi", undefined, "F01");
    expect(getYieldTrendData).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F01" }));
  });

  it("resolves factoryCode → factoryId and threads it to paretoByDefectType", async () => {
    getFactoryByCode.mockResolvedValue({ id: 7, code: "F01" });
    await gatherKpis("day", "vi", undefined, "F01");
    expect(getFactoryByCode).toHaveBeenCalledWith("F01");
    expect(paretoByDefectType).toHaveBeenCalledWith(expect.objectContaining({ factoryId: 7 }));
  });

  it("global (no factoryCode) never resolves a factory and calls pareto with factoryId undefined", async () => {
    await gatherKpis("day", "vi");
    expect(getFactoryByCode).not.toHaveBeenCalled();
    expect(paretoByDefectType).toHaveBeenCalledWith(expect.objectContaining({ factoryId: undefined }));
  });

  it("FAILS CLOSED: an unresolvable factoryCode does not fall back to an unscoped pareto query", async () => {
    getFactoryByCode.mockResolvedValue(null); // unknown factory code
    const kpis = await gatherKpis("day", "vi", undefined, "GHOST");

    // The section must be skipped, not silently queried unscoped (that would leak every
    // factory's defects to a caller whose own factory code failed to resolve).
    expect(paretoByDefectType).not.toHaveBeenCalled();
    expect(kpis.topDefects).toEqual([]);
    expect(kpis.dataWarnings.some((w) => /defect pareto unavailable/.test(w))).toBe(true);
  });

  it("PdM risk machines are drawn from the factory-filtered list, not the global machine list, when scoped", async () => {
    getMachinesWithHierarchy.mockResolvedValue([
      { machine: { id: 1, code: "M-F01-A" }, factory: { code: "F01" } },
      { machine: { id: 2, code: "M-F02-A" }, factory: { code: "F02" } },
    ]);
    computeFailureRisk.mockResolvedValue({ failureRisk: 50, maintenanceUrgency: "MEDIUM", predictedTimeframe: null });

    const kpis = await gatherKpis("day", "vi", undefined, "F01");

    expect(getMachines).not.toHaveBeenCalled(); // scoped path must not fall back to the global list
    expect(computeFailureRisk).toHaveBeenCalledTimes(1);
    expect(computeFailureRisk).toHaveBeenCalledWith(1); // only the F01 machine
    expect(kpis.pdmRiskMachines[0]?.machineCode).toBe("M-F01-A");
  });

  it("global (no factoryCode) uses getMachines(), not the hierarchy join", async () => {
    getMachines.mockResolvedValue([{ id: 9, code: "M-ANY" }]);
    computeFailureRisk.mockResolvedValue({ failureRisk: 10, maintenanceUrgency: "LOW", predictedTimeframe: null });

    await gatherKpis("day", "vi");

    expect(getMachinesWithHierarchy).not.toHaveBeenCalled();
    expect(getMachines).toHaveBeenCalledOnce();
  });

  it("sets kpis.factoryCode only when scoped", async () => {
    const scoped = await gatherKpis("day", "vi", undefined, "F01");
    expect(scoped.factoryCode).toBe("F01");
    const global = await gatherKpis("day", "vi");
    expect(global.factoryCode).toBeUndefined();
  });
});

describe("generateExecutiveSummary — skipLlm (doc 69 T9)", () => {
  it("skipLlm:true never calls the deep-model narrative path, uses the rule-based summary", async () => {
    const s = await generateExecutiveSummary("day", "vi", undefined, "F01", { skipLlm: true });
    expect(route).not.toHaveBeenCalled();
    expect(generateNarrative).not.toHaveBeenCalled();
    expect(s.generatedBy).toBe("offline");
    expect(s.headline.length).toBeGreaterThan(0);
    expect(s.kpis.factoryCode).toBe("F01");
  });

  it("without skipLlm the LLM path still runs exactly as before (regression check)", async () => {
    generateNarrative.mockResolvedValue({ text: "Headline: ok", provider: "gguf", model: "m" });
    const s = await generateExecutiveSummary("day", "vi");
    expect(generateNarrative).toHaveBeenCalledOnce();
    expect(s.generatedBy).toBe("gguf");
  });
});

describe("persistExecutiveSummary / getExecutiveSummaries — factory tagging (doc 69 T9)", () => {
  /**
   * Vòng sửa 1 (Wave 3 §4.4, task 5) — `getDb` phải trả về CẢ `select` lẫn `insert` now:
   * (a) `generateExecutiveSummary` bên trong gọi `gatherKpis` → `collectInspectionTotals`
   *     dùng `db.select().from().where()` — thiếu `select` khiến totals rơi về 0, và với
   *     `hasReportableContent` mới (dựa KPI thô) một kỳ 0-lượt-kiểm-tra KHÔNG được lưu,
   *     nên hai test này (vốn muốn kiểm tra CONTEXT JSON của một lần lưu THÀNH CÔNG) cần
   *     totals thật khác 0.
   * (b) `persistExecutiveSummary` tự nó cũng dùng `db.select(...).limit(1)` để chống
   *     trùng trước khi insert — thiếu `.limit()` khiến lệnh bị ném lỗi, nuốt bởi
   *     try/catch, và trả `null` mà không bao giờ tới `insert`.
   * Tổng thời gian: `values` (spy insert) chỉ được gọi khi CẢ hai đường trên đều có thật.
   */
  function makeInsertSpyDbStub(values: any, totals = { total: 100, ok: 90, ng: 10 }) {
    const whereResult: any = {
      then: (resolve: any, reject?: any) => Promise.resolve([totals]).then(resolve, reject),
      limit: () => Promise.resolve([]), // không có bản trùng sẵn có trong các test này
    };
    const selectBuilder: any = { from: () => selectBuilder, where: () => whereResult };
    return { select: () => selectBuilder, insert: () => ({ values }) };
  }

  it("persists reportFactoryCode from kpis.factoryCode when scoped", async () => {
    const values = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 1 }]) }));
    getDb.mockResolvedValue(makeInsertSpyDbStub(values));

    const s = await generateExecutiveSummary("day", "vi", undefined, "F01", { skipLlm: true });
    await persistExecutiveSummary(s);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        contextJson: expect.objectContaining({ reportFactoryCode: "F01", reportPeriod: "day" }),
      }),
    );
  });

  it("persists reportFactoryCode: null for a global (unscoped) summary", async () => {
    const values = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 2 }]) }));
    getDb.mockResolvedValue(makeInsertSpyDbStub(values));

    const s = await generateExecutiveSummary("day", "vi", undefined, undefined, { skipLlm: true });
    await persistExecutiveSummary(s);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ contextJson: expect.objectContaining({ reportFactoryCode: null }) }),
    );
  });

  it("getExecutiveSummaries maps a persisted row's reportFactoryCode back onto factoryCode", async () => {
    const row = {
      id: 5,
      title: "t",
      severity: "info",
      createdAt: new Date(),
      contextJson: { reportPeriod: "day", reportFactoryCode: "F01" },
    };
    const sel: any = {
      from: () => sel,
      where: () => sel,
      orderBy: () => sel,
      limit: () => Promise.resolve([row]),
    };
    getDb.mockResolvedValue({ select: () => sel });

    const rows = await getExecutiveSummaries({ factoryCode: "F01", limit: 1 });
    expect(rows[0].factoryCode).toBe("F01");
    expect(rows[0].period).toBe("day");
  });

  it("getDb unavailable → getExecutiveSummaries returns [] (fail-safe, unchanged)", async () => {
    getDb.mockResolvedValue(null);
    await expect(getExecutiveSummaries({ factoryCode: "F01" })).resolves.toEqual([]);
  });
});
