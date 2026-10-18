import { test } from "node:test";
import assert from "node:assert/strict";
import { lapLich } from "../src/lichDuAn.mjs";

const o = (batDau, ketThuc, batDauMuon, ketThucMuon, duTru) => ({ batDau, ketThuc, batDauMuon, ketThucMuon, duTru });

test("chuỗi thẳng", () => {
  const kq = lapLich([
    { ma: "A", thoiLuong: 2, truoc: [] },
    { ma: "B", thoiLuong: 3, truoc: ["A"] },
    { ma: "C", thoiLuong: 1, truoc: ["B"] },
  ]);
  assert.deepEqual(kq, {
    tongThoiGian: 6,
    lich: { A: o(0, 2, 0, 2, 0), B: o(2, 5, 2, 5, 0), C: o(5, 6, 5, 6, 0) },
    duongGang: ["A", "B", "C"],
  });
});

test("hình thoi: nhánh ngắn có dự trữ", () => {
  const kq = lapLich([
    { ma: "A", thoiLuong: 3, truoc: [] },
    { ma: "B", thoiLuong: 2, truoc: ["A"] },
    { ma: "C", thoiLuong: 4, truoc: ["A"] },
    { ma: "D", thoiLuong: 1, truoc: ["B", "C"] },
  ]);
  assert.equal(kq.tongThoiGian, 8);
  assert.deepEqual(kq.lich.B, o(3, 5, 5, 7, 2));
  assert.deepEqual(kq.lich.D, o(7, 8, 7, 8, 0));
  assert.deepEqual(kq.duongGang, ["A", "C", "D"]);
});

test("phụ thuộc vào mã không tồn tại ⇒ ném", () => {
  assert.throws(() => lapLich([{ ma: "A", thoiLuong: 1, truoc: ["Z"] }]), { message: "phụ thuộc lạ: A cần Z" });
});
