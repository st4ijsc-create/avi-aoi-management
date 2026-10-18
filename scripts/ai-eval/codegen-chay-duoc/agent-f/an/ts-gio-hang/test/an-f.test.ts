// TEST ẨN bộ F (ts-gio-hang) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GioHang, inHoaDon, tinhGiam } from "../src/index.ts";
import type { MaGiamGia } from "../src/index.ts";

const PT10: MaGiamGia = { loai: "phan-tram", ma: "GIAM10", phanTram: 10 };
const BAC: MaGiamGia = {
  loai: "bac",
  ma: "BAC",
  bac: [
    { tu: 1_000_000, giam: 120_000 },
    { tu: 300_000, giam: 30_000 },
    { tu: 600_000, giam: 70_000 },
  ],
};

test("[ẩn] phần trăm làm tròn xuống tới đồng", () => {
  assert.equal(tinhGiam(PT10, 150_000), 15_000);
  assert.equal(tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 7 }, 85_005), 5_950);
});

test("[ẩn] phần trăm bị chặn bởi giamToiDa", () => {
  assert.equal(tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 50, giamToiDa: 100_000 }, 900_000), 100_000);
  assert.equal(tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 50, giamToiDa: 100_000 }, 150_000), 75_000);
});

test("[ẩn] phần trăm ngoài (0, 100] ném RangeError", () => {
  assert.throws(() => tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 0 }, 100_000), RangeError);
  assert.throws(() => tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 101 }, 100_000), RangeError);
  assert.equal(tinhGiam({ loai: "phan-tram", ma: "X", phanTram: 100 }, 100_000), 100_000);
});

test("[ẩn] bậc: lấy bậc CAO NHẤT đạt được, danh sách không cần sắp xếp", () => {
  assert.equal(tinhGiam(BAC, 299_999), 0);
  assert.equal(tinhGiam(BAC, 300_000), 30_000);
  assert.equal(tinhGiam(BAC, 999_999), 70_000);
  assert.equal(tinhGiam(BAC, 2_000_000), 120_000);
});

test("[ẩn] không bao giờ giảm quá tạm tính", () => {
  assert.equal(tinhGiam({ loai: "bac", ma: "B", bac: [{ tu: 50_000, giam: 500_000 }] }, 85_000), 85_000);
});

test("[ẩn] giỏ: tạm tính, tiền giảm, tổng sau giảm; tính lại khi giỏ đổi", () => {
  const g = new GioHang();
  g.them("AO01", 2); // 300.000
  g.apDungMa(BAC);
  assert.equal(g.tamTinh(), 300_000);
  assert.equal(g.tienGiam(), 30_000);
  assert.equal(g.tongTien(), 270_000);
  g.them("QU01"); // 750.000
  assert.equal(g.tienGiam(), 70_000);
  assert.equal(g.tongTien(), 680_000);
  g.capNhat("AO01", 0); // 450.000
  assert.equal(g.tienGiam(), 30_000);
});

test("[ẩn] giỏ chỉ giữ một mã; boMa trả về giá gốc", () => {
  const g = new GioHang();
  g.them("GI01"); // 900.000
  g.apDungMa(BAC);
  g.apDungMa(PT10);
  assert.equal(g.tienGiam(), 90_000);
  assert.equal(g.tongTien(), 810_000);
  g.boMa();
  assert.equal(g.tienGiam(), 0);
  assert.equal(g.tongTien(), 900_000);
});

test("[ẩn] hoá đơn có dòng tạm tính và giảm giá trước tổng cộng", () => {
  const g = new GioHang();
  g.them("GI01");
  g.them("MU01", 2);
  g.apDungMa(PT10);
  assert.equal(
    inHoaDon(g),
    [
      "Giày thể thao x1: 900.000 ₫",
      "Mũ lưỡi trai x2: 170.000 ₫",
      "Tạm tính: 1.070.000 ₫",
      "Giảm giá (GIAM10): -107.000 ₫",
      "Tổng cộng: 963.000 ₫",
    ].join("\n"),
  );
});

test("[ẩn] hoá đơn giữ nguyên khi mã không giảm được gì", () => {
  const g = new GioHang();
  g.them("MU01");
  g.apDungMa(BAC); // 85.000 < bậc thấp nhất
  assert.equal(inHoaDon(g), ["Mũ lưỡi trai x1: 85.000 ₫", "Tổng cộng: 85.000 ₫"].join("\n"));
});
