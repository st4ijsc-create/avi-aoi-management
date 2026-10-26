import { describe, expect, it } from "vitest";
import { hienDanhSach, hienGiaTri, phanTichDanhSach, phanTichGiaTri } from "./flowChon";

describe("giá trị điều kiện logic.chon", () => {
  it("phân tích: số / true / false / null / chuỗi trong ngoặc kép / chữ trần (= chuỗi); KHÔNG ép '1' thành số khi có ngoặc", () => {
    expect(phanTichGiaTri("42")).toBe(42);
    expect(phanTichGiaTri("-3.5")).toBe(-3.5);
    expect(phanTichGiaTri("true")).toBe(true);
    expect(phanTichGiaTri("null")).toBeNull();
    expect(phanTichGiaTri('"1"')).toBe("1");
    expect(phanTichGiaTri("dien")).toBe("dien");
    expect(phanTichGiaTri("  co-khi  ")).toBe("co-khi");
    expect(phanTichGiaTri("")).toBe("");
  });
  it("hiển thị là NGHỊCH ĐẢO của phân tích (khứ hồi giữ nguyên kiểu), kể cả chuỗi trông như số", () => {
    for (const v of ["dien", "1", "true", "null", "12.5", " lề ", 7, -2.5, true, false, null, ""]) expect(phanTichGiaTri(hienGiaTri(v)), String(v)).toBe(v);
  });
  it("danh sách cho 'in': tách theo dấu phẩy, bỏ phần rỗng; khứ hồi", () => {
    expect(phanTichDanhSach("dien, co-khi,, 3, \"4\"")).toEqual(["dien", "co-khi", 3, "4"]);
    expect(phanTichDanhSach(hienDanhSach(["a", 1, "2", null]))).toEqual(["a", 1, "2", null]);
    expect(phanTichDanhSach("")).toEqual([]);
  });
});
