/**
 * Hiển thị của màn Giám sát thiết bị hợp nhất (`UnifiedDeviceMonitor`) cho dữ liệu adapter đã bị CHE (C2 quyết định 2.1):
 * `endpoint` có thể là null; kết quả `testConnection({id})` của người bị che KHÔNG có khoá `error` (chỉ `errorCode` + `errorParams`).
 */
import { translateAppError } from "@/lib/errorCodes";

/** Dòng phụ của thẻ adapter: endpoint, hoặc "—" khi bị che (không để trống, không "null"). */
export function chiTietAdapter(endpoint: string | null | undefined): string {
  return endpoint ?? "—";
}

/** Lý do thất bại của phép thử kết nối: văn bản driver (kỹ sư) → câu dịch của `errorCode` (người bị che) → "unknown". */
export function lyDoThuKetNoi(res: {
  error?: string | null;
  errorCode?: string | null;
  errorParams?: Record<string, string | number>;
}): string {
  return res.error ?? (res.errorCode ? translateAppError(res.errorCode, res.errorParams, "unknown") : "unknown");
}
