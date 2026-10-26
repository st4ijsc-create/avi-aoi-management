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
  | "NGOAI_VUOT_TRAN"
  | "NGOAI_DEM_HONG"
  | "NGOAI_SO_HONG"
  | "NGOAI_CHE_HONG"
  | "NGOAI_TOOL_KHONG_CAP"
  | "NGOAI_KHOA_KHONG_HOP_LE"
  | "NGOAI_NHA_CUNG_CAP_LOI"
  | "NGOAI_MODEL_KHONG_HOP_LE"
  | "NGOAI_LUONG_TOAN_CUC"
  | "NGOAI_TU_DUYET_VAN_HANH";

export class LoiNgoai extends Error {
  constructor(
    readonly ma: MaLoiNgoai,
    readonly chiTiet?: string,
  ) {
    super(chiTiet ? `${ma}: ${chiTiet}` : ma);
    this.name = "LoiNgoai";
  }
}

/** Mã tRPC tương ứng (NOT_FOUND cho "không có / ngoài phạm vi" — không lộ sự tồn tại). */
export function maTrpcCua(ma: MaLoiNgoai): "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE" | "BAD_GATEWAY" | "PAYLOAD_TOO_LARGE" {
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
      return "SERVICE_UNAVAILABLE";
    case "NGOAI_NHA_CUNG_CAP_LOI":
      return "BAD_GATEWAY";
    case "NGOAI_DU_LIEU_VAN_HANH":
    case "NGOAI_LUONG_TOAN_CUC":
    case "NGOAI_TU_DUYET_VAN_HANH":
      return "FORBIDDEN";
    default:
      return "BAD_REQUEST";
  }
}
