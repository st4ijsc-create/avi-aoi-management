import { congNgay, dinhDangNgay, soNgayGiua } from "./tienIch.mjs";
import { tinhPhat } from "./phat.mjs";

export class QuanLyMuon {
  #kho;
  #soNgayMuon;
  #phat;
  #phieu = new Map();
  #dem = 0;

  constructor(khoSach, { soNgayMuon = 14, phat = {} } = {}) {
    this.#kho = khoSach;
    this.#soNgayMuon = soNgayMuon;
    this.#phat = phat;
  }

  #soDangMuon(maSach) {
    let n = 0;
    for (const p of this.#phieu.values()) if (p.maSach === maSach && !p.ngayTra) n++;
    return n;
  }

  /** Mượn một bản. Hạn trả = ngày mượn + `soNgayMuon` ngày. */
  muon(maSach, nguoiMuon, ngayMuon) {
    const s = this.#kho.lay(maSach);
    if (!s) throw new Error(`Không có sách: ${maSach}`);
    if (this.#soDangMuon(maSach) >= s.soBan) throw new Error(`Hết bản để mượn: ${maSach}`);
    const p = {
      id: `P${++this.#dem}`,
      maSach,
      nguoiMuon,
      ngayMuon: dinhDangNgay(ngayMuon),
      hanTra: dinhDangNgay(congNgay(ngayMuon, this.#soNgayMuon)),
      ngayTra: null,
    };
    this.#phieu.set(p.id, p);
    return { ...p };
  }

  /** Trả sách. `soNgayTre` = số ngày sau hạn trả (trả đúng hạn hoặc sớm ⇒ 0); `tienPhat` theo `tinhPhat`. */
  tra(id, ngayTra) {
    const p = this.#phieu.get(id);
    if (!p) throw new Error(`Không có phiếu: ${id}`);
    if (p.ngayTra) throw new Error(`Phiếu đã trả: ${id}`);
    p.ngayTra = dinhDangNgay(ngayTra);
    p.soNgayTre = Math.max(0, soNgayGiua(new Date(p.hanTra), ngayTra));
    p.tienPhat = tinhPhat(p.soNgayTre, this.#phat);
    return { ...p };
  }

  /** Tổng tiền phạt các phiếu ĐÃ TRẢ của một người. */
  tongPhat(nguoiMuon) {
    let t = 0;
    for (const p of this.#phieu.values()) if (p.nguoiMuon === nguoiMuon && p.ngayTra) t += p.tienPhat;
    return t;
  }

  dangMuon(nguoiMuon) {
    return [...this.#phieu.values()].filter((p) => p.nguoiMuon === nguoiMuon && !p.ngayTra).map((p) => ({ ...p }));
  }
}
