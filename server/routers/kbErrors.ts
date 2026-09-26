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
 *  bytes là PNG) — KB_CONTENT_TYPE_MISMATCH. Fix round 1 (I-2): `kbDocParser.ts` giờ ném
 *  `KbContentTypeMismatchError` (con của `KbParseError`, mang `claimed`/`detected` có cấu trúc)
 *  tại đúng 2 chỗ phát sinh tình huống này (`toTextChecked`, `parseImage`) — router bắt lớp con
 *  này TRƯỚC nhánh `KbParseError` chung để gọi đúng hàm này thay vì rơi vào KB_PARSE_FAILED. */
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
 *  (mọi biến thể của `KbParseError` đổ về đây, xem task-3-report.md mục Step 1).
 *
 *  Fix round 1 (I-1a): `reason` là lỗi VỀ CHÍNH TỆP người dùng vừa tải lên (không có gì thuộc
 *  hạ tầng để rò), nhưng vì nó nguyên văn tiếng Anh, KHÔNG được nội suy vào câu i18n nữa — nếu
 *  không, người vận hành vẫn đọc câu Anh, chỉ thêm tiền tố Việt (đây chính là điều I-1 chỉ ra:
 *  quy ước `INVALID_VALUE` sẵn có của dự án cũng không render `{{reason}}`). `reason` CHỈ còn
 *  nằm trong `fallbackMessage` (giữ cho log/API `/v1`) — KHÔNG còn trong `appParams` (không nội
 *  suy thì không nên đi kèm phản hồi). Câu i18n `errors.KB_PARSE_FAILED` không còn tham số. */
export function buildParseFailedError(reason: string) {
  return appError("BAD_REQUEST", "KB_PARSE_FAILED", undefined, `Failed to parse document: ${reason}`);
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
 *
 *  Fix round 1 (I-1b): KHÁC với KB_PARSE_FAILED — `reason` ở đây CÓ THỂ chứa IP/hostname nội bộ
 *  đã resolve (vd. `kbWebFetcher.ts`'s SSRF guard: "Host resolves to a blocked/internal address
 *  (169.254.169.254)..."). Đây là dữ liệu hạ tầng, KHÔNG được ra client bằng bất kỳ đường nào —
 *  kể cả `fallbackMessage`, vì `TRPCError.message` được gửi thẳng cho client (không chỉ dùng nội
 *  bộ như tên gọi "fallback" gợi ý). Nên với mã này: `reason` KHÔNG vào `appParams`, KHÔNG vào
 *  `fallbackMessage` — chỉ `console.error` ở MÁY CHỦ để không mất chẩn đoán. `url` vẫn giữ (client
 *  tự nhập URL đó, trả lại là hữu ích và không rò gì). */
export function buildFetchFailedError(url: string, reason: string) {
  // Log chẩn đoán MÁY CHỦ duy nhất còn giữ `reason` thô — xem doc comment ở trên cho lý do tách
  // hai đường (client nhận câu chung ở dưới, log giữ chi tiết đầy đủ cho vận hành/điều tra sự cố).
  console.error(`[kbErrors] KB_FETCH_FAILED — không tải được nội dung từ "${url}": ${reason}`);
  return appError("BAD_REQUEST", "KB_FETCH_FAILED", { url }, `Failed to fetch ${url}`);
}
