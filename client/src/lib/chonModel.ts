/**
 * Đợt 10.2 — "chọn model theo yêu cầu" phía CLIENT: kiểu danh mục, lưu lựa chọn dính theo bề mặt, xác thực với danh mục, nhóm hiển thị. THUẦN (trừ localStorage có try/catch).
 * Hợp đồng máy chủ: `server/services/ai/chonModel/kieu.ts` — mã `auto | vai-tro:<id> | ho-so:<profileId> | ngoai:<ncc>:<model>`. Client KHÔNG tự dựng mã `ngoai:*` (chỉ lấy từ danh mục
 * máy chủ trả — máy chủ chỉ trả khi nhà máy đã bật). `auto` ⇒ KHÔNG gửi trường (không đổi một byte so với trước).
 */
export type LoaiMuc = "auto" | "vai-tro" | "ho-so" | "ngoai";
export type TrangThaiMuc = "san-sang" | "can-doi-khe" | "tat";
export interface MucModel {
  ma: string;
  loai: LoaiMuc;
  nhan: string;
  moTa: string;
  trangThai: TrangThaiMuc;
  uocTinhDoiKheGiay?: number;
  nhaCungCap?: string;
  /** ★ 10.4 T0 — bề mặt máy chủ PHỤC VỤ được mục này (chỉ điền cho `ngoai`). Thiếu ⇒ coi như [] (chưa phục vụ bề mặt nào). */
  duocDungO?: string[];
}
/** Bề mặt chọn: mỗi nơi nhớ lựa chọn RIÊNG (chat và lập trình cần model khác nhau). */
export type BeMatChon = "chat" | "lap-trinh" | "agent" | "luong";

/** Bản sao hình dạng hợp lệ của máy chủ (`CHON_MODEL_RE`) — census so khớp nguồn hai phía. */
export const CHON_MODEL_RE =
  /^(auto|vai-tro:[a-z][a-z0-9]*(\.[a-z0-9-]+)?|ho-so:[A-Za-z0-9._@-]{1,96}|ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:-]{1,96})$/;

/** Vai KHÔNG sinh chữ — ẩn khỏi mọi bề mặt hiện có (chat / lập trình / agent / node sinh chữ): máy chủ cũng từ chối (`beMatChu`). */
export const VAI_KHONG_SINH_CHU: ReadonlySet<string> = new Set(["embed", "rerank", "vision", "fim"]);

/** Tên bề mặt (BeMatChon) → giá trị `duocDungO` máy chủ khai. Mục `ngoai:*` chỉ hiện ở bề mặt mà máy chủ khai phục vụ (10.4 T0). */
export const DUOC_DUNG_O: Readonly<Record<BeMatChon, string>> = { chat: "chat", "lap-trinh": "coding", agent: "agent", luong: "luong" };

export const AUTO: MucModel = { ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" };

const khoa = (b: BeMatChon) => `aiChon.${b}`;

/** Lựa chọn đã lưu của bề mặt; hỏng / không có / sai hình dạng ⇒ "auto". */
export function docChonDaLuu(b: BeMatChon): string {
  try {
    const v = localStorage.getItem(khoa(b));
    return v && CHON_MODEL_RE.test(v) ? v : "auto";
  } catch {
    return "auto";
  }
}
export function luuChon(b: BeMatChon, ma: string): void {
  try {
    if (ma === "auto") localStorage.removeItem(khoa(b));
    else localStorage.setItem(khoa(b), ma);
  } catch {
    /* chế độ riêng tư / bị chặn — lựa chọn chỉ sống trong phiên */
  }
}

/** Mã đã lưu mà danh mục KHÔNG còn (hoặc đang `tat`) ⇒ phải về auto (trả `hetHieuLuc` để báo một lần). Danh mục chưa tải (rỗng) ⇒ giữ nguyên, chưa kết luận. */
export function xacThucChon(ma: string, danhMuc: readonly MucModel[]): { ma: string; hetHieuLuc: boolean } {
  if (ma === "auto" || danhMuc.length === 0) return { ma, hetHieuLuc: false };
  const m = danhMuc.find((x) => x.ma === ma);
  if (!m || m.trangThai === "tat") return { ma: "auto", hetHieuLuc: true };
  return { ma, hetHieuLuc: false };
}

/** Tập mục THẤY ĐƯỢC ở bề mặt (dùng cả để vẽ lẫn để kiểm mã đã lưu còn hợp lệ): auto + nhóm đã lọc. */
export function mucHienThi(danhMuc: readonly MucModel[], beMat: BeMatChon): MucModel[] {
  const n = nhomMuc(danhMuc, beMat);
  return [n.tuDong, ...n.vaiTro, ...n.hoSo, ...n.ngoai];
}

export interface NhomMuc {
  tuDong: MucModel;
  vaiTro: MucModel[];
  hoSo: MucModel[];
  ngoai: MucModel[];
}
/** Chia danh mục thành nhóm cho ô chọn của bề mặt. Vai không sinh chữ bị ẩn; mục `ngoai:*` chỉ hiện khi `duocDungO` chứa bề mặt này (thiếu ⇒ ẩn). Client không thêm gì ngoài danh mục. */
export function nhomMuc(danhMuc: readonly MucModel[], beMat: BeMatChon): NhomMuc {
  const tuDong = danhMuc.find((m) => m.loai === "auto") ?? AUTO;
  return {
    tuDong,
    vaiTro: danhMuc.filter((m) => m.loai === "vai-tro" && !VAI_KHONG_SINH_CHU.has(m.ma.slice("vai-tro:".length))),
    hoSo: danhMuc.filter((m) => m.loai === "ho-so"),
    ngoai: danhMuc.filter((m) => m.loai === "ngoai" && Array.isArray(m.duocDungO) && m.duocDungO.includes(DUOC_DUNG_O[beMat])),
  };
}

/** Hậu tố trạng thái hiển thị trong ô chọn: san-sang ⇒ rỗng; can-doi-khe ⇒ "cần đổi khe ~N s" hoặc "chưa đo"; tat ⇒ "tắt". `t` nhận khoá + mặc định + tham số. */
export function hauToTrangThai(m: MucModel, t: (k: string, def: string, o?: Record<string, unknown>) => string): string {
  if (m.trangThai === "san-sang") return "";
  if (m.trangThai === "tat") return t("chonModel.tat", "tắt");
  return m.uocTinhDoiKheGiay !== undefined
    ? t("chonModel.canDoiKhe", "cần đổi khe ~{{n}} s", { n: Math.round(m.uocTinhDoiKheGiay) })
    : t("chonModel.canDoiKheChuaDo", "cần đổi khe (chưa đo)");
}

/** Giá trị gửi lên máy chủ cho một lựa chọn: "auto" ⇒ undefined (KHÔNG gửi trường). */
export const chonModelGui = (ma: string): string | undefined => (ma === "auto" || !ma ? undefined : ma);

/**
 * Màn lập trình: đọc lựa chọn dính, DI TRÚ khoá cũ `repoWs.tangModel` ("code" ⇒ `vai-tro:code.software`; "auto" ⇒ auto) MỘT lần rồi xoá khoá cũ.
 * Khoá cũ chỉ phục vụ người đã chọn trước Đợt 10.2 — GỠ hàm di trú này khi extension 0.4.0 đã phát hành (dự kiến 2026-11-30).
 */
export function docChonLapTrinh(): string {
  const da = docChonDaLuu("lap-trinh");
  try {
    const cu = localStorage.getItem("repoWs.tangModel");
    if (cu === null) return da;
    localStorage.removeItem("repoWs.tangModel");
    if (da === "auto" && cu === "code") {
      luuChon("lap-trinh", "vai-tro:code.software");
      return "vai-tro:code.software";
    }
  } catch {
    /* chế độ riêng tư */
  }
  return da;
}
