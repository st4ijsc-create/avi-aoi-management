/**
 * doc 55 Item 3 / PV3 — PRODUCT VARIANT admin router wiring (mocked db).
 *
 * The DB helpers themselves are proven against the real test DB in
 * server/db/productVariant.test.ts; here we prove the ROUTER contract:
 *   • migration guard — every procedure returns PRECONDITION_FAILED (not a 500) when
 *     product_variants is absent (0286 not applied),
 *   • create/update/delete guards — base is un-deletable / un-renamable, 'BASE' is
 *     reserved, duplicate code → CONFLICT, unknown ids → NOT_FOUND,
 *   • override CRUD — base variant can't override, override needs a patch, target must
 *     be a base/common point, and each override mutation bumps ONLY that variant
 *     (QĐ#10), best-effort,
 *   • getEffectivePoints classifies each row base/overridden/variant,
 *   • RBAC — a permission-less non-admin is refused (settings_products / _measurement_points).
 *
 * Mutation-test: drop the base guard → delete-base test goes green-should-be-red; drop
 * the variant bump → override tests fail; drop the table guard → PRECONDITION tests fail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── db (index) mock — only the helpers the router calls. Hoisted so the (also
// hoisted) vi.mock factory can reference it. ──
const h = vi.hoisted(() => ({
  productVariantsTableAvailable: vi.fn(async () => true),
  getVariantsByModel: vi.fn(async () => [] as any[]),
  getVariantById: vi.fn(async () => undefined as any),
  getVariantByCode: vi.fn(async () => undefined as any),
  getVariantOverrides: vi.fn(async () => [] as any[]),
  resolveEffectivePoints: vi.fn(async () => [] as any[]),
  getProductModelById: vi.fn(async () => ({ id: 1, code: "PM-1" }) as any),
  getMeasurementPointDefById: vi.fn(async () => undefined as any),
  createVariant: vi.fn(async () => 42),
  updateVariant: vi.fn(async () => undefined),
  softDeleteVariant: vi.fn(async () => undefined),
  setVariantPointOverride: vi.fn(async () => 7),
  removeVariantOverride: vi.fn(async () => undefined),
  bumpVariantPointsConfigVersion: vi.fn(async () => ({ variantId: 10, productModelId: 1, code: "V1", version: 2 })),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  // BG-113/I-3 (review Khối C lượt 9) — `setOverride` nay gọi thêm ba hàm này
  // (whitelist patchJson + cửa duyệt ngưỡng + ghi version, xem productVariantRouter.ts).
  // Mock ĐƠN GIẢN (không dùng logic thật — logic thật đã có lưới riêng ở
  // apDungVariantPatch.test.ts) để lưới ROUTER này chỉ canh WIRING, không canh DB.
  apDungVariantPatch: vi.fn((base: any, patch: any) => ({ ...base, ...(patch && typeof patch === "object" ? patch : {}) })),
  recordVariantOverrideVersion: vi.fn(async () => undefined),
}));
vi.mock("../db", () => h);
// accessControl.checkPermission reads getDb() from ../db/connection — null ⇒ a
// non-admin is denied (isAdmin=false) so the RBAC test resolves without a real DB.
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
// BG-113/I-3 — setOverride(action:'override') nay gọi assertThresholdEditAllowed
// (cùng khuôn measurementPointWritePath.test.ts) — mặc định KHÔNG chặn (decision
// 'direct') để các mệnh đề WIRING sẵn có không phải biết gì về cửa duyệt ngưỡng.
const thresholdGateSpy = vi.fn(async () => ({
  decision: "direct" as const,
  productModelId: 1,
  lifecycleStatus: "development",
  hasReleasedProgram: false,
  enforced: true,
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  assertThresholdEditAllowed: (...a: any[]) => thresholdGateSpy(...a),
}));

import { productVariantRouter } from "./productVariantRouter";

const adminCtx = { user: { id: 5, role: "admin", name: "Admin" }, req: { ip: null, headers: {} } } as any;
const operatorCtx = { user: { id: 9, role: "operator", name: "Op" }, req: { ip: null, headers: {} } } as any;
const admin = productVariantRouter.createCaller(adminCtx);
const operator = productVariantRouter.createCaller(operatorCtx);

const baseVariant = { id: 1, productModelId: 1, code: "BASE", name: "Base", isBase: true, pointsConfigVersion: 1, lifecycleStatus: "active", referenceImageUrl: null, referenceImageKey: null, coordinateMode: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
const euVariant = { ...baseVariant, id: 10, code: "EU", name: "EU", isBase: false };

beforeEach(() => {
  // mockReset (not clearAllMocks) so any queued *Once value an early-throwing test
  // left unconsumed is drained — otherwise it leaks into the next test's first call.
  for (const m of Object.values(h)) m.mockReset();
  h.productVariantsTableAvailable.mockResolvedValue(true);
  h.getVariantsByModel.mockResolvedValue([]);
  h.getVariantById.mockResolvedValue(undefined);
  h.getVariantByCode.mockResolvedValue(undefined);
  h.getVariantOverrides.mockResolvedValue([]);
  h.resolveEffectivePoints.mockResolvedValue([]);
  h.getProductModelById.mockResolvedValue({ id: 1, code: "PM-1" } as any);
  h.getMeasurementPointDefById.mockResolvedValue(undefined);
  h.createVariant.mockResolvedValue(42);
  h.updateVariant.mockResolvedValue(undefined);
  h.softDeleteVariant.mockResolvedValue(undefined);
  h.setVariantPointOverride.mockResolvedValue(7);
  h.removeVariantOverride.mockResolvedValue(undefined);
  h.bumpVariantPointsConfigVersion.mockResolvedValue({ variantId: 10, productModelId: 1, code: "V1", version: 2 } as any);
  h.createAuditLog.mockResolvedValue({ id: 1 });
  // BG-113/I-3 — mockReset() ở trên xoá luôn IMPLEMENTATION (không chỉ lịch sử
  // gọi) của hai mock mới ⇒ phải gán lại, cùng khuôn mọi mock khác ở trên.
  h.apDungVariantPatch.mockImplementation((base: any, patch: any) => ({ ...base, ...(patch && typeof patch === "object" ? patch : {}) }));
  h.recordVariantOverrideVersion.mockResolvedValue(undefined);
  thresholdGateSpy.mockReset();
  thresholdGateSpy.mockResolvedValue({
    decision: "direct" as const,
    productModelId: 1,
    lifecycleStatus: "development",
    hasReleasedProgram: false,
    enforced: true,
  } as any);
});

// ════════════════════════════════════════════════════════════════════════════
describe("PV3 — migration guard (0286 absent)", () => {
  it("every procedure returns PRECONDITION_FAILED, never a raw 500", async () => {
    h.productVariantsTableAvailable.mockResolvedValue(false);
    await expect(admin.listVariants({ productModelId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(admin.createVariant({ productModelId: 1, code: "EU" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(admin.getEffectivePoints({ productModelId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.createVariant).not.toHaveBeenCalled();
  });
});

describe("PV3 — listVariants / getVariant", () => {
  it("lists variants as clean DTOs (no deletedAt)", async () => {
    h.getVariantsByModel.mockResolvedValueOnce([baseVariant, euVariant] as any);
    const res = await admin.listVariants({ productModelId: 1 });
    expect(res.map((v) => v.code)).toEqual(["BASE", "EU"]);
    expect(res[0]).not.toHaveProperty("deletedAt");
  });

  it("getVariant returns overrides + effective point count", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getVariantOverrides.mockResolvedValueOnce([{ id: 1, variantId: 10, basePointDefId: 3, action: "exclude", patchJson: null, updatedAt: new Date() }] as any);
    h.resolveEffectivePoints.mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as any);
    const res = await admin.getVariant({ variantId: 10 });
    expect(res.effectivePointCount).toBe(2);
    expect(res.overrides).toHaveLength(1);
  });

  it("getVariant unknown id → NOT_FOUND", async () => {
    h.getVariantById.mockResolvedValueOnce(undefined as any);
    await expect(admin.getVariant({ variantId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PV3 — createVariant", () => {
  it("creates a non-base variant (isBase never passed through)", async () => {
    const res = await admin.createVariant({ productModelId: 1, code: "EU", name: "EU SKU" });
    expect(res).toEqual({ id: 42 });
    const arg = h.createVariant.mock.calls[0][0] as any;
    expect(arg).not.toHaveProperty("isBase");
    expect(h.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "productVariant.create" }));
  });

  it("rejects the reserved 'BASE' code", async () => {
    await expect(admin.createVariant({ productModelId: 1, code: "base" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.createVariant).not.toHaveBeenCalled();
  });

  it("duplicate code → CONFLICT", async () => {
    h.getVariantByCode.mockResolvedValueOnce(euVariant as any);
    await expect(admin.createVariant({ productModelId: 1, code: "EU" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("unknown product model → NOT_FOUND", async () => {
    h.getProductModelById.mockResolvedValueOnce(undefined as any);
    await expect(admin.createVariant({ productModelId: 77, code: "EU" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a unique-index race (23505) → CONFLICT", async () => {
    h.createVariant.mockRejectedValueOnce({ code: "23505" });
    await expect(admin.createVariant({ productModelId: 1, code: "EU" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("PV3 — updateVariant", () => {
  it("renames a non-base variant", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    const res = await admin.updateVariant({ variantId: 10, name: "EU v2" });
    expect(res).toEqual({ success: true });
    expect(h.updateVariant).toHaveBeenCalledWith(10, expect.objectContaining({ name: "EU v2" }));
  });

  it("refuses to rename the BASE variant", async () => {
    h.getVariantById.mockResolvedValueOnce(baseVariant as any);
    await expect(admin.updateVariant({ variantId: 1, code: "NOTBASE" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.updateVariant).not.toHaveBeenCalled();
  });

  it("code change colliding with another live variant → CONFLICT", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getVariantByCode.mockResolvedValueOnce({ ...euVariant, id: 11, code: "US" } as any);
    await expect(admin.updateVariant({ variantId: 10, code: "US" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("unchanged code is stripped from the write (no unique-index trip)", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    await admin.updateVariant({ variantId: 10, code: "EU", name: "x" });
    const data = h.updateVariant.mock.calls[0][1] as any;
    expect(data).not.toHaveProperty("code");
  });

  it("unknown id → NOT_FOUND", async () => {
    h.getVariantById.mockResolvedValueOnce(undefined as any);
    await expect(admin.updateVariant({ variantId: 999, name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PV3 — deleteVariant", () => {
  it("soft-deletes a non-base variant", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    const res = await admin.deleteVariant({ variantId: 10 });
    expect(res).toEqual({ success: true });
    expect(h.softDeleteVariant).toHaveBeenCalledWith(10);
  });

  it("★ refuses to delete the BASE variant", async () => {
    h.getVariantById.mockResolvedValueOnce(baseVariant as any);
    await expect(admin.deleteVariant({ variantId: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.softDeleteVariant).not.toHaveBeenCalled();
  });
});

describe("PV3 — getEffectivePoints (classification)", () => {
  it("classifies base / overridden / variant-added rows", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getVariantOverrides.mockResolvedValueOnce([{ basePointDefId: 2, action: "override", patchJson: {} }] as any);
    h.resolveEffectivePoints.mockResolvedValueOnce([
      { id: 1, variantId: null },   // untouched base
      { id: 2, variantId: null },   // base with an override
      { id: 9, variantId: 10 },     // added by this variant
    ] as any);
    const res = await admin.getEffectivePoints({ productModelId: 1, variantId: 10 });
    const byId = new Map(res.points.map((p: any) => [p.id, p.origin]));
    expect(byId.get(1)).toBe("base");
    expect(byId.get(2)).toBe("overridden");
    expect(byId.get(9)).toBe("variant");
    expect(res.count).toBe(3);
  });

  it("variantId null ⇒ base set, everything 'base'", async () => {
    h.resolveEffectivePoints.mockResolvedValueOnce([{ id: 1, variantId: null }] as any);
    const res = await admin.getEffectivePoints({ productModelId: 1, variantId: null });
    expect(res.points[0].origin).toBe("base");
    expect(h.getVariantById).not.toHaveBeenCalled();
  });

  it("variant not belonging to the model → BAD_REQUEST", async () => {
    h.getVariantById.mockResolvedValueOnce({ ...euVariant, productModelId: 2 } as any);
    await expect(admin.getEffectivePoints({ productModelId: 1, variantId: 10 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("PV3 — setOverride / removeOverride", () => {
  const basePoint = { id: 3, productModelId: 1, variantId: null, code: "P3" };

  it("sets an 'override' and bumps ONLY the variant version (QĐ#10)", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    const res = await admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "99" } });
    expect(res).toEqual({ id: 7 });
    expect(h.setVariantPointOverride).toHaveBeenCalledWith(expect.objectContaining({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "99" } }));
    expect(h.bumpVariantPointsConfigVersion).toHaveBeenCalledWith(10);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ BG-113/I-3 (review Khối C lượt 9) — patchJson KHÔNG còn nhận BẤT KỲ
  // khoá nào (trước bản vá: `z.record(z.string(), z.unknown())`), gọi cửa
  // duyệt ngưỡng, và ghi version TRƯỚC khi override.
  // ══════════════════════════════════════════════════════════════════════
  it("★★★ ĐỘT BIẾN THẬT (I-3): patchJson mang khoá NGOÀI APPROVAL_LIMIT_FIELDS ({id: 999}) ⇒ BAD_REQUEST, KHÔNG ghi gì", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    await expect(
      admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "5", id: 999 } as any }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.setVariantPointOverride, "zod .strict() phải chặn TRƯỚC khi thân thủ tục chạy").not.toHaveBeenCalled();
    expect(h.recordVariantOverrideVersion).not.toHaveBeenCalled();
  });

  it("patchJson mang MỘT khoá phi-giới-hạn khác (deletedAt) ⇒ cũng BAD_REQUEST — không chỉ khoá 'id'", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    await expect(
      admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { deletedAt: null } as any }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("★★★ setOverride(action:'override') gọi assertThresholdEditAllowed(basePointDefId) — sản phẩm live+enforced ⇒ FORBIDDEN, KHÔNG ghi", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    // Mock thay THẲNG assertThresholdEditAllowed (không phải resolveThresholdEditGate
    // bên trong nó) ⇒ mô phỏng "bị chặn" bằng REJECT trực tiếp, cùng tinh thần
    // `measurementPointWritePath.test.ts` (gateSpy.mockRejectedValue) — PHẢI là một
    // TRPCError THẬT (không phải Error thường gắn thêm `.code`): tRPC chỉ giữ
    // nguyên `.code` khi lỗi ném ra LÀ instance TRPCError, ngược lại nó bọc thành
    // INTERNAL_SERVER_ERROR ở lớp resolveMiddleware.
    thresholdGateSpy.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN — would block" }));
    await expect(
      admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "5" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.setVariantPointOverride).not.toHaveBeenCalled();
    expect(h.recordVariantOverrideVersion, "cửa duyệt ngưỡng phải chặn TRƯỚC bước ghi version").not.toHaveBeenCalled();
  });

  it("★★★ setOverride(action:'override') ghi version TRƯỚC khi ghi đè — snapshot = hiệu lực TRƯỚC lượt này (base, KHÔNG có override cũ)", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.getVariantOverrides.mockResolvedValueOnce([]); // chưa có override nào trước đó cho điểm này
    await admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "5" } });
    // NEW-3 (review lượt 9, vòng 2) — variantId (10) nay là tham số THỨ HAI bắt
    // buộc (hàm tự gắn tiền tố [VARIANT:<id>], không tin caller nhớ gắn nhãn).
    expect(h.recordVariantOverrideVersion).toHaveBeenCalledWith(
      3,
      10,
      expect.objectContaining({ id: 3 }), // apDungVariantPatch(basePoint, null) ⇒ chính basePoint
      expect.objectContaining({ changedBy: 5 }),
    );
  });

  it("setOverride ghi version với hiệu lực TRƯỚC = base + override CŨ đã merge (apDungVariantPatch) — không phải base trơ", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.getVariantOverrides.mockResolvedValueOnce([
      { basePointDefId: 3, action: "override", patchJson: { upperLimit: "77" } } as any,
    ]);
    await admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "5" } });
    // apDungVariantPatch(basePoint, {upperLimit:"77"}) (mock đơn giản: spread) ⇒ hiệu lực TRƯỚC mang upperLimit CŨ "77".
    expect(h.recordVariantOverrideVersion).toHaveBeenCalledWith(3, 10, expect.objectContaining({ upperLimit: "77" }), expect.anything());
  });

  it("★★★ BG-113 (I-2, đường ghi thứ SÁU) — patch chỉ đổi upperLimit thấp hơn lowerLimit HIỆN CÓ (base) ⇒ BAD_REQUEST, KHÔNG ghi override/version nào", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce({ ...basePoint, lowerLimit: "9", upperLimit: "11" } as any);
    h.getVariantOverrides.mockResolvedValueOnce([]); // 0 override cũ ⇒ hiệu lực TRƯỚC = chính base
    await expect(
      admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { upperLimit: "0.5" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.recordVariantOverrideVersion, "gate phải chặn TRƯỚC bước ghi version").not.toHaveBeenCalled();
    expect(h.setVariantPointOverride, "gate phải chặn TRƯỚC bước ghi override").not.toHaveBeenCalled();
  });

  it("BG-113 (I-2, đường thứ SÁU) — patch đổi CẢ hai cận nhưng vẫn hợp lệ ([9;11] → [1;20]) ⇒ KHÔNG bị chặn oan", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce({ ...basePoint, lowerLimit: "9", upperLimit: "11" } as any);
    h.getVariantOverrides.mockResolvedValueOnce([]);
    await expect(
      admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override", patchJson: { lowerLimit: "1", upperLimit: "20" } }),
    ).resolves.toEqual({ id: 7 });
  });

  it("'exclude' stores no patch", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    await admin.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" });
    expect(h.setVariantPointOverride).toHaveBeenCalledWith(expect.objectContaining({ action: "exclude", patchJson: null }));
  });

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ NEW-4 (review Khối C lượt 9, vòng 2, BG-125) — TRƯỚC bản vá này 'exclude'
  // đi qua 0 gate, 0 version (lý do cũ: "không mang giá trị số để duyệt/snapshot").
  // Sai: loại hẳn một điểm khỏi cổng của một biến thể LIVE là thay đổi ngưỡng còn
  // TRIỆT ĐỂ HƠN nới một cận số — bo XẤU lọt qua êm. Nay 'exclude' đi qua CÙNG cửa
  // + ghi version như 'override'.
  // ══════════════════════════════════════════════════════════════════════
  it("★★★ NEW-4: 'exclude' NAY gọi CẢ cửa duyệt ngưỡng LẪN ghi version — KHÔNG còn đi qua trắng", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.getVariantOverrides.mockResolvedValueOnce([]);
    await admin.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" });
    expect(thresholdGateSpy, "NEW-4 — cửa duyệt ngưỡng PHẢI đứng cho 'exclude'").toHaveBeenCalledWith(3);
    expect(h.recordVariantOverrideVersion, "NEW-4 — 'exclude' PHẢI để lại version, hiệu lực TRƯỚC lượt loại điểm").toHaveBeenCalledWith(
      3,
      10,
      expect.objectContaining({ id: 3 }), // apDungVariantPatch(basePoint, null) ⇒ chính basePoint (0 override cũ)
      expect.objectContaining({ changedBy: 5 }),
    );
  });

  it("★★★ NEW-4: 'exclude' trên sản phẩm LIVE (cửa duyệt ngưỡng chặn) ⇒ FORBIDDEN, KHÔNG ghi override/version", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    thresholdGateSpy.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN — would block" }));
    await expect(admin.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.setVariantPointOverride, "cửa duyệt ngưỡng phải chặn TRƯỚC bước ghi override").not.toHaveBeenCalled();
    expect(h.recordVariantOverrideVersion, "cửa duyệt ngưỡng phải chặn TRƯỚC bước ghi version").not.toHaveBeenCalled();
  });

  it("'override' without a patch → BAD_REQUEST", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    await expect(admin.setOverride({ variantId: 10, basePointDefId: 3, action: "override" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the BASE variant cannot override itself", async () => {
    h.getVariantById.mockResolvedValueOnce(baseVariant as any);
    await expect(admin.setOverride({ variantId: 1, basePointDefId: 3, action: "exclude" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("overriding a VARIANT point (not a base/common point) → BAD_REQUEST", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce({ ...basePoint, variantId: 10 } as any);
    await expect(admin.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("override survives a failed version bump (best-effort)", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.bumpVariantPointsConfigVersion.mockRejectedValueOnce(new Error("db blip"));
    await expect(admin.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" })).resolves.toEqual({ id: 7 });
  });

  it("removeOverride deletes + bumps the variant", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.getVariantOverrides.mockResolvedValueOnce([]);
    const res = await admin.removeOverride({ variantId: 10, basePointDefId: 3 });
    expect(res).toEqual({ success: true });
    expect(h.removeVariantOverride).toHaveBeenCalledWith(10, 3);
    expect(h.bumpVariantPointsConfigVersion).toHaveBeenCalledWith(10);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ NEW-4 (review Khối C lượt 9, vòng 2, BG-125) — TRƯỚC bản vá `removeOverride`
  // đi thẳng qua: 0 gate, 0 version — y hệt lỗ mà I-3 đã vá cho `setOverride`. Gỡ
  // một override (kể cả 'exclude') hoàn tác chính lượt thay-đổi-ngưỡng đã tạo ra
  // nó ⇒ cần cùng mức bảo vệ.
  // ══════════════════════════════════════════════════════════════════════
  it("★★★ NEW-4: removeOverride NAY gọi cửa duyệt ngưỡng + ghi version, hiệu lực TRƯỚC = override sắp mất", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    h.getVariantOverrides.mockResolvedValueOnce([
      { basePointDefId: 3, action: "override", patchJson: { upperLimit: "77" } } as any,
    ]);
    await admin.removeOverride({ variantId: 10, basePointDefId: 3 });
    expect(thresholdGateSpy, "NEW-4 — cửa duyệt ngưỡng PHẢI đứng cho removeOverride").toHaveBeenCalledWith(3);
    // apDungVariantPatch(basePoint, {upperLimit:"77"}) (mock đơn giản: spread) ⇒ hiệu lực TRƯỚC mang upperLimit "77" sắp mất.
    expect(h.recordVariantOverrideVersion).toHaveBeenCalledWith(3, 10, expect.objectContaining({ upperLimit: "77" }), expect.objectContaining({ changedBy: 5 }));
    // Version PHẢI ghi TRƯỚC khi xoá — thứ tự lời gọi mock chứng minh (không so timestamp).
    const iVersion = h.recordVariantOverrideVersion.mock.invocationCallOrder[0];
    const iXoa = h.removeVariantOverride.mock.invocationCallOrder[0];
    expect(iVersion, "ghi version phải xảy ra TRƯỚC xoá — nếu không, hiệu lực TRƯỚC không còn đọc được").toBeLessThan(iXoa);
  });

  it("★★★ NEW-4: removeOverride trên sản phẩm LIVE (cửa duyệt ngưỡng chặn) ⇒ FORBIDDEN, KHÔNG xoá/ghi version", async () => {
    h.getVariantById.mockResolvedValueOnce(euVariant as any);
    h.getMeasurementPointDefById.mockResolvedValueOnce(basePoint as any);
    thresholdGateSpy.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN — would block" }));
    await expect(admin.removeOverride({ variantId: 10, basePointDefId: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.removeVariantOverride).not.toHaveBeenCalled();
    expect(h.recordVariantOverrideVersion).not.toHaveBeenCalled();
  });
});

describe("PV3 — RBAC", () => {
  it("a permission-less non-admin is refused create (settings_products)", async () => {
    await expect(operator.createVariant({ productModelId: 1, code: "EU" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.createVariant).not.toHaveBeenCalled();
  });

  it("a permission-less non-admin is refused setOverride (settings_measurement_points)", async () => {
    await expect(operator.setOverride({ variantId: 10, basePointDefId: 3, action: "exclude" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.setVariantPointOverride).not.toHaveBeenCalled();
  });
});
