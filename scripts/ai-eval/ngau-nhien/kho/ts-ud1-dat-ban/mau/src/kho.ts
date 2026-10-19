import type { Ban, DatBan, KhoDatBan } from "./kieu.ts";

export class KhoBoNho implements KhoDatBan {
  #ban = new Map<string, Ban>();
  #dat = new Map<string, DatBan>();

  layBan(ma: string): Ban | undefined {
    const b = this.#ban.get(ma);
    return b && { ...b };
  }

  dsBan(): Ban[] {
    return [...this.#ban.values()].map((b) => ({ ...b }));
  }

  luuBan(ban: Ban): void {
    this.#ban.set(ban.ma, { ...ban });
  }

  layDat(id: string): DatBan | undefined {
    const d = this.#dat.get(id);
    return d && { ...d };
  }

  dsDat(): DatBan[] {
    return [...this.#dat.values()].map((d) => ({ ...d }));
  }

  luuDat(dat: DatBan): void {
    this.#dat.set(dat.id, { ...dat });
  }
}
