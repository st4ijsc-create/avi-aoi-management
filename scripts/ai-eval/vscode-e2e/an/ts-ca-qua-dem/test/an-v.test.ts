import { test } from "node:test";
import assert from "node:assert/strict";
import { caCuaGio } from "../src/ca.ts";

test("ẩn: ca 1 bắt đầu 22h — mọi giờ trong ngày", () => {
  const ra = Array.from({ length: 24 }, (_, g) => caCuaGio(g, 22));
  const ky = Array.from({ length: 24 }, (_, g) => (["CA1", "CA2", "CA3"] as const)[Math.floor((((g - 22) % 24) + 24) % 24 / 8)]);
  assert.deepEqual(ra, ky);
  assert.equal(caCuaGio(5, 22), "CA1");
  assert.equal(caCuaGio(6, 22), "CA2");
  assert.equal(caCuaGio(21, 22), "CA3");
});
test("ẩn: ca 1 bắt đầu 0h", () => {
  assert.deepEqual([0, 7, 8, 15, 16, 23].map((g) => caCuaGio(g, 0)), ["CA1", "CA1", "CA2", "CA2", "CA3", "CA3"]);
});
test("ẩn: ca 1 bắt đầu 6h — giờ trước 6h", () => {
  assert.equal(caCuaGio(2, 6), "CA3");
  assert.equal(caCuaGio(5, 6), "CA3");
});
test("ẩn: gio sai ⇒ RangeError", () => {
  for (const g of [-1, 24, 1.5, Number.NaN]) assert.throws(() => caCuaGio(g, 6), RangeError, String(g));
});
test("ẩn: gioBatDau sai ⇒ RangeError", () => {
  for (const g of [-1, 24, 6.5]) assert.throws(() => caCuaGio(3, g), RangeError, String(g));
});
