/**
 * Sprint 5 §4 — registry MÃ LỖI máy-đọc-được.
 *
 * File này KHÔNG import gì để client dùng lại được kiểu mà không kéo theo tRPC
 * server. Thêm mã mới ⇒ thêm vào đây TRƯỚC, tsc sẽ bắt mọi chỗ gõ sai.
 *
 * Quy ước đặt tên: DANH_TỪ_TÌNH_HUỐNG, không nêu tên router (mã phải dùng lại
 * được ở nhiều router — đó chính là lý do có nó).
 */
export const APP_ERROR_CODES = [
  // ── 9 họ phổ quát (§4.1) ──────────────────────────────────────────────────
  "DB_UNAVAILABLE",
  "ENTITY_NOT_FOUND",     // params: { entity }
  "ENTITY_DUPLICATE",     // params: { entity } — KHÔNG có `field`: không template i18n nào
                          // render {{field}} cho mã này. Đợt di trú trước quảng cáo `field?`
                          // trong comment này nhưng không ai từng hiện thực template — 12 chỗ
                          // gọi đã trót truyền field vô ích, dọn ở Task 4 (F5, doc 71).
  "SCOPE_MISMATCH",       // params: { entity, parent }
  "FIELD_REQUIRED",       // params: { field }
  "INVALID_VALUE",        // params: { field, reason? } — Task 5 (doc 71, F4) đã thêm `reason?`
                          // THẬT: khoá client `errors.INVALID_VALUE_WITH_REASON` (có {{reason}})
                          // chỉ được dùng khi `params.reason` là chuỗi khác rỗng — câu GỐC
                          // `errors.INVALID_VALUE` (không đổi) vẫn phục vụ mọi call site cũ chưa
                          // truyền `reason`. `reason` PHẢI là khoá camelCase vào `errors.reason.*`
                          // (client/src/lib/errorCodes.ts), KHÔNG phải câu tiếng Việt/Anh viết tay.
  "FEATURE_DISABLED",     // params: { feature }
  "OPERATION_FAILED",     // params: { operation, reason? } — cùng cơ chế `reason?` với
                          // INVALID_VALUE ở trên (khoá `_WITH_REASON` riêng, xem doc 71 Task 5).
  "PERMISSION_DENIED",    // params: { action, reason? } — `action` vẫn BẮT BUỘC (cổng
                          // appErrorParamsCoverage.test.ts); `reason?` thêm ở Task 5 (doc 71) khi
                          // cần nói THÊM (vd tên quyền cụ thể cần có) ngoài tên action.
  "AUTH_REQUIRED",        // params: {} — chưa đăng nhập (ctx.user null), KHÁC FIELD_REQUIRED
                          // (không phải thiếu một trường nhập) và KHÁC FEATURE_DISABLED.
                          // Task 7 fix round 1 (I-1).
  "TWO_FACTOR_NOT_SET_UP", // params: { reason? } — 2FA CHƯA BẬT cho TÀI KHOẢN này, KHÁC
                          // FEATURE_DISABLED (2FA đang bật toàn hệ thống, chỉ tài khoản này
                          // chưa dùng). Task 7 fix round 1 (I-2).
                          //
                          // Task 5 (doc 71, F4) BAN ĐẦU khôi phục "Vào Cài đặt > Bảo mật để
                          // thiết lập" bằng cách enrich THẲNG câu TĨNH `errors.TWO_FACTOR_NOT_SET_UP`
                          // — SAI: reviewer round 1 (M-5) chỉ ra 6 call site KHÔNG đồng nhất ý
                          // định. 4/6 (defectDispositionRouter.ts, twoFactorRouter.ts verify() +
                          // regenerateBackupCodes(), userRouters.ts verify2FA()) đúng là "cần bật
                          // 2FA để tiếp tục" ⇒ chỉ dẫn "đi thiết lập" hợp lý. NHƯNG 2/6
                          // (twoFactorRouter.ts disable(), userRouters.ts disable2FA()) là người
                          // dùng đang TẮT 2FA — bảo họ "đi thiết lập" NGƯỢC Ý ĐỊNH. Đã trả câu
                          // TĨNH về nguyên bản (không chỉ dẫn) + dùng `reason?: "setUpInSecuritySettings"`
                          // (khoá `TWO_FACTOR_NOT_SET_UP_WITH_REASON`) CHỈ ở đúng 4 call site cần.
  "RATE_LIMITED",         // params: {} — vượt hạn mức thao tác (per-IP/per-machine throttle).
                          // Task 8 — gộp 3+ nơi ném TOO_MANY_REQUESTS rải rác (hierarchyRouters
                          // register/claimKey throttle, machineApiRouters heartbeat). Chi tiết
                          // hạn mức (đơn vị/giờ hay /phút khác nhau tuỳ nơi) giữ ở fallbackMessage,
                          // không đưa vào template vì không có 1 đơn vị chung cho mọi nơi gọi.
  "ACCOUNT_LOCKED",       // params: { remainingMinutes } — khoá brute-force ĐANG hiệu lực, KHÁC
                          // RATE_LIMITED (throttle thao tác) và KHÁC PERMISSION_DENIED (thiếu
                          // quyền) — đây là tài khoản, tạm thời, có thời hạn cụ thể. Review cuối
                          // (đợt sửa cuối, ca I-A #2): server/routers.ts:265 từng gộp nhầm vào
                          // RATE_LIMITED, "ít phút" nói giảm so với 15 phút thật.
  "ACCOUNT_DISABLED",     // params: {} — tài khoản bị admin vô hiệu hoá (users.isActive=false),
                          // KHÁC PERMISSION_DENIED (thiếu quyền — đi xin quyền là sai hướng, tài
                          // khoản này cần được kích hoạt lại, không phải cấp thêm quyền). Review
                          // cuối, ca I-A #3: server/routers.ts:268 từng gộp vào PERMISSION_DENIED.
  "FEATURE_NOT_CONFIGURED", // params: { feature } — tính năng KHÔNG có công tắc bật/tắt, chỉ
                          // thiếu cấu hình bắt buộc (biến môi trường/URL bên ngoài) — KHÁC
                          // FEATURE_DISABLED (có công tắc, ai đó tắt nó). Review cuối, ca I-A #5:
                          // licenseRouter.ts 12 chỗ dùng FEATURE_DISABLED cho LICENSE_SERVER_URL
                          // thiếu — không có công tắc nào để "bật" cho người dùng đi bật.
  "ENTITY_EXPIRED",       // params: { entity } — bản ghi CÓ TỒN TẠI nhưng đã quá hạn lưu trữ/hiệu
                          // lực, KHÁC ENTITY_NOT_FOUND (chưa từng có/đã bị xoá). Review cuối, ca
                          // I-A #9: reportArtifactRouter.ts gộp nhánh 'expired' vào ENTITY_NOT_FOUND.

  // ── Nạp tri thức (KB) — Task 3 ────────────────────────────────────────────
  "KB_FILE_TOO_LARGE",        // params: { limitMb }
  "KB_UNSUPPORTED_TYPE",      // params: { ext, supported }
  "KB_CONTENT_TYPE_MISMATCH", // params: { claimed, detected }
  "KB_PARSE_FAILED",          // params: {} — reason chỉ ở fallbackMessage (I-1a, xem kbErrors.ts)
  "KB_NO_TEXT_EXTRACTED",     // params: { source }
  "KB_FETCH_FAILED",          // params: { url } — reason có thể rò IP nội bộ, chỉ log server (I-1b)
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Tham số nội suy vào câu i18n. Chỉ nhận nguyên thuỷ — không nhét object/lỗi
 *  vào đây, nó đi thẳng ra client và có thể lộ nội bộ. */
export type AppErrorParams = Record<string, string | number>;
