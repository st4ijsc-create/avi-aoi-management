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

const MAX_MESSAGE_LENGTH = 200;
const GENERIC_ERROR = "Lỗi hệ thống, vui lòng thử lại";

/** Bản dịch các message zod mặc định hay gặp (zod trả tiếng Anh). */
const ZOD_MESSAGE_VI: Record<string, string> = {
  Required: "bắt buộc nhập",
  "Invalid input": "giá trị không hợp lệ",
  "Invalid email": "email không hợp lệ",
  "Invalid date": "ngày không hợp lệ",
  "Expected number, received nan": "phải là số",
  "Expected number, received string": "phải là số",
  "Expected string, received null": "không được để trống",
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
  const translated = ZOD_MESSAGE_VI[raw] ?? raw;
  const detail = field ? `Trường "${field}": ${translated}` : translated;
  const more = issues.length > 1 ? ` (và ${issues.length - 1} lỗi khác)` : "";
  return detail ? `Dữ liệu không hợp lệ — ${detail}${more}` : `Dữ liệu không hợp lệ${more}`;
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

// ── Doc 44 G5.4 — 403 KHÔNG nuốt reason cụ thể ────────────────────────────────
const FORBIDDEN_GENERIC = "Bạn không có quyền thực hiện thao tác này";

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
  if (!message || looksLikeInternalLeak(message)) return FORBIDDEN_GENERIC;
  if (message.trim() === FORBIDDEN_GENERIC) return FORBIDDEN_GENERIC; // tránh lặp đôi
  const truncated =
    message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
  const shapeCode = getReasonCodeFromShape(error);
  const messageCode = FORBIDDEN_REASON_CODE_RE.exec(message)?.[1];
  const reasonCode = shapeCode ?? messageCode;
  if (reasonCode) {
    // Không lặp mã nếu message đã chứa nguyên văn mã đó.
    return message.includes(reasonCode)
      ? `${FORBIDDEN_GENERIC} — ${truncated}`
      : `${FORBIDDEN_GENERIC} — [${reasonCode}] ${truncated}`;
  }
  if (FORBIDDEN_REASON_HINT_RE.test(message)) {
    return `${FORBIDDEN_GENERIC} — ${truncated}`;
  }
  return FORBIDDEN_GENERIC;
}

/** Dịch lỗi tRPC (hoặc Error bất kỳ) thành chuỗi tiếng Việt an toàn để hiện cho user. */
export function mapTrpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = getErrorCode(error);

  switch (code) {
    case "FORBIDDEN":
      // Doc 44 G5.4 — giữ reason cụ thể (POLICY_DENIED/APPROVAL_REQUIRED/quyền
      // gì/2FA) thay vì nuốt hết; fallback generic khi message không có gì.
      return mapForbidden(error, message);
    case "UNAUTHORIZED":
      return "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại";
    case "CONFLICT":
      return message && !looksLikeInternalLeak(message) ? message : "Mã đã tồn tại";
    default:
      break;
  }

  const zodIssues = message ? parseZodIssues(message) : null;
  if (zodIssues) return formatZodIssue(zodIssues);

  if (!message || looksLikeInternalLeak(message)) return GENERIC_ERROR;
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

/** Hiện toast lỗi đã dịch. Trả về chuỗi đã hiện (tiện cho test/log). */
export function toastTrpcError(error: unknown): string {
  const friendly = mapTrpcError(error);
  toast.error(friendly);
  return friendly;
}
