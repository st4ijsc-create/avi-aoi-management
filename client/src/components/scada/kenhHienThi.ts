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

// ─── R1a Task 14 — khuôn hiển thị `displayFormat` của kênh (M4 faceplate / M5 hộp thoại lệnh) ───────────────────────────────
/**
 * Khuôn hiển thị của kênh (cột `displayFormat`, khai ở M12):
 *   `bool:Tắt,Bật` ⇒ hai nhãn [false, true]; `enum:A,B,C` ⇒ mỗi giá trị một nhãn (kênh số: chỉ số 0..n-1 · kênh chuỗi: chính nhãn);
 *   `0.00` ⇒ số với đúng 2 chữ thập phân. Không khai / khuôn lạ ⇒ theo `dataType` (bool ⇒ nhãn mặc định của i18n: `nhan: null`).
 * Quyết định T14 (chưa có định nghĩa ở máy chủ): enum trên kênh số gửi CHỈ SỐ; trên kênh chuỗi gửi NHÃN. Máy chủ vẫn ép + kiểm.
 */
export type DinhDangKenh =
  | { kieu: "so"; soLe: number | null }
  | { kieu: "bool"; nhan: [string, string] | null }
  | { kieu: "enum"; nhan: string[] }
  | { kieu: "chuoi" };

const KHUON_SO = /^0(?:\.(0+))?$/;

export function phanTichDinhDang(fmt: string | null | undefined, dataType: string): DinhDangKenh {
  const f = (fmt ?? "").trim();
  if (f.startsWith("bool:")) {
    const nhan = f.slice(5).split(",").map((s) => s.trim());
    if (nhan.length === 2 && nhan[0] && nhan[1]) return { kieu: "bool", nhan: [nhan[0], nhan[1]] };
  }
  if (f.startsWith("enum:")) {
    const nhan = f.slice(5).split(",").map((s) => s.trim()).filter(Boolean);
    if (nhan.length > 0) return { kieu: "enum", nhan };
  }
  if (dataType === "bool") return { kieu: "bool", nhan: null };
  if (dataType === "int" || dataType === "float") {
    const m = KHUON_SO.exec(f);
    return { kieu: "so", soLe: m ? (m[1]?.length ?? 0) : null };
  }
  return { kieu: "chuoi" };
}

const laDung = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const laSai = (v: unknown) => v === false || v === 0 || v === "0" || v === "false";

/** Giá trị của nút enum thứ `i` theo kiểu dữ liệu (kênh số ⇒ chỉ số; còn lại ⇒ nhãn). */
export function giaTriEnum(dataType: string, nhan: string[], i: number): number | string {
  return dataType === "int" || dataType === "float" ? i : nhan[i];
}

/** Chỉ số nhãn enum ứng với một giá trị (số ⇒ chỉ số; chuỗi ⇒ trùng nhãn); không khớp ⇒ -1. */
export function chiSoEnum(v: unknown, nhan: string[]): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < nhan.length) return v;
  if (typeof v === "string") {
    const i = nhan.indexOf(v);
    if (i >= 0) return i;
    if (/^\d+$/.test(v) && Number(v) < nhan.length) return Number(v);
  }
  return -1;
}

/**
 * Chữ hiển thị của một giá trị theo khuôn kênh + ngôn ngữ. null / vắng ⇒ "—". `nhanBool` = nhãn mặc định [false, true] khi khuôn bool
 * không khai nhãn. Giá trị không khớp khuôn (enum ngoài dải, bool lạ) ⇒ in nguyên giá trị (không đoán).
 */
export function dinhDangGiaTri(v: unknown, dd: DinhDangKenh, locale: string, nhanBool?: [string, string]): string {
  if (v === null || v === undefined) return "—";
  switch (dd.kieu) {
    case "bool": {
      const nhan = dd.nhan ?? nhanBool;
      if (nhan && laDung(v)) return nhan[1];
      if (nhan && laSai(v)) return nhan[0];
      break;
    }
    case "enum": {
      const i = chiSoEnum(v, dd.nhan);
      if (i >= 0) return dd.nhan[i];
      break;
    }
    case "so": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) break;
      if (dd.soLe === null) return dinhDangSo(n, locale);
      try {
        return new Intl.NumberFormat(locale, { minimumFractionDigits: dd.soLe, maximumFractionDigits: dd.soLe }).format(n);
      } catch {
        return n.toFixed(dd.soLe);
      }
    }
    default:
      break;
  }
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
