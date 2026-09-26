/**
 * server/routers/changeReasonGiaTienToBienThe.test.ts
 *
 * ★★★ BG-126 (Khối C, "nợ còn mở", 2026-09-05) — `changeReason`/`reason` do
 * NGƯỜI DÙNG gõ ở `measurementPoint.update` / `setLimitsBatch` /
 * `revertPointsConfigToVersion` không được phép GIẢ tiền tố CẤU TRÚC
 * `[VARIANT:<id>]` (`RE_TIEN_TO_VERSION_BIEN_THE`, `server/db/product.ts`) —
 * tiền tố đó là TÍN HIỆU NỘI BỘ quyết định `napLichSuGioiHanTheoDiem`/
 * `loadPointLimitSnapshots` có LỌC BỎ một hàng `measurement_point_versions`
 * khỏi chuỗi BASE hay không (NEW-3, `02676ea2`). Người dùng gõ đúng chuỗi đó
 * (vô tình hay cố ý) ⇒ snapshot BASE của họ trở nên VÔ HÌNH với cổng
 * snapshot-gate ⇒ khi `SPEC_GATE_SNAPSHOT_ENABLED` BẬT, sản phẩm có thể được
 * chấm bằng giới hạn CŨ hơn (hạ oan) mà không ai biết vì sao.
 *
 * ★ Census "đo TRƯỚC" (đủ trong report BG-126): 4 input router nhận
 * `changeReason`/`reason`/`comment` VÀ chuỗi đó chảy tới một trong ba write-site
 * `server/db/product.ts:~2002 (updateMeasurementPointDef)` / `~2147
 * (updateMeasurementPointLimitsBatch)` / `~2396 (revertPointsConfigToVersion)`:
 *   1. `measurementPointRouter.update` (`changeReason`) — file này.
 *   2. `measurementPointRouter.setLimitsBatch` (`changeReason`) — file này.
 *   3. `measurementPointRouter.revertPointsConfigToVersion` (`reason`) — file này.
 *   4. `thresholdApprovalRouter.revert` (`comment`) — xem
 *      `server/routers/thresholdApprovalRouter.test.ts` (mở rộng, không file mới).
 * Các điểm gọi KHÁC `updateMeasurementPointDef` đã đo và loại (changeReason CỐ
 * ĐỊNH hoặc vắng mặt — không có văn bản người dùng chảy vào): `thresholdApprovalRouter.decideApproval`
 * (`threshold_approval:<id>` — chỉ số), `dataRouters.ts` bulk import (không truyền
 * option changeReason), `machineApiRouters.ts` machine sync ×2 (không truyền),
 * `spcAnalysisRouter.saveSpecLimits` (chuỗi cố định), `productRouters.uploadCroppedImage`
 * (chuỗi cố định), `aiLocalTools/writeHandlers*` (chuỗi cố định "AI Copilot").
 * `alertRouters.updateWithHistory`/`productModelRouter.update` ghi bảng KHÁC
 * (`yield_alert_thresholds`/audit `product_models`), không chạm
 * `measurement_point_versions` — ngoài phạm vi BG-126.
 *
 * Mutation-test tự nhiên: RED trước khi có guard (câu "[VARIANT:12] abc" đi
 * thẳng xuống write-site, không lưới nào chặn) — xem lịch sử git bản vá này.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readAppErrorMeta } from "../_core/appError";

const { RevertVersionError } = vi.hoisted(() => {
  class RevertVersionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RevertVersionError";
    }
  }
  return { RevertVersionError };
});

const updateSpy = vi.fn(async () => {});
const batchSpy = vi.fn(async () => ({ updated: 1, productModelId: 1, code: "PM-1", pointsConfigVersion: 2 }));
const revertSpy = vi.fn(async () => ({
  productModelId: 7, code: "PM-7", targetVersion: 1, fromVersion: 3, newVersion: 4,
  pointsReverted: 1, pointsUnchanged: 0, pointsSkipped: 0, skippedPointIds: [],
}));
const getPointSpy = vi.fn();
const getByIdsSpy = vi.fn();
const auditSpy = vi.fn(async () => ({ id: 1 }));
const bumpSpy = vi.fn(async (id: number) => ({ productModelId: id, code: "PM-TEST", version: 2 }));

vi.mock("../db", () => ({
  updateMeasurementPointDef: (...a: any[]) => updateSpy(...a),
  updateMeasurementPointLimitsBatch: (...a: any[]) => batchSpy(...a),
  revertPointsConfigToVersion: (...a: any[]) => revertSpy(...a),
  RevertVersionError,
  getMeasurementPointDefById: (...a: any[]) => getPointSpy(...a),
  getMeasurementPointDefsByIds: (...a: any[]) => getByIdsSpy(...a),
  bumpPointsConfigVersion: (...a: any[]) => bumpSpy(...a),
  createAuditLog: (...a: any[]) => auditSpy(...a),
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: vi.fn(async () => ({
    decision: "direct", productModelId: 1, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  })),
}));
vi.mock("../services/componentLinkBackfill", () => ({
  backfillComponentCodesFromBom: vi.fn(async () => ({})),
}));
vi.mock("../services/measurementPointResolver", () => ({
  getUnmappedProductModelId: vi.fn(async () => 99),
  getUnmappedPointRate: vi.fn(async () => ({ total: 0, unmatched: 0, rate: 0 })),
}));
const publishSpy = vi.fn();
vi.mock("../services/mqttService", () => ({
  publishPointsConfigChanged: (...a: any[]) => publishSpy(...a),
}));

import { measurementPointRouter } from "./productRouters";

const adminCtx = { user: { id: 5, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = measurementPointRouter.createCaller(adminCtx);

const existingPoint = {
  id: 42, code: "MP-42", name: "Solder A", productModelId: 1,
  measurementType: "VISUAL", measurementTypeCode: null,
  lowerLimit: null, upperLimit: null, nominalValue: null,
  toleranceMode: null, tolPlus: null, tolMinus: null,
  heightMin: null, heightMax: null, areaMin: null, areaMax: null,
  volumeMin: null, volumeMax: null, thicknessMin: null, thicknessMax: null,
  positionX: 10, positionY: 20, radius: 5,
  componentCode: null, refDesignator: null, variantId: null,
};

async function bat(err: unknown) {
  return readAppErrorMeta(err);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateSpy.mockResolvedValue(undefined as any);
  batchSpy.mockResolvedValue({ updated: 1, productModelId: 1, code: "PM-1", pointsConfigVersion: 2 });
  revertSpy.mockResolvedValue({
    productModelId: 7, code: "PM-7", targetVersion: 1, fromVersion: 3, newVersion: 4,
    pointsReverted: 1, pointsUnchanged: 0, pointsSkipped: 0, skippedPointIds: [],
  });
  getPointSpy.mockResolvedValue({ ...existingPoint });
  getByIdsSpy.mockResolvedValue([{ ...existingPoint }]);
  bumpSpy.mockResolvedValue({ productModelId: 1, code: "PM-TEST", version: 2 });
});

describe("BG-126 — measurementPoint.update: changeReason không được giả tiền tố [VARIANT:n]", () => {
  it("★★★ changeReason='[VARIANT:12] abc' ⇒ BAD_REQUEST/CHANGE_REASON_RESERVED_PREFIX, KHÔNG ghi gì", async () => {
    let err: unknown;
    try {
      await caller.update({ id: 42, name: "New name", changeReason: "[VARIANT:12] abc" });
    } catch (e) {
      err = e;
    }
    expect(err, "phải bị từ chối").toBeDefined();
    expect(await bat(err)).toMatchObject({ appCode: "CHANGE_REASON_RESERVED_PREFIX", appParams: { field: "changeReason" } });
    expect(updateSpy, "gate phải chặn TRƯỚC khi updateMeasurementPointDef chạy").not.toHaveBeenCalled();
  });

  it("changeReason='đổi giới hạn theo đo đạc' ⇒ qua bình thường", async () => {
    const res = await caller.update({ id: 42, name: "New name", changeReason: "đổi giới hạn theo đo đạc" });
    expect(res).toEqual({ success: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("thiếu changeReason (undefined) vẫn qua bình thường (field optional, không có gì để chặn)", async () => {
    const res = await caller.update({ id: 42, name: "New name" });
    expect(res).toEqual({ success: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("BG-126 — measurementPoint.setLimitsBatch: changeReason không được giả tiền tố [VARIANT:n]", () => {
  it("★★★ changeReason='[VARIANT:7] abc' ⇒ BAD_REQUEST/CHANGE_REASON_RESERVED_PREFIX, KHÔNG ghi gì", async () => {
    let err: unknown;
    try {
      await caller.setLimitsBatch({ items: [{ id: 42, heightMax: "5" }], changeReason: "[VARIANT:7] abc" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(await bat(err)).toMatchObject({ appCode: "CHANGE_REASON_RESERVED_PREFIX", appParams: { field: "changeReason" } });
    expect(batchSpy).not.toHaveBeenCalled();
  });

  it("changeReason='đổi giới hạn theo đo đạc' ⇒ qua bình thường", async () => {
    const res = await caller.setLimitsBatch({ items: [{ id: 42, heightMax: "5" }], changeReason: "đổi giới hạn theo đo đạc" });
    expect(res.updated).toBe(1);
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("BG-126 — measurementPoint.revertPointsConfigToVersion: reason không được giả tiền tố [VARIANT:n]", () => {
  it("★★★ reason='[VARIANT:3] abc' ⇒ BAD_REQUEST/CHANGE_REASON_RESERVED_PREFIX, KHÔNG ghi gì", async () => {
    let err: unknown;
    try {
      await caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 1, reason: "[VARIANT:3] abc" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(await bat(err)).toMatchObject({ appCode: "CHANGE_REASON_RESERVED_PREFIX", appParams: { field: "reason" } });
    expect(revertSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("reason='đổi giới hạn theo đo đạc' ⇒ qua bình thường", async () => {
    const res = await caller.revertPointsConfigToVersion({ productModelId: 7, targetVersion: 1, reason: "đổi giới hạn theo đo đạc" });
    expect(res.newVersion).toBe(4);
    expect(revertSpy).toHaveBeenCalledTimes(1);
  });
});
