/**
 * ★ T1 (2026-11-10) — LÁT MỎNG nối vòng TỰ KIỂM MÃ (`ai/tuKiemMa/`) vào chat coding, cạnh `aiLocalKnowledgeCodingKiemST.ts`.
 * Cờ `AI_CHAT_TU_KIEM_MA=1` (mặc định TẮT ⇒ `null`, KHÔNG một byte / sự kiện nào đổi). KHÔNG phát sự kiện SSE mới: kết cục đi ở
 * `done.tuKiemMa` (tóm tắt máy đọc) và — chỉ khi đã sửa được — ở `done.answer` (+ `answerRevised`) kèm một dòng ghi chú.
 * Không bao giờ ném (trừ huỷ): hạ tầng hỏng ⇒ "khong-kiem-duoc", câu trả lời giữ nguyên.
 */
import { bienDichMa } from "./ai/tuKiemMa/bienDichMa";
import { cheDoTuKiemMa, kiemVaSuaMa, soVongTuKiem, type KetQuaTuKiemMa, type NguonTuKiem } from "./ai/tuKiemMa/tuKiemMa";

export async function chayTuKiemMa(y: {
  cauTraLoi: string;
  goiLai: (tinSua: string, lanTruoc: string) => Promise<string>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** `context.tuKiemMa === true` của lượt — chỉ có nghĩa khi cờ env = `theo-luot`. */
  tuKiemMaLuot?: boolean;
}): Promise<{ ketQua: KetQuaTuKiemMa; nguon: NguonTuKiem } | null> {
  const env = y.env ?? process.env;
  const nguon = cheDoTuKiemMa(env, y.tuKiemMaLuot);
  if (!nguon) return null;
  try {
    const k = await kiemVaSuaMa({
      cauTraLoi: y.cauTraLoi,
      goiLai: y.goiLai,
      bienDich: bienDichMa,
      vongToiDa: soVongTuKiem(env),
      signal: y.signal,
    });
    return { ketQua: k, nguon };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    console.warn("[aiLocalKnowledge] tự kiểm mã lỗi (bỏ qua, giữ nguyên câu trả lời):", (e as Error)?.message);
    return null;
  }
}
