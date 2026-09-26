// server/db/apDungVariantPatch.test.ts
//
// ★★★ Khối C Task 6 — MỘT hàm merge patch variant (Doc 55 Item 3), thay hai bản
// đã trôi khỏi nhau: `mergeEffectivePoints` (product.ts) LỌC khoá bảo vệ
// (VARIANT_PATCH_PROTECTED_KEYS); khối inline ở `machineApiRouters.ts` (spec-gate
// v1.x, `variantOv.action === "override"`) shallow-merge THÔ — KHÔNG lọc, patch
// có thể ghi đè `id`/`deletedAt`/... của điểm-đo gốc. Lưới này khoá hành vi ĐÚNG
// (lọc) cho cả hai nơi gọi, qua MỘT hàm dùng chung.
//
// Lưới THUẦN — không chạm DB (apDungVariantPatch không đọc CSDL).
import { describe, expect, it } from "vitest";
import { apDungVariantPatch } from "./product";

describe("Khối C Task 6 — apDungVariantPatch (merge patch variant, lọc khoá bảo vệ)", () => {
  it("patch {upperLimit, id, deletedAt} áp lên base ⇒ CHỈ upperLimit ăn, id/deletedAt giữ nguyên base", () => {
    const base = { id: 1, upperLimit: "5", deletedAt: null as string | null, code: "P01" };
    const patch = { upperLimit: "9", id: 999, deletedAt: "x" };

    const out = apDungVariantPatch(base, patch);

    expect(out.upperLimit).toBe("9"); // khoá thường — patch thắng
    expect(out.id).toBe(1); // khoá bảo vệ — giữ BASE, không cho patch cướp danh tính hàng
    expect(out.deletedAt).toBeNull(); // khoá bảo vệ — patch không hồi sinh tombstone được
    expect(out.code).toBe("P01"); // trường base không có trong patch — giữ nguyên
  });

  it("mọi khoá trong VARIANT_PATCH_PROTECTED_KEYS đều bị lọc, không chỉ id/deletedAt", () => {
    const base = {
      id: 1,
      productModelId: 10,
      variantId: 20,
      code: "P01",
      createdAt: "2020-01-01",
      updatedAt: "2020-01-01",
      deletedAt: null as string | null,
      deletedAtVersion: 0,
      lastModifiedAt: "2020-01-01",
      upperLimit: "5",
    };
    const patch = {
      id: 999,
      productModelId: 999,
      variantId: 999,
      code: "HACKED",
      createdAt: "x",
      updatedAt: "x",
      deletedAt: "x",
      deletedAtVersion: 999,
      lastModifiedAt: "x",
      upperLimit: "9",
    };

    const out = apDungVariantPatch(base, patch);

    expect(out.upperLimit).toBe("9");
    const khoaBaoVe = [
      "id", "productModelId", "variantId", "code",
      "createdAt", "updatedAt", "deletedAt", "deletedAtVersion", "lastModifiedAt",
    ] as const;
    for (const k of khoaBaoVe) {
      expect(out[k]).toEqual(base[k]);
    }
  });

  it("patchJson null/undefined/không phải object ⇒ trả nguyên base, không throw", () => {
    const base = { id: 1, upperLimit: "5" };
    expect(apDungVariantPatch(base, null)).toEqual(base);
    expect(apDungVariantPatch(base, undefined)).toEqual(base);
    expect(apDungVariantPatch(base, "chuoi-la")).toEqual(base);
    expect(apDungVariantPatch(base, 42)).toEqual(base);
  });

  it("patch nhiều khoá thường cùng lúc ⇒ tất cả ăn (không chỉ khoá đầu tiên)", () => {
    const base = { id: 1, lowerLimit: "0", upperLimit: "5", unit: "mm" };
    const out = apDungVariantPatch(base, { lowerLimit: "1", upperLimit: "9", unit: "cm" });
    expect(out).toEqual({ id: 1, lowerLimit: "1", upperLimit: "9", unit: "cm" });
  });
});
