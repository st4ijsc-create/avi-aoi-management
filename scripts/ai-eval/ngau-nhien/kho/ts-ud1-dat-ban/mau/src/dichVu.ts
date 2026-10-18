import { LoiNghiepVu } from "./kieu.ts";
import type { Ban, CauHinhNhaHang, DatBan, KhoDatBan, YeuCauDat } from "./kieu.ts";

const RE_GIO = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_NGAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function phut(gio: unknown): number | null {
  if (typeof gio !== "string") return null;
  const m = RE_GIO.exec(gio);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function raGio(p: number): string {
  return `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`;
}

function ngayHopLe(ngay: unknown): boolean {
  if (typeof ngay !== "string") return false;
  const m = RE_NGAY.exec(ngay);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const laSoNguyenTrong = (v: unknown, a: number, b: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= a && v <= b;

const giao = (b1: number, e1: number, b2: number, e2: number) => b1 < e2 && b2 < e1;

const sai = (thongDiep: string) => new LoiNghiepVu("DU_LIEU_SAI", thongDiep);

export class DichVuDatBan {
  #kho: KhoDatBan;
  #mo: number;
  #dong: number;
  #dem = 0;

  constructor(kho: KhoDatBan, cauHinh: CauHinhNhaHang = { moCua: "10:00", dongCua: "22:00" }) {
    const mo = phut(cauHinh.moCua);
    const dong = phut(cauHinh.dongCua);
    if (mo === null || dong === null || mo >= dong) throw sai("giờ mở/đóng cửa không hợp lệ");
    this.#kho = kho;
    this.#mo = mo;
    this.#dong = dong;
  }

  themBan(ban: Ban): Ban {
    if (typeof ban.ma !== "string" || ban.ma.trim() === "") throw sai("mã bàn rỗng");
    if (!laSoNguyenTrong(ban.sucChua, 1, 20)) throw sai("sức chứa phải là số nguyên 1..20");
    const moi = { ma: ban.ma.trim(), sucChua: ban.sucChua };
    if (this.#kho.layBan(moi.ma)) throw new LoiNghiepVu("BAN_TRUNG", `bàn ${moi.ma} đã có`);
    this.#kho.luuBan(moi);
    return { ...moi };
  }

  #khung(ngay: unknown, gio: unknown, soPhut: unknown, soKhach: unknown): [number, number] {
    if (!laSoNguyenTrong(soKhach, 1, Number.MAX_SAFE_INTEGER)) throw sai("số khách phải là số nguyên ≥ 1");
    if (!ngayHopLe(ngay)) throw sai("ngày không hợp lệ");
    const bd = phut(gio);
    if (bd === null) throw sai("giờ không hợp lệ");
    if (!laSoNguyenTrong(soPhut, 30, 240)) throw sai("số phút phải là số nguyên 30..240");
    const kt = bd + soPhut;
    if (bd < this.#mo || kt > this.#dong) throw new LoiNghiepVu("NGOAI_GIO", "ngoài giờ mở cửa");
    return [bd, kt];
  }

  #ban(ma: string, ngay: string, bd: number, kt: number): boolean {
    return !this.#kho
      .dsDat()
      .some((d) => d.maBan === ma && d.ngay === ngay && d.trangThai === "hieu-luc" && giao(bd, kt, phut(d.batDau)!, phut(d.ketThuc)!));
  }

  #banPhuHop(ngay: string, bd: number, kt: number, soKhach: number): Ban[] {
    return this.#kho
      .dsBan()
      .filter((b) => b.sucChua >= soKhach)
      .sort((a, b) => a.sucChua - b.sucChua || (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0));
  }

  datBan(yc: YeuCauDat): DatBan {
    if (typeof yc.ten !== "string" || yc.ten.trim() === "") throw sai("tên rỗng");
    if (yc.maBan !== undefined && typeof yc.maBan !== "string") throw sai("mã bàn phải là chuỗi");
    const soPhut = yc.soPhut === undefined ? 90 : yc.soPhut;
    const [bd, kt] = this.#khung(yc.ngay, yc.gio, soPhut, yc.soKhach);

    let maBan: string;
    if (yc.maBan !== undefined) {
      const ban = this.#kho.layBan(yc.maBan);
      if (!ban) throw new LoiNghiepVu("KHONG_TIM_THAY", `không có bàn ${yc.maBan}`);
      if (ban.sucChua < yc.soKhach) throw new LoiNghiepVu("VUOT_SUC_CHUA", `bàn ${ban.ma} chỉ chứa ${ban.sucChua}`);
      if (!this.#ban(ban.ma, yc.ngay, bd, kt)) throw new LoiNghiepVu("TRUNG_GIO", `bàn ${ban.ma} đã có người đặt`);
      maBan = ban.ma;
    } else {
      const phuHop = this.#banPhuHop(yc.ngay, bd, kt, yc.soKhach);
      if (!phuHop.length) throw new LoiNghiepVu("VUOT_SUC_CHUA", "không bàn nào đủ chỗ");
      const trong = phuHop.find((b) => this.#ban(b.ma, yc.ngay, bd, kt));
      if (!trong) throw new LoiNghiepVu("HET_BAN", "hết bàn trống");
      maBan = trong.ma;
    }

    this.#dem++;
    const dat: DatBan = {
      id: `DB-${String(this.#dem).padStart(4, "0")}`,
      maBan,
      ten: yc.ten.trim(),
      soKhach: yc.soKhach,
      ngay: yc.ngay,
      batDau: raGio(bd),
      ketThuc: raGio(kt),
      trangThai: "hieu-luc",
    };
    this.#kho.luuDat(dat);
    return { ...dat };
  }

  huyDat(id: string): DatBan {
    const d = this.#kho.layDat(id);
    if (!d) throw new LoiNghiepVu("KHONG_TIM_THAY", `không có lượt đặt ${id}`);
    if (d.trangThai === "da-huy") throw new LoiNghiepVu("DA_HUY", `lượt đặt ${id} đã huỷ`);
    const moi: DatBan = { ...d, trangThai: "da-huy" };
    this.#kho.luuDat(moi);
    return { ...moi };
  }

  lichBan(maBan: string, ngay: string): DatBan[] {
    if (!ngayHopLe(ngay)) throw sai("ngày không hợp lệ");
    if (!this.#kho.layBan(maBan)) throw new LoiNghiepVu("KHONG_TIM_THAY", `không có bàn ${maBan}`);
    return this.#kho
      .dsDat()
      .filter((d) => d.maBan === maBan && d.ngay === ngay && d.trangThai === "hieu-luc")
      .sort((a, b) => phut(a.batDau)! - phut(b.batDau)!);
  }

  banTrong(ngay: string, gio: string, soPhut: number, soKhach: number): string[] {
    const [bd, kt] = this.#khung(ngay, gio, soPhut, soKhach);
    return this.#banPhuHop(ngay, bd, kt, soKhach)
      .filter((b) => this.#ban(b.ma, ngay, bd, kt))
      .map((b) => b.ma);
  }
}
