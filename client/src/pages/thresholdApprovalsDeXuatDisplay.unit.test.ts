/**
 * Lô 7 Mục 4 (BG-111) — lưới cho `thresholdApprovalsDeXuatDisplay.ts` (hàm THUẦN,
 * cùng khuôn `thresholdApprovalsBatch.unit.test.ts` — environment "node", 0 render).
 */
import { describe, it, expect } from "vitest";
import { xayDeXuatHienThi, coDeXuatDayDu } from "./thresholdApprovalsDeXuatDisplay";

describe("xayDeXuatHienThi — đọc suggestion.deXuat, ĐÚNG thứ tự POINT_LIMIT_SPEC", () => {
  it("hàng CŨ (suggestion = blob metadata AI, KHÔNG có deXuat) ⇒ mảng RỖNG — không bịa field", () => {
    const suggestion = {
      basis: "1964 kết quả đo/30 ngày",
      source: "ai_threshold_autotune",
      currentCpk: 1.28,
      proposedBy: "ai_autotune",
    };
    expect(xayDeXuatHienThi(suggestion)).toEqual([]);
    expect(coDeXuatDayDu(suggestion)).toBe(false);
  });

  it("suggestion = null/undefined/không phải object ⇒ mảng RỖNG (không ném lỗi)", () => {
    expect(xayDeXuatHienThi(null)).toEqual([]);
    expect(xayDeXuatHienThi(undefined)).toEqual([]);
    expect(xayDeXuatHienThi("chuoi la")).toEqual([]);
    expect(xayDeXuatHienThi(42)).toEqual([]);
  });

  it("deXuat không phải object (vd mảng, hoặc chuỗi) ⇒ mảng RỖNG", () => {
    expect(xayDeXuatHienThi({ deXuat: [1, 2, 3] })).toEqual([]);
    expect(xayDeXuatHienThi({ deXuat: "khong hop le" })).toEqual([]);
  });

  it("deXuat CHỈ heightMax (Lô 7 Mục 2 — request mở rộng) ⇒ 1 mục, giá trị + nhãn đúng, laXoa=false", () => {
    const ra = xayDeXuatHienThi({ deXuat: { heightMax: "9.500000" } });
    expect(ra).toEqual([{ field: "heightMax", i18nKey: "pointLimits.heightMax", giaTri: "9.500000", laXoa: false }]);
    expect(coDeXuatDayDu({ deXuat: { heightMax: "9.5" } })).toBe(true);
  });

  it("deXuat với field=null (đề xuất XOÁ) ⇒ giaTri=null, laXoa=true — hiển thị 'xoá', KHÔNG phải '0' hay '—' của không-đổi", () => {
    const ra = xayDeXuatHienThi({ deXuat: { heightMax: null } });
    expect(ra).toEqual([{ field: "heightMax", i18nKey: "pointLimits.heightMax", giaTri: null, laXoa: true }]);
  });

  it("deXuat mang NHIỀU field ⇒ thứ tự hiển thị theo ĐÚNG POINT_LIMIT_SPEC, không theo thứ tự khoá JSON", () => {
    // Cố tình khai NGƯỢC thứ tự spec (upperLimit trước lowerLimit trong object literal)
    // để chứng minh output không phụ thuộc thứ tự khoá JS — POINT_LIMIT_SPEC khai
    // lowerLimit TRƯỚC upperLimit.
    const ra = xayDeXuatHienThi({ deXuat: { upperLimit: "9", lowerLimit: "1", heightMax: "5" } });
    expect(ra.map((r) => r.field)).toEqual(["lowerLimit", "upperLimit", "heightMax"]);
  });

  it("deXuat.lowerLimit/upperLimit tương thích ngược (map từ proposedLsl/Usl legacy, Lô 7 Mục 2) ⇒ hiển thị đúng 2 mục", () => {
    const ra = xayDeXuatHienThi({ deXuat: { lowerLimit: "1", upperLimit: "9" } });
    expect(ra).toEqual([
      { field: "lowerLimit", i18nKey: "pointLimits.lowerLimit", giaTri: "1", laXoa: false },
      { field: "upperLimit", i18nKey: "pointLimits.upperLimit", giaTri: "9", laXoa: false },
    ]);
  });

  it("deXuat rỗng {} (object hợp lệ nhưng 0 khoá) ⇒ mảng rỗng", () => {
    expect(xayDeXuatHienThi({ deXuat: {} })).toEqual([]);
    expect(coDeXuatDayDu({ deXuat: {} })).toBe(false);
  });
});
