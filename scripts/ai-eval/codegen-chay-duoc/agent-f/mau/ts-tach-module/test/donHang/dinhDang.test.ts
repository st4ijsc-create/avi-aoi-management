import { test } from "node:test";
import assert from "node:assert/strict";
import { dinhDangVnd, tongKet } from "../../src/donHang/dinhDang.ts";

test("định dạng tiền", () => {
  assert.equal(dinhDangVnd(-1_250_000), "-1.250.000 ₫");
});

test("tổng kết không mã giảm", () => {
  assert.deepEqual(tongKet([{ ma: "A", loai: "thuong", soLuong: 1, donGia: 100 }]), { tamTinh: 100, giam: 0, thue: 10, phaiTra: 110 });
});
