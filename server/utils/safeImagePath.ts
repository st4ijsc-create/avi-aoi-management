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
