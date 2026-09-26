/**
 * Sprint F6 — insight handler tests (READ-ONLY, text + suggestion only).
 *
 * Asserts:
 *  - correlate_process_quality on a clearly-correlated dataset reports a high
 *    |r| and emits a "Đề xuất" / HITL suggestion string (no execution).
 *  - analyze_line_bottleneck on a rising cycle-time series reports an
 *    increasing trend and a takt-breach warning.
 *  - SAFETY: this module does NOT import commandDispatcher / proposeAction /
 *    writeTags (source-level grep), and both tools are read-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ★★★ G3-A — hai tool insight nay đứng sau cổng quyền (`analytics_oee` / `analytics_advanced`).
 * Bộ ca cũ gọi thẳng `handler(...)` không danh tính ⇒ nay bị TỪ CHỐI. Ở đây cấp danh tính hợp lệ +
 * mở cổng để giữ NGUYÊN ý định từng ca; cổng được kiểm riêng ở cuối file.
 */
type ChiSoQuyen = [userId: number, role: string, moduleName: string, action: string];
const checkPermissionMock = vi.fn(async (..._a: ChiSoQuyen) => true);
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: ChiSoQuyen) => checkPermissionMock(...a),
}));
const AUTH_TEST = { userId: 7, role: "supervisor" };

const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const getLineBalanceSeries = vi.fn();
const resolveLineIdByCode = vi.fn();
vi.mock("../../db/lineBalance", () => ({
  getLineBalanceSeries: (...a: unknown[]) => getLineBalanceSeries(...a),
  resolveLineIdByCode: (...a: unknown[]) => resolveLineIdByCode(...a),
}));

vi.mock("../../../drizzle/schema", () => ({
  processResults: {
    serialNumber: { __c: "serialNumber" },
    metrics: { __c: "metrics" },
    result: { __c: "result" },
    stepType: { __c: "stepType" },
    measuredAt: { __c: "measuredAt" },
    machineId: { __c: "machineId" },
  },
  machines: { code: { __c: "code" }, id: { __c: "id" } },
}));

import { analyzeLineBottleneck, correlateProcessQuality } from "./insightHandlersF6";

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionMock.mockResolvedValue(true as never);
});

/** Build a fake db that serves two sequential select() calls (upstream, downstream). */
function fakeDbForCorrelation(upstreamRows: any[], downstreamRows: any[]) {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = call === 0 ? upstreamRows : downstreamRows;
          call++;
          return {
            orderBy: async () => rows,
            // downstream query has no orderBy → where() itself is awaited
            then: (resolve: (v: any) => void) => resolve(rows),
          };
        },
      }),
    }),
  };
}

describe("correlate_process_quality", () => {
  it("returns noDbResult when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await correlateProcessQuality.handler!({ __authCtx: AUTH_TEST,
      upstreamStepType: "torque", metricKey: "torque", days: 7,
    } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });

  it("reports a strong correlation + HITL suggestion on a correlated dataset", async () => {
    // High torque → fail; low torque → pass (monotonic → |r| high).
    const upstream = Array.from({ length: 10 }, (_, i) => ({
      serialNumber: `SN${i}`,
      metrics: { torque: i },
      result: "pass",
    }));
    const downstream = Array.from({ length: 10 }, (_, i) => ({
      serialNumber: `SN${i}`,
      result: i >= 5 ? "fail" : "pass",
      stepType: "function",
    }));
    getDbMock.mockResolvedValue(fakeDbForCorrelation(upstream, downstream));

    const r = await correlateProcessQuality.handler!({ __authCtx: AUTH_TEST,
      upstreamStepType: "torque", metricKey: "torque", downstreamStepType: "function", days: 7,
    } as any);

    expect(r.type).toBe("correlation_insight");
    expect(r.data!.paired).toBe(10);
    expect(Math.abs(r.data!.pearson!)).toBeGreaterThan(0.6);
    expect(r.textSummary).toMatch(/Đề xuất|ĐỀ XUẤT/);
    expect(r.textSummary.toLowerCase()).toContain("hitl");
  });

  it("returns NOT_FOUND when fewer than 3 paired serials", async () => {
    getDbMock.mockResolvedValue(fakeDbForCorrelation(
      [{ serialNumber: "SN1", metrics: { torque: 1 }, result: "pass" }],
      [{ serialNumber: "SN1", result: "fail", stepType: "function" }],
    ));
    const r = await correlateProcessQuality.handler!({ __authCtx: AUTH_TEST,
      upstreamStepType: "torque", metricKey: "torque", downstreamStepType: "function", days: 7,
    } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("analyze_line_bottleneck", () => {
  it("flags increasing cycle trend + takt breach forecast", async () => {
    getDbMock.mockResolvedValue({});
    resolveLineIdByCode.mockResolvedValue(7);
    const base = Date.now() - 10 * 86400_000;
    // Cycle max rises steadily and already near/over takt → forecast breach.
    getLineBalanceSeries.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        periodStart: new Date(base + i * 86400_000).toISOString(),
        maxCycleTimeMs: 800 + i * 60,
        taktTimeMs: 1000,
        wipCount: 5 + i,
        bottleneckStationId: 3,
      })),
    );
    const r = await analyzeLineBottleneck.handler!({ __authCtx: AUTH_TEST, lineCode: "A", days: 7 } as any);
    expect(r.type).toBe("line_insight");
    expect(r.data!.cycleTrend).toBe("increasing");
    expect(r.textSummary).toContain("[Hiện trạng]");
    expect(r.textSummary).toContain("[Dự báo]");
    expect(r.textSummary).toMatch(/ĐỀ XUẤT/);
  });

  it("returns NOT_FOUND with insufficient data", async () => {
    getDbMock.mockResolvedValue({});
    resolveLineIdByCode.mockResolvedValue(7);
    getLineBalanceSeries.mockResolvedValue([
      { periodStart: new Date().toISOString(), maxCycleTimeMs: 800, taktTimeMs: 1000, wipCount: 5, bottleneckStationId: 3 },
    ]);
    const r = await analyzeLineBottleneck.handler!({ __authCtx: AUTH_TEST, lineCode: "A", days: 7 } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("F6 insight — read-only safety", () => {
  it("both insight tools are read tools with no write surface — nhưng CÓ cổng ĐỌC (G3-A)", () => {
    for (const t of [analyzeLineBottleneck, correlateProcessQuality]) {
      expect(t.kind ?? "read").toBe("read");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      // ⚠ ĐÍNH CHÍNH: dòng cũ đòi `requiredPermission` VẮNG — "không ghi gì" đã bị hiểu nhầm thành
      // "không cần quyền", trong khi hai tool này ĐỌC dữ liệu mà giao diện gác sau cổng.
      expect(t.requiredPermission?.action).toBe("canView");
    }
    expect(analyzeLineBottleneck.requiredPermission).toEqual({ module: "analytics_oee", action: "canView" });
    expect(correlateProcessQuality.requiredPermission).toEqual({ module: "analytics_advanced", action: "canView" });
  });

  it("★★★ G3-A — KHÔNG danh tính ⇒ TỪ CHỐI TRUNG THỰC, không chạm CSDL", async () => {
    getDbMock.mockResolvedValue({});
    for (const t of [analyzeLineBottleneck, correlateProcessQuality]) {
      const r: any = await (t.handler as any)({ lineCode: "A", days: 7, upstreamStepType: "torque", metricKey: "torque" });
      expect(r.note).toBe("PERMISSION_DENIED");
      expect(r.textSummary).toContain(t.requiredPermission!.module);
      expect(r.textSummary).not.toMatch(/không có dữ liệu|chưa có dữ liệu/i);
    }
    expect(checkPermissionMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("★★★ G3-A — cặp (module, action) TỚI CỔNG đúng bằng cặp đã KHAI", async () => {
    getDbMock.mockResolvedValue({});
    checkPermissionMock.mockResolvedValue(false as never);
    for (const t of [analyzeLineBottleneck, correlateProcessQuality]) {
      checkPermissionMock.mockClear();
      const r: any = await (t.handler as any)({
        lineCode: "A", days: 7, upstreamStepType: "torque", metricKey: "torque", __authCtx: AUTH_TEST,
      });
      expect(r.note).toBe("PERMISSION_DENIED");
      expect(checkPermissionMock).toHaveBeenCalledWith(
        7, "supervisor", t.requiredPermission!.module, t.requiredPermission!.action,
      );
      expect(getDbMock).not.toHaveBeenCalled();
    }
  });

  it("does NOT import commandDispatcher / proposeAction / writeTags / aiCopilotActions", () => {
    const src = readFileSync(join(__dirname, "insightHandlersF6.ts"), "utf8");
    // Inspect ONLY the import statements (the doc comment legitimately names
    // these symbols when stating the safety contract).
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bawait import\b/.test(l));
    const imports = importLines.join("\n");
    expect(imports).not.toMatch(/commandDispatcher/);
    expect(imports).not.toMatch(/proposeAction/);
    expect(imports).not.toMatch(/writeTags/);
    expect(imports).not.toMatch(/aiCopilotActions/);
    expect(imports).not.toMatch(/commandDispatcher|ot\/driver/);
  });
});
