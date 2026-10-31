/**
 * ★ Đợt 10.3 — lỗi có MÃ của cổng AI ngoài. Thông điệp KHÔNG BAO GIỜ chứa khoá / nội dung chưa che (lỗi nhà cung cấp đi qua
 * `cheChuoi` trước khi thành `chiTiet`). Thủ tục tRPC đổi mã ⇒ HTTP bằng `maTrpcCua`.
 */
export type MaLoiNgoai =
  | "NGOAI_TAT"
  | "NGOAI_KHONG_TON_TAI"
  | "NGOAI_CAM_DINH_KEM"
  | "NGOAI_DU_LIEU_VAN_HANH"
  | "NGOAI_QUA_LON"
  | "NGOAI_PHAN_HOI_QUA_LON"
  | "NGOAI_VUOT_TRAN"
  | "NGOAI_DEM_HONG"
  | "NGOAI_SO_HONG"
  | "NGOAI_CHE_HONG"
  | "NGOAI_TOOL_KHONG_CAP"
  | "NGOAI_KHOA_KHONG_HOP_LE"
  | "NGOAI_NHA_CUNG_CAP_LOI"
  | "NGOAI_MODEL_KHONG_HOP_LE"
  | "NGOAI_URL_KHONG_HOP_LE"
  | "NGOAI_LUONG_TOAN_CUC"
  | "NGOAI_TU_DUYET_VAN_HANH"
  | "NGOAI_CHUA_DUYET"
  /** ★ 10.4 — kết quả kiểm định của model ngoài sai định dạng (sau MỘT lần thử lại). */
  | "NGOAI_SAI_SCHEMA"
  /** ★ 10.4 — cùng một yêu cầu kiểm định đang chạy (chống bấm đúp — mỗi lần gọi là tiền thật). */
  | "NGOAI_DANG_CHAY"
  /** ★ 10.4b L0a — `tinNhan` không do bộ dựng `ghepPhan` tạo (lỗi LẬP TRÌNH phía máy chủ — không bao giờ do người dùng). */
  | "NGOAI_KHONG_QUA_BO_GHEP";

/**
 * ★ Đợt 12 H3.1 — loại lỗi của NHÀ CUNG CẤP (ổn định, không phụ thuộc chữ thông điệp) — quyết định thử lại và cho UI nói đúng:
 *   QUOTA (hết hạn mức / tín dụng — KHÔNG thử lại: thử lại chỉ giữ chỗ ngân sách lần nữa) · RATE_LIMIT (tạm — thử lại sau `Retry-After`) ·
 *   EMPTY_RESPONSE · TIMEOUT · TRANSPORT (đứt sau khi đã kết nối) · CONTEXT_WINDOW_EXCEEDED (KHÔNG thử lại — cùng yêu cầu sẽ lại tràn) ·
 *   AUTH (khoá sai / bị thu hồi — không thử lại) · SERVER (5xx / quá tải) · CLIENT (4xx khác — không thử lại).
 */
export const PHAN_LOAI_LOI_NGOAI = ["QUOTA", "RATE_LIMIT", "EMPTY_RESPONSE", "TIMEOUT", "TRANSPORT", "CONTEXT_WINDOW_EXCEEDED", "AUTH", "SERVER", "CLIENT"] as const;
export type PhanLoaiLoiNgoai = (typeof PHAN_LOAI_LOI_NGOAI)[number];

export class LoiNgoai extends Error {
  /** Chắc chắn yêu cầu CHƯA rời máy (lỗi trước khi gửi) ⇒ cổng hoàn TOÀN BỘ chỗ đã giữ. */
  readonly chuaGui: boolean;
  /** Lỗi tạm (429 / 5xx / mạng) ⇒ cổng được thử lại (mỗi lần thử giữ chỗ lại). */
  readonly thuLai: boolean;
  /** (H3.1) loại lỗi nhà cung cấp — vắng với lỗi của chính cổng (trần, mức, sổ…). */
  readonly phanLoai?: PhanLoaiLoiNgoai;
  /** (H3.1) nhà cung cấp xin chờ (`Retry-After`, ms) trước lần thử sau. */
  readonly choMs?: number;
  constructor(
    readonly ma: MaLoiNgoai,
    readonly chiTiet?: string,
    co: { chuaGui?: boolean; thuLai?: boolean; phanLoai?: PhanLoaiLoiNgoai; choMs?: number } = {},
  ) {
    super(chiTiet ? `${ma}: ${chiTiet}` : ma);
    this.name = "LoiNgoai";
    this.chuaGui = co.chuaGui === true;
    this.thuLai = co.thuLai === true;
    if (co.phanLoai) this.phanLoai = co.phanLoai;
    if (typeof co.choMs === "number" && Number.isFinite(co.choMs) && co.choMs >= 0) this.choMs = Math.trunc(co.choMs);
  }
}

/** Mã tRPC tương ứng (NOT_FOUND cho "không có / ngoài phạm vi" — không lộ sự tồn tại). */
export function maTrpcCua(ma: MaLoiNgoai): "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE" | "BAD_GATEWAY" | "PAYLOAD_TOO_LARGE" | "CONFLICT" {
  switch (ma) {
    case "NGOAI_TAT":
    case "NGOAI_KHONG_TON_TAI":
      return "NOT_FOUND";
    case "NGOAI_QUA_LON":
      return "PAYLOAD_TOO_LARGE";
    case "NGOAI_VUOT_TRAN":
      return "TOO_MANY_REQUESTS";
    case "NGOAI_DEM_HONG":
    case "NGOAI_SO_HONG":
    case "NGOAI_CHE_HONG":
    case "NGOAI_KHONG_QUA_BO_GHEP":
      return "SERVICE_UNAVAILABLE";
    case "NGOAI_NHA_CUNG_CAP_LOI":
    case "NGOAI_PHAN_HOI_QUA_LON":
    case "NGOAI_SAI_SCHEMA":
      return "BAD_GATEWAY";
    case "NGOAI_DANG_CHAY":
      return "CONFLICT";
    case "NGOAI_DU_LIEU_VAN_HANH":
    case "NGOAI_LUONG_TOAN_CUC":
    case "NGOAI_TU_DUYET_VAN_HANH":
    case "NGOAI_CHUA_DUYET":
      return "FORBIDDEN";
    default:
      return "BAD_REQUEST";
  }
}
