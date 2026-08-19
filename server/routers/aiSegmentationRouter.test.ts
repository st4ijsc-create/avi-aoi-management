/**
 * B7 — aiSegmentationRouter tests (mock DB accessor + engine).
 *
 * Kiểm: saveMask tính metrology + lưu; measureMask polygon; degrade
 * MODEL_NOT_AVAILABLE khi không có seg model (không crash).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { initTRPC } from "@trpc/server";

// ── Mock db accessor: ghi lại payload insert, trả id giả ──────────────────────
const insertSpy = vi.fn(async (data: any) => ({ id: 42, ...data }));
const listSpy = vi.fn(async () => [] as any[]);
vi.mock("../db/aiSegmentation", () => ({
  insertDefectSegmentation: (d: any) => insertSpy(d),
  listDefectSegmentations: (f: any) => listSpy(f),
  getDefectSegmentationById: vi.fn(async () => null),
  deleteDefectSegmentation: vi.fn(async () => {}),
}));

// ── Mock engine: SegmentationUnavailableError thật + runSegmentation ném nó ────
class FakeUnavailable extends Error {
  code = "MODEL_NOT_AVAILABLE" as const;
  constructor(m: string) { super(m); this.name = "SegmentationUnavailableError"; }
}
const runSegSpy = vi.fn();
vi.mock("../services/aiInferenceEngine", () => ({
  runSegmentation: (...a: unknown[]) => runSegSpy(...a),
  SegmentationUnavailableError: FakeUnavailable,
}));

import { aiSegmentationRouter } from "./aiSegmentationRouter";

const t = initTRPC.context<any>().create();
const createCaller = t.createCallerFactory(aiSegmentationRouter);
const caller = createCaller({ user: { id: 7, role: "quality_inspector" } });

const squarePolygon = {
  width: 40,
  height: 40,
  points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  insertSpy.mockResolvedValue({ id: 42 });
});

describe("saveMask", () => {
  it("lưu mask human + tính metrology (px khi thiếu calib)", async () => {
    const res = await caller.saveMask({
      source: "human",
      maskFormat: "polygon",
      maskData: squarePolygon,
      classLabel: "scratch",
    });
    expect(res.id).toBe(42);
    expect(res.metrology).not.toBeNull();
    expect(res.metrology!.unit).toBe("px");
    expect(res.metrology!.degraded).toBe(true);
    // insert payload có areaPx string + source + classLabel
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.source).toBe("human");
    expect(payload.classLabel).toBe("scratch");
    expect(payload.createdBy).toBe(7);
    expect(payload.areaUnit).toBe("px");
    expect(Number(payload.areaPx)).toBeGreaterThan(0);
  });

  it("với umPerPx → metrology unit 'um' và lưu umPerPx", async () => {
    const res = await caller.saveMask({
      maskData: squarePolygon,
      classLabel: "crack",
      umPerPx: 2,
    } as any);
    expect(res.metrology!.unit).toBe("um");
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.areaUnit).toBe("um");
    expect(Number(payload.umPerPx)).toBe(2);
  });
});

describe("measureMask", () => {
  it("polygon → metrology", async () => {
    const m = await caller.measureMask({ maskData: squarePolygon });
    expect(m.areaPx).toBeGreaterThan(0);
    expect(m.unit).toBe("px");
  });

  it("RLE không đo được → BAD_REQUEST", async () => {
    await expect(
      caller.measureMask({ maskData: { width: 10, height: 10, counts: [1, 2, 3] } }),
    ).rejects.toThrow(/RLE|polygon/i);
  });
});

describe("runSegmentation — degrade", () => {
  it("không seg model → PRECONDITION_FAILED MODEL_NOT_AVAILABLE (không crash)", async () => {
    runSegSpy.mockRejectedValueOnce(new FakeUnavailable("Model X is not a segmentation model"));
    await expect(
      caller.runSegmentation({ modelId: 1, image: "data:image/png;base64,AAAAAAAAAAAA" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("MODEL_NOT_AVAILABLE") });
  });

  it("có model → trả masks + metrology + degraded:false", async () => {
    runSegSpy.mockResolvedValueOnce({
      modelCode: "seg1",
      modelVersion: "1.0",
      outputType: "semantic-argmax",
      maskWidth: 40,
      maskHeight: 40,
      masks: [{
        label: "scratch", classIndex: 1, confidence: 0.9,
        polygon: squarePolygon.points, bbox: { x: 5, y: 5, w: 10, h: 10 }, pixelCount: 100,
      }],
      processingTimeMs: 5,
      status: "COMPLETED",
    });
    const res: any = await caller.runSegmentation({ modelId: 1, image: "AAAAAAAAAAAAAAAA" });
    expect(res.degraded).toBe(false);
    expect(res.masks.length).toBe(1);
    expect(res.masks[0].metrology.areaPx).toBeGreaterThan(0);
  });
});
