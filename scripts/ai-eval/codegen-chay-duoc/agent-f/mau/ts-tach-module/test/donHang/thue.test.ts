import { test } from "node:test";
import assert from "node:assert/strict";
import { thueDong, tongThue } from "../../src/donHang/thue.ts";

test("thuế theo loại, làm tròn", () => {
  assert.equal(thueDong({ ma: "T", loai: "thuc-pham", soLuong: 1, donGia: 45_010 }), 2251);
});

test("sách không thuế", () => {
  assert.equal(tongThue([{ ma: "S", loai: "sach", soLuong: 3, donGia: 80_000 }]), 0);
});
