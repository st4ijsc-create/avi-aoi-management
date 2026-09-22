/**
 * ggufCtxCap.ts — G5-B (2026-08-16): **MỘT NGUỒN SỰ THẬT cho trần ngữ cảnh (`n_ctx`).**
 *
 * ─── VÌ SAO MODULE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Trần ctx trước đây được khai **HAI LẦN, ĐỘC LẬP**:
 *   1. `aiGgufEngine.ts` — `GGUF_MAX_CTX = parseInt(env.GGUF_MAX_CTX ?? "32768")`, dùng để kẹp
 *      mọi `contextSize` được yêu cầu (`resolveContextSize`) và để kẹp `EMBED_CTX`.
 *   2. `aiModelRouter.ts` — `codeContextSize()` đọc LẠI cùng biến env rồi **kẹp thêm lần thứ hai**
 *      bằng một hằng `32768` viết cứng: `Math.min(max, 32768)`.
 *
 * Hệ quả đo được: nâng `GGUF_MAX_CTX` trong `.env` lên trên 32768 **KHÔNG có tác dụng** với tầng
 * `code` — hằng viết cứng ở (2) cắt lại đúng 32768 mà không nói gì. Đây đúng lớp lỗi *"cờ khai mà
 * vô hiệu"*: cấu hình khai một con số, hệ chạy bằng con số khác, không có gì đỏ.
 *
 * ⇒ Cả hai nơi nay gọi `ggufMaxCtx()` ở đây. Muốn đổi trần thì đổi `GGUF_MAX_CTX` — **một chỗ**.
 *
 * ─── PHẠM VI ──────────────────────────────────────────────────────────────────────────────────
 * Module này CHỈ đọc env và trả một con số. KHÔNG quyết định tầng, KHÔNG chọn model, KHÔNG I/O.
 * Nó cố tình nhỏ và không phụ thuộc gì để `aiModelRouter.route()` (thuần, đồng bộ) và
 * `aiGgufEngine` (nặng) đều import được mà không kéo theo nhau.
 *
 * ⚠ Mặc định chỉ đổi khi CÓ PHÉP ĐO, không theo cảm giác; ngân sách VRAM cho phép bao nhiêu là chuyện
 * của phép đo, không phải của file này. Việc của module là làm cho con số **nâng được từ MỘT chỗ**.
 */

/**
 * Mặc định khi `GGUF_MAX_CTX` không được gán / không phân tích được.
 *
 * ★ B3 (2026-09-22, ĐO ĐƯỢC) — 32768 → **65536**, chủ dự án duyệt điều kiện *"H tốt hơn + VRAM ≥ 3 GB"*:
 *   · Qwen3.6-35B-A3B (MoE, KV f16 = 80 KiB/token ⇒ 64k chỉ +2,5 GiB; card 32,6 GiB còn 6,1 GiB sau nạp);
 *   · trục H 12 bài × 3: **27/36 → 31/36 (75 % → 86 %)**, không bài nào tụt, lần đầu đường ống vượt model thuần
 *     (83 %) — vì ngân sách ngữ cảnh repo (mục lục + khối mã) hết bị bó ở 32k; agentic 5/6, 0 G5-D.
 *   · Chỉ MỘT biến đổi trong phép đo (llama-server `-c 65536` + biến này); trần nghĩ 16k, sampling giữ nguyên.
 * ⚠ Con số này phải KHỚP `n_ctx`/slot của llama-server (`start-llama-server.ps1`: `-c` chia cho `-np`):
 *   ctx/slot < trần này ⇒ request bị từ chối ⇒ mã lùi in-process ⇒ nạp bản thứ hai model. Bản dày 27B KHÔNG
 *   nạp nổi 64k trong 32 GB — mặc định này là cho MoE đang chạy; đổi model dày thì hạ qua `.env`.
 * Đổi mặc định ở ĐÂY, không ở nơi nào khác.
 */
export const GGUF_MAX_CTX_DEFAULT = 65536;

/** Trần dưới tuyệt đối cho mọi `contextSize` được yêu cầu (dùng chung với `resolveContextSize`). */
export const GGUF_MIN_CTX = 256;

/**
 * Trần trên hiệu dụng cho mọi `n_ctx`, đọc từ `GGUF_MAX_CTX` **tại thời điểm gọi** (không đóng
 * băng lúc import — test đổi env rồi gọi lại là thấy ngay).
 *
 * Phép phân tích giữ NGUYÊN HỆT bản cũ của `aiGgufEngine` (`parseInt(..., 10)`, chấp nhận số
 * dương hữu hạn, ngược lại về mặc định) để việc gom về một chỗ **không kèm đổi hành vi**.
 */
export function ggufMaxCtx(): number {
  const n = parseInt(process.env.GGUF_MAX_CTX || String(GGUF_MAX_CTX_DEFAULT), 10);
  return Number.isFinite(n) && n > 0 ? n : GGUF_MAX_CTX_DEFAULT;
}

/**
 * Kẹp một `contextSize` được yêu cầu vào `[GGUF_MIN_CTX, ggufMaxCtx()]`.
 * `undefined`/không hợp lệ → `fallback` (bên gọi quyết định, thường là `GGUF_DEFAULT_CTX`).
 */
export function clampCtx(requested: number | undefined, fallback: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.max(Math.floor(requested), GGUF_MIN_CTX), ggufMaxCtx());
}
