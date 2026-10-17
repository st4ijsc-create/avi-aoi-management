import { test } from "node:test";
import assert from "node:assert/strict";
import { KhoSach } from "../src/index.mjs";

function kho(ds) {
  const k = new KhoSach();
  ds.forEach(([ma, ten]) => k.them({ ma, ten }));
  return k;
}

test("ẩn: thứ tự tiếng Việt, không phân biệt hoa thường", () => {
  const k = kho([["1", "Zebra"], ["2", "apple"], ["3", "Ánh sáng"], ["4", "Banana"], ["5", "Đà Lạt"], ["6", "Dê"], ["7", "dưa hấu"], ["8", "Ăn uống"], ["9", "an toàn"]]);
  assert.deepEqual(k.danhSach().map((s) => s.ten), ["an toàn", "Ánh sáng", "apple", "Ăn uống", "Banana", "Dê", "dưa hấu", "Đà Lạt", "Zebra"]);
});
test("ẩn: trùng tên (khác hoa thường) ⇒ theo mã tăng dần", () => {
  const k = kho([["B2", "toán"], ["A9", "Toán"], ["A1", "TOÁN"], ["C1", "an"]]);
  assert.deepEqual(k.danhSach().map((s) => s.ma), ["C1", "A1", "A9", "B2"]);
});
test("ẩn: timTheoTen trả theo cùng thứ tự", () => {
  const k = kho([["1", "Sổ tay Zalo"], ["2", "sổ tay ánh sáng"], ["3", "Sổ tay Đà Lạt"], ["4", "khác"]]);
  assert.deepEqual(k.timTheoTen("sổ tay").map((s) => s.ma), ["2", "3", "1"]);
});
