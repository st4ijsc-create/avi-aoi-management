import { test } from "node:test";
import assert from "node:assert/strict";
import { dinhDangTien, thoiDiemDiaPhuong, thuTuTiengAnh, thoiGianTuongDoi } from "../src/dinhDang.ts";

// ICU chèn khoảng trắng không ngắt (U+00A0, U+202F) — chuẩn hoá về dấu cách thường trước khi so.
const chuan = (s: string) => s.replace(/[  ]/g, " ");

test("tiền USD theo en-US và VND theo vi-VN", () => {
  assert.equal(chuan(dinhDangTien(1234.5, "USD", "en-US")), "$1,234.50");
  assert.equal(chuan(dinhDangTien(1234567, "VND", "vi-VN")), "1.234.567 ₫");
});

test("thời điểm theo múi Asia/Ho_Chi_Minh", () => {
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 9, 18, 1, 30), "Asia/Ho_Chi_Minh"), "2026-10-18 08:30 +07:00");
});

test("số thứ tự tiếng Anh", () => {
  assert.deepEqual([1, 2, 3, 4].map(thuTuTiengAnh), ["1st", "2nd", "3rd", "4th"]);
});

test("thời gian tương đối en-US", () => {
  const bayGio = Date.UTC(2026, 0, 10, 12, 0, 0);
  assert.equal(chuan(thoiGianTuongDoi(bayGio - 3 * 3_600_000, bayGio, "en-US")), "3 hours ago");
  assert.equal(chuan(thoiGianTuongDoi(bayGio + 5 * 60_000, bayGio, "en-US")), "in 5 minutes");
});
