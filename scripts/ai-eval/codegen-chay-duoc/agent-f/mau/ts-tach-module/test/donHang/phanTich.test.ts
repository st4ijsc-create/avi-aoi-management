import { test } from "node:test";
import assert from "node:assert/strict";
import { LoiDinhDang, phanTichDong, phanTichDon } from "../../src/donHang/phanTich.ts";

test("phanTichDong đọc đủ bốn trường", () => {
  assert.deepEqual(phanTichDong(" ab ;sach; 2 ;10"), { ma: "AB", loai: "sach", soLuong: 2, donGia: 10 });
});

test("phanTichDon báo số dòng thật", () => {
  assert.throws(() => phanTichDon("\n\nA;la;1;1"), (e: unknown) => e instanceof LoiDinhDang && e.soDong === 3);
});
