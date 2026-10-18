/**
 * ★ Đợt 4B-server — BẢNG MÃ TỪ CHỐI token người dùng (`avgw_…`), MỘT chủ cho mọi bề mặt nhận token: cổng `/v1`
 * (`routes/openaiGateway.ts`) và các tuyến REST Bearer (`routes/aiGatewayTokenBearerApi.ts`). Hai bản sao của bảng này
 * là cách một client (extension) nhận hai mã khác nhau cho cùng một lý do. Module LÁ: 0 I/O.
 */
import type { MaTuChoiToken } from "../../../db/aiGatewayTokens";

/** Lý do ⇒ [HTTP, `error.code` máy đọc, câu tiếng Anh chuẩn OpenAI]. Client hành động khác nhau theo từng mã. */
export const TU_CHOI_TOKEN: Readonly<Record<MaTuChoiToken, [number, string, string]>> = {
  "khong-hop-le": [401, "invalid_api_key", "Invalid API token."],
  "het-han": [401, "token_expired", "API token expired. Create a new one or sign the device in again."],
  "thu-hoi": [401, "token_revoked", "API token has been revoked."],
  "tai-khoan-tat": [403, "account_disabled", "The account owning this token is disabled."],
  // Rà bảo mật de591c868 #2 — tài khoản đang bị buộc đổi mật khẩu (bí mật bị coi là lộ) ⇒ token bị chặn tới khi đổi.
  "phai-doi-mat-khau": [403, "password_change_required", "The account owning this token must change its password first."],
  csdl: [503, "auth_backend_unavailable", "Token verification backend unavailable."],
};

/** `type` của khung lỗi OpenAI theo mã HTTP (401/400 ⇒ invalid_request_error · 403 ⇒ permission_error · 503 ⇒ server_error). */
export function loaiLoiTheoMa(ma: number): string {
  return ma === 503 ? "server_error" : ma === 403 ? "permission_error" : "invalid_request_error";
}
