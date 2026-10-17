import { test } from "node:test";
import assert from "node:assert/strict";
import { laNgayNghi as laNgayNghiMod } from "../src/ngayNghi.ts";
import { laNgayNghi, taoLich } from "../src/index.ts";

const tom = (l: { ngay: string; ca: string; nhanVien: string }[]) => l.map((p) => `${p.ngay} ${p.ca} ${p.nhanVien}`);

test("ẩn: index xuất laNgayNghi của ngayNghi.ts", () => assert.equal(laNgayNghi, laNgayNghiMod));
test("ẩn: Chủ nhật luôn nghỉ, ngày thường không", () => {
  assert.equal(laNgayNghi("2026-03-08"), true);
  assert.equal(laNgayNghi("2026-03-09"), false);
  assert.equal(laNgayNghi("2026-03-09", ["2026-03-09"]), true);
  assert.equal(laNgayNghi("2026-03-10", ["2026-03-09"]), false);
});
test("ẩn: taoLich bỏ Chủ nhật, vòng xoay không tiến qua ngày nghỉ", () => {
  // 2026-03-07 thứ Bảy, 2026-03-08 Chủ nhật, 2026-03-09 thứ Hai
  const l = taoLich(["An", "Bình"], "2026-03-07", 3);
  assert.deepEqual(tom(l), [
    "2026-03-07 CA1 An", "2026-03-07 CA2 Bình", "2026-03-07 CA3 An",
    "2026-03-09 CA1 Bình", "2026-03-09 CA2 An", "2026-03-09 CA3 Bình",
  ]);
});
test("ẩn: taoLich bỏ ngày lễ trong dsNghi", () => {
  const l = taoLich(["An", "Bình", "Chi"], "2026-04-29", 3, ["2026-04-30", "2026-05-01"]);
  assert.deepEqual(tom(l), ["2026-04-29 CA1 An", "2026-04-29 CA2 Bình", "2026-04-29 CA3 Chi"]);
});
test("ẩn: toàn ngày nghỉ ⇒ lịch rỗng; không truyền dsNghi vẫn chạy", () => {
  assert.deepEqual(taoLich(["An"], "2026-03-08", 1), []);
  assert.equal(taoLich(["An"], "2026-03-02", 5).length, 15);
});
