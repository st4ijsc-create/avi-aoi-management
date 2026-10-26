/**
 * ★ Đợt 10.3 — nhà cung cấp GIẢ cho lưới: GHI LẠI mọi yêu cầu + khoá nhận được, trả kịch bản (chữ / toolCalls / lỗi). KHÔNG mạng.
 */
import { LoiNgoai } from "../loi";
import type { KetQuaNhaCungCap, NhaCungCapAi, YeuCauNhaCungCap } from "./kieu";

export type KichBanGia =
  | { kieu: "tra"; noiDung?: string; toolCalls?: KetQuaNhaCungCap["toolCalls"]; tokenVao?: number | null; tokenRa?: number | null }
  | { kieu: "loi"; thongDiep: string; thuLai?: boolean; chuaGui?: boolean };

export interface NhaCungCapGia extends NhaCungCapAi {
  nhan: Array<{ yc: YeuCauNhaCungCap; khoa: string }>;
  kichBan: KichBanGia[];
}

export function taoNhaCungCapGia(kichBan: KichBanGia[] = [{ kieu: "tra", noiDung: "ok" }], ma: NhaCungCapAi["ma"] = "anthropic"): NhaCungCapGia {
  const g: NhaCungCapGia = {
    ma,
    nhan: [],
    kichBan,
    async goi(yc, layKhoa) {
      const kb = g.kichBan[Math.min(g.nhan.length, g.kichBan.length - 1)]!;
      if (kb.kieu === "loi" && kb.chuaGui) throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", kb.thongDiep, { chuaGui: true });
      const khoa = await layKhoa();
      g.nhan.push({ yc: JSON.parse(JSON.stringify(yc)) as YeuCauNhaCungCap, khoa });
      if (kb.kieu === "loi") throw new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", kb.thongDiep, { thuLai: kb.thuLai === true });
      return { noiDung: kb.noiDung ?? "", toolCalls: kb.toolCalls ?? [], tokenVao: kb.tokenVao === undefined ? 10 : kb.tokenVao, tokenRa: kb.tokenRa === undefined ? 5 : kb.tokenRa };
    },
  };
  return g;
}
