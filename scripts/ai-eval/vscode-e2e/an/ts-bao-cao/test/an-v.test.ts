import { test } from "node:test";
import assert from "node:assert/strict";
import * as baoCao from "../src/baoCao.ts";
import { bangText, taoLich, thongKe } from "../src/index.ts";

test("ẩn: index xuất đúng hai hàm của baoCao.ts", () => {
  assert.equal(thongKe, baoCao.thongKe);
  assert.equal(bangText, baoCao.bangText);
});
test("ẩn: thống kê theo ca, sắp tổng giảm dần rồi tên", () => {
  const tk = thongKe(taoLich(["Bình", "An"], "2026-03-02", 1));
  assert.deepEqual(tk, [
    { nhanVien: "Bình", tong: 2, CA1: 1, CA2: 0, CA3: 1 },
    { nhanVien: "An", tong: 1, CA1: 0, CA2: 1, CA3: 0 },
  ]);
});
test("ẩn: cùng tổng ⇒ tên theo tiếng Việt", () => {
  const tk = thongKe([
    { ngay: "2026-03-02", ca: "CA1", nhanVien: "Đức" },
    { ngay: "2026-03-02", ca: "CA2", nhanVien: "Dung" },
    { ngay: "2026-03-02", ca: "CA3", nhanVien: "An" },
  ]);
  assert.deepEqual(tk.map((d) => d.nhanVien), ["An", "Dung", "Đức"]);
});
test("ẩn: bảng chữ", () => {
  const tk = thongKe(taoLich(["An", "Bình"], "2026-03-02", 1));
  assert.equal(bangText(tk), "Nhân viên | Tổng | CA1 | CA2 | CA3\nAn | 2 | 1 | 0 | 1\nBình | 1 | 0 | 1 | 0");
});
test("ẩn: rỗng", () => {
  assert.deepEqual(thongKe([]), []);
  assert.equal(bangText([]), "Nhân viên | Tổng | CA1 | CA2 | CA3");
});
