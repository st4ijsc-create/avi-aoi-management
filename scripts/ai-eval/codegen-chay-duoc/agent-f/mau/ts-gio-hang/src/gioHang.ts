import { timSanPham } from "./sanPham.ts";
import type { SanPham } from "./sanPham.ts";
import { tinhGiam } from "./maGiamGia.ts";
import type { MaGiamGia } from "./maGiamGia.ts";

export interface DongGio {
  ma: string;
  ten: string;
  donGia: number;
  soLuong: number;
  thanhTien: number;
}

export class GioHang {
  #dong = new Map<string, { sp: SanPham; soLuong: number }>();
  #ma: MaGiamGia | null = null;

  them(ma: string, soLuong = 1): void {
    if (!Number.isInteger(soLuong) || soLuong <= 0) {
      throw new RangeError(`Số lượng không hợp lệ: ${soLuong}`);
    }
    const sp = timSanPham(ma);
    if (!sp) throw new Error(`Không có sản phẩm ${ma}`);
    const hienCo = this.#dong.get(ma);
    this.#dong.set(ma, { sp, soLuong: (hienCo?.soLuong ?? 0) + soLuong });
  }

  /** Đặt lại số lượng; 0 = bỏ khỏi giỏ. */
  capNhat(ma: string, soLuong: number): void {
    if (!Number.isInteger(soLuong) || soLuong < 0) {
      throw new RangeError(`Số lượng không hợp lệ: ${soLuong}`);
    }
    const dong = this.#dong.get(ma);
    if (!dong) throw new Error(`Giỏ không có ${ma}`);
    if (soLuong === 0) this.#dong.delete(ma);
    else dong.soLuong = soLuong;
  }

  xoa(ma: string): void {
    this.#dong.delete(ma);
  }

  cacDong(): DongGio[] {
    return [...this.#dong.values()].map(({ sp, soLuong }) => ({
      ma: sp.ma,
      ten: sp.ten,
      donGia: sp.gia,
      soLuong,
      thanhTien: sp.gia * soLuong,
    }));
  }

  tongSoLuong(): number {
    return this.cacDong().reduce((s, d) => s + d.soLuong, 0);
  }

  /** Tổng trước giảm giá. */
  tamTinh(): number {
    return this.cacDong().reduce((s, d) => s + d.thanhTien, 0);
  }

  /** Áp mã giảm giá; giỏ chỉ giữ một mã, mã mới thay mã cũ. */
  apDungMa(ma: MaGiamGia): void {
    if (ma.loai === "phan-tram") tinhGiam(ma, 0); // kiểm hợp lệ sớm
    this.#ma = ma;
  }

  boMa(): void {
    this.#ma = null;
  }

  maDangApDung(): MaGiamGia | null {
    return this.#ma;
  }

  tienGiam(): number {
    return this.#ma ? tinhGiam(this.#ma, this.tamTinh()) : 0;
  }

  /** Tổng phải trả = tạm tính − tiền giảm. */
  tongTien(): number {
    return this.tamTinh() - this.tienGiam();
  }
}
