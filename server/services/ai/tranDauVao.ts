/**
 * ★★★ Trần kích thước đầu vào ở CỬA VÀO của AI Local (kiem-dinh 2026-10-26) — lớp bảo vệ CHÍNH trước bộ che / model; vá regex (`cheTuyenTinh.ts`) là lớp hai.
 *
 * ĐO TRƯỚC KHI ĐẶT: thân JSON của `/api/ai/*` và `/api/trpc/*` cho tới 200 MB, mặc định 25 MB, `/v1` 20 MB; `/api/ai/local-kb/{retrieve,ask,stream}` KHÔNG giới
 * hạn độ dài `question`/`history[].content`; `/v1` không giới hạn tổng nội dung `messages`. Bộ che mất ~90 ms/MB (đo, sau khi vá) ⇒ 200 MB = ~18 s chặn vòng lặp
 * sự kiện — cùng tiến trình với đường STOP. Context của model là 64k token ≈ 256 KB; trần dưới đây rộng hơn 8–400 lần mà vẫn chặn được thân nghìn-lần-lớn-hơn-cần.
 *
 * Cửa vào ĐÃ có trần (không đụng): lượt agent (`TRAN_KY_TU_CAU_HOI = 20 000`, `quanLyLuotChay.ts`).
 * THUẦN, không ném.
 */

const docSo = (ten: string, macDinh: number): number => {
  const n = Number(process.env[ten]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : macDinh;
};

/** KB (retrieve / ask / stream): `question` và MỖI `history[].content`. Đặt lại bằng env `AI_KB_TRAN_KY_TU`. */
export const tranKyTuKb = (): number => docSo("AI_KB_TRAN_KY_TU", 100_000);
/** `/v1`: TỔNG ký tự nội dung chữ của mọi message. Đặt lại bằng env `OPENAI_GATEWAY_MAX_CHARS`. */
export const tranKyTuV1Tong = (): number => docSo("OPENAI_GATEWAY_MAX_CHARS", 2_000_000);

export interface KetQuaTran {
  ok: boolean;
  /** vượt ở đâu (không chứa nội dung) */
  noi?: string;
  tran?: number;
}

/** `question` + từng `history[].content` (đã là chuỗi) có vượt trần KB không. */
export function kiemTranKb(question: string, history: ReadonlyArray<{ content: string }> = []): KetQuaTran {
  const tran = tranKyTuKb();
  if (question.length > tran) return { ok: false, noi: "question", tran };
  for (let i = 0; i < history.length; i++) if (history[i]!.content.length > tran) return { ok: false, noi: `history[${i}]`, tran };
  return { ok: true };
}

/** Tổng ký tự chữ trong `messages` kiểu OpenAI (`content` là chuỗi, hoặc mảng phần `{type:"text", text}`); phần lạ/ảnh không tính (đã có kiểm riêng). */
export function tongKyTuNoiDung(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let tong = 0;
  for (const m of messages) {
    const c = (m as { content?: unknown } | null)?.content;
    if (typeof c === "string") tong += c.length;
    else if (Array.isArray(c)) for (const p of c) if (typeof (p as { text?: unknown } | null)?.text === "string") tong += (p as { text: string }).text.length;
  }
  return tong;
}

export function kiemTranV1(messages: unknown): KetQuaTran {
  const tran = tranKyTuV1Tong();
  return tongKyTuNoiDung(messages) > tran ? { ok: false, noi: "messages", tran } : { ok: true };
}
