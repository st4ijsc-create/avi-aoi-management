/**
 * Phase B4.3 — aiExecutiveReport unit tests.
 *
 * Covers:
 *  - gatherKpis aggregates correctly from mocked KPI sources (FPY, NG rate, trend, pareto, PdM)
 *  - generateExecutiveSummary returns the structured shape (mocked Model Router + LLM)
 *  - fail-safe: never throws on missing data; offline fallback fills all sections
 *  - scheduler is a no-op when EXEC_REPORT_ENABLED flag is off
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks for all KPI sources + DB (dynamic-imported inside the service) ─────
const getDb = vi.fn();
const getYieldTrendData = vi.fn();
const paretoByDefectType = vi.fn();
const getMachines = vi.fn();
const computeFailureRisk = vi.fn();
const generateNarrative = vi.fn();
const route = vi.fn();

vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../db/statistics", () => ({ getYieldTrendData: (...a: unknown[]) => getYieldTrendData(...a) }));
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: (...a: unknown[]) => paretoByDefectType(...a) }));
vi.mock("../db/hierarchy", () => ({ getMachines: (...a: unknown[]) => getMachines(...a) }));
vi.mock("./predictiveMaintenanceService", () => ({ computeFailureRisk: (...a: unknown[]) => computeFailureRisk(...a) }));
vi.mock("./aiProviderRouter", () => ({ generateNarrative: (...a: unknown[]) => generateNarrative(...a) }));
vi.mock("./aiModelRouter", () => ({ route: (...a: unknown[]) => route(...a) }));

import { gatherKpis, generateExecutiveSummary, runExecutiveReportNow } from "./aiExecutiveReport";

/** A db stub whose select-chain returns totals, and insert returns an id. */
function makeDbStub(totals = { total: 1000, ok: 950, ng: 50 }) {
  const selectBuilder: any = {
    from: () => selectBuilder,
    where: () => Promise.resolve([totals]),
  };
  return {
    select: () => selectBuilder,
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 42 }]) }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  route.mockReturnValue({ maxTokens: 1536, temperature: 0.3, tier: 2 });
});

afterEach(() => {
  delete process.env.EXEC_REPORT_ENABLED;
});

describe("gatherKpis", () => {
  it("aggregates FPY, NG rate, trend, pareto and PdM from real sources", async () => {
    // Current period totals 1000/950/50, previous period 1000/990/10 → NG rate rising.
    let call = 0;
    const sel: any = {
      from: () => sel,
      where: () => Promise.resolve([call++ === 0 ? { total: 1000, ok: 950, ng: 50 } : { total: 1000, ok: 990, ng: 10 }]),
    };
    getDb.mockResolvedValue({ select: () => sel });

    getYieldTrendData.mockResolvedValue([
      { timeInterval: "2026-06-26", ngRate: 4.5, totalCount: 500 },
      { timeInterval: "2026-06-27", ngRate: 5.5, totalCount: 500 },
    ]);
    paretoByDefectType.mockResolvedValue({
      items: [
        { category: "Solder Bridge", count: 30, percentage: 60 },
        { category: "Missing Part", count: 20, percentage: 40 },
      ],
    });
    getMachines.mockResolvedValue([{ id: 1, code: "M-001" }, { id: 2, code: "M-002" }]);
    computeFailureRisk.mockImplementation(async (id: number) => ({
      machineId: id,
      failureRisk: id === 1 ? 80 : 20,
      maintenanceUrgency: id === 1 ? "HIGH" : "LOW",
      predictedTimeframe: id === 1 ? "within 18 hours" : null,
    }));

    const kpis = await gatherKpis("day", "vi");

    expect(kpis.totalInspections).toBe(1000);
    expect(kpis.fpy).toBeCloseTo(95, 1);
    expect(kpis.ngRate).toBeCloseTo(5, 1);
    expect(kpis.prevNgRate).toBeCloseTo(1, 1);
    expect(kpis.ngRateTrend).toBe("up");
    expect(kpis.topDefects[0].type).toBe("Solder Bridge");
    expect(kpis.ngRateSeries).toHaveLength(2);
    // Highest-risk machine first.
    expect(kpis.pdmRiskMachines[0].machineCode).toBe("M-001");
    expect(kpis.pdmRiskMachines[0].urgency).toBe("HIGH");
    expect(kpis.dataWarnings).toHaveLength(0);
  });

  it("never throws and records warnings when sources are missing", async () => {
    getDb.mockResolvedValue(null);
    getYieldTrendData.mockRejectedValue(new Error("db down"));
    paretoByDefectType.mockRejectedValue(new Error("db down"));
    getMachines.mockRejectedValue(new Error("db down"));

    const kpis = await gatherKpis("shift", "en");
    expect(kpis.totalInspections).toBe(0);
    expect(kpis.fpy).toBe(0);
    expect(kpis.ngRate).toBe(0);
    expect(kpis.topDefects).toEqual([]);
    expect(kpis.pdmRiskMachines).toEqual([]);
    expect(kpis.dataWarnings.length).toBeGreaterThan(0);
  });
});

describe("generateExecutiveSummary", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(makeDbStub());
    getYieldTrendData.mockResolvedValue([]);
    paretoByDefectType.mockResolvedValue({ items: [{ category: "Bridge", count: 10, percentage: 100 }] });
    getMachines.mockResolvedValue([]);
  });

  it("returns the structured shape using LLM narrative via the deep router", async () => {
    generateNarrative.mockResolvedValue({
      text:
        "Headline: Sản lượng ổn định, FPY tốt.\n" +
        "Điểm nổi bật:\n- A\n- B\n" +
        "Rủi ro:\n- R1\n" +
        "Khuyến nghị:\n- Rec1\n",
      provider: "gguf",
      model: "qwen2.5-7b",
    });

    const s = await generateExecutiveSummary("day", "vi");

    // Model Router used with task:"report".
    expect(route).toHaveBeenCalledWith(expect.objectContaining({ task: "report" }));
    expect(s).toHaveProperty("headline");
    expect(Array.isArray(s.highlights)).toBe(true);
    expect(Array.isArray(s.risks)).toBe(true);
    expect(Array.isArray(s.recommendations)).toBe(true);
    expect(Array.isArray(s.kpiTable)).toBe(true);
    expect(s.kpiTable.length).toBeGreaterThan(0);
    expect(s.kpis).toBeDefined();
    expect(s.generatedBy).toBe("gguf");
    expect(s.headline.length).toBeGreaterThan(0);
    expect(s.highlights).toContain("A");
    expect(s.recommendations).toContain("Rec1");
  });

  it("falls back to a full offline summary when the LLM throws", async () => {
    generateNarrative.mockRejectedValue(new Error("gguf unavailable"));

    const s = await generateExecutiveSummary("week", "en");
    expect(s.generatedBy).toBe("offline");
    // Offline summary must still fill every section.
    expect(s.headline.length).toBeGreaterThan(0);
    expect(s.highlights.length).toBeGreaterThan(0);
    expect(s.risks.length).toBeGreaterThan(0);
    expect(s.recommendations.length).toBeGreaterThan(0);
  });

  it("runExecutiveReportNow persists and returns an insight id", async () => {
    generateNarrative.mockResolvedValue({ text: "Headline: ok", provider: "gguf", model: "m" });
    const { summary, insightId } = await runExecutiveReportNow("day", "vi");
    expect(summary).toBeDefined();
    expect(insightId).toBe(42);
  });
});

describe("scheduler flag gating", () => {
  it("startExecutiveReportScheduler is a no-op when EXEC_REPORT_ENABLED is off", async () => {
    process.env.EXEC_REPORT_ENABLED = "false";
    // Re-import the module fresh so the flag is read at import time.
    vi.resetModules();
    const mod = await import("./reportScheduler");
    expect(() => mod.startExecutiveReportScheduler()).not.toThrow();
    const status = mod.getExecutiveReportSchedulerStatus();
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
  });
});
