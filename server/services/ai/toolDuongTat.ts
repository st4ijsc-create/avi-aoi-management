/**
 * ★★★ G2b (audit 2026-09-21 · P11) — QUYẾT ĐỊNH "CÓ ĐƯỢC DÙNG ĐƯỜNG TẮT TOOL KHÔNG".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ ĐO ĐƯỢC — ĐƯỜNG ỐNG TRẢ VỀ **0 KHỐI MÃ** TRÊN 6/9 TÁC VỤ LẬP TRÌNH CÓ ĐỘ KHÓ THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hỏi *"viết lớp BoNhoLRU có TTL…"* ⇒ vòng tool gọi `read_file`, và đường tắt ở
 * `aiLocalKnowledgeService` trả về **nguyên văn `server/services/aiLocalTools/toolRegistry.ts`**
 * (26.004 byte) làm CÂU TRẢ LỜI. Đo trên văn bản gốc: chứa `BoNhoLRU` = **false**, số khối mã = **0**.
 *
 * Số đo (bộ bài KHÓ 9 câu, mỗi câu có test THỰC THI, ablation 9/9 đúng · 0/9 sai):
 *   • model THUẦN (gọi thẳng llama-server) : 44–56 % chạy được, sinh mã 9/9 bài
 *   • qua ĐƯỜNG ỐNG                        : **0 %**, 6/9 bài **không có khối mã nào**
 *   • xảy ra Y HỆT với model chat ⇒ lỗi CÓ SẴN, không phải do đổi model (G1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GỐC RỄ — MỘT KẾT QUẢ TOOL BỊ DÙNG SAI VAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường tắt vốn ĐÚNG, và phải giữ: tool dữ-liệu-sống (`get_today_stats`, `lot_status`…) trả về một
 * `textSummary` **đã là câu trả lời** — đưa nó cho LLM diễn giải lại chỉ tốn 10–15 s mà không khá hơn.
 *
 * Nhưng `read_file`/`grep_repo`/`list_files` KHÔNG mang câu trả lời. Chúng mang **NGỮ CẢNH** —
 * tức **ĐẦU VÀO** cho lượt sinh chữ. Trả thẳng đầu ra của chúng cho người dùng là nhầm vai:
 * người hỏi "viết cho tôi một lớp" mà nhận về một tệp của chính repo.
 *
 * ⇒ Phép phân biệt KHÔNG phải "summary dài hay ngắn" mà là **TOOL NÀY MANG CÂU TRẢ LỜI HAY MANG
 *   NGỮ CẢNH**. Đó là thứ file này phát biểu, và nó là một hàm THUẦN để lưới chạy thẳng trên nó.
 *
 * ⚠ KHÔNG nới đường tắt cho tool dữ-liệu-sống: `toolDuongTat.test.ts` khẳng định chúng VẪN đi
 *   đường tắt. Một bản vá làm mọi tool đều gọi LLM sẽ cộng 10–15 s cho MỌI câu hỏi vận hành.
 */

/**
 * Tool mang **NGỮ CẢNH** (đầu ra là ĐẦU VÀO cho lượt sinh chữ, không phải câu trả lời).
 *
 * ⚠ Đây là danh sách TRẮNG theo TÊN TOOL, cố ý: thêm một tool đọc mới mà quên khai ở đây thì nó
 *   rơi về nhánh "mang câu trả lời" — tức hành vi CŨ, an toàn theo nghĩa không đổi gì, và
 *   `toolDuongTat.test.ts` có một ca canh đúng danh sách này để đột biến bị bắt.
 */
export const TOOL_MANG_NGU_CANH: ReadonlySet<string> = new Set([
  "read_file",
  "read_project_file",
  "grep_repo",
  "list_files",
  "retrieve_programming_kb",
]);

/**
 * ★★★ G2 — CẦU CHÌ HẬU KIỂM: **MỌI VÒNG ĐỌC ĐỀU BỊ TỪ CHỐI**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT MỆNH LỆNH TRONG PROMPT LÀ KHÔNG ĐỦ — ĐO ĐƯỢC, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản vá `textModel` (xem `vanBanChoModel.ts`) nạp cho model một câu MỆNH LỆNH: *"bạn KHÔNG có nội
 * dung này, KHÔNG ĐƯỢC mô tả hay suy đoán"*. Đo sống 10 lượt cùng một câu hỏi khi ngân sách cạn:
 *
 *   • **3/10 sạch** — model nghe lời.
 *   • **7/10 vẫn BỊA** — có lượt viết nguyên một Express router không tồn tại, thậm chí ghi
 *     *"dựa trên nội dung ĐÃ ĐƯỢC CUNG CẤP TỪ HỆ THỐNG"* (một khẳng định SAI SỰ THẬT).
 *
 * ⇒ Chỉ dẫn là hàng rào MỀM. Hàng rào CỨNG phải là cơ chế: khi **mọi** vòng đọc đều bị từ chối,
 *   không có gì để tổng hợp, nên **không gọi model** — trả thẳng lời từ chối trung thực của tool.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ CỤ THỂ ĐANG VÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cổng cũ `toolKhongCoGiDeNoi()` mở ĐÚNG cho ca một vòng, nhưng có dòng `if (soVongDaChay > 1)
 * return false;` — nhiều vòng thì nó TỰ TẮT. Lý lẽ của dòng ấy đúng cho ca thường (*"giá trị nằm ở
 * phép TỔNG HỢP giữa các vòng"*), nhưng KHÔNG đúng khi **không vòng nào có dữ liệu**: tổng hợp của
 * ba lời từ chối vẫn là một lời từ chối. Vị từ dưới đây bịt đúng chỗ đó, và chỉ chỗ đó.
 *
 * ⚠ CHỈ khi **TẤT CẢ** bị từ chối. Một vòng đọc được ⇒ `false` ⇒ model vẫn chạy như cũ.
 */
export function moiVongDeuTuChoi(notes: ReadonlyArray<string | null | undefined>): boolean {
  if (notes.length === 0) return false;
  return notes.every((n) => typeof n === "string" && n.trim() !== "");
}

export type QuyetDinhDuongTat = {
  /** true ⇒ trả thẳng `textSummary` cho người dùng, KHÔNG gọi LLM. */
  readonly dungDuongTat: boolean;
  /** Mã máy-đọc-được để lưới và nhật ký nói cùng một sự thật. */
  readonly lyDo:
    | "tool_khong_co_gi_de_noi"
    | "tool_mang_ngu_canh"
    | "da_da_buoc"
    | "summary_qua_ngan"
    | "summary_du_dai";
};

export type ThamSoDuongTat = {
  /** Tên tool của vòng CUỐI (null khi không có tool nào chạy). */
  readonly tenTool: string | null | undefined;
  readonly doDaiSummary: number;
  /** Vòng lặp đã đi >1 bước ⇒ giá trị nằm ở phép TỔNG HỢP, không ở kết quả vòng cuối. */
  readonly daDaBuoc: boolean;
  /** Tool đã nói bằng trạng thái CÓ CẤU TRÚC rằng nó không có gì. */
  readonly khongCoGiDeNoi: boolean;
  readonly tranDoDai: number;
};

/**
 * Hàm THUẦN — không đọc env, không đọc giờ, không I/O. Mọi nhánh có lưới.
 *
 * Thứ tự cổng có tải trọng và KHÔNG được đảo:
 *   1. `khongCoGiDeNoi` đứng TRƯỚC mọi thứ — tool đã nói thật "tôi không có gì"; đưa cái rỗng đó
 *      cho LLM diễn giải là mời nó BỊA (đúng lớp lỗi P2 của cùng bản audit).
 *   2. `TOOL_MANG_NGU_CANH` đứng TRƯỚC phép so độ dài — đây là bản vá P11. Tool ngữ cảnh KHÔNG
 *      BAO GIỜ được đi đường tắt, **bất kể** summary dài bao nhiêu; dài chính là dấu hiệu nó vừa
 *      đọc được nhiều ngữ cảnh, tức càng phải đưa cho LLM, càng KHÔNG được trả thẳng.
 *   3. Phần còn lại giữ NGUYÊN hành vi cũ.
 */
export function quyetDinhDuongTat(t: ThamSoDuongTat): QuyetDinhDuongTat {
  if (t.khongCoGiDeNoi) return { dungDuongTat: true, lyDo: "tool_khong_co_gi_de_noi" };
  if (t.tenTool && TOOL_MANG_NGU_CANH.has(t.tenTool)) {
    return { dungDuongTat: false, lyDo: "tool_mang_ngu_canh" };
  }
  if (t.daDaBuoc) return { dungDuongTat: false, lyDo: "da_da_buoc" };
  return t.doDaiSummary >= t.tranDoDai
    ? { dungDuongTat: true, lyDo: "summary_du_dai" }
    : { dungDuongTat: false, lyDo: "summary_qua_ngan" };
}

/**
 * ★★★ G11 (audit 2026-09-22 · dự án thật D3) — **CẦU CHÌ G2 KHÔNG ĐƯỢC PHỦ QUYẾT MỘT ĐƠN SINH MÃ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Viết phần cốt lõi của một website … Dùng PostgreSQL + Node.js (Express) + React"* ⇒ 43 ms,
 * 0 lần gọi model, đáp án là **"Không có tệp/thư mục \"Node.js\" trong hộp cát repo."**
 *
 * Cầu chì G2 (`moiVongDeuTuChoi`) ra đời để chặn BỊA: khi ngân sách cạn và **mọi** vòng đọc bị từ
 * chối, gọi model là mời nó dựng ra một Express router không tồn tại (đo được 7/10 lượt). Lý lẽ ấy
 * vẫn đúng — nhưng nó đúng cho **câu hỏi VỀ repo**. Với một đơn **SINH MÃ MỚI**, repo chưa bao giờ
 * là nguồn của câu trả lời, nên chẳng có gì để bịa về nó cả: một `NOT_FOUND` chỉ nói *"cái tên bạn
 * nhắc không có ở đây"*, và với đơn hàng "viết cho tôi một website" thì đó là thông tin **vô can**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * RANH GIỚI — VÀ VÌ SAO NÓ KHÔNG MỞ LẠI LỖ G2 ĐÃ BỊT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chỉ **hai** ghi chú được coi là vô can: `NOT_FOUND` và `NO_MATCH` — cả hai đều có nghĩa *"tôi đã
 * tìm, và không có"*. Mọi ghi chú khác (`DENIED_SECRET`, hết ngân sách, ngoài hộp cát, lỗi đọc…)
 * đều có nghĩa *"tôi KHÔNG ĐƯỢC/KHÔNG THỂ đọc"* — đó đúng là cảnh mà G2 đo được hành vi bịa, nên
 * cầu chì **vẫn nổ nguyên như cũ**, kể cả khi câu là sinh mã.
 *
 * ⚠ Đây là **CƠ CHẾ**, không phải một danh sách tên phải nhớ cập nhật: dù `tenCongNghe.ts` có sót
 *   bao nhiêu tên khung mới ra đời đi nữa, đơn sinh mã vẫn tới được model. Bảng tên làm câu trả lời
 *   SẠCH hơn; hàng rào này làm nó KHÔNG BIẾN MẤT.
 */
const GHI_CHU_VO_CAN_VOI_SINH_MA: ReadonlySet<string> = new Set(["NOT_FOUND", "NO_MATCH"]);

export function cauChiNenNo(
  notes: ReadonlyArray<string | null | undefined>,
  laDonSinhMa: boolean,
): boolean {
  if (!moiVongDeuTuChoi(notes)) return false;
  if (!laDonSinhMa) return true;
  // Sinh mã: chỉ tha khi MỌI ghi chú đều thuộc nhóm "đã tìm, không có".
  return !notes.every((n) => GHI_CHU_VO_CAN_VOI_SINH_MA.has(String(n ?? "").trim().toUpperCase()));
}
