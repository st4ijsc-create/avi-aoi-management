/**
 * Đợt 0.3 — lỗi của CỔNG ƯU TIÊN (hàng đầy / chờ quá trần / huỷ khi chờ) KHÔNG phải "server hỏng".
 *
 * Trước bản vá, một lỗi của cổng rơi vào cổng (c) `quyetDinhSauLoiServer` như mọi lỗi server khác ⇒
 * người dùng nhận câu *"llama-server còn SỐNG nhưng lượt sinh chữ hỏng … BẢN THỨ HAI ~19.000 MiB"*
 * — một chẩn đoán SAI hoàn toàn cho "model đang bận, bạn đứng thứ 33 trong hàng" — và mất mã lỗi
 * (`code`) mà tầng trên cần để nói "thử lại sau". Lưới này canh: lỗi cổng đi NGUYÊN VẸN lên trên,
 * cả đường không-stream lẫn stream, và không đường in-process nào bị chạm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GgufStreamChunk } from "./aiGgufEngine";
import { LoiHangDoiLlmHetGioCho, LoiHangDoiLlmQuaTai } from "./ai/hangDoiUuTienLlm";

const serverGenerateTextMock = vi.fn<(...a: any[]) => Promise<any>>();
const serverGenerateTextStreamMock = vi.fn<(...a: any[]) => AsyncGenerator<GgufStreamChunk>>();

vi.mock("./aiLlamaServerClient", async () => {
  const that = await vi.importActual<typeof import("./aiLlamaServerClient")>("./aiLlamaServerClient");
  return {
    ...that,
    shouldUseServerForText: () => true,
    laModelServerDangGiu: () => true,
    preflightHealthy: async () => true,
    llamaServerStrict: () => false,
    llamaServerEnabled: () => true,
    serverGenerateText: (...a: any[]) => serverGenerateTextMock(...a),
    serverGenerateTextStream: (...a: any[]) => serverGenerateTextStreamMock(...a),
  };
});

vi.mock("./aiModelRouter", () => ({
  getThinkingTierStatus: () => ({ enabled: false, modelConfigured: false, fileExists: false, active: false, reason: "off" }),
}));

const fakeLlama = { loadModel: vi.fn(), getVramState: vi.fn() };
vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => fakeLlama),
  LlamaChatSession: class {},
  LlamaJsonSchemaGrammar: class {},
}));

const SERVED = "qwen3-30b-a3b-instruct";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.GGUF_DEFAULT_MODEL = `${SERVED}.gguf`;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.LLAMA_SERVER_MODEL = `${SERVED}.gguf`;
  process.env.GGUF_MAX_CTX = "32768";
});

async function freshEngine() {
  vi.resetModules();
  return await import("./aiGgufEngine");
}

describe("aiGgufEngine × lỗi của cổng ưu tiên", () => {
  it("generateText: hàng đầy ⇒ lỗi cổng đi NGUYÊN VẸN (mã LLM_QUEUE_OVERLOADED), không lùi, không nạp", async () => {
    serverGenerateTextMock.mockRejectedValue(new LoiHangDoiLlmQuaTai());
    const engine = await freshEngine();
    const loi = await engine.generateText({ prompt: "xin chào" }).catch((e) => e);
    expect(loi).toBeInstanceOf(Error);
    expect(loi.code).toBe("LLM_QUEUE_OVERLOADED");
    expect(String(loi.message)).not.toMatch(/BẢN THỨ HAI/);
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });

  it("generateTextStream: chờ quá trần ⇒ lỗi cổng đi NGUYÊN VẸN (mã LLM_QUEUE_WAIT_TIMEOUT)", async () => {
    serverGenerateTextStreamMock.mockImplementation(async function* () {
      throw new LoiHangDoiLlmHetGioCho();
    });
    const engine = await freshEngine();
    const loi = await (async () => {
      for await (const _ of engine.generateTextStream({ prompt: "xin chào" })) {
        /* không mảnh nào */
      }
    })().catch((e) => e);
    expect(loi).toBeInstanceOf(Error);
    expect(loi.code).toBe("LLM_QUEUE_WAIT_TIMEOUT");
    expect(fakeLlama.loadModel).not.toHaveBeenCalled();
  });
});
