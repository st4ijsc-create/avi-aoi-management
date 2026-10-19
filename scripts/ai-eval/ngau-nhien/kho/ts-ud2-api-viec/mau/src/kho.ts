import type { BoLoc, CapNhatViec, Viec, ViecMoi } from "./kieu.ts";

const sao = (v: Viec): Viec => ({ ...v, nhan: [...v.nhan] });

export class KhoViec {
  #viec = new Map<number, Viec>();
  #idKe = 1;

  them(m: ViecMoi): Viec {
    const v: Viec = { id: this.#idKe++, tieuDe: m.tieuDe, xong: m.xong, uuTien: m.uuTien, nhan: [...m.nhan] };
    this.#viec.set(v.id, v);
    return sao(v);
  }

  lay(id: number): Viec | undefined {
    const v = this.#viec.get(id);
    return v && sao(v);
  }

  ds(loc: BoLoc = {}): Viec[] {
    const q = loc.q?.toLowerCase();
    return [...this.#viec.values()]
      .filter((v) => loc.xong === undefined || v.xong === loc.xong)
      .filter((v) => loc.uuTien === undefined || v.uuTien === loc.uuTien)
      .filter((v) => !q || v.tieuDe.toLowerCase().includes(q))
      .sort((a, b) => a.id - b.id)
      .map(sao);
  }

  capNhat(id: number, thayDoi: CapNhatViec): Viec | undefined {
    const v = this.#viec.get(id);
    if (!v) return undefined;
    if (thayDoi.tieuDe !== undefined) v.tieuDe = thayDoi.tieuDe;
    if (thayDoi.xong !== undefined) v.xong = thayDoi.xong;
    if (thayDoi.uuTien !== undefined) v.uuTien = thayDoi.uuTien;
    if (thayDoi.nhan !== undefined) v.nhan = [...thayDoi.nhan];
    return sao(v);
  }

  xoa(id: number): boolean {
    return this.#viec.delete(id);
  }
}
