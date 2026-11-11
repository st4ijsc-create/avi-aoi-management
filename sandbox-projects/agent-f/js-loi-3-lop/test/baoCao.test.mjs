import { test } from "node:test";
import assert from "node:assert/strict";
import { tongDon, xuatCsv } from "../index.mjs";

const DH1 = { ma: "DH-101", dong: [{ sanPham: "AO", soLuong: 2, donGia: 150000, giamPhanTram: 10 }, { sanPham: "MU", soLuong: 1, donGia: 85000 }] };

test("tổng đơn thường", () => {
  // 270000 + 85000 = 355000; thuế 21600 + 6800 = 28400
  assert.deepEqual(tongDon(DH1), { soDong: 2, truocThue: 355000, thue: 28400, tong: 383400 });
});

test("đơn có trả hàng nguyên dòng", () => {
  const don = { ma: "DH-105", dong: [{ sanPham: "AO", soLuong: 2, donGia: 150000 }, { sanPham: "AO", soLuong: -1, donGia: 150000 }] };
  assert.deepEqual(tongDon(don), { soDong: 2, truocThue: 150000, thue: 12000, tong: 162000 });
});

test("CSV đúng định dạng", () => {
  assert.equal(xuatCsv([DH1]), "ma_don,so_dong,truoc_thue,thue,tong\nDH-101,2,355000,28400,383400\nTONG_CONG,2,355000,28400,383400\n");
});

test("CSV rỗng", () => {
  assert.equal(xuatCsv([]), "ma_don,so_dong,truoc_thue,thue,tong\nTONG_CONG,0,0,0,0\n");
});
