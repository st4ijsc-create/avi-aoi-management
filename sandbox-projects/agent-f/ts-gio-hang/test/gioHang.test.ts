import { test } from "node:test";
import assert from "node:assert/strict";
import { GioHang, inHoaDon, dinhDangVnd } from "../src/index.ts";

test("thêm hàng cộng dồn số lượng và tính tổng", () => {
  const g = new GioHang();
  g.them("AO01", 2);
  g.them("MU01");
  g.them("AO01");
  assert.equal(g.tongSoLuong(), 4);
  assert.equal(g.tongTien(), 3 * 150_000 + 85_000);
});

test("cập nhật về 0 thì bỏ khỏi giỏ", () => {
  const g = new GioHang();
  g.them("QU01", 2);
  g.capNhat("QU01", 0);
  assert.deepEqual(g.cacDong(), []);
  assert.equal(g.tongTien(), 0);
});

test("sản phẩm không tồn tại hoặc số lượng sai thì ném lỗi", () => {
  const g = new GioHang();
  assert.throws(() => g.them("XX99"), /Không có sản phẩm XX99/);
  assert.throws(() => g.them("AO01", 0), RangeError);
  assert.throws(() => g.them("AO01", 1.5), RangeError);
});

test("định dạng tiền VND", () => {
  assert.equal(dinhDangVnd(0), "0 ₫");
  assert.equal(dinhDangVnd(85_000), "85.000 ₫");
  assert.equal(dinhDangVnd(1_250_000), "1.250.000 ₫");
});

test("hoá đơn liệt kê từng dòng và tổng cộng", () => {
  const g = new GioHang();
  g.them("GI01");
  g.them("MU01", 2);
  assert.equal(
    inHoaDon(g),
    ["Giày thể thao x1: 900.000 ₫", "Mũ lưỡi trai x2: 170.000 ₫", "Tổng cộng: 1.070.000 ₫"].join("\n"),
  );
});
