/**
 * Sprint 5 §4 (Task 3, A4) — dựng lỗi cho luồng nạp tri thức (Knowledge & Training Studio) ở
 * MỘT chỗ, vì cùng một tình huống hiện đang được ném từ hai router (`kbIngestRouter.ts`,
 * `kbStudioRouter.ts`) với hai câu chữ khác nhau — chính là thứ khiến một màn hình có cả tiếng
 * Anh lẫn tiếng Việt (kbImageDescriber ở cùng luồng đã tiếng Việt từ trước).
 *
 * `fallbackMessage` của mỗi hàm dưới đây GIỮ NGUYÊN VĂN câu tiếng Anh mà hai router đã ném ra
 * trước Task 3 — log máy chủ và API `/v1` (bên ngoài, chưa có `appCode`) không thấy gì đổi khác
 * ngoài việc câu đó giờ có kèm `appCode`/`appParams` trên `cause` (đọc được qua
 * `readAppErrorMeta`). Client dịch qua `errors.KB_*` (i18n); thiếu khoá thì rơi về đúng câu này.
 */
import { appError } from "../_core/appError";

/** Danh sách định dạng KB chấp nhận — MỘT nơi duy nhất, khớp nguyên văn với thông điệp cũ của
 *  `KbUnsupportedTypeError` (kbDocParser.ts:45) và `allowedTypes` (kbIngestRouter.ts's `status`
 *  query) — không phát minh danh sách thứ hai có thể trôi khỏi danh sách thật. */
export const KB_SUPPORTED_TYPES = "pdf, docx, md, txt, png, jpg, jpeg, webp";

/** Quá dung lượng tệp đã giải mã base64 — KB_FILE_TOO_LARGE. Trước đây câu ném ra là
 *  `"Document exceeds 20971520 bytes"` (byte thô) — cùng một `maxBytes` phục vụ cả nhánh
 *  "Document" lẫn "Video" của `decodeBase64Payload` (kbIngestRouter.ts), nên `limitMb` áp dụng
 *  chung cho cả hai; xem ghi chú lệch trong task-3-report.md. */
export function buildTooLargeError(maxBytes: number) {
  const limitMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return appError("PAYLOAD_TOO_LARGE", "KB_FILE_TOO_LARGE", { limitMb }, `Document exceeds ${maxBytes} bytes`);
}

/** Loại tệp/MIME không nằm trong `KB_SUPPORTED_TYPES` — KB_UNSUPPORTED_TYPE. Trước đây:
 *  `Unsupported document type: "pptx"`. `ext` nên là `KbUnsupportedTypeError.input` (chuỗi thô
 *  người dùng/']client đã gửi — có thể là đuôi tệp hoặc MIME). */
export function buildUnsupportedTypeError(ext: string, supported: string) {
  return appError(
    "BAD_REQUEST",
    "KB_UNSUPPORTED_TYPE",
    { ext, supported },
    `Unsupported document type: "${ext}". Supported: ${supported}.`,
  );
}

/** Tệp khai một định dạng nhưng nội dung byte thực tế là định dạng khác (vd. "notes.md" nhưng
 *  bytes là PNG) — KB_CONTENT_TYPE_MISMATCH. Đăng ký sẵn từ Task 1 nhưng KHÔNG có nơi gọi trong
 *  Task 3 (xem task-3-report.md): `kbDocParser.ts` (ngoài phạm vi sửa của Task 3) chỉ ném
 *  `KbParseError` chung cho cả "nội dung sai định dạng" lẫn "file hỏng" — không có trường
 *  `claimed`/`detected` tách rời để router đọc mà không phải soi chuỗi `message`. Giữ hàm này lại
 *  để sẵn sàng cho lúc `kbDocParser.ts` được sửa để ném một lớp lỗi riêng mang hai trường đó. */
export function buildContentTypeMismatchError(claimed: string, detected: string) {
  return appError(
    "BAD_REQUEST",
    "KB_CONTENT_TYPE_MISMATCH",
    { claimed, detected },
    `File claims ${claimed} but its content is ${detected}`,
  );
}

/** Định dạng được nhận diện nhưng phân tích thất bại (file hỏng, timeout, VLM lỗi, nội dung
 *  nhị phân giả dạng text...) — KB_PARSE_FAILED. `reason` = nguyên văn `KbParseError.message`
 *  (mọi biến thể của `KbParseError` đổ về đây, xem task-3-report.md mục Step 1). */
export function buildParseFailedError(reason: string) {
  return appError("BAD_REQUEST", "KB_PARSE_FAILED", { reason }, `Failed to parse document: ${reason}`);
}

/** Phân tích thành công nhưng không còn chữ nào để nạp (rỗng sau khi trim, hoặc 0 chunk sau khi
 *  cắt) — KB_NO_TEXT_EXTRACTED. `source` = sourceRef/URL/filename tuỳ router gọi. */
export function buildNoTextError(source: string) {
  return appError(
    "BAD_REQUEST",
    "KB_NO_TEXT_EXTRACTED",
    { source },
    `Document "${source}" produced no extractable text`,
  );
}

/** Nạp từ URL thất bại — gộp cả `SsrfBlockedError` (đích bị chặn) lẫn `FetchError` (mọi lỗi
 *  fetch khác: DNS, timeout, quá dung lượng, content-type không cho phép...) vào MỘT mã, vì cả
 *  hai đều là "không tải được nội dung từ URL này" dưới góc nhìn người vận hành — KB_FETCH_FAILED.
 *  `reason` = nguyên văn message của lỗi gốc (giữ đủ chi tiết kỹ thuật cho log/API ngoài). */
export function buildFetchFailedError(url: string, reason: string) {
  return appError("BAD_REQUEST", "KB_FETCH_FAILED", { url, reason }, `Failed to fetch ${url}: ${reason}`);
}
