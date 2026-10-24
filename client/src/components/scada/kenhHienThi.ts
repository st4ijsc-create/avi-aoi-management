/**
 * SCADA R1a Task 13 — quy tắc HIỂN THỊ thuần của M12 (`/scada/config/channels`): khoá i18n của 9 lý do `cheDoMay`, tông màu theo lý do,
 * mức tác động hiển thị, định dạng số theo ngôn ngữ, ép giá trị REMOTE theo kiểu dữ liệu của tag. Không React, không i18n ở đây (trả KHOÁ).
 */
import type { LoaiKenh } from "../../../../server/services/scada/kenhScada";
import type { ToneTrangThai } from "./chatLuongHienThi";

export type LyDoCheDo =
  | "remote"
  | "chua_khai"
  | "bo_dem_tat"
  | "chua_co_mau"
  | "chat_luong_xau"
  | "cu"
  | "khac_remote"
  | "loi_doc"
  | "kenh_sai_may";

/** Khoá i18n (`scada.kenh.cheDo.*`) của từng lý do. Bản đồ ĐẦY ĐỦ theo kiểu (thêm lý do ở máy chủ mà quên ở đây ⇒ tsc đỏ). */
export const KHOA_LY_DO: Record<LyDoCheDo, string> = {
  remote: "scada.kenh.cheDo.remote",
  chua_khai: "scada.kenh.cheDo.chuaKhai",
  bo_dem_tat: "scada.kenh.cheDo.boDemTat",
  chua_co_mau: "scada.kenh.cheDo.chuaCoMau",
  chat_luong_xau: "scada.kenh.cheDo.chatLuongXau",
  cu: "scada.kenh.cheDo.cu",
  khac_remote: "scada.kenh.cheDo.khacRemote",
  loi_doc: "scada.kenh.cheDo.loiDoc",
  kenh_sai_may: "scada.kenh.cheDo.kenhSaiMay",
};

/**
 * Tông màu của chế độ: REMOTE = đồ hoạ thường; LOCAL do khai báo (chưa khai / giá trị khác REMOTE) = trung tính;
 * LOCAL do kênh KHÔNG ĐÁNG TIN (không có mẫu, mẫu xấu, cũ, lỗi đọc, bộ đệm tắt, sai máy) = cảnh báo vừa.
 */
export function toneCheDo(cheDo: "REMOTE" | "LOCAL", lyDo: string): ToneTrangThai {
  if (cheDo === "REMOTE") return "ok";
  return lyDo === "chua_khai" || lyDo === "khac_remote" ? "muted" : "warn";
}

const KENH_GHI: ReadonlySet<LoaiKenh> = new Set<LoaiKenh>(["input_output", "calculated_output", "output"]);
export const laLoaiKenhGhi = (k: LoaiKenh): boolean => KENH_GHI.has(k);

export type MucHienThi =
  | { kieu: "khai"; muc: number }
  | { kieu: "macDinhDong" }
  | { kieu: "khongApDung" };

/**
 * Mức tác động HIỂN THỊ — CHỈ định dạng, KHÔNG tự suy: con số luôn là `mucHieuLuc` do máy chủ trả (NULL ⇒ 5 là luật của máy chủ).
 * Kênh RA mà `actuationLevel` chưa khai (null) ⇒ "5 — mặc định đóng"; kênh vào / tính toán không nhận lệnh ghi và chưa khai ⇒ "—".
 */
export function mucHienThi(h: { actuationLevel: number | null; mucHieuLuc: number; loaiKenh: LoaiKenh }): MucHienThi {
  if (h.actuationLevel !== null && h.actuationLevel !== undefined) return { kieu: "khai", muc: h.mucHieuLuc };
  if (!laLoaiKenhGhi(h.loaiKenh)) return { kieu: "khongApDung" };
  return h.mucHieuLuc === 5 ? { kieu: "macDinhDong" } : { kieu: "khai", muc: h.mucHieuLuc };
}

/** Số theo ngôn ngữ giao diện (dấu thập phân); null ⇒ "—". */
export function dinhDangSo(v: number | null | undefined, locale: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v);
  } catch {
    return String(v);
  }
}

export type EpGiaTri = { ok: true; giaTri: number | boolean | string } | { ok: false };

/** Ép chuỗi người nhập về kiểu của tag (máy chủ ép lại bằng `kiemGiaTriGhi`; đây chỉ để gửi đúng kiểu + khoá nút khi hiển nhiên sai). */
export function epGiaTriRemote(dataType: string | null | undefined, nhap: string): EpGiaTri {
  const s = nhap.trim();
  if (s === "") return { ok: false };
  switch (dataType) {
    case "bool":
      if (s === "true" || s === "1") return { ok: true, giaTri: true };
      if (s === "false" || s === "0") return { ok: true, giaTri: false };
      return { ok: false };
    case "int":
      return /^-?\d+$/.test(s) ? { ok: true, giaTri: Number(s) } : { ok: false };
    case "float": {
      const n = Number(s);
      return Number.isFinite(n) ? { ok: true, giaTri: n } : { ok: false };
    }
    default:
      return { ok: true, giaTri: s };
  }
}

/** Số thập phân/khoa học hợp lệ, dấu "." (không hex, không "-", "1e" gõ dở, không dấu phẩy). */
const SO_NHAP = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Số trong ô nhập (đọc từ CHỮ THÔ, không từ `<input type=number>` vốn trả "" cho "-" / "1e" gõ dở): CHỈ ô người dùng thực sự xoá trắng
 * ("" / khoảng trắng) mới cho null (bỏ khai); chữ gõ dở hoặc không phải số ⇒ "loi" (khoá nút gửi, không lặng lẽ bỏ giới hạn).
 */
export function docSoNhap(s: string): number | null | "loi" {
  const t = s.trim();
  if (t === "") return null;
  if (!SO_NHAP.test(t)) return "loi";
  const n = Number(t);
  return Number.isFinite(n) ? n : "loi";
}
