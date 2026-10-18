import { boDau, chuanHoaTen } from "./vanBan.mjs";

const soMa = (a, b) => (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0);

export class KhoSach {
  #sach = new Map();

  them({ ma, ten, tacGia = "", soBan = 1 }) {
    if (!ma) throw new Error("Thiếu mã sách");
    if (this.#sach.has(ma)) throw new Error(`Trùng mã sách: ${ma}`);
    if (!Number.isInteger(soBan) || soBan < 1) throw new RangeError("soBan phải là số nguyên ≥ 1");
    const s = { ma, ten: chuanHoaTen(ten), tacGia: chuanHoaTen(tacGia), soBan };
    this.#sach.set(ma, s);
    return { ...s };
  }

  lay(ma) {
    const s = this.#sach.get(ma);
    return s ? { ...s } : null;
  }

  /** Sách có tên chứa từ khoá (không phân biệt hoa thường, không phân biệt dấu), theo thứ tự của `danhSach()`. */
  timTheoTen(tuKhoa) {
    const k = boDau(chuanHoaTen(tuKhoa)).toLowerCase();
    return this.danhSach().filter((s) => boDau(s.ten).toLowerCase().includes(k));
  }

  /** Mọi sách, xếp theo tên kiểu tiếng Việt (không phân biệt hoa thường); trùng tên thì theo mã. */
  danhSach() {
    return [...this.#sach.values()]
      .map((s) => ({ ...s }))
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi", { sensitivity: "base" }) || soMa(a, b));
  }
}
