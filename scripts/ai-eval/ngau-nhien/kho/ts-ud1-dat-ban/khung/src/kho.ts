import type { Ban, DatBan, KhoDatBan } from "./kieu.ts";

export class KhoBoNho implements KhoDatBan {
  layBan(ma: string): Ban | undefined {
    throw new Error("chưa làm");
  }

  dsBan(): Ban[] {
    throw new Error("chưa làm");
  }

  luuBan(ban: Ban): void {
    throw new Error("chưa làm");
  }

  layDat(id: string): DatBan | undefined {
    throw new Error("chưa làm");
  }

  dsDat(): DatBan[] {
    throw new Error("chưa làm");
  }

  luuDat(dat: DatBan): void {
    throw new Error("chưa làm");
  }
}
