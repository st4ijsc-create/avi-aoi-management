import { test } from "node:test";
import assert from "node:assert/strict";
import { KhoSach, QuanLyMuon } from "../src/index.mjs";

const N = (s) => new Date(`${s}T00:00:00Z`);
function ql(opt) {
  const k = new KhoSach();
  k.them({ ma: "A", ten: "Sách A", soBan: 3 });
  return new QuanLyMuon(k, opt);
}

test("ẩn: hạn trả mặc định 14 ngày, qua tháng", () => {
  assert.equal(ql().muon("A", "x", N("2026-01-25")).hanTra, "2026-02-08");
});
test("ẩn: hạn trả qua năm", () => {
  assert.equal(ql().muon("A", "x", N("2026-12-25")).hanTra, "2027-01-08");
});
test("ẩn: soNgayMuon tuỳ chọn", () => {
  assert.equal(ql({ soNgayMuon: 7 }).muon("A", "x", N("2026-03-01")).hanTra, "2026-03-08");
});
test("ẩn: trả đúng hạn ⇒ 0 ngày trễ", () => {
  const q = ql();
  const p = q.muon("A", "x", N("2026-03-01"));
  assert.equal(q.tra(p.id, N("2026-03-15")).soNgayTre, 0);
});
test("ẩn: trả sớm ⇒ 0 ngày trễ, không âm", () => {
  const q = ql();
  const p = q.muon("A", "x", N("2026-03-01"));
  assert.equal(q.tra(p.id, N("2026-03-03")).soNgayTre, 0);
});
test("ẩn: trả trễ 1 ngày", () => {
  const q = ql();
  const p = q.muon("A", "x", N("2026-03-01"));
  assert.equal(q.tra(p.id, N("2026-03-16")).soNgayTre, 1);
});
