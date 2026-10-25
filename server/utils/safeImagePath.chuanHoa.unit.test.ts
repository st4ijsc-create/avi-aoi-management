/** chuanHoaKhoaAnh (L6b-fix 2026-10-25): một lần chuẩn hoá cho cả kiểm phạm vi lẫn đọc tệp; mọi dạng traversal / mã hoá ⇒ null. */
import { describe, expect, it } from "vitest";
import { chuanHoaKhoaAnh } from "./safeImagePath";

const BS = String.fromCharCode(92);
describe("chuanHoaKhoaAnh", () => {
  it("khoá hợp lệ được chuẩn hoá về dạng tương đối thống nhất", () => {
    expect(chuanHoaKhoaAnh("temp/tmp_1_a.png")).toBe("temp/tmp_1_a.png");
    expect(chuanHoaKhoaAnh("/uploads/temp/tmp_1_a.png")).toBe("temp/tmp_1_a.png");
    expect(chuanHoaKhoaAnh("uploads" + BS + "inspections" + BS + "a.jpg")).toBe("inspections/a.jpg");
    expect(chuanHoaKhoaAnh("  ./inspections/./a.jpg ")).toBe("inspections/a.jpg");
  });
  it("traversal / mã hoá / tuyệt đối / NUL / rỗng ⇒ null", () => {
    for (const k of [
      "temp/../x.png", "temp/%2e%2e/x.png", "temp/%2E%2E/x.png", "temp/..%2fx.png", "temp" + BS + ".." + BS + "x", "uploads/temp/../x.png", "/../x.png",
      "a//b.png", "a/b/", "..", "C:/x.png", "temp/" + String.fromCharCode(0) + "x", "", "   ", "uploads/",
    ]) expect(chuanHoaKhoaAnh(k), k).toBeNull();
    expect(chuanHoaKhoaAnh(undefined)).toBeNull();
    expect(chuanHoaKhoaAnh(5)).toBeNull();
  });
});
