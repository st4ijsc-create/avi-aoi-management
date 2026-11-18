import { test } from "node:test";
import assert from "node:assert/strict";
import { LoiDinhDang, inHoaDon, phanTichDon, tongKet } from "../src/index.ts";

const DON = ["# đơn mẫu", "SP01;thuong;2;150000", "", "sach-a;sach;3;80000", "TP9;thuc-pham;1;45000"].join("\n");

test("phân tích bỏ dòng trống và chú thích, mã viết hoa", () => {
  const ds = phanTichDon(DON);
  assert.deepEqual(ds.map((d) => d.ma), ["SP01", "SACH-A", "TP9"]);
});

test("dòng sai báo đúng số dòng", () => {
  assert.throws(() => phanTichDon("A;thuong;1;100\nB;thuong;x;100"), (e: unknown) => e instanceof LoiDinhDang && e.soDong === 2);
});

test("tổng kết có mã giảm phần trăm", () => {
  // tạm tính 300000 + 240000 + 45000 = 585000; giảm 10 % = 58500; thuế 30000 + 0 + 2250 = 32250
  assert.deepEqual(tongKet(phanTichDon(DON), "giam10"), { tamTinh: 585000, giam: 58500, thue: 32250, phaiTra: 558750 });
});

test("in hoá đơn", () => {
  assert.equal(
    inHoaDon(phanTichDon("SP01;thuong;2;150000"), "GIAM50K"),
    ["SP01 x2: 300.000 ₫", "Tạm tính: 300.000 ₫", "Giảm (GIAM50K): -50.000 ₫", "Thuế VAT: 30.000 ₫", "Phải trả: 280.000 ₫"].join("\n"),
  );
});

test("mã giảm chưa đủ tối thiểu thì không giảm", () => {
  assert.equal(tongKet(phanTichDon("B1;sach;1;100000"), "SACH20").giam, 0);
});
