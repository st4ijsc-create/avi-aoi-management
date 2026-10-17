import { test } from "node:test";
import assert from "node:assert/strict";
import { KhoSach, QuanLyMuon } from "../src/index.mjs";

const N = (s) => new Date(`${s}T00:00:00Z`);

function kho() {
  const k = new KhoSach();
  k.them({ ma: "S1", ten: "  Lập   trình Node ", tacGia: "An", soBan: 2 });
  k.them({ ma: "S2", ten: "Đường xưa mây trắng", tacGia: "Nhất Hạnh" });
  k.them({ ma: "S3", ten: "dữ liệu lớn", tacGia: "Bình" });
  k.them({ ma: "S4", ten: "Ánh sáng", tacGia: "Chi" });
  return k;
}

test("thêm và lấy sách, tên được chuẩn hoá", () => {
  const k = kho();
  assert.equal(k.lay("S1").ten, "Lập trình Node");
  assert.equal(k.lay("X"), null);
  assert.throws(() => k.them({ ma: "S1", ten: "trùng" }), /Trùng mã/);
});

test("danh sách xếp theo tên kiểu tiếng Việt", () => {
  assert.deepEqual(kho().danhSach().map((s) => s.ma), ["S4", "S3", "S2", "S1"]);
});

test("tìm theo tên không phân biệt hoa thường", () => {
  assert.deepEqual(kho().timTheoTen("LẬP TRÌNH").map((s) => s.ma), ["S1"]);
});

test("mượn: hạn trả = ngày mượn + 14 ngày; hết bản thì báo lỗi", () => {
  const q = new QuanLyMuon(kho());
  const p = q.muon("S2", "lan", N("2026-03-01"));
  assert.equal(p.hanTra, "2026-03-15");
  assert.throws(() => q.muon("S2", "minh", N("2026-03-02")), /Hết bản/);
  assert.equal(q.dangMuon("lan").length, 1);
});

test("trả trễ 3 ngày", () => {
  const q = new QuanLyMuon(kho());
  const p = q.muon("S1", "lan", N("2026-03-01"));
  const r = q.tra(p.id, N("2026-03-18"));
  assert.equal(r.soNgayTre, 3);
  assert.equal(q.dangMuon("lan").length, 0);
});
