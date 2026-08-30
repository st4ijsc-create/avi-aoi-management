/**
 * Dạy giao thức `avi-tool` cho BA TOOL ĐỌC (`doc_tep`/`liet_ke`/`grep`, xem `yeuCauDoc.ts`) — dùng
 * ở đường hỏi BÌNH THƯỜNG của chế độ LOCAL (khác Cmd+K, đã có teaching riêng của nó ngay trong câu
 * hỏi cho hai tool GHI, xem `cauHoiSuaChon.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-30 (Đợt D.1, LỖI 1) — GỐC RỄ ĐO ĐƯỢC: GIAO THỨC CHƯA BAO GIỜ ĐƯỢC DẠY Ở ĐƯỜNG HỎI
 * THƯỜNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 6 đo 11/11 lượt LOCAL (câu hỏi bình thường, không qua Cmd+K): model KHÔNG hề thử phát khối
 * ```avi-tool``` — nó trả lời suông hoặc lạc sang persona vận hành ("hộp cát repo", một khái niệm
 * của chế độ SERVER, không áp dụng cho LOCAL). Đọc mã xác nhận: máy chủ (`server/`) KHÔNG hề biết
 * chuỗi "avi-tool" — grep toàn bộ `server/` cho chuỗi đó ra 0 kết quả. Đây là một giao thức HOÀN
 * TOÀN client-side do extension tự đặt ra (`khoiAviTool.ts`); nhánh `codingMode:true` phía server
 * (`aiLocalKnowledgeService.ts::streamCodingAnswer`) dạy một protocol KHÁC hẳn (sinh mã/diff trực
 * tiếp, không phải khối JSON `avi-tool`) và chạy tool NGAY TRÊN HỘP CÁT CỦA SERVER — bật cờ đó cho
 * LOCAL không dạy được cú pháp cần, mà còn khiến model đọc nhầm repo của server (xem docblock
 * `yeuCau.ts`). Nơi DUY NHẤT từng dạy `avi-tool` là `cauHoiSuaChon.ts` (Cmd+K), và chỉ cho hai tool
 * GHI — đường hỏi bình thường (câu người dùng tự gõ vào bảng chat) không có teaching nào cả.
 *
 * Vá: EXTENSION tự chèn văn bản dạy giao thức vào MỌI câu hỏi ở chế độ LOCAL (xem `yeuCau.ts`) —
 * cùng cách `cauHoiSuaChon.ts` đã làm cho Cmd+K, chỉ khác đối tượng (ba tool ĐỌC thay vì hai tool
 * GHI) và điểm chèn (mọi câu hỏi LOCAL, không chỉ Cmd+K).
 *
 * ⚠⚠⚠ KHÔNG CHÉP TAY CÚ PHÁP HÀNG RÀO. Nhãn hàng rào đến từ `NHAN_HANG_RAO` (`khoiAviTool.ts`) —
 *   nơi DUY NHẤT biết cú pháp mà `tachKhoiAviTool` thật sự chấp nhận. Một chuỗi dạy chép tay là một
 *   BẢN SAO THỨ HAI sẽ trôi khỏi parser đúng như lớp lỗi vừa đo được (LỖI 2: hàng rào thụt lề).
 * ⚠ CHỈ áp cho chế độ LOCAL (xem nơi gọi ở `yeuCau.ts`): chế độ SERVER có vòng tool CỦA NÓ chạy
 *   trên hộp cát máy chủ, dạy `avi-tool` ở đó là dạy một giao thức không ai đọc.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-30 — VÒNG ĐO LẠI THỨ NHẤT: DẠY THÔI CHƯA ĐỦ, PHẢI GỠ ĐÚNG CÁI ĐANG CẠNH TRANH.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo LIVE 11 câu hỏi Step 2 ngay sau khi thêm teaching (chưa có đoạn dưới): **1/11 đúng cú pháp, 10
 * vẫn bỏ qua** — model trả nguyên văn `"Tôi không có thông tin chính xác về câu hỏi này trong tài
 * liệu hiện tại."`. Đọc mã (`aiLocalKnowledgeService.ts::generateWithOllama`) tìm ra vì sao: máy
 * chủ tự dựng một khối "NGUYÊN TẮC TRẢ LỜI" ở TẦNG SYSTEM, luật số 2 ra lệnh model trả ĐÚNG NGUYÊN
 * VĂN câu đó khi ngữ cảnh KB không khớp câu hỏi — và model tuân theo luật đó THAY VÌ thử giao thức
 * vừa được dạy trong `question`. Một câu dạy KHÔNG nói rõ nó đang GHI ĐÈ luật nào sẽ thua luật đó ở
 * phần lớn lượt (10/11) — chỉ thắng khi câu hỏi "gợi hành động" mạnh (grep) hơn là "hỏi tri thức".
 * Vá: nói THẲNG luật đang bị ghi đè, và nhắc lại ở CUỐI câu hỏi (gần điểm sinh chữ nhất — vị trí có
 * trọng số cao hơn một hướng dẫn nằm ở đầu prompt), xem `nhanLaiCuoiCauHoi` (`yeuCau.ts`).
 */
import { NHAN_HANG_RAO } from "./khoiAviTool";

/** Dựng MỘT ví dụ khối rào — dùng `JSON.stringify` thay vì gõ tay chuỗi JSON, cùng cách
 *  `cauHoiSuaChon.ts` đã làm cho tool GHI: tránh một lỗi đánh máy trong ví dụ khiến chính ví dụ
 *  dạy model một hình dạng KHÔNG đọc được. */
function khoiViDu(tool: string, args: Record<string, unknown>): string {
  return ["```" + NHAN_HANG_RAO, JSON.stringify({ tool, args }), "```"].join("\n");
}

export function dungVanBanDayGiaoThucDoc(): string {
  return [
    "QUAN TRỌNG — ĐỌC KỸ TRƯỚC KHI ÁP DỤNG \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới cần " +
      "biết NỘI DUNG một tệp/thư mục cụ thể trong workspace mà bạn KHÔNG thấy trong \"Ngữ cảnh từ " +
      "knowledge base\", đây KHÔNG PHẢI ca \"ngữ cảnh không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi " +
      "không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\". Bạn có một cách khác: " +
      "TỰ ĐỌC tệp/thư mục đó rồi mới trả lời.",
    "",
    "Muốn đọc, phát ra ĐÚNG MỘT khối rào sau (không thêm chữ nào khác trong khối); tôi sẽ chạy công " +
      "cụ đó và gửi lại NGUYÊN VĂN kết quả cho bạn ở lượt kế tiếp — bạn KHÔNG tự bịa nội dung tệp:",
    "",
    "Đọc một tệp:",
    khoiViDu("doc_tep", { path: "<đường dẫn tệp>" }),
    "",
    "Liệt kê một thư mục:",
    khoiViDu("liet_ke", { path: "<đường dẫn thư mục>" }),
    "",
    "Tìm một chuỗi/mẫu trong workspace (path có thể bỏ trống để tìm toàn workspace):",
    khoiViDu("grep", { mau: "<mẫu cần tìm>", path: "<thư mục, tuỳ chọn>" }),
    "",
    "Mỗi lượt trả lời CHỈ MỘT khối (một yêu cầu đọc). Nếu bạn ĐÃ có đủ nội dung cần thiết (đọc rồi, " +
      "hoặc câu hỏi không cần đọc tệp nào), trả lời bình thường — KHÔNG phát khối này.",
  ].join("\n");
}

/**
 * Câu nhắc NGẮN, đặt ở CUỐI `question` (gần điểm model bắt đầu sinh chữ nhất) — xem docblock ở
 * trên: một hướng dẫn nằm ở ĐẦU prompt thua luật "NGUYÊN TẮC TRẢ LỜI" của máy chủ ở 10/11 lượt đo
 * được; nhắc lại ngắn gọn NGAY TRƯỚC lúc model trả lời tăng trọng số của chỉ dẫn tại đúng vị trí mô
 * hình chú ý nhiều nhất. KHÔNG dạy lại cú pháp ở đây (đã dạy đủ ở `dungVanBanDayGiaoThucDoc`) — chỉ
 * nhắc ĐIỀU KIỆN kích hoạt, tránh trùng lặp nội dung làm loãng cả hai.
 */
export function nhacLaiCuoiCauHoi(): string {
  return (
    "\n\n(Nhắc lại: nếu câu hỏi trên cần nội dung một tệp bạn chưa có, hãy phát khối ```" +
    NHAN_HANG_RAO +
    "``` như đã hướng dẫn — ĐỪNG trả lời \"không có thông tin\".)"
  );
}
