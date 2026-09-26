/**
 * F11 (nhóm C 2026-08-14) — nhận diện lỗi "chưa đăng nhập" theo MÃ, không theo chuỗi.
 *
 * Tách khỏi `main.tsx` vì file đó gọi `createRoot()` ở cấp module: import nó trong test
 * là dựng cả ứng dụng. Vị từ này thuần, không side-effect, nên test được thẳng.
 *
 * ── VÌ SAO PHẢI ĐỔI ─────────────────────────────────────────────────────────────
 * Trước đây `main.tsx` nhận diện bằng `error.message === UNAUTHED_ERR_MSG`, tức khớp
 * đúng chuỗi `'Please login (10001)'`. Đường xác thực chính (`server/_core/trpc.ts`)
 * vẫn dùng đúng chuỗi đó nên vẫn điều hướng được — nhưng **sáu chỗ khác** cũng ném
 * `UNAUTHORIZED` + `AUTH_REQUIRED` với message KHÁC:
 *   · `"Login required"`                       (aiInspectionAnalyticsRouter ×2, executiveReportRouter ×2)
 *   · `"Authentication required to resolve alert"` (mqttOeeRouters)
 *   · `"Chưa đăng nhập"`                       (productionSessionRouter)
 * Với chúng, phép so chuỗi KHÔNG khớp ⇒ không điều hướng; mà handler toàn cục chỉ
 * `console.error` ⇒ cũng không hiện gì. Người dùng nhận một màn hình rỗng câm và kẹt.
 *
 * Nay ưu tiên `appCode` — mã máy-đọc-được mà đợt di trú mã lỗi đã dựng ra cho đúng
 * việc này. Giữ phép so chuỗi làm đường lui cho tuyến nào chưa di trú.
 */
import { UNAUTHED_ERR_MSG } from "@shared/const";

/** Mã ứng dụng cho "cần đăng nhập". Trùng `server/_core/appErrorCodes.ts`. */
export const AUTH_REQUIRED_CODE = "AUTH_REQUIRED";

/**
 * Lỗi này có nghĩa "phiên không còn hợp lệ, cần đăng nhập lại" hay không.
 *
 * Cố ý KHÔNG nhận diện theo mã tRPC `UNAUTHORIZED` đơn thuần: mã đó còn được dùng cho
 * các tình huống khác (ví dụ thiếu quyền trên một tuyến cụ thể), và đá người dùng ra
 * trang đăng nhập khi họ ĐANG đăng nhập hợp lệ là một hồi quy tệ hơn bệnh đang chữa.
 */
export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const appCode = (error as { data?: { appCode?: unknown } }).data?.appCode;
  if (appCode === AUTH_REQUIRED_CODE) return true;

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message === UNAUTHED_ERR_MSG;
}
