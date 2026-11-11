// Phân tích văn bản đơn.
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
