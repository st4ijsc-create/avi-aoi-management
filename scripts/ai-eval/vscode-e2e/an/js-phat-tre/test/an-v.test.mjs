import { test } from "node:test";
import assert from "node:assert/strict";
import { tinhPhat as tinhPhatMod } from "../src/phat.mjs";
import { KhoSach, QuanLyMuon, tinhPhat } from "../src/index.mjs";

const N = (s) => new Date(`${s}T00:00:00Z`);
function ql(opt) {
  const k = new KhoSach();
  k.them({ ma: "A", ten: "Sách A", soBan: 5 });
  return new QuanLyMuon(k, opt);
}

test("ẩn: index xuất đúng tinhPhat của phat.mjs", () => assert.equal(tinhPhat, tinhPhatMod));
test("ẩn: tinhPhat mặc định 5.000/ngày, trần 100.000", () => {
  assert.equal(tinhPhat(0), 0);
  assert.equal(tinhPhat(3), 15000);
  assert.equal(tinhPhat(20), 100000);
  assert.equal(tinhPhat(21), 100000);
});
test("ẩn: tinhPhat tuỳ chọn", () => {
  assert.equal(tinhPhat(4, { mucNgay: 2000 }), 8000);
  assert.equal(tinhPhat(10, { mucNgay: 2000, toiDa: 15000 }), 15000);
});
test("ẩn: tinhPhat đầu vào sai ⇒ RangeError", () => {
  assert.throws(() => tinhPhat(-1), RangeError);
  assert.throws(() => tinhPhat(1.5), RangeError);
});
test("ẩn: tra trả tienPhat, đúng hạn ⇒ 0", () => {
  const q = ql();
  const a = q.muon("A", "lan", N("2026-03-01"));
  const b = q.muon("A", "lan", N("2026-03-01"));
  assert.equal(q.tra(a.id, N("2026-03-18")).tienPhat, 15000);
  assert.equal(q.tra(b.id, N("2026-03-10")).tienPhat, 0);
});
test("ẩn: tongPhat chỉ tính phiếu đã trả, theo người", () => {
  const q = ql({ phat: { mucNgay: 1000 } });
  const a = q.muon("A", "lan", N("2026-03-01"));
  q.muon("A", "lan", N("2026-03-01"));
  const c = q.muon("A", "minh", N("2026-03-01"));
  q.tra(a.id, N("2026-03-20"));
  q.tra(c.id, N("2026-03-16"));
  assert.equal(q.tongPhat("lan"), 5000);
  assert.equal(q.tongPhat("minh"), 1000);
  assert.equal(q.tongPhat("ai"), 0);
});
