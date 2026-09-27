/**
 * Doc 80 Đợt 1 final wave (item 1) — chunk `{type:"error"}` GIỮA lượt STREAM của copilot.
 *
 * Task 8 ném `throw new Error(c.error || …)` ở `goiModelStream` ⇒ `rawErrorCensus` 465 > 464. Nay là
 * `LoiLuongModelCopilot` (mang `reasonCode`). Lưới này canh HÀNH VI không đổi quanh chỗ vá:
 *   §A — message engine đi NGUYÊN VĂN vào `devDetail`, và `maLoiCua` vẫn phân loại được (slot/HTTP 5xx
 *        ⇒ MODEL_UNAVAILABLE) — tức đổi lớp lỗi không làm mất một bit chẩn đoán nào;
 *   §B — đường HUỶ vẫn phân biệt được: chunk error tới SAU khi người gọi đã huỷ ⇒ `LoiCopilotBiHuy`
 *        (không phải lỗi hệ thống, không có errorCode);
 *   §C — lớp lỗi có mã, và KHÔNG phải `LoiCopilotBiHuy` (hai lớp không thể nhầm bằng `instanceof`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Kịch bản của `chatCompletionStream` giả. */
  kichBan: "loi-ngay" as "loi-ngay" | "loi-sau-huy",
  /** Signal mà engine giả nhận được ở đối số thứ ba. */
  signalNhan: undefined as AbortSignal | undefined,
}));

vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  warmModel: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => {
    throw new Error("lưới này chỉ đi đường STREAM");
  }),
  generateJSON: vi.fn(async () => ({ data: null })),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
  chatCompletionStream: async function* (_o: unknown, _m: unknown, signal?: AbortSignal) {
    h.signalNhan = signal;
    if (h.kichBan === "loi-ngay") {
      yield { type: "token", token: "```st\n" };
      yield { type: "error", error: "[llamaServer] stream HTTP 503: no slot available" };
      return;
    }
    // loi-sau-huy: "model đang nghĩ" cho tới khi người gọi huỷ, rồi engine báo lỗi (fetch bị abort).
    await new Promise<void>((r) => {
      if (signal?.aborted) return r();
      signal?.addEventListener("abort", () => r(), { once: true });
    });
    yield { type: "error", error: "[llamaServer] stream lỗi: This operation was aborted" };
  },
}));
vi.mock("../aiModelRouter", () => ({
  route: () => ({ tier: 2, modelId: "code-model", requiresHitl: false, maxTokens: 1536, temperature: 0.3, jsonMode: false, contextSize: 65536, reason: "mock" }),
}));
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({ query: "", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [] })),
}));
vi.mock("../aiLocalKnowledgeService", () => ({
  retrieveKnowledge: vi.fn(async () => ({ question: "", intent: "howto", language: "vi", entities: [], confidence: 0, citations: [], contexts: [] })),
}));
vi.mock("../aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));

import { generateProgram, LoiCopilotBiHuy, LoiLuongModelCopilot } from "./aiProgrammingCopilot";

const YEU_CAU = { kind: "iec61131-st", mode: "generate" as const, request: "toggle a run bit" };
let loiConsole: string[] = [];

beforeEach(() => {
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  process.env.GGUF_CODE_CTX = "32768";
  h.kichBan = "loi-ngay";
  h.signalNhan = undefined;
  loiConsole = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    loiConsole.push(a.map(String).join(" "));
  });
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.GGUF_CODE_CTX;
  vi.restoreAllMocks();
});

describe("§A — chunk error giữa luồng ⇒ lỗi CÓ MÃ, message nguyên văn tới devDetail, phân loại không đổi", () => {
  it("HTTP 503/slot ⇒ errorCode MODEL_UNAVAILABLE, devDetail mang đúng chuỗi engine, có token đã phát trước đó", async () => {
    const tokens: string[] = [];
    const r = await generateProgram(YEU_CAU, { onToken: (t) => tokens.push(t) });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.errorCode).toBe("MODEL_UNAVAILABLE");
    expect(String(r.devDetail)).toContain("no slot available");
    expect(tokens.join("")).toContain("```st");
    // Lỗi được KÊU (không nuốt) với đúng chuỗi — hành vi G5-D giữ nguyên.
    expect(loiConsole.some((l) => /HỎNG/.test(l) && /no slot available/.test(l))).toBe(true);
  });
});

describe("§B — đường huỷ vẫn tách bạch khỏi lỗi hệ thống", () => {
  it("chunk error tới SAU khi người gọi huỷ ⇒ ném LoiCopilotBiHuy, KHÔNG phải kết quả MODEL_UNAVAILABLE", async () => {
    h.kichBan = "loi-sau-huy";
    const boHuy = new AbortController();
    const p = generateProgram(YEU_CAU, { signal: boHuy.signal });
    // Chờ engine giả nhận signal (tức pipeline đã tới lượt model) rồi mới huỷ.
    for (let i = 0; i < 300 && !h.signalNhan; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.signalNhan, "signal của người gọi phải tới engine").toBe(boHuy.signal);
    boHuy.abort();
    await expect(p).rejects.toBeInstanceOf(LoiCopilotBiHuy);
    // Huỷ là ý người dùng: không được kêu "lượt gọi model HỎNG".
    expect(loiConsole.filter((l) => /HỎNG/.test(l))).toEqual([]);
  });
});

describe("§C — lớp lỗi", () => {
  it("LoiLuongModelCopilot mang reasonCode, giữ message nguyên văn, và không phải LoiCopilotBiHuy", () => {
    const e = new LoiLuongModelCopilot("[llamaServer] stream HTTP 503: x");
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(LoiCopilotBiHuy);
    expect(e.reasonCode).toBe("STREAM_ERROR_CHUNK");
    expect(e.message).toBe("[llamaServer] stream HTTP 503: x");
    expect(e.name).toBe("LoiLuongModelCopilot");
  });
});
