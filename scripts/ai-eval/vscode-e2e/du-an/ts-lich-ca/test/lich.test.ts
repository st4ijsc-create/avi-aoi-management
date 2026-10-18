import { test } from "node:test";
import assert from "node:assert/strict";
import { caCuaGio, soCaCuaNhanVien, taoLich } from "../src/index.ts";

test("ca trong ngày, ca 1 bắt đầu 6h", () => {
  assert.deepEqual([6, 13, 14, 21].map((g) => caCuaGio(g, 6)), ["CA1", "CA1", "CA2", "CA2"]);
});

test("ca vắt qua nửa đêm", () => {
  assert.deepEqual([22, 23, 0, 5].map((g) => caCuaGio(g, 6)), ["CA3", "CA3", "CA3", "CA3"]);
});

test("giờ sai ⇒ RangeError", () => {
  assert.throws(() => caCuaGio(24, 6), RangeError);
});

test("xếp vòng nối tiếp qua các ngày (thứ Hai 2026-03-02, 2 ngày)", () => {
  const l = taoLich(["An", "Bình"], "2026-03-02", 2);
  assert.deepEqual(
    l.map((p) => `${p.ngay} ${p.ca} ${p.nhanVien}`),
    ["2026-03-02 CA1 An", "2026-03-02 CA2 Bình", "2026-03-02 CA3 An", "2026-03-03 CA1 Bình", "2026-03-03 CA2 An", "2026-03-03 CA3 Bình"],
  );
  assert.equal(soCaCuaNhanVien(l, "An"), 3);
});
