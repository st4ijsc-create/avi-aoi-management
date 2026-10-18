import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as vanBan from "../src/vanBan.mjs";
import * as chiMuc from "../src/index.mjs";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

test("ẩn: src/tienIch.mjs không còn, src/vanBan.mjs có đủ hàm cũ", () => {
  assert.equal(existsSync(`${SRC}tienIch.mjs`), false);
  for (const f of ["chuanHoaTen", "congNgay", "dinhDangNgay", "soNgayGiua", "boDau"]) assert.equal(typeof vanBan[f], "function", f);
});
test("ẩn: không tệp nào trong src/ còn nhắc tienIch", () => {
  for (const f of readdirSync(SRC, { recursive: true })) {
    if (String(f).endsWith(".mjs")) assert.ok(!readFileSync(`${SRC}${f}`, "utf8").includes("tienIch"), String(f));
  }
});
test("ẩn: boDau", () => {
  assert.equal(vanBan.boDau("Đường Lê Lợi"), "Duong Le Loi");
  assert.equal(vanBan.boDau("ĐƯỢC rồi, cảm ơn!"), "DUOC roi, cam on!");
  assert.equal(vanBan.boDau("Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ"), "Tieng Viet co dau: a a a a a");
  assert.equal(vanBan.boDau("abc-123"), "abc-123");
});
test("ẩn: index xuất boDau", () => {
  assert.equal(chiMuc.boDau("đ"), "d");
});
test("ẩn: tìm theo tên không phân biệt dấu", () => {
  const k = new chiMuc.KhoSach();
  k.them({ ma: "S1", ten: "Lập trình Node" });
  k.them({ ma: "S2", ten: "Đường xưa mây trắng" });
  k.them({ ma: "S3", ten: "Nhập môn lập trình" });
  assert.deepEqual(k.timTheoTen("lap trinh").map((s) => s.ma), ["S1", "S3"]);
  assert.deepEqual(k.timTheoTen("DUONG").map((s) => s.ma), ["S2"]);
  assert.deepEqual(k.timTheoTen("lập").map((s) => s.ma), ["S1", "S3"]);
});
