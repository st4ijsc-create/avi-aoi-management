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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ PDCA vòng 3 (`pdca4-report.md`) — LỖ HỔNG THỨ HAI: CÂU GHI ĐÈ CHỈ CHE MỘT NỬA TRƯỜNG HỢP.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pareto #2 của vòng 1 (T07 — "viết mã mới bị kéo vào vòng tìm-tệp"): ABLATION đo LIVE (bật/tắt
 * TOÀN BỘ khối dạy này, 3 câu "viết hàm mới" mỗi phía, tên hàm DUY NHẤT mỗi lần — script
 * `pdca4-gta.cjs`) cho `laLuotToolSearch` = BẬT **[true,false,false]** (1/3 lạc vào vòng đọc, tìm
 * một tệp KHÔNG TỒN TẠI như `"src/utils/math.ts"` do chính model bịa ra) vs TẮT **[false,false,
 * false]** (0/3) — NHƯNG con số quan trọng hơn là **giao được mã: BẬT 0/3, TẮT 2/3**. Đọc kỹ 2/3
 * câu BẬT không lạc vào tìm-tệp: chúng cũng KHÔNG giao mã — trả nguyên văn câu mẫu bị cấm ("Tôi
 * không có thông tin chính xác..."). Vì sao câu ghi-đè phía trên KHÔNG chặn được câu mẫu đó ở đây:
 * điều kiện kích hoạt của nó là "câu hỏi CẦN biết NỘI DUNG một tệp/thư mục CỤ THỂ" — một yêu cầu
 * viết hàm HOÀN TOÀN MỚI không khớp điều kiện đó (không có tệp nào để cần nội dung), nên câu ghi đè
 * không áp dụng, và model rơi thẳng về luật gốc của máy chủ (trả câu mẫu khi KB không khớp). Đây
 * KHÔNG PHẢI cùng một lỗ với LỖI 1 — LỖI 1 vá "cần đọc mà không dám đọc", lỗ này là "không cần đọc
 * gì cả mà cũng không dám TRẢ LỜI". Vá: thêm MỘT nhánh ghi đè THỨ HAI, dành riêng cho yêu cầu viết
 * mã mới không cần tệp tham chiếu — cả ở đầu (`dungVanBanDayGiaoThucDoc`) LẪN cuối câu hỏi
 * (`nhacLaiCuoiCauHoi`, cùng lý do trọng số vị trí đã đo ở LỖI 1). KHÔNG đụng nhánh ĐỌC hiện có —
 * đây là một câu THÊM, không phải một câu THAY.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT H / TASK H5 — LỖ HỔNG THỨ BA: `de_xuat_nho`/`mcp_goi` ĐƯỢC DẠY Ở ĐẦU, KHÔNG BAO GIỜ NHẮC
 * LẠI Ở CUỐI ⇒ ĐO ĐƯỢC 0/5, RAG-HIJACK.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo H4 (`task-h4-report.md`): 5/5 lượt mời AI đề xuất nhớ (`de_xuat_nho`, dạy ở `dayBoNhoDoc.ts`)
 * và T12 (gọi tool MCP đã kết nối, dạy ở `dayMcpDoc.ts`) đều bị model BỎ QUA HOÀN TOÀN — không chỉ
 * "sai cú pháp", model KHÔNG HỀ trả lời câu hỏi thật, mà lạc sang một đoạn RAG tri thức vận hành
 * gần-cố-định (mô tả cây thư mục `features/`) bất kể nội dung câu hỏi. Cùng CƠ CHẾ đã đo ở LỖI 1
 * (trên): luật "NGUYÊN TẮC TRẢ LỜI" của máy chủ thắng khi chỉ dẫn chỉ đứng Ở ĐẦU `question` — khác
 * LỖI 1 ở chỗ hai giao thức này CHƯA TỪNG có bản nhắc lại ở CUỐI câu hỏi, trong khi ba tool ĐỌC (và
 * nhánh viết mã mới) đã có từ vòng đo lại thứ nhất. Vá: mở rộng `nhacLaiCuoiCauHoi` (ngay dưới) để
 * nhắc CẢ hai — CÓ ĐIỀU KIỆN (chỉ khi `dayGiaoThucDoc` cũng đã dạy chúng ở đầu prompt, tức
 * `dsToolMcp`/`dsBoNho` không rỗng, xem `yeuCau.ts`): một câu nhắc về MCP khi chưa có tool nào kết
 * nối, hay về đề xuất nhớ khi chưa có mục nhớ nào, sẽ nhắc model về một khả năng KHÔNG áp dụng được
 * lượt này — đúng bất biến "vá xong kiểm NHÁNH KIA" mà Task H2/H3 đã đặt cho phần DẠY, nay áp dụng
 * lại cho phần NHẮC.
 */
import { NHAN_HANG_RAO } from "./khoiAviTool";
// ★★★ ĐỢT H / TASK H5 — nguồn DUY NHẤT cho hai tên tool được nhắc lại ở CUỐI câu hỏi bên dưới
// (`nhacLaiCuoiCauHoi`): `TEN_TOOL_MCP` (nơi DẠY: `dayMcpDoc.ts`) và `TEN_TOOL_DE_XUAT_NHO` (nơi
// DẠY: `dayBoNhoDoc.ts`). KHÔNG chép tay chuỗi "mcp_goi"/"de_xuat_nho" lần thứ năm ở đây — cùng
// nguyên tắc đã áp cho `NHAN_HANG_RAO` (docblock module).
import { TEN_TOOL_MCP } from "./yeuCauMcp";
import { TEN_TOOL_DE_XUAT_NHO } from "./deXuatNho";

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
    "",
    "QUAN TRỌNG THỨ HAI — CA KHÁC, CŨNG GHI ĐÈ \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới " +
      "yêu cầu VIẾT MỘT ĐOẠN MÃ/HÀM HOÀN TOÀN MỚI (chưa tồn tại ở đâu cả — không phải sửa, không " +
      "phải tìm, không cần đọc một tệp cụ thể nào để trả lời), đây CŨNG KHÔNG PHẢI ca \"ngữ cảnh " +
      "không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi không có thông tin chính xác...\", và ĐỪNG " +
      "phát khối đọc tệp ở trên để đi tìm một tệp không tồn tại. Hãy viết THẲNG đoạn mã được yêu " +
      "cầu ngay trong câu trả lời này.",
  ].join("\n");
}

/**
 * Câu nhắc NGẮN, đặt ở CUỐI `question` (gần điểm model bắt đầu sinh chữ nhất) — xem docblock ở
 * trên: một hướng dẫn nằm ở ĐẦU prompt thua luật "NGUYÊN TẮC TRẢ LỜI" của máy chủ ở 10/11 lượt đo
 * được; nhắc lại ngắn gọn NGAY TRƯỚC lúc model trả lời tăng trọng số của chỉ dẫn tại đúng vị trí mô
 * hình chú ý nhiều nhất. KHÔNG dạy lại cú pháp ở đây (đã dạy đủ ở `dungVanBanDayGiaoThucDoc`/
 * `dayMcpDoc.ts`/`dayBoNhoDoc.ts`) — chỉ nhắc ĐIỀU KIỆN kích hoạt, tránh trùng lặp nội dung làm
 * loãng cả hai.
 *
 * ★★★ ĐỢT H / TASK H5 — `dv.coMcp`/`dv.coBoNho` CÓ ĐIỀU KIỆN, cùng bất biến "vá xong kiểm NHÁNH
 * KIA" mà `dayMcpDoc.ts`/`dayBoNhoDoc.ts` đã đặt cho phần DẠY: người gọi (`yeuCau.ts`) chỉ bật cờ
 * khi CHÍNH LƯỢT NÀY đã dạy MCP/bộ nhớ ở đầu prompt (`dsToolMcp`/`dsBoNho` không rỗng). Mặc định
 * CẢ HAI `false` (tham số tuỳ chọn, có thể gọi `nhacLaiCuoiCauHoi()` không đối số) ⇒ chuỗi trả về
 * GIỐNG HỆT byte-đúng bản trước H5 — người dùng chưa từng chạm MCP/bộ nhớ dài hạn không thấy một
 * ký tự thừa nào (đối chứng bắt buộc B3: không được làm loãng giao thức ĐỌC đang chạy tốt).
 */
export function nhacLaiCuoiCauHoi(dv: { coMcp?: boolean; coBoNho?: boolean } = {}): string {
  const phanDoc =
    "\n\n(Nhắc lại: nếu câu hỏi trên cần nội dung một tệp bạn chưa có, hãy phát khối ```" +
    NHAN_HANG_RAO +
    "``` như đã hướng dẫn; nếu câu hỏi là yêu cầu viết mã MỚI (không cần đọc tệp), hãy viết THẲNG " +
    "mã đó — cả hai ca ĐỪNG trả lời \"không có thông tin\".";

  // ★★★ H5 — nhắc MCP CHỈ khi lượt này đã dạy `mcp_goi` ở đầu prompt (`dv.coMcp`). Tên tool tới từ
  // `TEN_TOOL_MCP` (`yeuCauMcp.ts`) — KHÔNG chép tay "mcp_goi" ở đây.
  const phanMcp = dv.coMcp
    ? " Nếu câu hỏi trên hỏi về, hoặc yêu cầu dùng, một CÔNG CỤ NGOÀI (MCP) đã kết nối ở trên, " +
      "đừng trả lời lạc đề — hãy phát khối ```" +
      NHAN_HANG_RAO +
      '``` với "tool":"' +
      TEN_TOOL_MCP +
      '" như đã hướng dẫn.'
    : "";

  // ★★★ H5 — nhắc đề xuất nhớ CHỈ khi lượt này đã dạy `de_xuat_nho` ở đầu prompt (`dv.coBoNho`).
  // Tên tool tới từ `TEN_TOOL_DE_XUAT_NHO` (`deXuatNho.ts`) — KHÔNG chép tay "de_xuat_nho" ở đây.
  const phanBoNho = dv.coBoNho
    ? " Nếu câu hỏi trên là một điều đáng NHỚ LÂU DÀI (chưa có trong BỘ NHỚ DÀI HẠN ở trên) hoặc " +
      "yêu cầu bạn ghi nhớ nó, đừng bỏ qua — hãy đề xuất bằng khối ```" +
      NHAN_HANG_RAO +
      '``` với "tool":"' +
      TEN_TOOL_DE_XUAT_NHO +
      '" như đã hướng dẫn.'
    : "";

  return `${phanDoc}${phanMcp}${phanBoNho})`;
}
