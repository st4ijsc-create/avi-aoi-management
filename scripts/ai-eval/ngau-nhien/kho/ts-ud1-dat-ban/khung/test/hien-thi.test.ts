import { test } from "node:test";
import assert from "node:assert/strict";
import { KhoBoNho } from "../src/kho.ts";
import { DichVuDatBan } from "../src/dichVu.ts";
import { LoiNghiepVu } from "../src/kieu.ts";

const coMa = (ma: string) => (e: unknown) => e instanceof LoiNghiepVu && e.ma === ma;

function dungDichVu() {
  const dv = new DichVuDatBan(new KhoBoNho());
  dv.themBan({ ma: "B1", sucChua: 4 });
  return dv;
}

test("đặt bàn chỉ định: trả bản ghi đầy đủ", () => {
  const dv = dungDichVu();
  assert.deepEqual(dv.datBan({ ten: " Lan ", soKhach: 2, ngay: "2026-10-20", gio: "18:30", maBan: "B1" }), {
    id: "DB-0001",
    maBan: "B1",
    ten: "Lan",
    soKhach: 2,
    ngay: "2026-10-20",
    batDau: "18:30",
    ketThuc: "20:00",
    trangThai: "hieu-luc",
  });
});

test("trùng giờ cùng bàn ⇒ TRUNG_GIO", () => {
  const dv = dungDichVu();
  dv.datBan({ ten: "A", soKhach: 2, ngay: "2026-10-20", gio: "18:00", maBan: "B1" });
  assert.throws(() => dv.datBan({ ten: "B", soKhach: 2, ngay: "2026-10-20", gio: "19:00", maBan: "B1" }), coMa("TRUNG_GIO"));
});

test("huỷ đặt rồi đặt lại được khung giờ đó", () => {
  const dv = dungDichVu();
  const d = dv.datBan({ ten: "A", soKhach: 2, ngay: "2026-10-20", gio: "18:00", maBan: "B1" });
  assert.equal(dv.huyDat(d.id).trangThai, "da-huy");
  assert.equal(dv.datBan({ ten: "B", soKhach: 3, ngay: "2026-10-20", gio: "18:00", maBan: "B1" }).id, "DB-0002");
});
