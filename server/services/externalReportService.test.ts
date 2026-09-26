/**
 * Doc 32 Wave R3 (R3-A) — unit tests for externalReportService.
 * ============================================================================
 * Exercises the reportType → aggregator → renderReport → persistArtifact
 * orchestration WITHOUT a DB: the aggregators, render engine, artifact store and
 * db connection are mocked. Proves:
 *   - each reportType calls its aggregator and produces a real (persisted) artifact,
 *   - the requested `format` is HONORED (pdf → pdf, xlsx → xlsx, excel → xlsx, csv → csv)
 *     — the pre-R3 "format ignored" bug is gone,
 *   - the response returns the artifact id + download url (NOT a volatile Map key),
 *   - invalid reportType/format are rejected (400),
 *   - sparse OEE renders an honest empty state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  renderReport: vi.fn(),
  resolveBranding: vi.fn(),
  persistArtifact: vi.fn(),
  getDefectParetoByCategory: vi.fn(),
  getYieldByProduct: vi.fn(),
  getYieldTrendByDay: vi.fn(),
  getYieldTrendByWeek: vi.fn(),
  getWorkstationHeatmap: vi.fn(),
  getShiftReport: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./universalExportService", () => ({
  renderReport: mocks.renderReport,
  resolveBranding: mocks.resolveBranding,
}));
vi.mock("./reportArtifactService", () => ({
  persistArtifact: mocks.persistArtifact,
}));
vi.mock("../db/reportAggregators", () => ({
  getDefectParetoByCategory: mocks.getDefectParetoByCategory,
  getYieldByProduct: mocks.getYieldByProduct,
  // ★ 2026-08-17 — báo cáo `daily` chuyển từ `db/statistics.getYieldTrendData` (KHÔNG có trục
  // `userId`; chỉ nhận MỘT `factoryCode` nên người gán hai nhà máy không diễn đạt được) sang
  // `getYieldTrendByDay`, đi qua cùng `scopedConditions` với ba bộ tổng hợp còn lại.
  getYieldTrendByDay: mocks.getYieldTrendByDay,
  getYieldTrendByWeek: mocks.getYieldTrendByWeek,
  getWorkstationHeatmap: mocks.getWorkstationHeatmap,
}));
vi.mock("../db/statistics", () => ({
  getShiftReport: mocks.getShiftReport,
}));
vi.mock("../db/connection", () => ({
  getDb: mocks.getDb,
}));

import {
  generateExternalReport,
  normalizeReportType,
  normalizeFormat,
  resolveReportWindow,
  buildRollupFilters,
  ExternalReportError,
  EXTERNAL_REPORT_TYPES,
} from "./externalReportService";

// ── Fixtures ────────────────────────────────────────────────────────────────

function seedAggregators(oeeRows: any[] = []) {
  mocks.getYieldTrendByDay.mockResolvedValue([
    { day: "2026-07-01", total: 100, ok: 95, ng: 3, ntf: 2, yieldRate: 97, ngRate: 3 },
  ]);
  mocks.getYieldTrendByWeek.mockResolvedValue([
    { week: "2026-06-29", isoWeek: "2026-W27", total: 100, ok: 95, ng: 3, ntf: 2, yieldRate: 97 },
  ]);
  mocks.getShiftReport.mockResolvedValue([
    { shift: "S1", shiftName: "Ca 1", shiftWindow: "06:00-14:00", total: 50, ok: 48, ng: 1, ntf: 1, yieldPct: 98, fpy: 96, machinesActive: 3, defectTypeCount: 1 },
    { shift: "S2", shiftName: "Ca 2", shiftWindow: "14:00-22:00", total: 40, ok: 38, ng: 2, ntf: 0, yieldPct: 95, fpy: 94, machinesActive: 2, defectTypeCount: 2 },
  ]);
  mocks.getDefectParetoByCategory.mockResolvedValue({
    dimension: "category",
    items: [
      { key: "SOLDER", count: 10, percentage: 50, cumulativePercentage: 50, bucket: "value" },
      { key: "UNCLASSIFIED", count: 10, percentage: 50, cumulativePercentage: 100, bucket: "unclassified" },
    ],
    totalDefects: 20,
    classifiedDefects: 10,
    unclassifiedDefects: 10,
    topN: 10,
  });
  mocks.getYieldByProduct.mockResolvedValue([
    { productModelId: 1, productCode: "P1", productName: "Prod 1", total: 100, ok: 95, ng: 3, ntf: 2, yieldRate: 97 },
  ]);
  mocks.getWorkstationHeatmap.mockResolvedValue([
    { workstationId: 1, workstationName: "WS1", ngCount: 5, inspectionCount: 100, ngRate: 5 },
  ]);
  mocks.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(oeeRows) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBranding.mockResolvedValue({ companyName: "ACME" });
  mocks.renderReport.mockImplementation(async (input: any) => ({
    buffer: Buffer.from(`bytes-${input.format}`),
    mimeType: `application/${input.format}`,
    filename: `${input.type}.${input.format}`,
    format: input.format,
  }));
  mocks.persistArtifact.mockImplementation(async (input: any) => ({
    id: 777,
    storageKey: "report-artifacts/2026/07/hash." + input.format,
    storageUrl: "/uploads/report-artifacts/2026/07/hash." + input.format,
    downloadUrl: "/api/reports/artifacts/777/download",
    fileHash: "hash",
    fileSize: input.buffer.length,
    expiresAt: new Date("2027-07-05T00:00:00Z"),
    deduped: false,
  }));
  seedAggregators();
});

const BASE = { dateFrom: "2026-07-01", dateTo: "2026-07-01" };

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe("normalizeReportType", () => {
  it("maps the new short ids", () => {
    for (const t of EXTERNAL_REPORT_TYPES) expect(normalizeReportType(t)).toBe(t);
  });
  it("maps the legacy mobile names", () => {
    expect(normalizeReportType("daily_summary")).toBe("daily");
    expect(normalizeReportType("shift_report")).toBe("shift");
    expect(normalizeReportType("defect_analysis")).toBe("defect");
    expect(normalizeReportType("station_report")).toBe("station");
  });
  it("rejects unknown / non-string", () => {
    expect(normalizeReportType("bogus")).toBeNull();
    expect(normalizeReportType(undefined)).toBeNull();
    expect(normalizeReportType(123 as any)).toBeNull();
  });
});

describe("normalizeFormat", () => {
  it("defaults to pdf when omitted", () => {
    expect(normalizeFormat(undefined)).toBe("pdf");
    expect(normalizeFormat("")).toBe("pdf");
  });
  it("accepts pdf/xlsx/csv and the legacy 'excel' alias", () => {
    expect(normalizeFormat("pdf")).toBe("pdf");
    expect(normalizeFormat("xlsx")).toBe("xlsx");
    expect(normalizeFormat("excel")).toBe("xlsx");
    expect(normalizeFormat("csv")).toBe("csv");
  });
  it("rejects a bad format", () => {
    expect(normalizeFormat("docx")).toBeNull();
  });
});

describe("resolveReportWindow", () => {
  it("resolves a date-only window to instants", () => {
    const { start, end } = resolveReportWindow("2026-07-01", "2026-07-02");
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
  it("defaults to today when omitted", () => {
    const { start, end } = resolveReportWindow(undefined, undefined);
    expect(start.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

describe("buildRollupFilters", () => {
  const w = { start: new Date("2026-07-01"), end: new Date("2026-07-02") };
  it("maps + coerces the flexible filter object", () => {
    const f = buildRollupFilters(w, { factory: "3", lineId: 5, machine: "9", product: "2" });
    expect(f).toMatchObject({ factoryId: 3, lineId: 5, machineId: 9, productModelId: 2 });
  });
  it("leaves unknown filters undefined", () => {
    const f = buildRollupFilters(w, {});
    expect(f.factoryId).toBeUndefined();
    expect(f.machineId).toBeUndefined();
  });
});

// ── Orchestration: reportType → aggregator ─────────────────────────────────────

describe("generateExternalReport — reportType wiring", () => {
  const cases: Array<[string, keyof typeof mocks]> = [
    ["daily", "getYieldTrendByDay"],
    ["weekly", "getYieldTrendByWeek"],
    ["shift", "getShiftReport"],
    ["defect", "getDefectParetoByCategory"],
    ["product", "getYieldByProduct"],
    ["station", "getWorkstationHeatmap"],
  ];

  it.each(cases)("%s report calls its aggregator + persists a real artifact", async (reportType, aggregatorKey) => {
    const result = await generateExternalReport({ reportType, format: "pdf", ...BASE });
    expect(mocks[aggregatorKey]).toHaveBeenCalledTimes(1);
    expect(mocks.renderReport).toHaveBeenCalledTimes(1);
    expect(mocks.persistArtifact).toHaveBeenCalledTimes(1);
    // Response returns the ARTIFACT id + download url, not a volatile Map key.
    expect(result.reportId).toBe(777);
    expect(typeof result.reportId).toBe("number");
    expect(result.downloadUrl).toBe("/api/reports/artifacts/777/download");
    expect(result.reportType).toBe(reportType);
  });

  it("oee report queries the persisted oee_metrics table", async () => {
    seedAggregators([
      { day: "2026-07-01", machine_code: "M1", availability: 90, performance: 85, quality: 99, oee: 75.7, total_count: 100, good_count: 98, reject_count: 2 },
    ]);
    const result = await generateExternalReport({ reportType: "oee", format: "xlsx", ...BASE });
    expect(mocks.getDb).toHaveBeenCalled();
    expect(result.rowCount).toBe(1);
    expect(result.emptyState).toBe(false);
  });
});

// ── Format honored (the pre-R3 bug is gone) ────────────────────────────────────

describe("generateExternalReport — format is honored", () => {
  it.each([
    ["pdf", "pdf"],
    ["xlsx", "xlsx"],
    ["excel", "xlsx"], // legacy alias → xlsx
    ["csv", "csv"],
  ])("format %s → renders + persists as %s", async (requested, expectedFormat) => {
    const result = await generateExternalReport({ reportType: "product", format: requested, ...BASE });
    expect(mocks.renderReport).toHaveBeenCalledWith(expect.objectContaining({ format: expectedFormat }));
    expect(mocks.persistArtifact).toHaveBeenCalledWith(expect.objectContaining({ format: expectedFormat }));
    expect(result.format).toBe(expectedFormat);
  });

  it("defaults to pdf when format omitted", async () => {
    const result = await generateExternalReport({ reportType: "daily", ...BASE });
    expect(result.format).toBe("pdf");
  });
});

// ── Provenance + createdBy ─────────────────────────────────────────────────────

describe("generateExternalReport — provenance", () => {
  it("persists with source=external and passes createdBy through", async () => {
    await generateExternalReport({ reportType: "daily", format: "pdf", createdBy: 42, ...BASE });
    expect(mocks.persistArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ source: "external", createdBy: 42 }),
    );
  });
  it("createdBy null for master-key server-to-server callers", async () => {
    await generateExternalReport({ reportType: "daily", format: "pdf", ...BASE });
    expect(mocks.persistArtifact).toHaveBeenCalledWith(expect.objectContaining({ createdBy: null }));
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────

describe("generateExternalReport — validation", () => {
  it("rejects an invalid reportType with ExternalReportError(400)", async () => {
    await expect(generateExternalReport({ reportType: "bogus", format: "pdf", ...BASE }))
      .rejects.toMatchObject({ status: 400 });
    await expect(generateExternalReport({ reportType: "bogus", format: "pdf", ...BASE }))
      .rejects.toBeInstanceOf(ExternalReportError);
    expect(mocks.persistArtifact).not.toHaveBeenCalled();
  });
  it("rejects an invalid format with ExternalReportError(400)", async () => {
    await expect(generateExternalReport({ reportType: "daily", format: "docx", ...BASE }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.persistArtifact).not.toHaveBeenCalled();
  });
});

// ── Honest empty state (sparse OEE) ────────────────────────────────────────────

describe("generateExternalReport — honest empty state", () => {
  it("sparse OEE → still renders, flags emptyState + a reason", async () => {
    seedAggregators([]); // no oee_metrics rows in window
    const result = await generateExternalReport({ reportType: "oee", format: "pdf", ...BASE });
    // A real file is still produced (rendered + persisted) — never a silent skip.
    expect(mocks.renderReport).toHaveBeenCalledTimes(1);
    expect(mocks.persistArtifact).toHaveBeenCalledTimes(1);
    expect(result.reportId).toBe(777);
    expect(result.rowCount).toBe(0);
    expect(result.emptyState).toBe(true);
    expect(result.emptyReason).toBeTruthy();
  });

  it("defect report with no NG folds into an honest empty reason", async () => {
    mocks.getDefectParetoByCategory.mockResolvedValue({
      dimension: "category", items: [], totalDefects: 0, classifiedDefects: 0, unclassifiedDefects: 0, topN: 10,
    });
    const result = await generateExternalReport({ reportType: "defect", format: "pdf", ...BASE });
    expect(result.emptyState).toBe(true);
    expect(result.emptyReason).toBeTruthy();
  });
});

// ── Legacy mobile request shape still works ────────────────────────────────────

describe("generateExternalReport — backward compatibility", () => {
  it("accepts the legacy mobile request (nested filters.startDate/endDate + legacy names)", async () => {
    const result = await generateExternalReport({
      reportType: "defect_analysis",
      format: "excel",
      filters: { startDate: "2026-07-01", endDate: "2026-07-02", stationIds: ["1", "2"] },
    });
    expect(result.reportType).toBe("defect");
    expect(result.format).toBe("xlsx");
    expect(result.reportId).toBe(777);
  });
});
