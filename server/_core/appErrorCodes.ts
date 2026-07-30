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
  "ENTITY_DUPLICATE",     // params: { entity, field? }
  "SCOPE_MISMATCH",       // params: { entity, parent }
  "FIELD_REQUIRED",       // params: { field }
  "INVALID_VALUE",        // params: { field, reason? }
  "FEATURE_DISABLED",     // params: { feature }
  "OPERATION_FAILED",     // params: { operation }
  "PERMISSION_DENIED",    // params: { action? }

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
