/**
 * Doc 42 Đợt 0.5 — bộ dịch lỗi tRPC dùng chung cho toast/inline.
 *
 * Biến TRPCClientError thành chuỗi tiếng Việt thân thiện:
 *  - CONFLICT → message server ("Mã đã tồn tại", …)
 *  - Lỗi zod (message là JSON array issues) → field + message đầu tiên, không dump JSON
 *  - FORBIDDEN / UNAUTHORIZED → câu cố định
 *  - Mặc định → message gốc cắt 200 ký tự; không bao giờ lộ "Failed query"/SQL
 *
 * Dùng: `onError: (err) => toastTrpcError(err)` hoặc `toast.error(mapTrpcError(err))`.
 */
import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";

import { translateAppError, translateClientKey } from "./errorCodes";

const MAX_MESSAGE_LENGTH = 200;

/**
 * F1 (2026-08-21) — CÂU DỰ PHÒNG CỦA CHÍNH BỘ DỊCH PHẢI ĐI QUA i18n.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ NÚT THẮT MÀ MỌI ĐỢT DI TRÚ TRƯỚC ĐỀU ĐI VÒNG QUA
 * ══════════════════════════════════════════════════════════════════════════════════
 * Máy chủ có 1061 mã lỗi đủ vi/en/zh, và đường `appCode → translateAppError` dịch đúng.
 * Nhưng đường DỰ PHÒNG — lỗi KHÔNG có `appCode` — kết thúc ở chính file này, và ở đây
 * mọi câu đều là **tiếng Việt gán cứng**. Đó không phải nhánh hiếm:
 *   • `UNAUTHORIZED` — hết phiên, gặp mỗi ngày;
 *   • `FORBIDDEN` generic — mọi chối-quyền không mang reason;
 *   • lỗi zod — ứng dụng MES đầy biểu mẫu, đây là lớp lỗi thường gặp NHẤT;
 *   • message rỗng / có dấu hiệu leak SQL.
 * ⇒ Người dùng `en`/`zh` đi qua bất kỳ nhánh nào trong số đó đều đọc tiếng Việt.
 *
 * Đây cũng là lý do nên sửa chỗ này TRƯỚC 139 điểm gọi còn hiện `err.message` thô: mọi
 * điểm gọi ấy, sau khi di trú, đều đổ về đúng những câu dưới đây. Sửa gốc một lần thay
 * vì đi sửa từng ngọn rồi phát hiện ngọn nào cũng dẫn về cùng một chỗ hỏng.
 *
 * ── VÌ SAO LÀ HÀM, KHÔNG PHẢI HẰNG ───────────────────────────────────────────────
 * Hằng ở phạm vi module ĐÓNG BĂNG ngôn ngữ tại thời điểm `import` — đúng lớp lỗi đã
 * làm hai bản vá phải hoàn nguyên trong đợt hình-dạng-3. Người dùng đổi ngôn ngữ sau
 * khi module nạp xong sẽ vẫn đọc ngôn ngữ cũ. Nên: tra tại LÚC GỌI.
 */
const cauChung = () => translateClientKey("errors.client.generic", "Lỗi hệ thống, vui lòng thử lại");

/**
 * Bản dịch message zod mặc định (zod trả tiếng Anh) → khoá i18n.
 *
 * ⚠ KHOÁ, không phải câu: bảng cũ ánh xạ thẳng sang tiếng Việt nên `en`/`zh` chịu chung.
 * Hai message zod khác nhau ("received nan" / "received string") cùng trỏ một khoá vì
 * với người dùng chúng là CÙNG một chuyện — "phải là số".
 */
const ZOD_MESSAGE_KEY: Record<string, { khoa: string; vi: string }> = {
  Required: { khoa: "zodRequired", vi: "bắt buộc nhập" },
  "Invalid input": { khoa: "zodInvalidInput", vi: "giá trị không hợp lệ" },
  "Invalid email": { khoa: "zodInvalidEmail", vi: "email không hợp lệ" },
  "Invalid date": { khoa: "zodInvalidDate", vi: "ngày không hợp lệ" },
  "Expected number, received nan": { khoa: "zodExpectedNumber", vi: "phải là số" },
  "Expected number, received string": { khoa: "zodExpectedNumber", vi: "phải là số" },
  "Expected string, received null": { khoa: "zodExpectedNonEmpty", vi: "không được để trống" },
};

interface ZodIssueLike {
  path?: (string | number)[];
  message?: string;
}

function parseZodIssues(message: string): ZodIssueLike[] | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      return parsed as ZodIssueLike[];
    }
  } catch {
    // không phải JSON — bỏ qua
  }
  return null;
}

function formatZodIssue(issues: ZodIssueLike[]): string {
  const first = issues[0];
  const field = Array.isArray(first?.path) ? first.path.filter((p) => typeof p === "string").join(".") : "";
  const raw = typeof first?.message === "string" ? first.message : "";
  const anhXa = ZOD_MESSAGE_KEY[raw];
  // Không có trong bảng ⇒ giữ NGUYÊN VĂN message của zod. Đó là chuỗi tiếng Anh, nhưng
  // nó mang thông tin CỤ THỂ mà câu generic không có — mất nó là mất thứ người dùng cần
  // để sửa (đúng lớp lỗi F4 đã ghi sổ: "hành-động-được" quý hơn "đúng ngôn ngữ").
  const translated = anhXa ? translateClientKey(`errors.client.${anhXa.khoa}`, anhXa.vi) : raw;
  const detail = field
    ? translateClientKey("errors.client.zodField", `Trường "${field}": ${translated}`, {
        field,
        message: translated,
      })
    : translated;
  const more =
    issues.length > 1
      ? translateClientKey("errors.client.zodMore", ` (và ${issues.length - 1} lỗi khác)`, {
          count: issues.length - 1,
        })
      : "";
  const boc = translateClientKey("errors.client.invalidData", "Dữ liệu không hợp lệ");
  return detail ? `${boc} — ${detail}${more}` : `${boc}${more}`;
}

/** Message có dấu hiệu leak SQL/nội bộ → không được hiện nguyên văn. */
function looksLikeInternalLeak(message: string): boolean {
  return (
    message.includes("Failed query") ||
    /\b(insert into|update .+ set|delete from|select .+ from)\b/i.test(message) ||
    message.includes("violates unique constraint") ||
    message.includes("SQLSTATE")
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (typeof code === "string") return code;
  }
  if (error && typeof error === "object") {
    const data = (error as { data?: { code?: unknown } }).data;
    if (data && typeof data.code === "string") return data.code;
  }
  return undefined;
}

/** Sprint 5 §4.3 — mã ứng dụng do appError() gắn, nếu router đã di trú. */
function getAppError(error: unknown): { appCode: string; appParams?: Record<string, string | number> } | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: { appCode?: unknown; appParams?: unknown } }).data;
  if (!data || typeof data.appCode !== "string") return null;
  return {
    appCode: data.appCode,
    appParams:
      data.appParams && typeof data.appParams === "object"
        ? (data.appParams as Record<string, string | number>)
        : undefined,
  };
}

// ── Doc 44 G5.4 — 403 KHÔNG nuốt reason cụ thể ────────────────────────────────
/**
 * ⚠ HAI VAI TRÒ KHÁC NHAU CỦA CÙNG MỘT CÂU — ĐỪNG GỘP LẠI.
 *
 * `FORBIDDEN_GENERIC_VI` là chuỗi để **SO KHỚP**: máy chủ có thể gửi xuống đúng câu
 * tiếng Việt này, và dòng chống-lặp-đôi bên dưới cần nhận ra nó. `cauCam()` là câu để
 * **HIỆN**, theo ngôn ngữ người dùng đang chọn.
 *
 * Gộp hai vai vào một hằng đã dịch thì ở giao diện `en`, phép so sánh không còn khớp
 * câu tiếng Việt máy chủ gửi ⇒ người dùng đọc câu ĐÔI ("You do not have permission… —
 * Bạn không có quyền…"). Cùng lớp lỗi với `col.header` ở `masterDataIO.ts`, nơi một
 * chuỗi vừa là NHÃN vừa là KHOÁ KHỚP và bọc `t()` suýt phá chức năng nhập Excel.
 * ⇒ Luật rút ra, áp cho cả hai chỗ: **trước khi dịch một chuỗi, hỏi "có ai KHỚP theo
 *   chuỗi này không?"**
 */
const FORBIDDEN_GENERIC_VI = "Bạn không có quyền thực hiện thao tác này";
const cauCam = () => translateClientKey("errors.client.forbidden", FORBIDDEN_GENERIC_VI);

/** Mã reason dạng CODE (POLICY_DENIED, APPROVAL_REQUIRED, …) trong message/shape. */
const FORBIDDEN_REASON_CODE_RE =
  /\b(POLICY_DENIED|APPROVAL_REQUIRED|PERMISSION_[A-Z_]+|LICENSE_[A-Z_]+|MODULE_[A-Z_]+|ROLE_[A-Z_]+)\b/;

/** Message 403 có nội dung actionable (quyền/role/2FA/duyệt/license) → đáng hiện. */
const FORBIDDEN_REASON_HINT_RE =
  /(required role|permission|policy|approval|license|module|quyền|vai trò|2fa|xác thực 2 bước|otp|phê duyệt|duyệt|giấy phép|khoá|khóa)/i;

/** Lấy reason code từ shape (data.reasonCode / data.reason) nếu server có gửi. */
function getReasonCodeFromShape(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: { reasonCode?: unknown; reason?: unknown } }).data;
  if (data && typeof data.reasonCode === "string") return data.reasonCode;
  if (data && typeof data.reason === "string") return data.reason;
  return undefined;
}

/**
 * Dịch lỗi FORBIDDEN: trước đây làm phẳng 100% thành câu generic — user không
 * biết vì sao bị chặn (thiếu quyền gì? cần duyệt? cần 2FA?). Giờ: nếu message/
 * shape mang reason nhận diện được thì hiện kèm mã + message gốc; chỉ fallback
 * generic khi không có gì (hoặc message có dấu hiệu leak nội bộ).
 */
function mapForbidden(error: unknown, message: string): string {
  const cam = cauCam();
  if (!message || looksLikeInternalLeak(message)) return cam;
  // Chống lặp đôi: so với CẢ chuỗi tiếng Việt gốc (máy chủ có thể gửi đúng câu đó) LẪN
  // câu đã dịch (giao diện vi thì hai cái trùng nhau; en/zh thì máy chủ vẫn gửi vi).
  if (message.trim() === FORBIDDEN_GENERIC_VI || message.trim() === cam) return cam;
  const truncated =
    message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
  const shapeCode = getReasonCodeFromShape(error);
  const messageCode = FORBIDDEN_REASON_CODE_RE.exec(message)?.[1];
  const reasonCode = shapeCode ?? messageCode;
  if (reasonCode) {
    // Không lặp mã nếu message đã chứa nguyên văn mã đó.
    return message.includes(reasonCode)
      ? `${cam} — ${truncated}`
      : `${cam} — [${reasonCode}] ${truncated}`;
  }
  if (FORBIDDEN_REASON_HINT_RE.test(message)) {
    return `${cam} — ${truncated}`;
  }
  return cam;
}

/** Dịch lỗi tRPC (hoặc Error bất kỳ) thành chuỗi tiếng Việt an toàn để hiện cho user. */
export function mapTrpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = getErrorCode(error);

  // Sprint 5 §4.3 — mã máy-đọc-được thắng mọi luật đoán-theo-chuỗi bên dưới.
  // Fallback KHÔNG dùng `message` thô: nếu message có dấu hiệu leak nội bộ thì
  // câu generic vẫn phải thắng, y như luật đã có từ doc 42.
  const appErr = getAppError(error);
  if (appErr) {
    const safeFallback = !message || looksLikeInternalLeak(message) ? cauChung() : message;
    return translateAppError(appErr.appCode, appErr.appParams, safeFallback);
  }

  switch (code) {
    case "FORBIDDEN":
      // Doc 44 G5.4 — giữ reason cụ thể (POLICY_DENIED/APPROVAL_REQUIRED/quyền
      // gì/2FA) thay vì nuốt hết; fallback generic khi message không có gì.
      return mapForbidden(error, message);
    case "UNAUTHORIZED":
      return translateClientKey(
        "errors.client.sessionExpired",
        "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại",
      );
    case "CONFLICT":
      // Message máy chủ THẮNG câu dự phòng: nó nói ĐÚNG cái gì trùng. Chỉ khi không có
      // gì (hoặc có dấu hiệu leak) mới rơi về câu chung.
      return message && !looksLikeInternalLeak(message)
        ? message
        : translateClientKey("errors.client.duplicate", "Mã đã tồn tại");
    default:
      break;
  }

  const zodIssues = message ? parseZodIssues(message) : null;
  if (zodIssues) return formatZodIssue(zodIssues);

  if (!message || looksLikeInternalLeak(message)) return cauChung();
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

/** Hiện toast lỗi đã dịch. Trả về chuỗi đã hiện (tiện cho test/log). */
export function toastTrpcError(error: unknown): string {
  const friendly = mapTrpcError(error);
  toast.error(friendly);
  return friendly;
}
