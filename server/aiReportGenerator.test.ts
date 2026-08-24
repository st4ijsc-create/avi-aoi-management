/**
 * server/services/aiReportGenerator.ts — LƯỚI ĐO THẬT.
 *
 * ⚠ BẢN TRƯỚC CỦA FILE NÀY LÀ MỘT LƯỚI ĐO HƯ KHÔNG (G0 phần C).
 * 22 ca đều XANH, nhưng dòng `import` duy nhất của nó là `NarrativeMetadata` — một KIỂU.
 * Không một hàm sản phẩm nào được gọi: cả 22 ca dựng object literal ngay trong test rồi
 * assert lên chính object đó (`expect(mockMetadata.generatedBy).toBe("openai")`). Nó có
 * HÌNH DẠNG đúng bằng một lưới thật (describe/it/expect, tên ca nhắc "FIX #3"/"FIX #5")
 * nhưng đo đúng 0 dòng mã sản phẩm — xoá sạch aiReportGenerator.ts vẫn XANH đủ 22 ca.
 *
 * BẢN NÀY gọi THẬT bốn hàm xuất ra và assert lên CON SỐ ĐẦU RA:
 *   generateDailyQualitySummary · generateRCAReport · generateModelPerformanceReport ·
 *   generateExecutiveSummary
 * (⚠ brief G0-C viết `generateRcaReport`; tên THẬT trong mã là `generateRCAReport`.)
 *
 * CÁCH CÔ LẬP — vì sao mock ở tầng `getDb()` chứ không seed DB `aoi_management_test`:
 *   Mọi phép tính đáng canh của module này (yieldRate, %defect, impact RCA, errorRate,
 *   p50/p95, yieldChange, ngưỡng MIN_SAMPLES_FOR_ERROR_ALERT, các nhánh "honest-empty")
 *   nằm HOÀN TOÀN trong mã TS ở lớp TRÊN câu SQL. Seed một DB thật chỉ thêm một biến số
 *   (migration của DB clone — xem cảnh báo "xanh rỗng" ở vitest.setup.ts) mà KHÔNG tăng
 *   thêm một dòng mã sản phẩm nào được thực thi. Ta thay ĐÚNG MỘT đường: kết quả trả về
 *   của driver DB. Toàn bộ hàm collect… và generate… THẬT vẫn chạy: cùng drizzle table thật, cùng
 *   `and/gte/lte/eq/desc` thật, cùng nhánh điều kiện thật.
 *   ⇒ Mọi con số dưới đây là số do MÃ SẢN PHẨM tính ra, không phải số test tự viết.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks: chỉ ba mặt tiếp xúc NGOÀI tiến trình ─────────────────────────────
const getDb = vi.fn();
const routerNarrative = vi.fn();
const checkConfidenceDrift = vi.fn();

vi.mock("./db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("./services/aiProviderRouter", () => ({
  generateNarrative: (...a: unknown[]) => routerNarrative(...a),
}));
vi.mock("./services/aiDriftMonitor", () => ({
  checkConfidenceDrift: (...a: unknown[]) => checkConfidenceDrift(...a),
}));

import {
  generateDailyQualitySummary,
  generateRCAReport,
  generateModelPerformanceReport,
  generateExecutiveSummary,
  generateReport,
} from "./services/aiReportGenerator";
import {
  productInspections,
  measurementResults,
  machines,
  inferenceResults,
} from "../drizzle/schema";
import { aiModels } from "../drizzle/schema/ai";

// ─── DB stub ─────────────────────────────────────────────────────────────────
//
// Bắt chước chuỗi builder của drizzle (`select().from().innerJoin().where().groupBy()
// .orderBy().limit()` — thenable ở MỌI mắt xích vì mỗi collector dừng ở một mắt khác
// nhau). Định tuyến theo BẢNG được `.from()` + các khoá của object select, đủ để tách
// `collectInspectionStats` (select {total,ok,ng}) khỏi `collectMachinePerformance`
// (select có thêm `machineId`) dù cả hai cùng đọc `product_inspections`.

interface QueryCtx {
  table: unknown;
  fields: string[];
}

function makeDbStub(resolveRows: (ctx: QueryCtx) => unknown[]) {
  const select = (fields?: Record<string, unknown>) => {
    const ctx: QueryCtx = { table: null, fields: Object.keys(fields ?? {}) };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      from: (t: unknown) => {
        ctx.table = t;
        return chain;
      },
      innerJoin: self,
      leftJoin: self,
      where: self,
      groupBy: self,
      orderBy: self,
      limit: self,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows(ctx)).then(res, rej),
    });
    return chain;
  };
  return { select };
}

/** Hàng thô như driver trả về (drizzle trả string cho COUNT/AVG của pg — giữ đúng vậy). */
interface StubTables {
  /** Hàng thống kê kiểm tra, tiêu thụ THEO THỨ TỰ (executive summary gọi 2 lần: kỳ này rồi kỳ trước). */
  stats?: Array<{ total: number; ok: number; ng: number; ntf?: number }>;
  topDefects?: Array<{ defectType: string | null; count: number }>;
  machinePerf?: Array<{ machineId: number; machineCode: string | null; total: number; ok: number; ng: number; ntf?: number }>;
  models?: Array<{ modelId: number; modelCode: string; modelVersion: string | null; status: string }>;
  inference?: Array<{ total: number; avgLatencyMs: number; p50LatencyMs: number; p95LatencyMs: number; errCount: number }>;
}

function installDb(tables: StubTables) {
  const statsQueue = [...(tables.stats ?? [])];
  const inferenceQueue = [...(tables.inference ?? [])];
  getDb.mockResolvedValue(
    makeDbStub((ctx) => {
      if (ctx.table === productInspections) {
        // machineId trong danh sách cột ⇒ collectMachinePerformance; ngược lại ⇒ collectInspectionStats.
        if (ctx.fields.includes("machineId")) return tables.machinePerf ?? [];
        return [statsQueue.shift() ?? { total: 0, ok: 0, ng: 0 }];
      }
      if (ctx.table === measurementResults) return tables.topDefects ?? [];
      if (ctx.table === aiModels) return tables.models ?? [];
      if (ctx.table === inferenceResults) {
        return [inferenceQueue.shift() ?? { total: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, errCount: 0 }];
      }
      if (ctx.table === machines) return [];
      throw new Error("[test] bảng ngoài dự kiến trong truy vấn: " + String(ctx.table));
    }),
  );
}

/** Ép nhánh narrative OFFLINE (mã sản phẩm THẬT: generateOfflineNarrative). */
function narrativeOffline() {
  routerNarrative.mockRejectedValue(new Error("no local model in test"));
}

/**
 * ★★★ G4-A — `language: "en"` nay được khai **TƯỜNG MINH** ở đây.
 *
 * ⚠⚠ Trước G4-A, `ReportParams.language` mặc định `"en"`, nên **mọi** khẳng định tiếng Anh dưới
 * đây "đúng" một cách **TÌNH CỜ**: chúng đo mặc định, không đo một lựa chọn. Bản vá đổi mặc định
 * sang `"vi"` (nhà máy Việt Nam — xem `aiReportPhrases.ts`), nên nếu không khai gì thì các câu
 * này phải là tiếng Việt.
 * ⇒ Khai `"en"` ngay tại `JAN` giữ **toàn bộ** giá trị của lưới cũ — nó vẫn canh từng chuỗi tiếng
 *   Anh, chỉ khác là **có chủ đích**. Phần "không khai gì ⇒ tiếng Việt" là một ca RIÊNG ở
 *   `aiReportPhrases.exhaustive.test.ts` §C, nên hai câu hỏi không còn dựa vào cùng một mặc định.
 */
const JAN = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-01-31T23:59:59Z"),
  language: "en" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  checkConfidenceDrift.mockResolvedValue({ evaluated: false, drift: false, severity: "NONE" });
  narrativeOffline();
});

// ─── 1. generateDailyQualitySummary ──────────────────────────────────────────

describe("generateDailyQualitySummary — con số đầu ra", () => {
  it("1000 kiểm tra / 920 OK / 80 NG ⇒ yield 92%, %defect 60/20/10, cảnh báo lỗi ÁP ĐẢO", async () => {
    installDb({
      stats: [{ total: 1000, ok: 920, ng: 80 }],
      topDefects: [
        { defectType: "Solder Bridge", count: 48 },
        { defectType: "Missing Part", count: 16 },
        { defectType: "Tombstone", count: 8 },
      ],
    });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.totalInspections).toBe(1000);
    expect(r.okCount).toBe(920);
    expect(r.ngCount).toBe(80);
    expect(r.yieldRate).toBeCloseTo(92, 9);

    // % theo TỔNG SỐ NG (80), không phải theo tổng kiểm tra.
    expect(r.topDefects.map((d) => d.type)).toEqual(["Solder Bridge", "Missing Part", "Tombstone"]);
    expect(r.topDefects[0].percentage).toBeCloseTo(60, 9);
    expect(r.topDefects[1].percentage).toBeCloseTo(20, 9);
    expect(r.topDefects[2].percentage).toBeCloseTo(10, 9);

    // defectRate = 8% ⇒ KHÔNG vượt ngưỡng 10% ⇒ không có cảnh báo "High defect rate".
    expect(r.anomalies.some((a) => a.includes("High defect rate"))).toBe(false);
    // Nhưng 60% > 50% ⇒ có cảnh báo lỗi áp đảo, kèm ĐÚNG con số.
    expect(r.anomalies).toContain(
      'Dominant defect type "Solder Bridge" accounts for 60.0% of all defects',
    );

    // defectRate 8% > 5% ⇒ khuyến nghị hiệu chuẩn.
    expect(r.recommendations).toContain("Review inspection criteria and machine calibration");
    expect(r.recommendations).toContain('Focus improvement on "Solder Bridge" defect type');
    expect(r.period).toBe("2026-01-01 to 2026-01-31");
  });

  it("narrative OFFLINE nhắc lại ĐÚNG con số đã tính (92.0% / 80)", async () => {
    installDb({
      stats: [{ total: 1000, ok: 920, ng: 80 }],
      topDefects: [{ defectType: "Solder Bridge", count: 48 }],
    });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.narrative).toContain("1000 inspections");
    expect(r.narrative).toContain("92.0% yield rate");
    expect(r.narrative).toContain("80 defective items");
    expect(r.narrativeMetadata?.generatedBy).toBe("offline");
    expect(r.narrativeMetadata?.confidence).toBe(0.4);
    expect(r.narrativeMetadata?.model).toBe("template");
  });

  it("bản tiếng Việt ⇒ narrative offline tiếng Việt, cùng bộ số", async () => {
    installDb({
      stats: [{ total: 1000, ok: 920, ng: 80 }],
      topDefects: [{ defectType: "Cầu chì hàn", count: 48 }],
    });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily", language: "vi" });

    expect(r.narrative).toContain("đã kiểm tra 1000 sản phẩm");
    expect(r.narrative).toContain("tỷ lệ đạt 92.0%");
    expect(r.narrative).toContain("80 sản phẩm lỗi");
  });

  it("CON SỐ THẬT đi tới provider narrative, và metadata theo provider trả về", async () => {
    installDb({
      stats: [{ total: 1000, ok: 920, ng: 80 }],
      topDefects: [{ defectType: "Solder Bridge", count: 48 }],
    });
    routerNarrative.mockResolvedValue({
      text: "narrative sinh bởi model cục bộ",
      provider: "gguf",
      model: "qwen3-4b",
      totalTimeMs: 123,
      fallbackUsed: false,
    });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.narrativeMetadata?.generatedBy).toBe("gguf");
    expect(r.narrativeMetadata?.confidence).toBe(0.75);
    expect(r.narrativeMetadata?.model).toBe("qwen3-4b");

    // Payload gửi cho LLM phải chứa CHÍNH những con số đã tính (không phải dữ liệu thô).
    const payload = JSON.parse(routerNarrative.mock.calls[0][0].prompt);
    expect(payload.total).toBe(1000);
    expect(payload.ng).toBe(80);
    expect(payload.yieldRate).toBeCloseTo(92, 9);
    expect(payload.topDefects[0].percentage).toBeCloseTo(60, 9);
  });

  it("defectRate 12% ⇒ cảnh báo 'High defect rate: 12.0%' (ngưỡng 10%)", async () => {
    installDb({
      stats: [{ total: 500, ok: 440, ng: 60 }],
      topDefects: [{ defectType: "Solder Bridge", count: 20 }],
    });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.yieldRate).toBeCloseTo(88, 9);
    expect(r.anomalies).toContain("High defect rate: 12.0%");
    // 20/60 = 33,3% ⇒ KHÔNG áp đảo.
    expect(r.topDefects[0].percentage).toBeCloseTo(100 / 3, 9);
    expect(r.anomalies.some((a) => a.includes("Dominant defect type"))).toBe(false);
  });

  it("kỳ RỖNG (0 kiểm tra) ⇒ 0, KHÔNG NaN, không cảnh báo, đúng 1 khuyến nghị", async () => {
    installDb({ stats: [{ total: 0, ok: 0, ng: 0 }], topDefects: [] });

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.yieldRate).toBe(0);
    expect(Number.isNaN(r.yieldRate)).toBe(false);
    expect(r.topDefects).toEqual([]);
    expect(r.anomalies).toEqual([]);
    expect(r.recommendations).toEqual(["Continue monitoring and compare with previous periods"]);
  });

  it("DB KHÔNG khả dụng (getDb → null) ⇒ báo cáo 0 chứ không ném", async () => {
    getDb.mockResolvedValue(null);

    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });

    expect(r.totalInspections).toBe(0);
    expect(r.ngCount).toBe(0);
    expect(r.yieldRate).toBe(0);
    expect(r.topDefects).toEqual([]);
  });
});

// ─── 2. generateRCAReport ────────────────────────────────────────────────────

describe("generateRCAReport — con số đầu ra", () => {
  it("impact = count/ng, correlation = ng/total, máy tệ nhất theo TỶ LỆ chứ không theo SỐ TUYỆT ĐỐI", async () => {
    installDb({
      stats: [{ total: 400, ok: 350, ng: 50 }],
      topDefects: [
        { defectType: "Solder Bridge", count: 30 },
        { defectType: "Missing Part", count: 10 },
      ],
      machinePerf: [
        { machineId: 1, machineCode: "AOI-01", total: 200, ok: 160, ng: 40 },
        { machineId: 2, machineCode: "AOI-02", total: 200, ok: 190, ng: 10 },
      ],
    });

    const r = await generateRCAReport({ ...JAN, reportType: "rca", triggerReason: "Defect spike 2026-01-20" });

    expect(r.triggeredBy).toBe("Defect spike 2026-01-20");

    expect(r.contributingFactors).toHaveLength(2);
    expect(r.contributingFactors[0].factor).toBe("Solder Bridge");
    expect(r.contributingFactors[0].impact).toBeCloseTo(60, 9); // 30/50
    expect(r.contributingFactors[0].evidence).toBe("30 occurrences out of 50 total defects");
    expect(r.contributingFactors[1].impact).toBeCloseTo(20, 9); // 10/50

    expect(r.correlations).toHaveLength(2);
    expect(r.correlations[0]).toMatchObject({ factor1: "AOI-01", factor2: "defect_rate" });
    expect(r.correlations[0].correlation).toBeCloseTo(0.2, 9); // 40/200
    expect(r.correlations[1].correlation).toBeCloseTo(0.05, 9); // 10/200

    expect(r.actionItems[0]).toBe('Investigate root cause of "Solder Bridge" defect type');
    expect(r.actionItems[1]).toBe('Check machine "AOI-01" — highest defect rate');
    expect(r.timeline).toHaveLength(3);

    // Narrative offline dùng lại ĐÚNG impact hàng đầu.
    expect(r.narrative).toContain('"Solder Bridge" (60.0% impact)');
  });

  it("máy có nhiều NG hơn nhưng sản lượng lớn hơn KHÔNG phải máy tệ nhất", async () => {
    installDb({
      stats: [{ total: 1100, ok: 1040, ng: 60 }],
      topDefects: [{ defectType: "Solder Bridge", count: 60 }],
      machinePerf: [
        // 50 NG nhưng trên 1000 lượt = 5%
        { machineId: 1, machineCode: "AOI-BIG", total: 1000, ok: 950, ng: 50 },
        // chỉ 10 NG nhưng trên 100 lượt = 10% ⇒ ĐÂY mới là máy tệ nhất
        { machineId: 2, machineCode: "AOI-SMALL", total: 100, ok: 90, ng: 10 },
      ],
    });

    const r = await generateRCAReport({ ...JAN, reportType: "rca" });

    expect(r.actionItems[1]).toBe('Check machine "AOI-SMALL" — highest defect rate');
    expect(r.correlations[0].correlation).toBeCloseTo(0.05, 9);
    expect(r.correlations[1].correlation).toBeCloseTo(0.1, 9);
  });

  it("không có lỗi nào ⇒ không có contributing factor, vẫn có action item mặc định", async () => {
    installDb({ stats: [{ total: 100, ok: 100, ng: 0 }], topDefects: [], machinePerf: [] });

    const r = await generateRCAReport({ ...JAN, reportType: "rca" });

    expect(r.contributingFactors).toEqual([]);
    expect(r.correlations).toEqual([]);
    expect(r.actionItems).toEqual([
      "Review process parameters for anomalous period",
      "Schedule preventive maintenance if machine degradation suspected",
    ]);
  });
});

// ─── 3. generateModelPerformanceReport ───────────────────────────────────────

describe("generateModelPerformanceReport — con số đầu ra", () => {
  const oneModel = [{ modelId: 7, modelCode: "AOI-DET-V3", modelVersion: "1.2.0", status: "ACTIVE" }];

  it("100 lượt suy luận / 15 lỗi ⇒ errorRate 0.15, latency LÀM TRÒN, hai khuyến nghị retrain", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 100, avgLatencyMs: 248.6, p50LatencyMs: 200, p95LatencyMs: 900, errCount: 15 }],
    });
    checkConfidenceDrift.mockResolvedValue({ evaluated: true, drift: true, severity: "HIGH" });

    const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    expect(r.models).toHaveLength(1);
    const m = r.models[0];
    expect(m.modelCode).toBe("AOI-DET-V3");
    expect(m.dataAvailable).toBe(true);
    expect(m.totalPredictions).toBe(100);
    expect(m.avgLatencyMs).toBe(249); // Math.round(248.6)
    expect(m.p50LatencyMs).toBe(200);
    expect(m.p95LatencyMs).toBe(900);
    expect(m.errorRate).toBeCloseTo(0.15, 9);
    expect(m.driftDetected).toBe(true);
    expect(m.driftSeverity).toBe("HIGH");
    // Cố ý: KHÔNG có nguồn accuracy thật trong hệ ⇒ phải null, không được bịa.
    expect(m.currentAccuracy).toBeNull();
    expect(m.accuracyTrend).toBeNull();

    expect(r.retrainRecommendations).toEqual([
      'Model "AOI-DET-V3" shows accuracy drift — recommend retraining',
      'Model "AOI-DET-V3" inference error rate 15.0% over 100 predictions — investigate pipeline/model health',
    ]);
  });

  it("errorRate 50% nhưng chỉ 10 mẫu ⇒ DƯỚI ngưỡng MIN_SAMPLES_FOR_ERROR_ALERT=20 ⇒ KHÔNG cảnh báo", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 10, avgLatencyMs: 100, p50LatencyMs: 90, p95LatencyMs: 300, errCount: 5 }],
    });

    const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    expect(r.models[0].errorRate).toBeCloseTo(0.5, 9);
    expect(r.models[0].totalPredictions).toBe(10);
    expect(r.retrainRecommendations).toEqual([
      "All models performing within acceptable ranges — no immediate action needed",
    ]);
  });

  it("đúng 20 mẫu ⇒ ĐẠT ngưỡng ⇒ CÓ cảnh báo (canh đúng biên >=, không phải >)", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 20, avgLatencyMs: 100, p50LatencyMs: 90, p95LatencyMs: 300, errCount: 6 }],
    });

    const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    expect(r.models[0].errorRate).toBeCloseTo(0.3, 9);
    expect(r.retrainRecommendations).toEqual([
      'Model "AOI-DET-V3" inference error rate 30.0% over 20 predictions — investigate pipeline/model health',
    ]);
  });

  it("KHÔNG có suy luận nào + drift chưa đo được ⇒ honest-empty (null, KHÔNG phải 0 hay 'khoẻ')", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, errCount: 0 }],
    });

    const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    const m = r.models[0];
    expect(m.dataAvailable).toBe(false);
    expect(m.totalPredictions).toBeNull();
    expect(m.avgLatencyMs).toBeNull();
    expect(m.p50LatencyMs).toBeNull();
    expect(m.p95LatencyMs).toBeNull();
    expect(m.errorRate).toBeNull();
    expect(m.driftDetected).toBeNull();
    expect(m.driftSeverity).toBeNull();

    expect(r.retrainRecommendations).toEqual([
      "Model performance metrics unavailable for this period — no real inference activity recorded yet",
    ]);
    // Narrative offline KHÔNG được tuyên bố "tất cả trong ngưỡng cho phép".
    expect(r.narrative).toContain("no real inference activity recorded yet");
    expect(r.narrative).not.toContain("All models performing within acceptable ranges");
  });

  it("drift đo được nhưng KHÔNG lệch ⇒ driftDetected=false (khác hẳn null 'chưa đo')", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, errCount: 0 }],
    });
    checkConfidenceDrift.mockResolvedValue({ evaluated: true, drift: false, severity: "NONE" });

    const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    expect(r.models[0].driftDetected).toBe(false);
    expect(r.models[0].driftSeverity).toBe("NONE");
    // dataAvailable TRUE vì có tín hiệu drift thật, dù không có hàng inference nào.
    expect(r.models[0].dataAvailable).toBe(true);
    expect(r.retrainRecommendations).toEqual([
      "All models performing within acceptable ranges — no immediate action needed",
    ]);
  });

  it("báo cáo chạy READ-ONLY: lượt kiểm drift KHÔNG được ghi model_drift_alerts", async () => {
    installDb({
      models: oneModel,
      inference: [{ total: 5, avgLatencyMs: 10, p50LatencyMs: 10, p95LatencyMs: 10, errCount: 0 }],
    });

    await generateModelPerformanceReport({ ...JAN, reportType: "model_performance" });

    expect(checkConfidenceDrift).toHaveBeenCalledTimes(1);
    expect(checkConfidenceDrift.mock.calls[0][0]).toMatchObject({
      modelId: 7,
      modelVersion: "1.2.0",
      emitAlert: false,
    });
  });
});

// ─── 4. generateExecutiveSummary ─────────────────────────────────────────────

describe("generateExecutiveSummary — con số đầu ra", () => {
  it("kỳ này 1000/940 vs kỳ trước 800/720 ⇒ yield 94 (+4pp), defect 6% (−4pp), xếp hạng máy", async () => {
    installDb({
      // Thứ tự tiêu thụ: KỲ NÀY trước, KỲ TRƯỚC sau (mã sản phẩm gọi đúng thứ tự đó).
      stats: [
        { total: 1000, ok: 940, ng: 60 },
        { total: 800, ok: 720, ng: 80 },
      ],
      machinePerf: [
        { machineId: 1, machineCode: "AOI-01", total: 500, ok: 490, ng: 10 }, // yield 98
        { machineId: 8, machineCode: "AOI-08", total: 500, ok: 450, ng: 50 }, // yield 90
      ],
    });

    const r = await generateExecutiveSummary({ ...JAN, reportType: "executive" });

    expect(r.kpis.totalProduction).toBe(1000);
    expect(r.kpis.overallYield).toBeCloseTo(94, 9);
    expect(r.kpis.yieldChange).toBeCloseTo(4, 9); // 94 − 90
    expect(r.kpis.avgDefectRate).toBeCloseTo(6, 9);
    expect(r.kpis.defectRateChange).toBeCloseTo(-4, 9); // 6 − 10
    expect(r.kpis.topPerformingMachine).toBe("AOI-01");
    expect(r.kpis.worstPerformingMachine).toBe("AOI-08");

    expect(r.trends).toContain("Yield improved by 4.0 percentage points");
    // 1000 > 800 × 1,1 = 880 ⇒ sản lượng tăng đáng kể.
    expect(r.trends).toContain("Production volume increased significantly");
    expect(r.concerns).toEqual(["Defect rate at 6.0% — above target"]);
    expect(r.forecast).toContain("Positive trend");
  });

  it("yield GIẢM ⇒ yieldChange âm, trend giảm, forecast chuyển sang cảnh báo", async () => {
    installDb({
      stats: [
        { total: 1000, ok: 850, ng: 150 }, // yield 85, defect 15
        { total: 1000, ok: 950, ng: 50 }, // yield 95, defect 5
      ],
      machinePerf: [{ machineId: 1, machineCode: "AOI-01", total: 1000, ok: 850, ng: 150 }],
    });

    const r = await generateExecutiveSummary({ ...JAN, reportType: "executive" });

    expect(r.kpis.overallYield).toBeCloseTo(85, 9);
    expect(r.kpis.yieldChange).toBeCloseTo(-10, 9);
    expect(r.kpis.defectRateChange).toBeCloseTo(10, 9);
    expect(r.trends).toContain("Yield decreased by 10.0 percentage points");
    expect(r.concerns).toContain("Defect rate at 15.0% — above target");
    expect(r.concerns).toContain("Significant yield decline vs previous period");
    expect(r.forecast).toContain("Declining trend");
    // Chỉ một máy ⇒ vừa tốt nhất vừa tệ nhất, không được ném/undefined.
    expect(r.kpis.topPerformingMachine).toBe("AOI-01");
    expect(r.kpis.worstPerformingMachine).toBe("AOI-01");
  });

  it("không có máy nào ⇒ 'N/A' chứ không undefined", async () => {
    installDb({ stats: [{ total: 0, ok: 0, ng: 0 }, { total: 0, ok: 0, ng: 0 }], machinePerf: [] });

    const r = await generateExecutiveSummary({ ...JAN, reportType: "executive" });

    expect(r.kpis.topPerformingMachine).toBe("N/A");
    expect(r.kpis.worstPerformingMachine).toBe("N/A");
    expect(r.kpis.yieldChange).toBe(0);
    expect(r.trends).toEqual([]);
  });

  // ★ Lượt vá sau-review (2026-08-25, I-2a): collectMachinePerformance trước đây bỏ NTF
  // khỏi yieldRate ⇒ xếp hạng máy dùng ok/total thay vì finalYield(ok,ntf,total). Ca này
  // cố tình cho một máy NTF CAO để hai công thức cho ra HAI thứ hạng KHÁC NHAU — nếu ai
  // đó lại hard-code `ntf: 0` (hoặc bỏ cột ntf khỏi SELECT), ca này phải ĐỎ ngay.
  it("NTF = PASS trong xếp hạng máy: máy NTF cao KHÔNG bị coi là máy tệ nhất", async () => {
    installDb({
      stats: [{ total: 200, ok: 175, ng: 5 }, { total: 200, ok: 175, ng: 5 }],
      machinePerf: [
        // yield THẬT (NTF=PASS) = 100; nếu NTF bị bỏ qua thì tính ra 80 và xếp CUỐI bảng.
        { machineId: 1, machineCode: "AOI-NTF", total: 100, ok: 80, ng: 0, ntf: 20 },
        // Không NTF — yield 95 dù tính đúng hay sai, dùng làm mốc so sánh.
        { machineId: 2, machineCode: "AOI-CLEAN", total: 100, ok: 95, ng: 5 },
      ],
    });

    const r = await generateExecutiveSummary({ ...JAN, reportType: "executive" });

    expect(r.kpis.topPerformingMachine).toBe("AOI-NTF");
    expect(r.kpis.worstPerformingMachine).toBe("AOI-CLEAN");
  });
});

// ─── 5. generateReport — bộ định tuyến ───────────────────────────────────────

describe("generateReport — điểm vào hợp nhất", () => {
  it("reportType='daily' trả đúng nhánh và cùng con số với lời gọi trực tiếp", async () => {
    installDb({
      stats: [{ total: 1000, ok: 920, ng: 80 }],
      topDefects: [{ defectType: "Solder Bridge", count: 48 }],
    });

    const r = await generateReport({ ...JAN, reportType: "daily" });

    expect(r?.type).toBe("daily");
    expect(r && "yieldRate" in r.data ? r.data.yieldRate : null).toBeCloseTo(92, 9);
  });

  it("reportType='model_performance' đi tới đúng bộ sinh model", async () => {
    installDb({
      models: [{ modelId: 7, modelCode: "AOI-DET-V3", modelVersion: "1.0.0", status: "ACTIVE" }],
      inference: [{ total: 40, avgLatencyMs: 100, p50LatencyMs: 90, p95LatencyMs: 300, errCount: 0 }],
    });

    const r = await generateReport({ ...JAN, reportType: "model_performance" });

    expect(r?.type).toBe("model_performance");
    expect(r && "models" in r.data ? r.data.models[0].totalPredictions : null).toBe(40);
  });
});
