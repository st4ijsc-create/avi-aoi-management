import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dinhDangTien,
  thoiDiemDiaPhuong,
  thuTuTiengAnh,
  soNhieu,
  thoiGianTuongDoi,
  sapXepTen,
} from "../src/dinhDang.ts";

const chuan = (s: string) => s.replace(/[  ]/g, " ");
const NGAY = 86_400_000;
const GIO = 3_600_000;

test("tiền: chéo locale, làm tròn, số âm", () => {
  assert.equal(chuan(dinhDangTien(1234.5, "USD", "vi-VN")), "1.234,50 US$");
  assert.equal(chuan(dinhDangTien(1234567, "VND", "en-US")), "₫1,234,567");
  assert.equal(chuan(dinhDangTien(1234567.6, "VND", "vi-VN")), "1.234.568 ₫");
  assert.equal(chuan(dinhDangTien(-5, "USD", "en-US")), "-$5.00");
  assert.equal(chuan(dinhDangTien(-2500, "VND", "vi-VN")), "-2.500 ₫");
  assert.equal(chuan(dinhDangTien(0, "VND", "vi-VN")), "0 ₫");
  assert.equal(chuan(dinhDangTien(1e6, "USD", "en-US")), "$1,000,000.00");
});

test("tiền không hữu hạn ⇒ RangeError", () => {
  assert.throws(() => dinhDangTien(Number.NaN, "USD", "en-US"), RangeError);
  assert.throws(() => dinhDangTien(Infinity, "VND", "vi-VN"), RangeError);
});

test("America/New_York quanh lúc đổi giờ mùa hè (nhảy 02:00 → 03:00)", () => {
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 2, 8, 6, 59, 59), "America/New_York"), "2026-03-08 01:59 -05:00");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 2, 8, 7, 0, 0), "America/New_York"), "2026-03-08 03:00 -04:00");
});

test("America/New_York lúc lùi giờ (01:30 xảy ra hai lần) và qua năm", () => {
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 10, 1, 5, 30), "America/New_York"), "2026-11-01 01:30 -04:00");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 10, 1, 6, 30), "America/New_York"), "2026-11-01 01:30 -05:00");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 0, 1, 4, 30), "America/New_York"), "2025-12-31 23:30 -05:00");
});

test("nửa đêm là 00, giờ chiều 24h, giây bị cắt, UTC và lệch lẻ phút", () => {
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 9, 18, 17, 0), "Asia/Ho_Chi_Minh"), "2026-10-19 00:00 +07:00");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 9, 18, 8, 5, 59, 999), "Asia/Ho_Chi_Minh"), "2026-10-18 15:05 +07:00");
  assert.equal(thoiDiemDiaPhuong(0, "UTC"), "1970-01-01 00:00 +00:00");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 0, 1, 0, 0), "Asia/Kathmandu"), "2026-01-01 05:45 +05:45");
  assert.equal(thoiDiemDiaPhuong(Date.UTC(2026, 0, 15, 12, 0), "America/St_Johns"), "2026-01-15 08:30 -03:30");
});

test("múi giờ lạ hoặc thời điểm không hữu hạn ⇒ RangeError", () => {
  assert.throws(() => thoiDiemDiaPhuong(0, "Hoa/Hoả_Tinh"), RangeError);
  assert.throws(() => thoiDiemDiaPhuong(Number.NaN, "UTC"), RangeError);
});

test("số thứ tự tiếng Anh: 11–13 là th, số lớn, đầu vào sai", () => {
  assert.deepEqual(
    [0, 11, 12, 13, 21, 22, 23, 101, 111, 112, 1000000].map(thuTuTiengAnh),
    ["0th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "1000000th"],
  );
  assert.throws(() => thuTuTiengAnh(-1), RangeError);
  assert.throws(() => thuTuTiengAnh(2.5), RangeError);
});

test("soNhieu: theo PluralRules của locale, # là số đã định dạng", () => {
  const anh = { one: "# file", other: "# files" };
  assert.equal(soNhieu(1, "en-US", anh), "1 file");
  assert.equal(soNhieu(0, "en-US", anh), "0 files");
  assert.equal(soNhieu(1234, "en-US", anh), "1,234 files");
  assert.equal(soNhieu(1.5, "en-US", anh), "1.5 files");
  const viet = { one: "# (một)", other: "# tệp" };
  assert.equal(soNhieu(1, "vi-VN", viet), "1 tệp");
  assert.equal(soNhieu(1234.5, "vi-VN", viet), "1.234,5 tệp");
  assert.equal(soNhieu(2, "en-US", { other: "#/#" }), "2/2");
  assert.equal(soNhieu(1, "en-US", { other: "# mục" }), "1 mục");
});

test("thời gian tương đối en-US: ngưỡng đơn vị, cắt về 0, numeric auto", () => {
  const b = Date.UTC(2026, 0, 10, 12, 0, 0);
  const t = (d: number) => chuan(thoiGianTuongDoi(b + d, b, "en-US"));
  assert.equal(t(-500), "now");
  assert.equal(t(0), "now");
  assert.equal(t(-45_000), "45 seconds ago");
  assert.equal(t(59_999), "in 59 seconds");
  assert.equal(t(60_000), "in 1 minute");
  assert.equal(t(-(3 * GIO + 59 * 60_000)), "3 hours ago");
  assert.equal(t(23 * GIO + 59 * 60_000), "in 23 hours");
  assert.equal(t(-NGAY), "yesterday");
  assert.equal(t(NGAY + 5), "tomorrow");
  assert.equal(t(-(40 * NGAY + 20 * GIO)), "40 days ago");
});

test("thời gian tương đối vi-VN", () => {
  const b = Date.UTC(2026, 0, 10, 12, 0, 0);
  const t = (d: number) => chuan(thoiGianTuongDoi(b + d, b, "vi-VN"));
  assert.equal(t(-900), "bây giờ");
  assert.equal(t(-3 * GIO), "3 giờ trước");
  assert.equal(t(-NGAY), "Hôm qua");
  assert.equal(t(2 * NGAY + GIO), "Ngày kia");
  assert.equal(t(-45_000), "45 giây trước");
});

test("sapXepTen theo bảng chữ tiếng Việt + số tự nhiên, không sửa mảng vào", () => {
  const vao = ["Đức", "Zoe", "Ưng", "Máy 10", "An", "Ăn", "Ơn", "Dũng", "Ô", "Âu", "Uyên", "Máy 2", "Ê", "Em", "Oanh", "Bình", "Ánh"];
  const banSao = [...vao];
  assert.deepEqual(sapXepTen(vao), [
    "An", "Ánh", "Ăn", "Âu", "Bình", "Dũng", "Đức", "Em", "Ê", "Máy 2", "Máy 10", "Oanh", "Ô", "Ơn", "Uyên", "Ưng", "Zoe",
  ]);
  assert.deepEqual(vao, banSao);
});
