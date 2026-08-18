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
 * ⚠ KHÔNG tự nâng mặc định. `GGUF_MAX_CTX_DEFAULT = 32768` giữ nguyên con số đang chạy; ngân sách
 * VRAM cho phép bao nhiêu là chuyện của phép đo, không phải của file này. Việc của module là làm
 * cho con số **nâng được từ MỘT chỗ**.
 */

/**
 * Mặc định khi `GGUF_MAX_CTX` không được gán / không phân tích được.
 * Giá trị 32768 là con số đang chạy trong `.env` (doc 34 §5.1 — mở 128K chỉ khi đọc repo/manual
 * lớn). Đổi mặc định ở ĐÂY, không ở nơi nào khác.
 */
export const GGUF_MAX_CTX_DEFAULT = 32768;

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
