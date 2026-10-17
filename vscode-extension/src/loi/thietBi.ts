/**
 * ★★★ ĐỢT 4B — DEVICE FLOW (THUẦN): diễn dịch hai đáp ứng của máy chủ (`server/routes/aiGatewayTokenThietBi.ts`).
 *
 *   POST /api/ai/gateway-token/thiet-bi      ⇒ {device_code, user_code, verification_path, verification_path_complete,
 *                                                expires_in, interval}
 *   POST /api/ai/gateway-token/thiet-bi/doi  ⇒ 400 {error: authorization_pending | slow_down | access_denied |
 *                                                expired_token | invalid_grant} · 409 token_limit_reached · 503
 *                                              ⇒ 200 {access_token: "avgw_…", token_type, scope, expires_at, token_prefix}
 *
 * ⚠ Máy chủ CỐ Ý không trả URL tuyệt đối (chống chèn Host) — extension ghép `verification_path_complete` vào ĐÚNG
 *   địa chỉ máy chủ nó đang gọi. Đường do máy chủ trả phải là đường TƯƠNG ĐỐI bắt đầu bằng "/" (không "//", không
 *   scheme) — một đáp ứng lạ không được biến thành một URL trỏ sang máy khác.
 * ⚠ Token là BÍ MẬT: chỉ nằm trong SecretStorage (khoá `KHOA_TOKEN_GATEWAY`), không bao giờ vào settings/globalState/log.
 */

/** Khoá SecretStorage của token cổng `/v1` (avgw_…). */
export const KHOA_TOKEN_GATEWAY = "aviAiLocal.tokenGateway";
/** Siêu dữ liệu KHÔNG bí mật của token (tiền tố hiển thị + hạn) — globalState, chỉ để hiển thị. */
export const KHOA_THONG_TIN_TOKEN = "aviAiLocal.thongTinToken";
export const TIEN_TO_TOKEN_GATEWAY = "avgw_";
/** Phạm vi xin: `chat` (agent) + `fim` (ghost-text, việc sau) — máy chủ chuẩn hoá lại. */
export const PHAM_VI_XIN = ["chat", "fim"] as const;

export interface MaThietBi {
  maThietBi: string;
  maNguoiDung: string;
  /** Đường tương đối (đã kiểm) tới trang xác nhận, kèm `?ma=`. */
  duongXacNhan: string;
  hetHanGiay: number;
  chuKyGiay: number;
}

export type KetQuaXinMa = { ok: true; ma: MaThietBi } | { ok: false; lyDo: string };

const laDuongTuongDoiAnToan = (s: unknown): s is string =>
  typeof s === "string" && s.startsWith("/") && !s.startsWith("//") && !/[\\\s]/.test(s) && !/^\/[a-z]+:/i.test(s);

export function docPhanHoiXinMa(status: number, than: unknown): KetQuaXinMa {
  const o = than && typeof than === "object" ? (than as Record<string, unknown>) : {};
  if (status === 429) return { ok: false, lyDo: "Máy chủ đang chặn vì xin mã quá nhiều lần — đợi một phút rồi thử lại." };
  if (status !== 200) {
    const loi = typeof o.error === "string" ? o.error : "";
    if (status === 404) return { ok: false, lyDo: "Máy chủ chưa có đường device flow (bản máy chủ cũ hoặc thiếu giấy phép AI)." };
    return { ok: false, lyDo: `Máy chủ trả ${status}${loi ? ` (${loi})` : ""} khi xin mã thiết bị.` };
  }
  const maThietBi = o.device_code;
  const maNguoiDung = o.user_code;
  if (typeof maThietBi !== "string" || maThietBi.length < 16 || typeof maNguoiDung !== "string" || !maNguoiDung) {
    return { ok: false, lyDo: "Đáp ứng xin mã thiết bị thiếu device_code/user_code." };
  }
  // ⚠ Rà bảo mật máy chủ de591c868 #3 (lừa đảo mã thiết bị, RFC 8628 §5.4): trang duyệt KHÔNG điền sẵn mã, người
  //   dùng phải GÕ mã đang hiện trong VSCode của chính họ ⇒ extension KHÔNG tự gắn `?ma=` vào đường (dùng nguyên đường
  //   máy chủ trả) và hiện mã thật rõ để người gõ.
  const duong = laDuongTuongDoiAnToan(o.verification_path_complete)
    ? o.verification_path_complete
    : laDuongTuongDoiAnToan(o.verification_path)
      ? o.verification_path
      : null;
  if (!duong) return { ok: false, lyDo: "Đáp ứng xin mã thiết bị có đường xác nhận không hợp lệ (không phải đường tương đối)." };
  const so = (v: unknown, macDinh: number, toiThieu: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= toiThieu ? Math.floor(v) : macDinh;
  return {
    ok: true,
    ma: { maThietBi, maNguoiDung, duongXacNhan: duong, hetHanGiay: so(o.expires_in, 600, 1), chuKyGiay: so(o.interval, 5, 1) },
  };
}

export type KetQuaDoiMa =
  | { loai: "xong"; token: string; hetHanLuc?: string; tienTo?: string }
  | { loai: "cho" }
  | { loai: "cham-lai" }
  | { loai: "tu-choi" }
  | { loai: "het-han" }
  | { loai: "loi"; lyDo: string; tamThoi: boolean };

export function docPhanHoiDoiMa(status: number, than: unknown): KetQuaDoiMa {
  const o = than && typeof than === "object" ? (than as Record<string, unknown>) : {};
  if (status === 200) {
    const token = o.access_token;
    if (typeof token !== "string" || !token.startsWith(TIEN_TO_TOKEN_GATEWAY)) {
      return { loai: "loi", lyDo: "Máy chủ trả token không đúng khuôn avgw_….", tamThoi: false };
    }
    return {
      loai: "xong",
      token,
      ...(typeof o.expires_at === "string" ? { hetHanLuc: o.expires_at } : {}),
      ...(typeof o.token_prefix === "string" ? { tienTo: o.token_prefix } : {}),
    };
  }
  const loi = typeof o.error === "string" ? o.error : "";
  if (loi === "authorization_pending") return { loai: "cho" };
  if (loi === "slow_down") return { loai: "cham-lai" };
  if (loi === "access_denied") return { loai: "tu-choi" };
  if (loi === "expired_token") return { loai: "het-han" };
  if (loi === "invalid_grant") return { loai: "loi", lyDo: "Mã thiết bị không hợp lệ hoặc đã dùng — bắt đầu lại.", tamThoi: false };
  if (loi === "token_limit_reached")
    return { loai: "loi", lyDo: "Tài khoản đã có quá nhiều token còn hiệu lực — thu hồi bớt ở trang /ai-thiet-bi rồi thử lại.", tamThoi: false };
  if (status === 503 || status >= 500) return { loai: "loi", lyDo: `Máy chủ tạm lỗi (${status}).`, tamThoi: true };
  return { loai: "loi", lyDo: `Máy chủ trả ${status}${loi ? ` (${loi})` : ""} khi đổi mã.`, tamThoi: false };
}

/** Tên thiết bị gửi lên (máy chủ chuẩn hoá/cắt) — không chứa bí mật. */
export function tenThietBi(may: string, phienBan: string): string {
  return `VSCode AI Local ${phienBan} — ${may}`.slice(0, 80);
}
