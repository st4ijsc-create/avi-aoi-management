/**
 * ★★★ ĐỢT G TASK G4 / B3 — VỊ TỪ PHÂN LOẠI "đây có phải lỗi KHÔNG NỐI ĐƯỢC MÁY CHỦ không?".
 *
 * THUẦN (không import `vscode`) để đo được bằng lưới riêng, không cần dựng `fetch`/mạng thật.
 *
 * ⚠⚠⚠ BÀI HỌC ĐỢT D (Task 6/D.1, `bangChat.ts#hoi` — xem docblock nhánh `dieuKhien.signal.aborted`):
 * nhận diện một lượt HUỶ bằng HÌNH DẠNG chuỗi (`e.name === "AbortError"`) từng làm bong bóng lỗi
 * HIỆN RỖNG, vì `abort(reason)` với `reason` là chuỗi trần không mang hình dạng đó. Bài học mang
 * sang đây NGUYÊN VẸN: KHÔNG so `(e as Error).message` với chuỗi tiếng Anh của Node/undici — chuỗi
 * đó là văn bản nội bộ ("fetch failed"), không phải một hợp đồng ổn định. TÍN HIỆU đáng tin ở đây là
 * `error.cause.code` — undici LUÔN đặt mã lỗi hệ điều hành (`ECONNREFUSED`, `ENOTFOUND`, …) vào đó
 * khi `fetch()` không dựng nổi kết nối, ĐO ĐƯỢC trực tiếp bằng `node -e "fetch(...).catch(e=>...)"`
 * trên chính Node của VSCode (xem lời khai đo trong báo cáo Task G4) — không đoán, không suy từ tài
 * liệu.
 *
 * ⚠ NHÁNH KIA — MỘT ĐÁP ỨNG HTTP THẬT (401 sai mật khẩu, 403 tài khoản bị khoá, 500 lỗi máy chủ…)
 *   KHÔNG mang `.cause.code` này: `mang/dongSse.ts` ném `LoiHttp` (dựng bằng `new Error`, không có
 *   `.cause`) SAU KHI `fetch()` đã trả về một `Response` — tức máy chủ RÕ RÀNG nối được, chỉ là từ
 *   chối/lỗi. `mang/duyetGhi.ts` (`goiMutation`) cũng vậy: `!res.ok` ném `new Error(...)`, không có
 *   `.cause`. Vị từ này PHẢI trả `false` cho cả hai — gợi ý "đổi địa chỉ máy chủ" cho một lỗi 401/500
 *   là gợi ý SAI, đẩy người dùng đi sửa nhầm chỗ (còn tệ hơn không gợi ý gì, xem yêu cầu B3).
 */

/**
 * Mã lỗi mạng tầng hệ điều hành/libuv mà Node gắn vào `error.cause.code` (hoặc trực tiếp
 * `error.code` cho vài lỗi timeout riêng của undici) khi `fetch()` không dựng nổi một kết nối TCP
 * hoặc không phân giải được tên miền — TRƯỚC KHI có bất kỳ đáp ứng HTTP nào. Chủ đích HẸP: đủ để
 * bắt các ca kể trong B3 ("lỗi mạng/ECONNREFUSED/ENOTFOUND/timeout"), không rộng tới mức nuốt luôn
 * lỗi TLS/chứng chỉ (một chuyện khác, đổi địa chỉ không sửa được).
 */
const MA_LOI_KHONG_NOI_DUOC = new Set([
  "ECONNREFUSED", // máy chủ không lắng nghe ở địa chỉ/cổng đó — kịch bản "đổi IP" đúng tâm B3
  "ENOTFOUND", // DNS không phân giải được tên miền trong địa chỉ
  "EAI_AGAIN", // DNS tạm thời không phản hồi
  "ETIMEDOUT", // hết thời gian chờ khi dựng kết nối
  "ECONNRESET", // kết nối bị đóng đột ngột giữa lúc dựng/đang dùng
  "EHOSTUNREACH", // máy chủ đích không tới được ở tầng mạng
  "ENETUNREACH", // toàn bộ mạng đích không tới được
  "ENETDOWN",
  "EHOSTDOWN",
  "ECONNABORTED",
  "EPIPE",
  // Mã riêng của undici (bộ máy fetch của Node) cho các ca hết-giờ tầng kết nối/socket — không đi
  // qua `.cause`, undici đặt thẳng lên `error.code`.
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Đọc `.code` (chuỗi) của một giá trị bất kỳ, không ném nếu hình dạng lạ. */
function docMaLoi(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const ma = (v as { code?: unknown }).code;
  return typeof ma === "string" ? ma : undefined;
}

/**
 * true khi `err` là một lỗi KHÔNG NỐI ĐƯỢC MÁY CHỦ (mạng hỏng, sai địa chỉ, máy chủ tắt, timeout) —
 * tức chưa hề có đáp ứng HTTP nào từ máy chủ. `false` cho MỌI THỨ KHÁC, kể cả một đáp ứng HTTP lỗi
 * (401/403/500 — máy chủ CÓ trả lời, chỉ là từ chối) và lỗi không phải `Error`.
 */
export function laLoiKhongNoiDuocMayChu(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Ca phổ biến nhất: undici bọc lỗi kết nối trong `TypeError("fetch failed")` với `.cause` mang mã
  // hệ điều hành thật. Đọc TÍN HIỆU (`.cause.code`), không đọc chuỗi `message`.
  if (MA_LOI_KHONG_NOI_DUOC.has(docMaLoi((err as { cause?: unknown }).cause) ?? "")) return true;
  // Vài lỗi timeout của riêng undici đặt mã THẲNG lên `error.code`, không bọc qua `.cause`.
  if (MA_LOI_KHONG_NOI_DUOC.has(docMaLoi(err) ?? "")) return true;
  return false;
}

/**
 * Câu thông báo khi B3 xác định đây LÀ lỗi không-nối-được-máy-chủ — in RÕ địa chỉ đang thử (không
 * bịa, không giấu) và nói THẲNG hai điều người dùng cần biết để tự sửa:
 *   (1) có lệnh/nút mở đúng ô cấu hình `aviAiLocal.serverUrl`;
 *   (2) ĐO ĐƯỢC (B4, xem báo cáo): đổi xong KHÔNG cần khởi động lại VSCode — mọi lượt gọi máy chủ
 *       trong tệp này đọc `vscode.workspace.getConfiguration("aviAiLocal").get("serverUrl")` MỚI ở
 *       mỗi lượt, không cache lúc `activate()` — nói rõ để người dùng không tự đoán rồi đóng/mở lại
 *       VSCode một cách vô ích.
 */
export function moTaLoiKhongNoiDuocMayChu(serverUrl: string): string {
  return (
    `KHÔNG NỐI ĐƯỢC MÁY CHỦ tại "${serverUrl}" — đã thử và không có đáp ứng (máy chủ tắt, sai địa ` +
    `chỉ/cổng, hoặc mạng không thông). Nếu địa chỉ máy chủ vừa đổi, bấm nút bên dưới để mở đúng ô ` +
    `cấu hình "aviAiLocal.serverUrl" (KHÔNG cần khởi động lại VSCode — lượt hỏi kế tiếp dùng địa chỉ ` +
    `mới ngay lập tức).`
  );
}
