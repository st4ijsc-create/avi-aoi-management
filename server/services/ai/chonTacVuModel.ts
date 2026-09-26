/**
 * ★★★ G4 (audit 2026-09-21 · P4) — CHỌN TẦNG MODEL THEO **TỪNG YÊU CẦU**, KHÔNG THEO BIẾN MÔI TRƯỜNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHOẢNG TRỐNG ĐO ĐƯỢC SO VỚI CLAUDE / CURSOR
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   Claude Code : `/model` — đổi theo phiên
 *   Cursor      : dropdown — đổi theo TỪNG câu
 *   AI Local    : **không có gì**. `AICodingWorkspace.tsx` dùng `ModelSelect` **0 lần**, và
 *                 `ModelSelect` vốn để chọn model THỊ GIÁC AOI (`aiModel.list`), không phải LLM.
 *                 Cách duy nhất để đổi: sửa `.env` + **khởi động lại server**.
 *
 * `tacVuModel()` cũ đọc thẳng `process.env.AI_CODING_MODEL_TASK` ⇒ một tiến trình = một lựa chọn cho
 * MỌI người dùng, MỌI câu hỏi. Hàm này biến biến môi trường ấy thành **MẶC ĐỊNH CỦA HỆ**, còn quyền
 * chọn trả về cho từng lượt.
 *
 * ⚠ AN TOÀN: giá trị đến từ CLIENT nên đây là danh sách TRẮNG, fail-safe về mặc định. Một chuỗi lạ
 *   KHÔNG được phép trở thành một `task` mà `aiModelRouter` chưa biết — đó là cách một trường
 *   client-khai biến thành lỗi 500 hoặc tệ hơn, một model ngoài dự tính bị nạp.
 * ⚠ Lựa chọn này KHÔNG nới quyền: RBAC, hộp cát, thẻ duyệt, ngân sách byte đều không đọc nó.
 */

/** Giá trị client được phép gửi. Bất kỳ thứ gì khác ⇒ `"auto"`. */
export type TacVuNguoiChon = "auto" | "fast" | "code";

/** Tầng mà `aiModelRouter` hiểu. `"chat"` là mặc định lịch sử của chế độ lập trình. */
export type TacVuRouter = "chat" | "code" | "fast";

const HOP_LE: ReadonlySet<string> = new Set(["auto", "fast", "code"]);

/** Lọc một giá trị client-khai về đúng miền. Hàm thuần, fail-safe. */
export function locTacVuNguoiChon(raw: unknown): TacVuNguoiChon {
  return typeof raw === "string" && HOP_LE.has(raw) ? (raw as TacVuNguoiChon) : "auto";
}

/**
 * Quyết định tầng cuối cùng.
 *
 *   • người chọn `"code"` / `"fast"` ⇒ theo người, **không cần khởi động lại**.
 *   • người chọn `"auto"` (hoặc không chọn) ⇒ theo mặc định của hệ (`AI_CODING_MODEL_TASK`),
 *     tức **hành vi cũ y nguyên** — điều kiện để bản vá này không đổi gì cho ai chưa dùng bộ chọn.
 */
export function chonTacVuModel(nguoiChon: unknown, envTask: string | undefined): TacVuRouter {
  const c = locTacVuNguoiChon(nguoiChon);
  if (c === "code") return "code";
  if (c === "fast") return "fast";
  return envTask === "code" ? "code" : "chat";
}
