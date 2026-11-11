import { test } from "node:test";
import assert from "node:assert/strict";
import { tongDon } from "../index.mjs";

test("hồi quy: trả lại đúng món đã mua có giảm giá ⇒ tổng đơn 0", () => {
  const don = { ma: "DH-102", dong: [{ sanPham: "AO", soLuong: 1, donGia: 12345, giamPhanTram: 10 }, { sanPham: "AO", soLuong: -1, donGia: 12345, giamPhanTram: 10 }] };
  assert.deepEqual(tongDon(don), { soDong: 2, truocThue: 0, thue: 0, tong: 0 });
});
