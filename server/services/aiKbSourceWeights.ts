/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TRỌNG SỐ HẠNG NGUỒN CỦA RAG — **MODULE LÁ, KHÔNG IMPORT GÌ CẢ.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠⚠ VÌ SAO TÁCH RA KHỎI `aiLocalKnowledgeService.ts` — ĐÂY LÀ LÝ DO CƠ CHẾ, KHÔNG PHẢI GỌN GÀNG.
 *
 * Bảng trọng số trước đây nằm INLINE trong `retrieveKnowledge()`. Bộ đo duy nhất phát biểu được
 * về thứ hạng (`scripts/ai-eval/eval-rag-operational.mjs`) lại xếp hạng bằng **cosine THUẦN**:
 *
 *     const scored = embeddings.map((e) => ({ id: e.id, cos: cosine(qVec, e.embedding) }));
 *     scored.sort((a, b) => b.cos - a.cos);          // ← KHÔNG có typeWeight, KHÔNG có langWeight
 *
 * Hệ quả đo được: **đổi bất kỳ trọng số nào ⇒ bộ eval nhúc nhích ĐÚNG 0,0000.** Tức là suốt thời
 * gian bảng trọng số ấy tồn tại, KHÔNG có phép đo nào từng phát biểu được nó đúng hay sai — và một
 * yêu cầu "quét vài mức trọng số rồi chọn theo số" là **bất khả thi về mặt cấu tạo**, không phải
 * khó. Đây đúng lớp lỗi "thiết bị đo MÙ đúng thứ nó được dựng ra để đo".
 *
 * ⇒ Trọng số sống ở module LÁ (zero import) để **cả sản phẩm lẫn bộ đo dùng CHUNG một bản**.
 *   Bộ eval `import` thẳng file này (chế độ `--parity`), nên một lượt quét trọng số là phép đo
 *   trên **con số production thật**, không phải trên một bản chép tay có thể trôi.
 *
 * ⚠ RÀNG BUỘC: file này KHÔNG được `import` bất cứ thứ gì (kể cả kiểu). `eval-rag-operational.mjs`
 *   nạp nó bằng type-stripping của Node (`await import("...aiKbSourceWeights.ts")`); thêm một
 *   import là kéo theo cả cây phụ thuộc của server vào một script `node` trần ⇒ bộ đo gãy.
 */

/** Ngôn ngữ truy vấn. Sao lại tại chỗ (không import `KbLanguage`) để giữ module này là LÁ. */
export type KbWeightLanguage = "vi" | "en" | "zh";

// ─── Nhận dạng đường dẫn ──────────────────────────────────────────────────────────────────────

/** Tài liệu tiếng Việt hướng người dùng cuối — ưu tiên khi câu hỏi là tiếng Việt. */
export const VN_BOOST_PATH_RE = /(domain\/knowledge\/|USER_GUIDE|HUONG_DAN|_VI\.|HE_THONG|TRO_GIUP)/i;

/** Tài liệu nặng tiếng Anh — hạ khi hỏi tiếng Việt, nâng nhẹ khi hỏi tiếng Anh. */
export const EN_DEMOTE_PATH_RE = /(CSHARP_CLIENT|SERVER_PERFORMANCE_ASSESSMENT|_EN\.)/i;

/**
 * Báo cáo audit dạng "catalogue chuỗi UI thô" — tạo khớp giả trên mọi truy vấn không liên quan
 * (bất kỳ câu nào chứa chữ "audit" đều kéo báo cáo i18n lên). Hạ MẠNH (0,55).
 */
export const NOISE_DOC_RE =
  /(I18N_AUDIT_REPORT|SYSTEM_AUDIT_REPORT|AUDIT_REPORT|MODULE_AUDIT|_DELIVERABLE|_UPGRADE_REPORT|FRONTEND_AUDIT)/i;

/**
 * ★ G4-B — **NHẬT KÝ PHIÊN AGENT + THIẾT KẾ NỘI BỘ.** `docs/superpowers/**` (1.754 chunk) và
 * `docs/ECOSYSTEM/**` (1.631 chunk) = **3.385 / 7.306 chunk = 46% toàn kho**, trong khi nội dung
 * vận hành do người viết chỉ ~319 chunk (4,4%).
 *
 * Đây là tài liệu *quá trình* (kế hoạch, báo cáo pha, brief), KHÔNG phải tài liệu *vận hành*.
 * Nhiều bản trong đó đã bị pha sau vượt qua — trích dẫn chúng như hiện trạng là nói sai.
 *
 * ⚠⚠ **HẠ TRỌNG SỐ, KHÔNG LOẠI KHỎI CHUNKER** — và lý do KHÔNG nằm ở con số eval:
 *   Bộ 54 ca `rag-operational-cases.json` có **0 ca** mong đợi một đường dẫn `docs/**` (đã đếm:
 *   expectPaths chỉ trỏ vào knowledge/domain · knowledge/operational · knowledge/features). Nghĩa
 *   là thước ấy **về cấu tạo không thể** đo được CÁI GIÁ của việc xoá tài liệu kiến trúc — mọi mức
 *   hạ đều "tốt hơn", tối ưu của nó là *xoá sạch*. Chọn "loại hẳn" dựa trên một thước như vậy là
 *   **lượng từ tự thoả**. Vì vậy: (a) chỉ HẠ, để câu hỏi kiến trúc vẫn trả lời được; (b) cái giá
 *   được đo bằng bộ ca RIÊNG `rag-architecture-cases.json` (mong đợi `docs/ECOSYSTEM/**`), nên mức
 *   hạ được chọn từ **hai phía**, không phải một.
 */
export const DEV_JOURNAL_PATH_RE = /^docs\/(superpowers|ECOSYSTEM)\//i;

// ─── Bảng trọng số theo hạng nguồn ────────────────────────────────────────────────────────────

/**
 * ★ G4-B — `operational` và `playbook` TRƯỚC ĐÂY KHÔNG CÓ TRONG BẢNG.
 *
 * `operational` (162 thẻ "cách vận hành màn hình X") rơi về mặc định **1,00** — tức THẤP HƠN
 * `feature` 1,18 và `domain` 1,08, và NGANG với 2.428 chunk mã nguồn dài 155–215 ký tự. Thẻ vận
 * hành là hạng nguồn **gần câu hỏi người vận hành nhất** mà lại là hạng bị xếp thấp nhất trong ba
 * hạng do người viết.
 *
 * `playbook` là hạng MỚI (G4-B nhiệm vụ 1): 6 quy trình ứng cứu sự cố `.yaml` trước đây **0 chunk**
 * vì chunker chỉ đi `.md`.
 *
 * ⚠ MỌI con số dưới đây do một lượt QUÉT chọn ra, không phải chọn bằng cảm giác — và quét trên
 * BA bộ ca, vì mỗi bộ một mình đều là thước MỘT PHÍA:
 *
 *   trọng số        │ vận hành 54 ca    │ playbook 8 ca      │ kiến trúc 10 ca
 *   ────────────────┼───────────────────┼────────────────────┼─────────────────
 *   op 1,00 (cũ)    │ 0,452 · rec 0,705 │ —                  │ 0,360
 *   op 1,08         │ 0,452 · rec 0,707 │ —                  │ 0,360
 *   **op 1,15** ←   │ **0,470 · 0,734** │ —                  │ 0,340
 *   op 1,25         │ 0,463 · rec 0,723 │ —                  │ 0,340
 *   op 1,40         │ 0,448 · rec 0,701 │ —                  │ 0,260 (nhiễu↑ 0,30)
 *   ────────────────┼───────────────────┼────────────────────┼─────────────────
 *   pb 1,00         │ 0,452 · MRR 0,969 │ 0,225 · rec 0,563  │ 0,360
 *   **pb 1,15** ←   │ 0,452 · MRR 0,946 │ **0,350 · 0,875**  │ 0,360
 *   pb 1,30         │ 0,437 · MRR 0,921 │ 0,400 · rec 1,000  │ 0,360
 *   pb 1,60         │ 0,411 · MRR 0,831 │ 0,400 · rec 1,000  │ 0,280
 *
 * ⚠⚠ `playbook` KHÔNG được đặt cao hơn `feature` dù nó là nội dung ứng cứu giá trị nhất — và lý do
 *   là phép đo, không phải thứ bậc cảm tính. Ở pb=1,30 bộ playbook chỉ thêm +0,05 P@5 (8 ca) trong
 *   khi bộ vận hành mất −0,015 P@5 và −0,048 MRR trên 54 ca: cộng lại là ÂM. pb=1,15 lấy gần hết
 *   phần được (+0,125 P@5 · +0,312 recall trên bộ playbook) với chi phí ≈0 trên bộ chính.
 *
 * ⚠ Bộ 54 ca vận hành được viết KHI playbook còn 0 chunk ⇒ nó có 0 ca mong đợi `workflows/**`, nên
 *   một mình nó chỉ đo được CHI PHÍ của việc nâng playbook, không đo được phần LỢI — kết luận rút
 *   từ nó sẽ luôn là "đừng nâng". Đó là lý do `rag-playbook-cases.json` tồn tại.
 *
 * Chạy lại toàn bộ:
 *     node scripts/ai-eval/eval-rag-operational.mjs --parity --sweep
 *     node scripts/ai-eval/eval-rag-operational.mjs --parity --sweep --cases scripts/ai-eval/rag-playbook-cases.json
 *     node scripts/ai-eval/eval-rag-operational.mjs --parity --sweep --cases scripts/ai-eval/rag-architecture-cases.json
 */
export const SOURCE_TYPE_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  feature: 1.18,
  operational: 1.15,
  playbook: 1.15,
  domain: 1.08,
  doc: 0.9,
});

/** Hạng không có tên trong bảng (router/service/type/route/nav/schema_table/module/pattern). */
export const DEFAULT_TYPE_WEIGHT = 1.0;

/**
 * ★★★ HỆ SỐ NHÂN CHO NHẬT KÝ DEV — **ĐO XONG RỒI ĐẶT VỀ 1,0 (KHÔNG HẠ).**
 *
 * Đây là chỗ một giả thuyết của CHÍNH TÔI bị phép đo bác bỏ, nên ghi lại đầy đủ thay vì lặng lẽ
 * sửa số. Brief G4-B đề xuất "hạ `docs/superpowers` + `docs/ECOSYSTEM`", tôi đã đặt 0,80 trước khi
 * đo. Lượt quét hai phía (`--sweep`, cùng một lượt nhúng) nói:
 *
 *   mức hạ │ vận hành 54 ca (P@5 · MRR) │ kiến trúc 10 ca (P@5 · MRR)
 *   ───────┼────────────────────────────┼────────────────────────────
 *   1,00   │ 0,452 · 0,969              │ 0,360 · 0,825
 *   0,90   │ 0,456 · 0,969              │ 0,220 · 0,592
 *   0,80   │ 0,456 · 0,969              │ 0,180 · 0,317
 *   0,55   │ 0,456 · 0,969              │ **0,000 · 0,003**
 *
 * ⇒ Cái ĐƯỢC bão hoà ngay ở 0,90 và chỉ đáng **+0,004 P@5** (≈ một vị trí chunk trên toàn bộ 54
 *   ca — mức nhiễu). Cái MẤT thì tuyến tính và tới 0,55 là **xoá sạch** khả năng trả lời câu hỏi
 *   kiến trúc: 0/10 ca còn tìm được tài liệu đúng.
 *
 * ⚠⚠ Và nếu chỉ chạy bộ 54 ca vận hành thì **mọi mức hạ đều trông "hơi tốt hơn"** — vì bộ ấy có 0
 *   ca mong đợi `docs/**`. Tối ưu của một thước một-phía như vậy là *xoá sạch tài liệu kiến trúc*,
 *   và nó sẽ báo xanh trong khi làm việc đó. Đúng lớp lỗi "lượng từ TỰ THOẢ".
 *
 * ⇒ **KHÔNG HẠ.** Vấn đề brief mô tả (tài liệu dev lấn át) hoá ra được giải quyết bởi HAI cơ chế
 *   khác đã có/vừa thêm: nâng hạng nội dung vận hành, và `PER_SOURCE_CAP=2` vốn đã chặn một tài
 *   liệu dài chiếm nhiều ô. Đo bằng `--probe`: câu "Máy dừng đột ngột thì phải làm gì" đi từ
 *   8/20 tài liệu dev trong top-20 xuống **0/20** mà KHÔNG cần hạ một hệ số nào.
 *
 * Cơ chế được GIỮ LẠI (chứ không xoá) để lượt quét còn tái lập được và để việc bật lại là một
 * hằng số kèm một cổng test — không phải một quyết định thầm lặng.
 */
export const DEV_JOURNAL_WEIGHT = 1.0;

/** Bộ ghi đè dùng cho MỘT lượt quét — sản phẩm không bao giờ truyền tham số này. */
export interface KbWeightOverrides {
  types?: Readonly<Record<string, number>>;
  devJournal?: number;
}

export function sourceTypeWeight(sourceType: string, overrides?: KbWeightOverrides): number {
  const table = overrides?.types ?? SOURCE_TYPE_WEIGHTS;
  const w = table[sourceType];
  return typeof w === "number" ? w : DEFAULT_TYPE_WEIGHT;
}

export function devJournalWeight(sourcePath: string, overrides?: KbWeightOverrides): number {
  if (!DEV_JOURNAL_PATH_RE.test(normalizePath(sourcePath))) return 1;
  return overrides?.devJournal ?? DEV_JOURNAL_WEIGHT;
}

/** Chuẩn hoá "\" → "/" — chunk id trên Windows có thể mang dấu ngược. */
function normalizePath(p: string): string {
  return String(p ?? "").replace(/\\/g, "/");
}

export function sourceLanguageWeight(sourcePath: string, qLang: KbWeightLanguage): number {
  if (NOISE_DOC_RE.test(sourcePath)) return 0.55;
  // zh không có kho riêng; xử như nhánh EN (trung tính) — kho là vi/en, LLM dịch khái niệm sang
  // zh lúc sinh câu trả lời.
  if (qLang === "vi") {
    if (VN_BOOST_PATH_RE.test(sourcePath)) return 1.08;
    if (EN_DEMOTE_PATH_RE.test(sourcePath)) return 0.92;
  } else {
    if (EN_DEMOTE_PATH_RE.test(sourcePath)) return 1.05;
    if (VN_BOOST_PATH_RE.test(sourcePath)) return 0.95;
  }
  return 1;
}

/**
 * Toàn bộ phần trọng-số-theo-NGUỒN của công thức xếp hạng (ngôn ngữ × hạng × nhật-ký-dev).
 * KHÔNG bao gồm `routeWeight`/`feedbackWeight` — hai cái đó phụ thuộc ngữ cảnh phiên, không phải
 * thuộc tính của nguồn, nên chúng ở lại `retrieveKnowledge()`.
 */
export function sourceWeight(
  sourcePath: string,
  sourceType: string,
  qLang: KbWeightLanguage,
  overrides?: KbWeightOverrides,
): number {
  return (
    sourceLanguageWeight(sourcePath, qLang) *
    sourceTypeWeight(sourceType, overrides) *
    devJournalWeight(sourcePath, overrides)
  );
}
