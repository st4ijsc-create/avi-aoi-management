/**
 * ★★★ B1 (kế hoạch 2026-09-22) — **LƯỢT NÀO ĐƯỢC NGHĨ, LƯỢT NÀO KHÔNG — QUYẾT MỘT CHỖ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC — T1 của bản rà soát tương thích Qwen3.6-35B-A3B
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Model mặc định mới **nghĩ theo mặc định** (template `thinking = 1`). Mọi lượt gọi PHỤ của đường
 * lập trình — chọn tệp (512 token), KB-QA (220/900), tạo khung, khối sửa — đi qua `motLuotModel` →
 * `streamCodingModel` → `YeuCauSinhChu`, mà kiểu ấy **không có `disableThinking`**, nên cờ tắt nghĩ
 * không bao giờ tới `ggufStream`. Đo sống trên `:8091`, đúng hình dạng lượt chọn tệp:
 *
 *     max_tokens 512 · thinking BẬT  ⇒  content: ""  ·  reasoning_content: 2.061 ký tự  ·  finish: length
 *
 * Tức lượt chọn tệp trên model mới **trả rỗng gần như chắc chắn**; KB-QA 220 token còn tệ hơn. Đây
 * là lỗ *đúng đắn*, không phải lỗ hiệu năng: người dùng nhận "không chọn được tệp" khi model đã chọn
 * xong trong đầu mà chưa kịp viết ra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT VỊ TỪ THUẦN, KHÔNG PHẢI `disableThinking: true` RẢI RÁC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ phân loại ý định đã tắt nghĩ đúng (`intentClassifier.ts:1661`) — bằng một dòng tại chỗ. Năm call
 * site còn lại thì không, và không ai thấy vì không có chỗ nào **liệt kê** lượt nào thuộc lớp nào.
 * Một bảng lớp lượt ở đây làm ba việc: (1) người thêm lượt mới phải xếp nó vào một lớp; (2) lưới canh
 * được *"lớp phụ ⇒ tắt nghĩ"* như một bất biến, không phải như một thói quen; (3) bộ chọn chế độ ở
 * màn lập trình (F3: Nghĩ sâu / Cân bằng / Nhanh) có một điểm duy nhất để ghi đè.
 *
 * Quy tắc, rút từ tiêu chí *"đúng trước nhanh"*:
 *   • lượt **SINH/SỬA MÃ** — thứ người dùng trả tiền bằng thời gian để nhận về đúng — được NGHĨ;
 *   • lượt **PHỤ** trả một cấu trúc nhỏ (đường tệp, JSON, câu trả lời ngắn từ RAG) — nghĩ chỉ đốt
 *     ngân sách rồi cắt cụt đúng phần cần đọc — KHÔNG nghĩ.
 * Trần token đi kèm: lớp nghĩ dùng `tranTokenSinhMa` (nới theo model, kẹp ctx); lớp phụ giữ trần
 * gốc của nó — nới trần cho một lượt không nghĩ là cấp ngữ cảnh nó không dùng.
 *
 * Module THUẦN: không I/O, không env, không giờ. Mọi nhánh có lưới.
 */

/** Các lớp lượt gọi model trên đường lập trình + KB. Thêm lớp mới ⇒ phải xếp vào một trong hai nhóm. */
export type LoaiLuot =
  | "sinh-ma"     // streamCodingGenerate — viết mã mới
  | "sua-tep"     // motLuotModel: chép lại cả tệp với thay đổi
  | "khoi-sua"    // motLuotModel: sửa MỘT khối trong tệp
  | "tao-khung"   // motLuotModel: dựng khung dự án mới
  | "chon-tep"    // motLuotModel: chọn đường tệp từ lỗi — JSON nhỏ
  | "kb-qa"       // KB-QA: trả lời ngắn từ RAG
  | "phan-loai"   // bộ phân loại ý định / chọn tool — JSON nhỏ
  | "trich-xuat"; // trích xuất có cấu trúc

const LOP_DUOC_NGHI: ReadonlySet<LoaiLuot> = new Set<LoaiLuot>(["sinh-ma", "sua-tep", "khoi-sua", "tao-khung"]);

/**
 * ★ F3 — chế độ nghĩ NGƯỜI DÙNG chọn cho một lượt (bộ chọn ở màn lập trình, đi theo TỪNG yêu cầu qua
 * `context.cheDoNghi`, không qua `.env`). Vắng ⇒ quy tắc lớp lượt.
 *   · `"nhanh"`    — tắt nghĩ cả lớp sinh/sửa mã (đo được: nhanh 5–15× nhưng đúng ít hơn ~10–15 điểm);
 *   · `"can-bang"` — đúng quy tắc lớp lượt (mặc định);
 *   · `"sau"`      — ngân sách nghĩ 24k THEO YÊU CẦU + trần sinh 32k (`ai/nghiSau.ts`, 2026-09-23). Trước đây
 *                    nó ≡ "can-bang" vì tưởng b9814 bỏ qua ngân sách theo yêu cầu — sai TÊN TRƯỜNG, không phải
 *                    thiếu khả năng (đo sống: `thinking_budget_tokens` 200 ⇒ nghĩ bị cắt đúng ngân sách).
 */
export type CheDoNghi = "sau" | "can-bang" | "nhanh";

const CHE_DO_NGHI: ReadonlySet<string> = new Set<CheDoNghi>(["sau", "can-bang", "nhanh"]);

/**
 * Danh sách TRẮNG cho trường client-khai `cheDoNghi` (cùng lập trường với `locTacVuNguoiChon`): chỉ
 * ĐÚNG ba literal đi qua; mọi thứ khác (hoa/thường, khoảng trắng, số, null) ⇒ `undefined` ⇒ quy tắc lớp.
 * Cố ý KHÔNG chuẩn hoá chuỗi: client là của ta, gửi đúng literal; một chuỗi "gần đúng" là dấu hiệu lỗi
 * chứ không phải ý muốn.
 */
export function locCheDoNghi(raw: unknown): CheDoNghi | undefined {
  return typeof raw === "string" && CHE_DO_NGHI.has(raw) ? (raw as CheDoNghi) : undefined;
}

/**
 * `true` ⇔ lớp lượt này ĐƯỢC nghĩ theo quy tắc mặc định. Hàm THUẦN.
 * `ghiDe` (từ bộ chọn chế độ F3) thắng quy tắc: `"nhanh"` tắt nghĩ cả lớp sinh mã; `"sau"` không
 * bật nghĩ cho lớp phụ (lớp phụ không có gì để nghĩ; bật chỉ đốt trần).
 */
export function luotDuocNghi(loai: LoaiLuot, ghiDe?: CheDoNghi): boolean {
  if (!LOP_DUOC_NGHI.has(loai)) return false;
  if (ghiDe === "nhanh") return false;
  return true;
}

/**
 * Trần token cho lượt, theo lớp. Hàm THUẦN.
 *   • lớp KHÔNG nghĩ ⇒ trả đúng `tranGoc` (không đổi hành vi cũ);
 *   • lớp nghĩ ⇒ `Math.max(tranGoc, tranNghi)` — `tranNghi` do người gọi tính bằng `tranTokenSinhMa`
 *     (đã kẹp ctx/slot − prompt); lấy max để một lượt vốn đã rộng (tạo khung 8.000) không bị co lại.
 */
export function tranTokenTheoLop(loai: LoaiLuot, tranGoc: number, tranNghi: number | null, ghiDe?: CheDoNghi): number {
  const goc = Number.isFinite(tranGoc) && tranGoc > 0 ? Math.floor(tranGoc) : 256;
  if (!luotDuocNghi(loai, ghiDe)) return goc;
  if (tranNghi === null || !Number.isFinite(tranNghi) || tranNghi <= 0) return goc;
  return Math.max(goc, Math.floor(tranNghi));
}
