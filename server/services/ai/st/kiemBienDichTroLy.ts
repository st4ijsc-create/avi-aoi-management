/**
 * ★ Đợt 9 (2026-10-23, dieu-phoi giao — A/B "vòng kiểm biên dịch trên TRỢ LÝ LẬP TRÌNH") — vòng kiểm + tự sửa biên dịch ST cho đường
 * SINH MÃ của trợ lý (`/api/ai/local-kb/stream`, `codingMode`), cùng lõi với /v1 (`kiemVaSuaST`, lời nhắc chung `shared/stNhacSua.mjs`).
 *
 * Bật khi `AI_KIEM_BIEN_DICH_ST` có `tro-ly` (hoặc `all`) VÀ lượt không opt-out (`context.kiemBienDichST === false` — nhánh "tắt"
 * của A/B trên CÙNG server). Mã đã STREAM xong ⇒ bản đã sửa đi về bằng hợp đồng SẴN CÓ `done.answerRevised` (client THAY văn bản,
 * như bổ sung `using` C#) — giống /v1 KHÔNG stream: người đọc nhận BẢN CUỐI + một dòng ghi chú.
 * Trong lúc sửa (lượt sinh lại không stream, 27B có thể > 2 phút): phát `tool_loop` mỗi `NHIP_MS` — luồng SSE không im lặng
 * (fetch của Node cắt thân im > 300 s) và người dùng thấy "đang biên dịch / sửa".
 * Hỏng hạ tầng / lỗi gọi model ⇒ giữ NGUYÊN câu trả lời đầu (không bao giờ làm mất câu trả lời).
 */
import type { GgufChatMessage, GgufGenerateResult } from "../../aiGgufEngine";
import { stripThinking } from "../thinkingStrip";
import { headerKiemBienDich, kiemBienDichBat, kiemVaSuaST, nhanKiemBienDich, tranMsVongSuaST, type KetQuaKiemBienDichST } from "./kiemBienDichSt";

/** Nhịp phát tiến độ trong lúc vòng kiểm/sửa chạy. */
export const NHIP_MS = 15_000;

export function nenKiemBienDichTroLy(context: { kiemBienDichST?: unknown } | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return kiemBienDichBat("tro-ly", env) && context?.kiemBienDichST !== false;
}

/** Sự kiện tiến độ — đúng hình `StreamEvent` `tool_loop` (route chuyển tiếp sẵn). */
export interface TienDoKiem {
  type: "tool_loop";
  round: number;
  phase: "dang_goi" | "xong";
  toolName: "compile_st";
  elapsedMs: number;
}

export interface KetQuaKiemTroLy {
  kq: KetQuaKiemBienDichST;
  /** Câu trả lời CUỐI (đã sửa nếu `da-sua`) + ghi chú; `null` ⇒ không đổi gì (bỏ qua — không có mã ST). */
  traLoiCuoi: string | null;
  /** Câu trả lời cuối KHÁC bản đã stream ⇒ client phải THAY (`answerRevised`). */
  daThay: boolean;
  /** Ghi chú hiện ngay (token) trước `done`. */
  ghiChu: string | null;
  /** Ô máy đọc của `done` (`kiemBienDichST`) — kiểm nhánh A/B + tra cứu. */
  tomTat: string;
}

export interface YeuCauKiemTroLy {
  cauTraLoi: string;
  heThong: string;
  prompt: string;
  modelId: string | undefined;
  maxTokens: number;
  userId?: number;
  signal?: AbortSignal;
  /** Lưới thay engine / cổng. */
  chat?: (messages: GgufChatMessage[], modelId: string | undefined, maxTokens: number) => Promise<GgufGenerateResult>;
  ghiLuotSua?: (o: { ms: number; r: GgufGenerateResult | null }) => void;
  locRa?: (t: string) => string;
  bienDich?: Parameters<typeof kiemVaSuaST>[0]["bienDich"];
  nhipMs?: number;
}

/**
 * Chạy vòng kiểm/sửa, PHÁT `tool_loop` theo nhịp, TRẢ kết quả. Không bao giờ ném (lỗi ⇒ `khong-kiem-duoc`, giữ câu trả lời đầu).
 */
export async function* chayKiemBienDichTroLy(y: YeuCauKiemTroLy): AsyncGenerator<TienDoKiem, KetQuaKiemTroLy> {
  const t0 = Date.now();
  const chat =
    y.chat ??
    (async (messages: GgufChatMessage[], modelId: string | undefined, maxTokens: number) => {
      const { chatCompletion } = await import("../../aiGgufEngine");
      return chatCompletion({ messages, maxTokens, temperature: 0.25, topP: 0.9, repeatPenalty: 1.05 }, modelId);
    });
  let vong = 0;
  const loiHua = kiemVaSuaST({
    cauTraLoi: y.cauTraLoi,
    tranMs: tranMsVongSuaST(y.modelId),
    ...(y.signal ? { signal: y.signal } : {}),
    ...(y.bienDich ? { bienDich: y.bienDich } : {}),
    goiLai: async (tin, lanTruoc) => {
      vong++;
      const tSua = Date.now();
      let r: GgufGenerateResult;
      try {
        r = await chat(
          [
            { role: "system", content: y.heThong },
            { role: "user", content: y.prompt },
            { role: "assistant", content: lanTruoc },
            { role: "user", content: tin },
          ],
          y.modelId,
          y.maxTokens,
        );
      } catch (e) {
        y.ghiLuotSua?.({ ms: Date.now() - tSua, r: null });
        throw e;
      }
      y.ghiLuotSua?.({ ms: Date.now() - tSua, r });
      const sach = stripThinking(r.text).answer;
      return y.locRa ? y.locRa(sach) : sach;
    },
  }).then(
    (kq) => ({ kq, loi: null as unknown }),
    (loi: unknown) => ({ kq: null, loi }),
  );

  const nhip = y.nhipMs ?? NHIP_MS;
  for (;;) {
    let hen: ReturnType<typeof setTimeout> | null = null;
    const xong = await Promise.race([
      loiHua.then(() => true),
      new Promise<false>((r) => {
        hen = setTimeout(() => r(false), nhip);
      }),
    ]);
    if (hen) clearTimeout(hen);
    if (xong) break;
    yield { type: "tool_loop", round: Math.max(1, vong), phase: "dang_goi", toolName: "compile_st", elapsedMs: Date.now() - t0 };
  }
  const { kq: kqOk, loi } = await loiHua;
  const kq: KetQuaKiemBienDichST = kqOk ?? {
    trangThai: "khong-kiem-duoc",
    lyDo: `loi: ${(loi as Error)?.message ?? String(loi)}`.slice(0, 200),
    phuongNgu: null,
    trinhDich: "rusty",
    soVong: vong,
    soLoiDaSua: 0,
    chanDoanCuoi: [],
    cauTraLoiDau: y.cauTraLoi,
    cauTraLoiCuoi: y.cauTraLoi,
    msThem: Date.now() - t0,
  };
  if (kq.trangThai !== "bo-qua") yield { type: "tool_loop", round: Math.max(1, kq.soVong), phase: "xong", toolName: "compile_st", elapsedMs: Date.now() - t0 };
  const nhan = nhanKiemBienDich(kq);
  const daThay = kq.trangThai === "da-sua" && kq.cauTraLoiCuoi !== y.cauTraLoi;
  return {
    kq,
    traLoiCuoi: nhan ? `${kq.cauTraLoiCuoi}\n\n---\n${nhan}` : null,
    daThay,
    ghiChu: nhan ? `\n\n---\n${nhan}` : null,
    tomTat: headerKiemBienDich(kq),
  };
}
