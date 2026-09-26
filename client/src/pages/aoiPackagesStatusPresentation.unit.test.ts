/**
 * Lô 4 Mục 2 (BG-74, client) — 'dead' nhìn thấy được và phân biệt được.
 *
 * Đo TRƯỚC (task description, không đoán): `client/src/pages/AOIPackages.tsx`
 * (`StatusBadge` — grep 'dead' trong client/src, đây là TRANG quản lý gói AOI phía
 * client) trước bản vá KHÔNG có nhánh nào cho `status:'dead'` — badge rơi vào
 * fallback `bg-muted text-muted-foreground` (XÁM NHẠT, thấp hơn cả `failed` —
 * `bg-destructive/15 text-destructive` — về mức nổi bật), và bộ lọc `<Select>`
 * (dòng ~261-270) chỉ liệt kê 4 `<SelectItem>` (committed/uploaded/pending/failed),
 * KHÔNG có 'dead'.
 *
 * Repo KHÔNG có hạ tầng render-test (BG-129, ghi trong context nhiệm vụ) — test
 * này KHÔNG render component, chỉ kiểm LOGIC THUẦN đã được rút ra thành hàm/hằng số
 * độc lập (`aoiPackagesStatusPresentation.ts`) mà `AOIPackages.tsx` gọi tới. Lời hứa
 * THỊ GIÁC (đỏ đậm hơn `failed`) được xác nhận lại bằng ảnh chụp UI tự xem (report).
 */
import { describe, it, expect } from "vitest";
import {
  PACKAGE_STATUS_BADGE_VARIANTS,
  PACKAGE_STATUS_FILTER_OPTIONS,
} from "./aoiPackagesStatusPresentation";

describe("PACKAGE_STATUS_BADGE_VARIANTS — 'dead' phải NỔI HƠN 'failed', không phải xám nhạt", () => {
  it("★★★ TRUNG TÂM — 'dead' tồn tại làm một khoá riêng (trước bản vá: rơi fallback xám, không có khoá này)", () => {
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead).toBeDefined();
  });

  it("'dead' KHÔNG dùng CÙNG className xám nhạt của fallback (bg-muted)", () => {
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead.className).not.toMatch(/bg-muted/);
  });

  it("'dead' dùng nền ĐẶC (bg-destructive, không phải /15 mờ) — nổi hơn 'failed' (bg-destructive/15 mờ)", () => {
    expect(PACKAGE_STATUS_BADGE_VARIANTS.failed.className).toMatch(/bg-destructive\/15/);
    // 'dead' phải chứa "bg-destructive" nhưng KHÔNG phải dạng mờ "/15" như failed —
    // tức là một token bg-destructive ĐẶC (không có "/" ngay sau, hoặc opacity cao hơn).
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead.className).toMatch(/bg-destructive(?!\/15\b)/);
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead.className).not.toBe(PACKAGE_STATUS_BADGE_VARIANTS.failed.className);
  });

  it("khoá i18n của 'dead' khác khoá 'failed' (không dùng chung common.error)", () => {
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead.labelKey).toBeTruthy();
    expect(PACKAGE_STATUS_BADGE_VARIANTS.dead.labelKey).not.toBe(PACKAGE_STATUS_BADGE_VARIANTS.failed.labelKey);
  });
});

describe("PACKAGE_STATUS_FILTER_OPTIONS — bộ lọc UI có đủ 'dead' (nối procedure Mục 1)", () => {
  it("★★★ TRUNG TÂM — danh sách tuỳ chọn lọc chứa 'dead'", () => {
    const values = PACKAGE_STATUS_FILTER_OPTIONS.map((o) => o.value);
    expect(values).toContain("dead");
  });

  it("mỗi tuỳ chọn có labelKey không rỗng (không chuỗi Việt trần)", () => {
    for (const opt of PACKAGE_STATUS_FILTER_OPTIONS) {
      expect(opt.labelKey.length).toBeGreaterThan(0);
      // Không chứa ký tự có dấu tiếng Việt trần trong CHÍNH labelKey (khoá i18n, không phải chuỗi hiển thị)
      expect(opt.labelKey).toMatch(/^[a-zA-Z0-9_.]+$/);
    }
  });
});
