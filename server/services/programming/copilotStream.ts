/**
 * Doc 80 · Đợt 1 · Task 8 (AI-07, phụ lục A §8 D1) — COPILOT LẬP TRÌNH QUA SSE: stage · token · huỷ.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * MỘT PIPELINE, HAI CỬA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Thủ tục tRPC `programming.copilotGenerate` (tool chat, khách cũ) và tuyến SSE
 * `POST /api/ai/programming-copilot/stream` (panel) gọi CÙNG:
 *   • `copilotGenerateInput` — lược đồ đầu vào (một zod, không hai);
 *   • `generateProgram()`    — cổng an toàn → RAG → sinh → validate (parser ST thật, Task 7) → tự sửa;
 *   • `hoanThienKetQuaCopilot()` — gỡ `devDetail` với vai khác admin + nhãn "không phải chứng nhận"
 *     cho explain chạm chủ đề an toàn.
 * Tuyến SSE chỉ thêm `TheoDoiCopilot` (stage/token/huỷ) — KHÔNG có bản sao logic nào ở đây.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG SỰ KIỆN (`CopilotStreamEvent`) — tuyến SSE là DANH SÁCH TRẮNG, lưới
 * `programmingCopilotStream.sseCensus.test.ts` đối chiếu union này với các `case` của tuyến.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *   stage  — gate / retrieve / generate / validate / repair(attempt) + `elapsedMs` từ đầu lượt;
 *   token  — chữ trả lời hiện dần (đã cắt suy luận);
 *   result — CÙNG hình dạng kết quả `copilotGenerate` (sau `hoanThienKetQuaCopilot`);
 *   error  — `{code, userMessage}` (+ `reasonCode` khi cổng an toàn chặn; + `devDetail` CHỈ admin).
 *            `code` ∈ `SAFETY_REFUSED` | `CopilotErrorCode` (MODEL_OFFLINE · TOKEN_BUDGET ·
 *            CONTEXT_TOO_LARGE · MODEL_UNAVAILABLE · EMPTY_OUTPUT · INTERNAL).
 * Huỷ (người gọi abort) ⇒ KHÔNG phát gì nữa: người nhận đã đi.
 */
import { z } from "zod";
import { PROGRAMMING_KINDS, type ProgrammingKind } from "./programmingAdapter";
import {
  generateProgram,
  cauLoiCopilot,
  LoiCopilotBiHuy,
  type CopilotStage,
  type GenerateProgramInput,
  type GenerateProgramResult,
} from "./aiProgrammingCopilot";
import { detectRequestLang, isSafetyRelevantText, stripPlatformDiagnostics } from "./copilotSafetyGate";

const KIND = z.enum(PROGRAMMING_KINDS as [ProgrammingKind, ...ProgrammingKind[]]);

/** Lược đồ đầu vào DÙNG CHUNG của `copilotGenerate` và tuyến SSE (chuyển nguyên văn từ router). */
export const copilotGenerateInput = z.object({
  kind: KIND,
  request: z.string().min(1).max(4000),
  mode: z.enum(["generate", "complete", "translate", "review", "explain"]).optional(),
  vendor: z.string().max(64).optional(),
  contextCode: z.string().max(2_000_000).optional(),
  targetKind: KIND.optional(),
});
export type CopilotGenerateInput = z.infer<typeof copilotGenerateInput>;

/**
 * Doc 80 · Task 10 · AI-09 — chi tiết kỹ thuật (`devDetail`: chuỗi chẩn đoán G1-D/G5-D, trích suy
 * luận của model) CHỈ trả cho admin. Kỹ sư nhận câu ngắn trong `note` + `errorCode`. Pure/testable.
 * (Chuyển từ `programmingRouter` — router re-export để nơi gọi cũ không đổi.)
 */
export function anChiTietKyThuat<T extends { devDetail?: string }>(result: T, role: string | undefined | null): T {
  if (role === "admin" || !("devDetail" in result)) return result;
  const { devDetail: _bo, ...conLai } = result;
  return conLai as T;
}

export type KetQuaCopilotHoanThien = GenerateProgramResult & {
  safetyReviewRequired?: true;
  certified?: false;
  safetyNote?: string;
};

/**
 * Hậu xử lý kết quả `generateProgram` cho NGƯỜI GỌI (chuyển nguyên văn từ thân `copilotGenerate`):
 * gỡ `devDetail` theo vai; explain (được phép) trên mã/yêu cầu chạm chủ đề an toàn ⇒ gắn nhãn
 * "không phải chứng nhận". AI-13 — chẩn đoán `[safety-lint:…]` của CHÍNH nền tảng bị loại trước.
 */
export function hoanThienKetQuaCopilot(
  input: Pick<CopilotGenerateInput, "mode" | "request" | "contextCode">,
  raw: GenerateProgramResult,
  role: string | undefined | null,
): KetQuaCopilotHoanThien {
  const result = anChiTietKyThuat(raw, role);
  if (
    input.mode === "explain" &&
    !result.refused &&
    isSafetyRelevantText(stripPlatformDiagnostics(input.request), input.contextCode)
  ) {
    return {
      ...result,
      safetyReviewRequired: true as const,
      certified: false as const,
      safetyNote:
        "Chương trình chứa logic liên quan AN TOÀN — phần giải thích này KHÔNG phải chứng nhận. " +
        "Yêu cầu KỸ SƯ AN TOÀN có thẩm quyền kiểm định trên bộ điều khiển đã được chứng nhận.",
    };
  }
  return result;
}

export type CopilotStreamEvent =
  | { type: "stage"; stage: CopilotStage; attempt?: number; elapsedMs: number }
  | { type: "token"; token: string }
  | { type: "result"; result: KetQuaCopilotHoanThien }
  | { type: "error"; code: string; userMessage: string; reasonCode?: string; devDetail?: string };

/**
 * Chạy MỘT lượt copilot, phát sự kiện theo thứ tự. Cầu nối callback (`TheoDoiCopilot`) → async
 * generator bằng một hàng đợi: `generateProgram` không biết gì về SSE.
 */
export async function* streamCopilot(
  input: CopilotGenerateInput,
  opts: { callerRole?: string | null; signal?: AbortSignal },
): AsyncGenerator<CopilotStreamEvent> {
  const t0 = Date.now();
  const hang: CopilotStreamEvent[] = [];
  let danhThuc: (() => void) | null = null;
  const day = (e: CopilotStreamEvent) => {
    hang.push(e);
    const d = danhThuc;
    danhThuc = null;
    d?.();
  };

  let xong = false;
  let ketQua: GenerateProgramResult | null = null;
  let loi: unknown = null;
  const lang = detectRequestLang(input.request);
  const role = opts.callerRole ?? undefined;

  const input2: GenerateProgramInput = { ...input, callerRole: String(role ?? "") };
  void generateProgram(input2, {
    onStage: (stage, info) =>
      day({ type: "stage", stage, ...(info?.attempt ? { attempt: info.attempt } : {}), elapsedMs: Date.now() - t0 }),
    onToken: (token) => day({ type: "token", token }),
    signal: opts.signal,
  })
    .then(
      (r) => {
        ketQua = r;
      },
      (e) => {
        loi = e;
      },
    )
    .finally(() => {
      xong = true;
      const d = danhThuc;
      danhThuc = null;
      d?.();
    });

  for (;;) {
    while (hang.length) yield hang.shift()!;
    if (xong) break;
    await new Promise<void>((r) => {
      danhThuc = r;
    });
  }

  if (opts.signal?.aborted || loi instanceof LoiCopilotBiHuy) return;
  if (loi) {
    console.error("[copilotStream] pipeline copilot ném:", (loi as Error)?.message ?? loi);
    yield {
      type: "error",
      code: "INTERNAL",
      userMessage: cauLoiCopilot("INTERNAL", lang),
      ...(role === "admin" ? { devDetail: String((loi as Error)?.message ?? loi) } : {}),
    };
    return;
  }
  const r = ketQua as GenerateProgramResult | null;
  if (!r) return;
  if (r.refused) {
    // Cổng an toàn chặn TRƯỚC model (generateProgram không gọi model nào ở nhánh này).
    yield {
      type: "error",
      code: "SAFETY_REFUSED",
      userMessage: r.userMessage ?? r.reason ?? "",
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
    };
    return;
  }
  if (r.errorCode) {
    // Lỗi HỆ THỐNG (không có mã/giải thích): câu ngắn + mã; chi tiết kỹ thuật chỉ admin.
    yield {
      type: "error",
      code: r.errorCode,
      userMessage: r.note ?? cauLoiCopilot(r.errorCode, lang),
      ...(role === "admin" && r.devDetail ? { devDetail: r.devDetail } : {}),
    };
    return;
  }
  yield { type: "result", result: hoanThienKetQuaCopilot(input, r, role) };
}
