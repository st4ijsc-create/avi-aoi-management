/**
 * safeImagePath.ts
 * Shared utility for safe image path resolution — prevents path traversal attacks.
 * Used by aiVisionLanguageRouter and aiAnalysisHubRouter.
 */
import path from "path";
import { appError } from "../_core/appError";

export function getUploadsRoot(): string {
  return process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
}

/**
 * Resolves an imageKey (relative path) to an absolute path confined within uploadsRoot.
 * Throws TRPCError BAD_REQUEST for absolute paths / empty keys.
 * Throws TRPCError FORBIDDEN if the resolved path escapes the uploads directory.
 *
 * @param imageKey - relative image key provided by the client (e.g. "inspections/abc.jpg")
 * @param uploadsRoot - optional override for the uploads root (used in tests)
 */
export function resolveSafeImagePath(imageKey: string, uploadsRoot?: string): string {
  if (!imageKey || path.isAbsolute(imageKey)) {
    // Task 10 (F3, doc71) — gộp "rỗng" LẪN "đường dẫn tuyệt đối" (2 dạng
    // imageKey không hợp lệ) dưới CÙNG field "image" (khoá đã có sẵn) —
    // không thêm reason: cả 2 nhánh của hàm đều là "imageKey không hợp lệ",
    // fallbackMessage khác nhau đã đủ phân biệt ở log server.
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image" }, "Invalid image key");
  }

  const root = uploadsRoot ?? getUploadsRoot();
  const normalizedKey = imageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(root, normalizedKey);
  const uploadsPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (!resolved.startsWith(uploadsPrefix) && resolved !== root) {
    throw appError("FORBIDDEN", "INVALID_VALUE", { field: "image" }, "Image path is outside uploads directory");
  }

  return resolved;
}

/**
 * Chuẩn hoá MỘT lần khoá ảnh của client (L6b-fix 2026-10-25): `\` → `/`, bỏ `/` đầu và `uploads/` đầu, bỏ đoạn `.`.
 * TỪ CHỐI (null) khi: không phải chuỗi, rỗng, chứa NUL, tuyệt đối / ổ đĩa, có đoạn `..` hoặc đoạn rỗng (`a//b`, đuôi `/`), hoặc có `%2e`/`%2f`/`%5c` (dạng mã hoá của dấu chấm / gạch).
 * Mọi nơi kiểm phạm vi lẫn đọc tệp phải dùng ĐÚNG chuỗi trả về — không chuẩn hoá lại riêng.
 */
export function chuanHoaKhoaAnh(imageKey: unknown): string | null {
  if (typeof imageKey !== "string" || imageKey.includes("\0")) return null;
  if (/%(2e|2f|5c)/i.test(imageKey)) return null;
  const k = imageKey.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//i, "");
  if (!k || path.posix.isAbsolute(k) || /^[a-zA-Z]:/.test(k)) return null;
  const doan = k.split("/").filter((s) => s !== ".");
  if (doan.length === 0 || doan.some((s) => s === "" || s === "..")) return null;
  return doan.join("/");
}
