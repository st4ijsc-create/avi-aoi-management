import type { BoLoc, CapNhatViec, Viec, ViecMoi } from "./kieu.ts";

export class KhoViec {
  them(m: ViecMoi): Viec {
    throw new Error("chưa làm");
  }

  lay(id: number): Viec | undefined {
    throw new Error("chưa làm");
  }

  ds(loc: BoLoc = {}): Viec[] {
    throw new Error("chưa làm");
  }

  capNhat(id: number, thayDoi: CapNhatViec): Viec | undefined {
    throw new Error("chưa làm");
  }

  xoa(id: number): boolean {
    throw new Error("chưa làm");
  }
}
