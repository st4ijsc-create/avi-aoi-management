import { test } from "node:test";
import assert from "node:assert/strict";
import { KhoBoNho } from "../src/kho.ts";
import { DichVuDatBan } from "../src/dichVu.ts";
import { LoiNghiepVu } from "../src/kieu.ts";
import type { Ban, DatBan, KhoDatBan, MaLoi } from "../src/kieu.ts";

const coMa = (ma: MaLoi) => (e: unknown) => {
  assert.ok(e instanceof LoiNghiepVu, `phải là LoiNghiepVu, nhận ${String(e)}`);
  assert.ok(e instanceof Error);
  assert.equal(e.ma, ma);
  return true;
};
const N = "2026-10-20";

function dv3() {
  const dv = new DichVuDatBan(new KhoBoNho());
  dv.themBan({ ma: "B6", sucChua: 6 });
  dv.themBan({ ma: "B2", sucChua: 2 });
  dv.themBan({ ma: "A4", sucChua: 4 });
  dv.themBan({ ma: "C4", sucChua: 4 });
  return dv;
}

test("KhoBoNho lưu và trả BẢN SAO; dsDat theo thứ tự lưu đầu tiên", () => {
  const kho = new KhoBoNho();
  const b: Ban = { ma: "X", sucChua: 2 };
  kho.luuBan(b);
  b.sucChua = 99;
  assert.deepEqual(kho.layBan("X"), { ma: "X", sucChua: 2 });
  kho.layBan("X")!.sucChua = 50;
  kho.dsBan()[0].sucChua = 51;
  assert.deepEqual(kho.dsBan(), [{ ma: "X", sucChua: 2 }]);
  assert.equal(kho.layBan("Y"), undefined);
  assert.equal(kho.layDat("DB-9"), undefined);
  const d1: DatBan = { id: "D1", maBan: "X", ten: "a", soKhach: 1, ngay: N, batDau: "10:00", ketThuc: "11:30", trangThai: "hieu-luc" };
  const d2: DatBan = { ...d1, id: "D2" };
  kho.luuDat(d1);
  kho.luuDat(d2);
  kho.luuDat({ ...d1, trangThai: "da-huy" });
  d1.ten = "đổi ngoài";
  assert.deepEqual(kho.dsDat().map((d) => [d.id, d.trangThai, d.ten]), [["D1", "da-huy", "a"], ["D2", "hieu-luc", "a"]]);
  kho.layDat("D2")!.ten = "z";
  assert.equal(kho.layDat("D2")!.ten, "a");
});

test("themBan: trim mã, trùng mã, dữ liệu sai", () => {
  const dv = new DichVuDatBan(new KhoBoNho());
  assert.deepEqual(dv.themBan({ ma: " T1 ", sucChua: 20 }), { ma: "T1", sucChua: 20 });
  assert.throws(() => dv.themBan({ ma: "T1", sucChua: 2 }), coMa("BAN_TRUNG"));
  assert.throws(() => dv.themBan({ ma: "T1 ", sucChua: 2 }), coMa("BAN_TRUNG"));
  for (const ban of [{ ma: "  ", sucChua: 2 }, { ma: "T2", sucChua: 0 }, { ma: "T2", sucChua: 21 }, { ma: "T2", sucChua: 2.5 }]) {
    assert.throws(() => dv.themBan(ban), coMa("DU_LIEU_SAI"), JSON.stringify(ban));
  }
});

test("datBan: mọi kiểu dữ liệu sai ⇒ DU_LIEU_SAI (trước cả NGOAI_GIO, KHONG_TIM_THAY)", () => {
  const dv = dv3();
  const goc = { ten: "A", soKhach: 2, ngay: N, gio: "18:00" };
  const sai: object[] = [
    { ten: "   " },
    { soKhach: 0 },
    { soKhach: 1.5 },
    { ngay: "2026-02-30" },
    { ngay: "2026-2-3" },
    { ngay: "20/10/2026" },
    { gio: "24:00" },
    { gio: "9:30" },
    { gio: "18:60" },
    { soPhut: 29 },
    { soPhut: 241 },
    { soPhut: 45.5 },
    { gio: "07:00", soKhach: 0 },
    { maBan: "KHONG-CO", soPhut: 10 },
  ];
  for (const s of sai) assert.throws(() => dv.datBan({ ...goc, ...s } as never), coMa("DU_LIEU_SAI"), JSON.stringify(s));
  assert.equal(dv.datBan({ ...goc, ngay: "2028-02-29", soPhut: 240 }).ketThuc, "22:00");
});

test("giờ mở cửa: biên đúng giờ đóng được, lố 1 phút thì NGOAI_GIO; cấu hình riêng", () => {
  const dv = dv3();
  assert.throws(() => dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "09:59" }), coMa("NGOAI_GIO"));
  assert.throws(() => dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "20:31" }), coMa("NGOAI_GIO"));
  assert.equal(dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "20:30" }).ketThuc, "22:00");
  assert.equal(dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "10:00", soPhut: 30 }).batDau, "10:00");
  assert.throws(() => dv.datBan({ ten: "A", soKhach: 99, ngay: N, gio: "23:00", maBan: "KHONG-CO" }), coMa("NGOAI_GIO"));
  const dem = new DichVuDatBan(new KhoBoNho(), { moCua: "17:00", dongCua: "23:59" });
  dem.themBan({ ma: "Q", sucChua: 2 });
  assert.equal(dem.datBan({ ten: "Đêm", soKhach: 2, ngay: N, gio: "22:29" }).ketThuc, "23:59");
  assert.throws(() => dem.datBan({ ten: "Sớm", soKhach: 2, ngay: N, gio: "16:59" }), coMa("NGOAI_GIO"));
});

test("cấu hình giờ sai ⇒ DU_LIEU_SAI ngay ở constructor", () => {
  for (const ch of [{ moCua: "22:00", dongCua: "10:00" }, { moCua: "10:00", dongCua: "10:00" }, { moCua: "8:00", dongCua: "22:00" }, { moCua: "10:00", dongCua: "24:00" }]) {
    assert.throws(() => new DichVuDatBan(new KhoBoNho(), ch), coMa("DU_LIEU_SAI"), JSON.stringify(ch));
  }
});

test("chồng giờ: kề nhau thì được, chồng 1 phút thì không; khác ngày, khác bàn, đã huỷ thì không tính", () => {
  const dv = dv3();
  const d = dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "18:00", maBan: "A4" });
  assert.equal(dv.datBan({ ten: "B", soKhach: 2, ngay: N, gio: "19:30", maBan: "A4" }).batDau, "19:30");
  assert.equal(dv.datBan({ ten: "C", soKhach: 2, ngay: N, gio: "16:30", maBan: "A4" }).ketThuc, "18:00");
  assert.throws(() => dv.datBan({ ten: "D", soKhach: 2, ngay: N, gio: "17:59", soPhut: 30, maBan: "A4" }), coMa("TRUNG_GIO"));
  assert.throws(() => dv.datBan({ ten: "D", soKhach: 2, ngay: N, gio: "18:15", soPhut: 30, maBan: "A4" }), coMa("TRUNG_GIO"));
  assert.throws(() => dv.datBan({ ten: "D", soKhach: 2, ngay: N, gio: "15:00", soPhut: 240, maBan: "A4" }), coMa("TRUNG_GIO"));
  assert.equal(dv.datBan({ ten: "E", soKhach: 2, ngay: "2026-10-21", gio: "18:00", maBan: "A4" }).maBan, "A4");
  assert.equal(dv.datBan({ ten: "F", soKhach: 2, ngay: N, gio: "18:00", maBan: "C4" }).maBan, "C4");
  dv.huyDat(d.id);
  assert.equal(dv.datBan({ ten: "G", soKhach: 4, ngay: N, gio: "18:00", maBan: "A4" }).ten, "G");
});

test("tự chọn bàn: nhỏ nhất đủ chỗ, hoà thì mã nhỏ hơn; hết bàn / vượt sức chứa", () => {
  const dv = dv3();
  const r = (soKhach: number) => dv.datBan({ ten: "K", soKhach, ngay: N, gio: "19:00" }).maBan;
  assert.equal(r(3), "A4");
  assert.equal(r(1), "B2");
  assert.equal(r(2), "C4");
  assert.equal(r(4), "B6");
  assert.throws(() => r(1), coMa("HET_BAN"));
  assert.throws(() => r(7), coMa("VUOT_SUC_CHUA"));
  assert.equal(dv.datBan({ ten: "K", soKhach: 6, ngay: N, gio: "20:30" }).maBan, "B6");
});

test("thứ tự lỗi khi chỉ định bàn: KHONG_TIM_THAY > VUOT_SUC_CHUA > TRUNG_GIO", () => {
  const dv = dv3();
  dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "18:00", maBan: "B2" });
  assert.throws(() => dv.datBan({ ten: "X", soKhach: 50, ngay: N, gio: "18:00", maBan: "b2" }), coMa("KHONG_TIM_THAY"));
  assert.throws(() => dv.datBan({ ten: "X", soKhach: 3, ngay: N, gio: "18:00", maBan: "B2" }), coMa("VUOT_SUC_CHUA"));
  assert.throws(() => dv.datBan({ ten: "X", soKhach: 2, ngay: N, gio: "18:00", maBan: "B2" }), coMa("TRUNG_GIO"));
});

test("huyDat: không có ⇒ KHONG_TIM_THAY, huỷ hai lần ⇒ DA_HUY, kho được cập nhật", () => {
  const kho = new KhoBoNho();
  const dv = new DichVuDatBan(kho);
  dv.themBan({ ma: "B1", sucChua: 4 });
  const d = dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "12:00" });
  assert.throws(() => dv.huyDat("DB-0099"), coMa("KHONG_TIM_THAY"));
  assert.deepEqual(dv.huyDat(d.id), { ...d, trangThai: "da-huy" });
  assert.equal(kho.layDat(d.id)!.trangThai, "da-huy");
  assert.throws(() => dv.huyDat(d.id), coMa("DA_HUY"));
});

test("lichBan sắp theo giờ, bỏ lượt đã huỷ và ngày khác; banTrong", () => {
  const dv = dv3();
  dv.datBan({ ten: "Tối", soKhach: 2, ngay: N, gio: "19:00", maBan: "A4" });
  const huy = dv.datBan({ ten: "Huỷ", soKhach: 2, ngay: N, gio: "15:00", maBan: "A4" });
  dv.datBan({ ten: "Trưa", soKhach: 2, ngay: N, gio: "11:00", maBan: "A4" });
  dv.datBan({ ten: "Mai", soKhach: 2, ngay: "2026-10-21", gio: "10:00", maBan: "A4" });
  dv.huyDat(huy.id);
  assert.deepEqual(dv.lichBan("A4", N).map((d) => [d.ten, d.batDau, d.ketThuc]), [["Trưa", "11:00", "12:30"], ["Tối", "19:00", "20:30"]]);
  assert.deepEqual(dv.lichBan("B6", N), []);
  assert.throws(() => dv.lichBan("ZZ", N), coMa("KHONG_TIM_THAY"));
  assert.throws(() => dv.lichBan("A4", "2026-13-01"), coMa("DU_LIEU_SAI"));
  assert.deepEqual(dv.banTrong(N, "19:00", 60, 2), ["B2", "C4", "B6"]);
  assert.deepEqual(dv.banTrong(N, "20:30", 60, 3), ["A4", "C4", "B6"]);
  assert.deepEqual(dv.banTrong(N, "12:00", 120, 7), []);
  assert.throws(() => dv.banTrong(N, "21:30", 60, 2), coMa("NGOAI_GIO"));
  assert.throws(() => dv.banTrong(N, "12:00", 10, 2), coMa("DU_LIEU_SAI"));
});

test("dịch vụ chỉ dùng giao diện KhoDatBan; id tăng dần, lần đặt hỏng không tiêu id", () => {
  const ban = new Map<string, Ban>();
  const dat = new Map<string, DatBan>();
  const ghi: string[] = [];
  const kho: KhoDatBan = {
    layBan: (ma) => (ban.has(ma) ? { ...ban.get(ma)! } : undefined),
    dsBan: () => [...ban.values()].map((b) => ({ ...b })),
    luuBan: (b) => { ghi.push(`ban:${b.ma}`); ban.set(b.ma, { ...b }); },
    layDat: (id) => (dat.has(id) ? { ...dat.get(id)! } : undefined),
    dsDat: () => [...dat.values()].map((d) => ({ ...d })),
    luuDat: (d) => { ghi.push(`dat:${d.id}:${d.trangThai}`); dat.set(d.id, { ...d }); },
  };
  const dv = new DichVuDatBan(kho);
  dv.themBan({ ma: "M", sucChua: 2 });
  const a = dv.datBan({ ten: "A", soKhach: 2, ngay: N, gio: "11:00" });
  assert.throws(() => dv.datBan({ ten: "B", soKhach: 2, ngay: N, gio: "11:30" }), coMa("HET_BAN"));
  const c = dv.datBan({ ten: "C", soKhach: 1, ngay: N, gio: "12:30" });
  dv.huyDat(a.id);
  assert.deepEqual([a.id, c.id], ["DB-0001", "DB-0002"]);
  assert.deepEqual(ghi, ["ban:M", "dat:DB-0001:hieu-luc", "dat:DB-0002:hieu-luc", "dat:DB-0001:da-huy"]);
  const tra = dv.datBan({ ten: "D", soKhach: 1, ngay: N, gio: "14:00" });
  tra.ten = "sửa ngoài";
  assert.equal(dat.get("DB-0003")!.ten, "D");
});
