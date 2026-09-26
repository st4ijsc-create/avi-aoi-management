/**
 * Doc 80 · Task 10 · D1 vá nóng (AI-01) — CHÍNH SÁCH NGHĨ THEO LOẠI LƯỢT của copilot lập trình.
 *
 * Đo trước (phụ lục A §1, cánh A): 13/14 tác vụ HỎNG vì `route("code")` cấp `maxTokens` 1536 trong
 * khi Qwen3.6 trên :8091 NGHĨ (server `--reasoning-budget 12000`) ⇒ model tiêu hết 1536 token vào
 * `reasoning_content`, không phát ký tự nào ra `content`. Copilot không đặt `disableThinking` lẫn
 * `thinkingBudgetTokens` ở lượt nào.
 *
 * Chính sách (KHÔNG đổi route `code` dùng chung — chỉ tham số từng lượt trong đường copilot):
 *   • lượt sinh chính / giải thích: ngân sách nghĩ có giới hạn (mặc định 6000) và
 *     `maxTokens` = ngân sách + 4000 — nếu cửa sổ ngữ cảnh đủ chỗ; không đủ ⇒ tắt nghĩ.
 *   • lượt tự sửa, lượt JSON (ir-flow / POU): LUÔN tắt nghĩ.
 * Lưới này xác nhận THAM SỐ THẬT gửi tới client model (chatCompletion / generateJSON).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const chatCompletion = vi.fn();
const generateJSON = vi.fn();
vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  warmModel: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletion(...a),
  generateJSON: (...a: unknown[]) => generateJSON(...a),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));
/** Gương quyết định THẬT của `route("code")` khi AI_CODE_ROUTER_ENABLED=true: 1536 token, ctx = GGUF_MAX_CTX. */
const routeCfg = { maxTokens: 1536, contextSize: 65536 };
vi.mock("../aiModelRouter", () => ({
  route: () => ({
    tier: 2, modelId: "code-model", requiresHitl: false,
    maxTokens: routeCfg.maxTokens, temperature: 0.3, jsonMode: false,
    contextSize: routeCfg.contextSize, reason: "mock",
  }),
}));
const kbContext = { text: "" };
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({ query: "", enabled: !!kbContext.text, semanticUsed: false, answerContext: kbContext.text, citations: [], chunks: [] })),
}));
vi.mock("../aiLocalKnowledgeService", () => ({
  retrieveKnowledge: vi.fn(async () => ({ question: "", intent: "howto", language: "vi", entities: [], confidence: 0, citations: [], contexts: [] })),
}));
vi.mock("../aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));

import { uocLuongSoToken } from "../aiLlamaServerClient";

const llm = (text: string) => ({ text, tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m" });
const ST_OK = "```st\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;\n```";
const ST_BAD = "```st\nVAR\n  run : BOOL;\n  run := TRUE;\n```";

async function fresh() {
  vi.resetModules();
  return await import("./aiProgrammingCopilot");
}
const optsOf = (fn: any, i: number) => fn.mock.calls[i][0];

beforeEach(() => {
  chatCompletion.mockReset();
  generateJSON.mockReset();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  process.env.GGUF_CODE_CTX = "32768"; // cấu hình sản phẩm (.env)
  routeCfg.maxTokens = 1536;
  routeCfg.contextSize = 65536;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.GGUF_CODE_CTX;
  delete process.env.AI_COPILOT_THINKING_BUDGET_TOKENS;
  delete process.env.AI_CODEGEN_REPAIR_MAX;
});

describe("D1 — tham số nghĩ gửi tới model theo loại lượt", () => {
  it("lượt SINH CHÍNH: thinkingBudgetTokens 6000, maxTokens ≥ ngân sách + 4000, KHÔNG tắt nghĩ", async () => {
    chatCompletion.mockResolvedValueOnce(llm(ST_OK));
    const { generateProgram } = await fresh();
    const r = await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    expect(r.ok).toBe(true);
    const o = optsOf(chatCompletion, 0);
    expect(o.thinkingBudgetTokens).toBe(6000);
    expect(o.maxTokens).toBeGreaterThanOrEqual(6000 + 4000);
    expect(o.disableThinking).toBeFalsy();
  });

  it("lượt TỰ SỬA: LUÔN tắt nghĩ, không gửi ngân sách nghĩ", async () => {
    process.env.AI_CODEGEN_REPAIR_MAX = "1";
    chatCompletion.mockResolvedValueOnce(llm(ST_BAD)).mockResolvedValueOnce(llm(ST_OK));
    const { generateProgram } = await fresh();
    const r = await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    expect(r.repairAttempts).toBe(1);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const sua = optsOf(chatCompletion, 1);
    expect(sua.disableThinking).toBe(true);
    expect(sua.thinkingBudgetTokens).toBeUndefined();
    expect(sua.maxTokens).toBeGreaterThanOrEqual(1536);
  });

  it("lượt JSON (ir-flow): LUÔN tắt nghĩ", async () => {
    const flow = { flow_id: "f", target_device_type: "generic", version: 1, blocks: [{ id: "b1", type: "wait", ms: 100 }] };
    generateJSON.mockResolvedValueOnce({ data: flow, raw: JSON.stringify(flow), tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m" } as any);
    const { generateProgram } = await fresh();
    await generateProgram({ kind: "ir-flow", request: "wait a moment" });
    const o = generateJSON.mock.calls[0][1] as any;
    expect(o.disableThinking).toBe(true);
    expect((o as any).thinkingBudgetTokens).toBeUndefined();
  });

  it("lượt GIẢI THÍCH: có ngân sách nghĩ như lượt sinh chính", async () => {
    chatCompletion.mockResolvedValueOnce(llm("It sets run."));
    const { generateProgram } = await fresh();
    await generateProgram({ kind: "iec61131-st", mode: "explain", request: "giải thích", contextCode: "run := TRUE;" });
    const o = optsOf(chatCompletion, 0);
    expect(o.thinkingBudgetTokens).toBe(6000);
    expect(o.maxTokens).toBeGreaterThanOrEqual(10000);
  });

  it("cửa sổ ngữ cảnh KHÔNG đủ cho ngân sách nghĩ (GGUF_CODE_CTX 8192) ⇒ lượt chính TẮT nghĩ, giữ maxTokens của route", async () => {
    process.env.GGUF_CODE_CTX = "8192";
    chatCompletion.mockResolvedValueOnce(llm(ST_OK));
    const { generateProgram } = await fresh();
    await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    const o = optsOf(chatCompletion, 0);
    expect(o.disableThinking).toBe(true);
    expect(o.thinkingBudgetTokens).toBeUndefined();
    expect(o.maxTokens).toBe(1536);
  });

  it("AI_COPILOT_THINKING_BUDGET_TOKENS=0 ⇒ tắt nghĩ ở lượt chính (đường lui vận hành)", async () => {
    process.env.AI_COPILOT_THINKING_BUDGET_TOKENS = "0";
    chatCompletion.mockResolvedValueOnce(llm(ST_OK));
    const { generateProgram } = await fresh();
    await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    expect(optsOf(chatCompletion, 0).disableThinking).toBe(true);
  });

  it("ngân sách ngữ cảnh tính theo maxTokens THẬT của lượt: prompt + maxTokens ≤ cửa sổ (buffer + manual khổng lồ)", async () => {
    // Cửa sổ 15.000: vừa đủ bật nghĩ (≥ 10.000 + 4.096). Nếu hồ token vẫn trừ 1.536 của route thay
    // vì 10.000 của lượt thật, phần đưa vào (~6.400) + 10.000 sẽ TRÀN cửa sổ.
    process.env.GGUF_CODE_CTX = "15000";
    kbContext.text = "[1] MANUAL " + "m".repeat(60_000);
    try {
      chatCompletion.mockResolvedValueOnce(llm(ST_OK));
      const { generateProgram } = await fresh();
      await generateProgram({ kind: "iec61131-st", mode: "complete", request: "x".repeat(3900), contextCode: "z".repeat(400_000) });
      const o = optsOf(chatCompletion, 0);
      expect(o.thinkingBudgetTokens).toBe(6000);
      const vao = o.messages.reduce((s: number, m: any) => s + uocLuongSoToken(m.content), 0);
      expect(vao + o.maxTokens).toBeLessThanOrEqual(15000);
    } finally {
      kbContext.text = "";
    }
  });
});
