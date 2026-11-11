import { test } from "node:test";
import assert from "node:assert/strict";
import { tamTinh, tienGiam } from "../../src/donHang/gia.ts";

test("tạm tính cộng thành tiền", () => {
  assert.equal(tamTinh([{ ma: "A", loai: "thuong", soLuong: 2, donGia: 5 }, { ma: "B", loai: "sach", soLuong: 1, donGia: 7 }]), 17);
});

test("giảm cố định không vượt tạm tính và cần tối thiểu", () => {
  assert.equal(tienGiam(299_999, "GIAM50K"), 0);
  assert.equal(tienGiam(300_000, "giam50k"), 50_000);
});
