/**
 * Wave 4 §5 (2026-07-29-ai-wave4-alert-kpi-truth Task 5) — `generatePredictions`
 * phải đi qua routeAlert() thay vì INSERT thẳng vào predictive_alerts.
 *
 * Trước sửa: khối trong predictiveAlertRouter.generatePredictions gọi
 * `db.insert(predictiveAlerts).values({...})` trực tiếp — bỏ qua toàn bộ hạ tầng
 * Wave 3 (gộp một-cảnh-báo-mở theo machineId+alertType, đặt expiresAt) và Task 2
 * (ghi nhật ký predictive_alert_occurrences). Bấm nút vài lần dựng lại đúng đống
 * cảnh báo trùng lặp/không-hết-hạn mà Wave 3 vừa dọn, và tạo lỗ đen KPI (lần
 * tái-diễn không được đếm).
 *
 * Toàn bộ hạ tầng phân tích thật (forecastYield/getDefectTrend/getDefectPareto/
 * correlateStationDefect/deriveDefectSpikeSignal) bị mock — bài kiểm này CHỈ xác
 * nhận đường ĐI (routeAlert được gọi, INSERT thẳng biến mất), KHÔNG đụng điều
 * kiện QUYẾT ĐỊNH có cảnh báo hay không (đã phủ riêng ở
 * aiPredictiveRcaConverge.test.ts / aiRcaAlertSql.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTRPC } from "@trpc/server";

// ─── Fixture: >=7 hàng cùng machine_code để qua ngưỡng lọc sơ bộ `data.length < 7`
// trong predictiveAlertRouter.generatePredictions. ──────────────────────────────
const MACHINE_ROW = {
  machine_id: 42,
  machine_code: "M-01",
  product_model_id: 5,
  product_model_code: "PM-1",
  factory_id: 3,
  total: 100,
  ng_count: 8,
};
function sevenRows() {
  return Array.from({ length: 7 }, (_, i) => ({ ...MACHINE_ROW, date: `2026-01-0${i + 1}` }));
}

// ─── Fake DB — .execute() cho SELECT dữ liệu thô + .insert() để CHỨNG MINH đường
// INSERT-thẳng cũ không còn được gọi từ generatePredictions nữa. ────────────────
const insertValues = vi.fn(async () => undefined);
const fakeDb = {
  execute: vi.fn(async () => ({ rows: sevenRows() })),
  insert: vi.fn(() => ({ values: insertValues })),
};
vi.mock("../db", () => ({ getDb: async () => fakeDb }));

// ─── SIGNAL — DefectSpikeSignal thật (đủ field, không rút gọn) để khớp payload
// routeAlert cần. deriveDefectSpikeSignal là hàm ĐỒNG BỘ (không async). ─────────
const SIGNAL = {
  alertType: "DEFECT_SPIKE" as const,
  severity: "HIGH" as const,
  predictedValue: 14.2,
  currentValue: 8.1,
  alertThreshold: 9.6,
  confidenceScore: 76,
  predictedTimeframe: "7 ngày tới",
  modelUsed: "yield-forecast:ewma (exponential weighted moving average)",
  dataPoints: 14,
  factors: [{ name: "Solder Bridge", contribution: 66.7, description: "40 NG trong cửa sổ" }],
  recommendations: ["Kiểm tra hàn — Solder Bridge chiếm 66.7% lỗi"],
};
const deriveDefectSpikeSignal = vi.fn(() => SIGNAL as any);
vi.mock("../services/aiPredictiveAlertService", () => ({
  deriveDefectSpikeSignal: (...a: unknown[]) => deriveDefectSpikeSignal(...a),
}));

const forecastYield = vi.fn(async () => [] as any[]);
const getDefectTrend = vi.fn(async () => [] as any[]);
const getDefectPareto = vi.fn(async () => [] as any[]);
vi.mock("../services/aiInspectionAnalytics", () => ({
  forecastYield: (...a: unknown[]) => forecastYield(...a),
  getDefectTrend: (...a: unknown[]) => getDefectTrend(...a),
  getDefectPareto: (...a: unknown[]) => getDefectPareto(...a),
}));

const correlateStationDefect = vi.fn(async () => ({ ok: false, factors: [] }) as any);
vi.mock("../services/ai/defectCorrelationService", () => ({
  correlateStationDefect: (...a: unknown[]) => correlateStationDefect(...a),
}));

const routeAlert = vi.fn(async () => ({
  alertType: "DEFECT_SPIKE",
  targets: [],
  consolidated: false,
  escalationLevel: "L1",
}) as any);
vi.mock("../services/aiSmartAlertRouter", () => ({
  routeAlert: (...a: unknown[]) => routeAlert(...a),
}));

import { predictiveAlertRouter } from "./aiRouters";

const t = initTRPC.context<any>().create();
const makeAlertCaller = t.createCallerFactory(predictiveAlertRouter);
const alertCaller = makeAlertCaller({ user: { id: 1, name: "Tester", role: "admin" } });

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.execute.mockResolvedValue({ rows: sevenRows() } as any);
  fakeDb.insert.mockReturnValue({ values: insertValues } as any);
  deriveDefectSpikeSignal.mockReturnValue(SIGNAL as any);
  forecastYield.mockResolvedValue([] as any);
  getDefectTrend.mockResolvedValue([] as any);
  getDefectPareto.mockResolvedValue([] as any);
  correlateStationDefect.mockResolvedValue({ ok: false, factors: [] } as any);
  routeAlert.mockResolvedValue({ alertType: "DEFECT_SPIKE", targets: [], consolidated: false, escalationLevel: "L1" } as any);
});

describe("generatePredictions — đi qua routeAlert", () => {
  it("gọi routeAlert thay vì INSERT thẳng", async () => {
    const res = await alertCaller.generatePredictions({ daysToAnalyze: 7 });

    expect(res.success).toBe(true);
    expect(routeAlert).toHaveBeenCalledTimes(1);
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it("truyền đủ machineId + mức độ + độ tin cậy cho routeAlert", async () => {
    await alertCaller.generatePredictions({ daysToAnalyze: 7 });

    expect(routeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DEFECT_SPIKE",
        machineId: 42,
        severity: "HIGH",
        data: expect.objectContaining({ confidence: 76 }),
      }),
    );
  });
});
