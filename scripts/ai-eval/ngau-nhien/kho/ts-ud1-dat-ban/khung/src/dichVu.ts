import { LoiNghiepVu } from "./kieu.ts";
import type { Ban, CauHinhNhaHang, DatBan, KhoDatBan, YeuCauDat } from "./kieu.ts";

export class DichVuDatBan {
  constructor(kho: KhoDatBan, cauHinh: CauHinhNhaHang = { moCua: "10:00", dongCua: "22:00" }) {
    throw new LoiNghiepVu("DU_LIEU_SAI", "chưa làm");
  }

  themBan(ban: Ban): Ban {
    throw new Error("chưa làm");
  }

  datBan(yc: YeuCauDat): DatBan {
    throw new Error("chưa làm");
  }

  huyDat(id: string): DatBan {
    throw new Error("chưa làm");
  }

  lichBan(maBan: string, ngay: string): DatBan[] {
    throw new Error("chưa làm");
  }

  banTrong(ngay: string, gio: string, soPhut: number, soKhach: number): string[] {
    throw new Error("chưa làm");
  }
}
