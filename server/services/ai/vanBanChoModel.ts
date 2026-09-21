/**
 * ★★★ G2 (audit 2026-09-21 · P2) — HAI KÊNH CHỮ CHO HAI NGƯỜI ĐỌC CÓ NHU CẦU NGƯỢC NHAU.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC — MODEL **BỊA NGUYÊN NỘI DUNG TỆP** KHI KHÔNG ĐỌC ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hỏi *"Đọc file server/routers.ts và tóm tắt"* khi ngân sách hộp cát đã cạn ⇒ model trả lời rất
 * tự tin: *"router **Express**… route GET `/api/machines` đọc `data/machines.json`… dùng `fs`"*.
 * Sự thật đo được trên tệp: **786 dòng tRPC**, `express` = 0, `machines.json` = 0, `require(` = 0.
 *
 * **Ablation quyết định** (cùng câu hỏi, cùng model, chỉ khác ngân sách):
 *   • ngân sách CÒN ⇒ 3 vòng `read_file`, trả về **đúng nguyên văn** tệp.
 *   • ngân sách CẠN ⇒ **0 vòng tool**, và **bịa**.
 * ⇒ Bịa gắn NHÂN QUẢ với việc đọc thất bại, không phải bản tính model ⇒ vá được.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GỐC RỄ — MỘT CHUỖI PHỤC VỤ HAI NGƯỜI ĐỌC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ToolResult.textSummary` được khai ngay trong kiểu là *"for LLM context injection"*, **đồng thời**
 * là chuỗi hiện ra cho NGƯỜI. So câu chữ của hai mã từ chối:
 *
 *   NOT_FOUND       → "Không có tệp/thư mục X trong hộp cát repo."          ⇒ model NÓI THẬT
 *   BUDGET_EXCEEDED → "…Đây là một cái TRẦN, **KHÔNG PHẢI MỘT SỰ CỐ**…"     ⇒ model BỊA
 *   DENIED_SECRET   → "…Đây là thiết kế, **KHÔNG PHẢI SỰ CỐ**…"            ⇒ cùng khuôn
 *
 * Cụm *"không phải sự cố"* được viết để **TRẤN AN NGƯỜI** ("hệ thống của bạn không hỏng") — và đó
 * là câu ĐÚNG cho người. Nhưng cùng chuỗi ấy nạp cho **MODEL** như kết quả tool thì nó đọc thành
 * *"không có lỗi gì"* rồi **trả lời tiếp từ trí nhớ**. Người cần được trấn an; model cần một
 * **MỆNH LỆNH**. Một chuỗi không phục vụ nổi cả hai.
 *
 * ⇒ `textModel` là kênh THỨ HAI, chỉ dành cho prompt. Vắng ⇒ dùng `textSummary` y như cũ (mọi tool
 *   hiện có KHÔNG đổi một byte).
 */

/** Hình dạng tối thiểu cần để lấy chữ — cố ý KHÔNG nhập `ToolResult` để hàm này thuần và dễ thử. */
export type CoChu = {
  readonly textSummary?: string | null;
  /** Chữ dành RIÊNG cho model. Vắng ⇒ dùng `textSummary`. */
  readonly textModel?: string | null;
};

/**
 * Chữ nạp vào PROMPT. Hàm thuần.
 *
 * ⚠ KHÔNG dùng hàm này cho đường hiển thị — người dùng phải thấy `textSummary` (câu trấn an có
 *   ích và đã được dịch 3 thứ tiếng). Lẫn hai đường là quay lại đúng lỗi đang vá.
 */
export function vanBanChoModel(r: CoChu | null | undefined): string {
  if (!r) return "";
  const m = r.textModel;
  if (typeof m === "string" && m.trim() !== "") return m;
  return r.textSummary ?? "";
}

/**
 * Dựng câu MỆNH LỆNH cho model khi một lượt đọc bị TỪ CHỐI.
 *
 * Ba điều câu này phải nói, và `vanBanChoModel.test.ts` canh từng điều:
 *   1. **KHÔNG có** nội dung — nói thẳng, không vòng vo.
 *   2. **CẤM** mô tả/tóm tắt/suy đoán nội dung ấy.
 *   3. Phải **nói ra** rằng chưa đọc được, kèm lý do.
 *
 * ⚠ Tuyệt đối KHÔNG chứa cụm "không phải sự cố" / "not an error" / "chỉ là một cái trần" —
 *   chính cụm ấy là nguyên nhân. Có lưới canh chuỗi cấm.
 */
export function menhLenhTuChoiChoModel(duong: string, ma: string, giaiThich: string): string {
  return (
    `[KẾT QUẢ TOOL — TỪ CHỐI] Lượt đọc "${duong}" KHÔNG trả về nội dung (mã: ${ma}). ` +
    `Bạn KHÔNG có nội dung của "${duong}" trong lượt này. ` +
    `Bạn KHÔNG ĐƯỢC mô tả, tóm tắt, trích dẫn hay suy đoán nội dung của nó — kể cả khi bạn nghĩ ` +
    `mình biết tệp này. Hãy nói thẳng với người dùng rằng bạn chưa đọc được nó, và nêu lý do: ${giaiThich}`
  );
}
