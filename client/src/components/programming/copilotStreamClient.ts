/**
 * Doc 80 · Đợt 1 · Task 8 (AI-07, phụ lục A §8 D1) — client của `POST /api/ai/programming-copilot/stream`.
 *
 * Thuần (không React) để test được:
 *   • `tachKhungSse`    — tách khung `data: …\n\n` (giữ phần dở dang cho mảnh TCP kế tiếp);
 *   • `apDungSuKien`    — gộp MỘT sự kiện vào trạng thái panel. `switch (type)` là DANH SÁCH TRẮNG
 *                         khớp union `CopilotStreamEvent` của server — lưới
 *                         `server/routes/programmingCopilotStream.sseCensus.test.ts` đối chiếu cả ba
 *                         (service · tuyến · client) để kiểu thứ năm không rơi im lặng ở đây;
 *   • `chayCopilotStream` — fetch có `AbortSignal` (huỷ ⇒ đóng kết nối ⇒ server abort llama-server).
 *
 * `result` giữ NGUYÊN hình dạng kết quả `copilotGenerate`; `error` được dựng lại thành đúng hình dạng mà
 * panel vốn đã hiển thị (từ chối của cổng an toàn / lỗi hệ thống có `errorCode`) ⇒ phần vẽ kết quả của
 * panel KHÔNG có nhánh thứ hai.
 */

export type CopilotStreamStage = "gate" | "retrieve" | "generate" | "validate" | "repair";

export interface CopilotStageMark {
  stage: CopilotStreamStage;
  attempt?: number;
  elapsedMs: number;
}

/** Hình dạng kết quả `copilotGenerate` (panel đọc có optional-chaining). */
export type CopilotResultLike = Record<string, unknown>;

export interface CopilotStreamState {
  stages: CopilotStageMark[];
  /** Chữ đang hiện dần của lượt model HIỆN TẠI (lượt tự sửa viết lại từ đầu ⇒ xoá). */
  text: string;
  result: CopilotResultLike | null;
}

export function trangThaiLuongMoi(): CopilotStreamState {
  return { stages: [], text: "", result: null };
}

/** Tách các khung SSE đầy đủ; `rest` là phần chưa trọn khung. Khung JSON hỏng bị bỏ qua. */
export function tachKhungSse(buffer: string): { events: unknown[]; rest: string } {
  const khung = buffer.split("\n\n");
  const rest = khung.pop() ?? "";
  const events: unknown[] = [];
  for (const k of khung) {
    for (const dong of k.split("\n")) {
      if (!dong.startsWith("data:")) continue;
      const du = dong.slice(5).trim();
      if (!du) continue;
      try {
        events.push(JSON.parse(du));
      } catch {
        /* một khung méo không giết cả luồng */
      }
    }
  }
  return { events, rest };
}

const STAGES: ReadonlySet<string> = new Set(["gate", "retrieve", "generate", "validate", "repair"]);

export function apDungSuKien(s: CopilotStreamState, raw: unknown, kind: string): CopilotStreamState {
  const e = (raw ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "stage": {
      if (typeof e.stage !== "string" || !STAGES.has(e.stage)) return s;
      const stage = e.stage as CopilotStreamStage;
      const mark: CopilotStageMark = {
        stage,
        ...(typeof e.attempt === "number" ? { attempt: e.attempt } : {}),
        elapsedMs: typeof e.elapsedMs === "number" ? e.elapsedMs : 0,
      };
      // Lượt model MỚI (sinh / tự sửa) viết lại chương trình từ đầu ⇒ chữ đang hiện bị thay.
      const text = stage === "generate" || stage === "repair" ? "" : s.text;
      return { ...s, stages: [...s.stages, mark], text };
    }
    case "token":
      return typeof e.token === "string" && e.token ? { ...s, text: s.text + e.token } : s;
    case "result":
      return e.result && typeof e.result === "object" ? { ...s, result: e.result as CopilotResultLike } : s;
    case "error": {
      const code = typeof e.code === "string" ? e.code : "INTERNAL";
      const userMessage = typeof e.userMessage === "string" ? e.userMessage : "";
      if (code === "SAFETY_REFUSED") {
        return {
          ...s,
          result: {
            ok: false,
            refused: true,
            refusalSource: "gate",
            ...(typeof e.reasonCode === "string" ? { reasonCode: e.reasonCode } : {}),
            userMessage,
            reason: userMessage,
            kind,
          },
        };
      }
      return {
        ...s,
        result: {
          ok: false,
          refused: false,
          kind,
          errorCode: code,
          note: userMessage,
          ...(typeof e.devDetail === "string" ? { devDetail: e.devDetail } : {}),
          ...(Array.isArray(e.citations) ? { citations: e.citations } : {}),
        },
      };
    }
    default:
      return s;
  }
}

export const DUONG_COPILOT_STREAM = "/api/ai/programming-copilot/stream";

export type KetQuaChay =
  | { status: "ok" }
  | { status: "aborted" }
  | { status: "http"; httpStatus: number; body: unknown }
  | { status: "network"; message: string };

export async function chayCopilotStream(
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal; onEvent: (e: unknown) => void; fetchImpl?: typeof fetch },
): Promise<KetQuaChay> {
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(DUONG_COPILOT_STREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const than = await res.json().catch(() => ({}));
      return { status: "http", httpStatus: res.status, body: than };
    }
    const rd = res.body.getReader();
    const giai = new TextDecoder();
    let dem = "";
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      const t = tachKhungSse(dem + giai.decode(value, { stream: true }));
      dem = t.rest;
      for (const e of t.events) opts.onEvent(e);
    }
    const cuoi = tachKhungSse(dem + giai.decode() + "\n\n");
    for (const e of cuoi.events) opts.onEvent(e);
    return { status: "ok" };
  } catch (err) {
    if (opts.signal?.aborted || (err as { name?: string })?.name === "AbortError") return { status: "aborted" };
    return { status: "network", message: String((err as Error)?.message ?? err) };
  }
}
