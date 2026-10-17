import { congNgay, dinhDangNgay, soNgayGiua } from "./tienIch.mjs";

export class QuanLyMuon {
  #kho;
  #soNgayMuon;
  #phieu = new Map();
  #dem = 0;

  constructor(khoSach, { soNgayMuon = 14 } = {}) {
    this.#kho = khoSach;
    this.#soNgayMuon = soNgayMuon;
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

  /** Trả sách. `soNgayTre` = số ngày sau hạn trả (trả đúng hạn hoặc sớm ⇒ 0). */
  tra(id, ngayTra) {
    const p = this.#phieu.get(id);
    if (!p) throw new Error(`Không có phiếu: ${id}`);
    if (p.ngayTra) throw new Error(`Phiếu đã trả: ${id}`);
    p.ngayTra = dinhDangNgay(ngayTra);
    p.soNgayTre = Math.max(0, soNgayGiua(new Date(p.hanTra), ngayTra));
    return { ...p };
  }

  dangMuon(nguoiMuon) {
    return [...this.#phieu.values()].filter((p) => p.nguoiMuon === nguoiMuon && !p.ngayTra).map((p) => ({ ...p }));
  }
}
