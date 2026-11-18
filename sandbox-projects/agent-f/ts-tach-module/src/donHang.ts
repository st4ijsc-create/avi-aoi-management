// Toàn bộ nghiệp vụ đơn hàng trong một tệp (đã quá dài, cần tách — xem README).

// ── Phân tích văn bản đơn ────────────────────────────────────────────────────────────────────────────
export type LoaiHang = "thuc-pham" | "sach" | "thuong";

export interface DongDon {
  ma: string;
  loai: LoaiHang;
  soLuong: number;
  donGia: number;
}

export class LoiDinhDang extends Error {
  readonly soDong: number;
  constructor(soDong: number, thongDiep: string) {
    super(`dòng ${soDong}: ${thongDiep}`);
    this.name = "LoiDinhDang";
    this.soDong = soDong;
  }
}

const LOAI_HOP_LE: readonly LoaiHang[] = ["thuc-pham", "sach", "thuong"];

function soNguyenDuong(chu: string, soDong: number, ten: string): number {
  const t = chu.trim();
  if (!/^\d+$/.test(t)) throw new LoiDinhDang(soDong, `${ten} phải là số nguyên không âm`);
  return Number(t);
}

export function phanTichDong(dong: string, soDong = 1): DongDon {
  const phan = dong.split(";");
  if (phan.length !== 4) throw new LoiDinhDang(soDong, "cần đúng 4 trường MA;LOAI;SO_LUONG;DON_GIA");
  const ma = phan[0].trim().toUpperCase();
  if (!ma) throw new LoiDinhDang(soDong, "mã rỗng");
  const loai = phan[1].trim() as LoaiHang;
  if (!LOAI_HOP_LE.includes(loai)) throw new LoiDinhDang(soDong, `loại không hợp lệ: ${phan[1].trim()}`);
  const soLuong = soNguyenDuong(phan[2], soDong, "số lượng");
  if (soLuong === 0) throw new LoiDinhDang(soDong, "số lượng phải lớn hơn 0");
  const donGia = soNguyenDuong(phan[3], soDong, "đơn giá");
  return { ma, loai, soLuong, donGia };
}

export function phanTichDon(vanBan: string): DongDon[] {
  const ra: DongDon[] = [];
  vanBan.split(/\r?\n/).forEach((dong, i) => {
    const t = dong.trim();
    if (!t || t.startsWith("#")) return;
    ra.push(phanTichDong(t, i + 1));
  });
  return ra;
}

// ── Giá và mã giảm ───────────────────────────────────────────────────────────────────────────────────
export interface MaGiam {
  ma: string;
  kieu: "phan-tram" | "co-dinh";
  giaTri: number;
  toiThieu: number;
}

export const BANG_MA_GIAM: readonly MaGiam[] = [
  { ma: "GIAM10", kieu: "phan-tram", giaTri: 10, toiThieu: 0 },
  { ma: "GIAM50K", kieu: "co-dinh", giaTri: 50_000, toiThieu: 300_000 },
  { ma: "SACH20", kieu: "phan-tram", giaTri: 20, toiThieu: 200_000 },
];

export function thanhTien(d: DongDon): number {
  return d.soLuong * d.donGia;
}

export function tamTinh(ds: readonly DongDon[]): number {
  return ds.reduce((s, d) => s + thanhTien(d), 0);
}

export function timMaGiam(ma: string): MaGiam | undefined {
  return BANG_MA_GIAM.find((m) => m.ma === ma.trim().toUpperCase());
}

/** Số tiền được giảm (không âm, không vượt tạm tính). Mã lạ hoặc chưa đủ tối thiểu ⇒ 0. */
export function tienGiam(tamTinhTien: number, maGiam?: string): number {
  if (!maGiam) return 0;
  const m = timMaGiam(maGiam);
  if (!m || tamTinhTien < m.toiThieu) return 0;
  const giam = m.kieu === "phan-tram" ? Math.floor((tamTinhTien * m.giaTri) / 100) : m.giaTri;
  return Math.min(giam, tamTinhTien);
}

// ── Thuế VAT theo loại hàng ──────────────────────────────────────────────────────────────────────────
export const THUE_SUAT: Readonly<Record<LoaiHang, number>> = { "thuc-pham": 5, sach: 0, thuong: 10 };

export function thueDong(d: DongDon): number {
  return Math.round((thanhTien(d) * THUE_SUAT[d.loai]) / 100);
}

/** Thuế tính trên từng dòng TRƯỚC giảm giá (quy ước của cửa hàng), cộng lại. */
export function tongThue(ds: readonly DongDon[]): number {
  return ds.reduce((s, d) => s + thueDong(d), 0);
}

// ── Định dạng và hoá đơn ─────────────────────────────────────────────────────────────────────────────
/** 1250000 -> "1.250.000 ₫". */
export function dinhDangVnd(soTien: number): string {
  const tri = Math.abs(Math.trunc(soTien));
  const nhom = String(tri).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${soTien < 0 ? "-" : ""}${nhom} ₫`;
}

export interface TongKet {
  tamTinh: number;
  giam: number;
  thue: number;
  phaiTra: number;
}

export function tongKet(ds: readonly DongDon[], maGiam?: string): TongKet {
  const tt = tamTinh(ds);
  const giam = tienGiam(tt, maGiam);
  const thue = tongThue(ds);
  return { tamTinh: tt, giam, thue, phaiTra: tt - giam + thue };
}

export function inHoaDon(ds: readonly DongDon[], maGiam?: string): string {
  const k = tongKet(ds, maGiam);
  const dong = ds.map((d) => `${d.ma} x${d.soLuong}: ${dinhDangVnd(thanhTien(d))}`);
  dong.push(`Tạm tính: ${dinhDangVnd(k.tamTinh)}`);
  if (k.giam > 0) dong.push(`Giảm (${maGiam!.trim().toUpperCase()}): -${dinhDangVnd(k.giam)}`);
  dong.push(`Thuế VAT: ${dinhDangVnd(k.thue)}`);
  dong.push(`Phải trả: ${dinhDangVnd(k.phaiTra)}`);
  return dong.join("\n");
}
