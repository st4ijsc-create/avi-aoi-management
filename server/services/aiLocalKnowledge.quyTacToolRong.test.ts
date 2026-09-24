/**
 * ★ PDCA #4 (2026-09-24) — tool RỖNG + câu hỏi QUY TẮC ⇒ trả lời theo TÀI LIỆU; mọi thứ khác GIỮ cổng `emptyToolGate`.
 * Cùng khuôn mock với `aiLocalKnowledge.emptyToolGate.test.ts` (pipeline THẬT của service).
 *   §1 câu quy tắc + tool rỗng + tài liệu tin cậy ⇒ LLM được gọi KHÔNG kèm khối tool; câu trả lời + ghi chú dữ liệu sống.
 *   §2 model TỪ CHỐI ⇒ trả dòng tool y như cũ.
 *   §3 ĐỐI CHỨNG AN TOÀN: câu số liệu SỐNG (câu của emptyToolGate) ⇒ KHÔNG gọi LLM (cổng giữ nguyên).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}

const chunks = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/NG.md",
    title: "Lỗi NG theo defectType",
    text: "Thống kê lỗi NG theo defectType nằm ở Menu › Chất lượng › Phân tích lỗi.",
    keywords: ["ng", "defect"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/NG.md",
    title: "Lỗi NG theo defectType",
    keywords: ["ng", "defect"],
    textLength: 72,
    embeddingDim: DIM,
    embedding: unit(0),
  },
];
const chunksJsonl = chunks.map((c) => JSON.stringify(c)).join("\n");
const embeddingsJsonl = embeddings.map((e) => JSON.stringify(e)).join("\n");

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
  },
  existsSync: () => true,
  readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
}));

const tryExecuteToolLoop = vi.fn();
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: (...a: unknown[]) => tryExecuteToolLoop(...a),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
const generateText = vi.fn();
const generateTextStream = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  generateTextStream: (...a: unknown[]) => generateTextStream(...a),
}));

import { answerQuestion, streamAnswer } from "./aiLocalKnowledgeService";

const CAU_RONG = "Chưa đủ dữ liệu yield (2 điểm) để đánh giá SPC trong 14 ngày qua.";
const CAU_TAI_LIEU = "Theo tài liệu, UCL/LCL = mean ± 3σ.";
const TU_CHOI = "Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.";

function toolRong() {
  tryExecuteToolLoop.mockResolvedValue({
    result: { type: "spc", title: "SPC", data: {}, textSummary: CAU_RONG, note: "NOT_ENOUGH_DATA" },
    decision: { tool: "get_spc_yield", args: {}, reason: "TRIGGER" },
    loop: null,
  });
}
function llm(chu: string) {
  generateText.mockResolvedValue({ text: chu, tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: chu };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
}
async function gom(gen: AsyncGenerator<{ type: string; token?: string }>): Promise<string> {
  let s = "";
  for await (const ev of gen) if (ev.type === "token" && typeof ev.token === "string") s += ev.token;
  return s;
}
const promptCua = (m: ReturnType<typeof vi.fn>) => JSON.stringify(m.mock.calls[0]?.[0] ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue(unit(0)); // trùng đoạn duy nhất ⇒ tin cậy cao
  isGgufAvailable.mockResolvedValue(true);
  toolRong();
  llm(CAU_TAI_LIEU);
});

describe("§1 — câu QUY TẮC + tool rỗng ⇒ trả lời theo tài liệu", () => {
  it("★★★ answerQuestion", async () => {
    const r = await answerQuestion("Lỗi NG theo defectType được tính thế nào? (a1)", 3);
    expect(r.answer).toContain(CAU_TAI_LIEU);
    expect(r.answer).toContain(CAU_RONG);
    expect(r.answer.indexOf(CAU_TAI_LIEU)).toBeLessThan(r.answer.indexOf(CAU_RONG));
    expect(promptCua(generateText), "LLM không được thấy khối tool rỗng").not.toContain("Chưa đủ dữ liệu yield");
  });
  it("★★★ streamAnswer", async () => {
    const chu = await gom(streamAnswer("Lỗi NG theo defectType được tính thế nào? (s1)", 3));
    expect(chu).toContain(CAU_TAI_LIEU);
    expect(chu).toContain(CAU_RONG);
    expect(promptCua(generateTextStream)).not.toContain("Chưa đủ dữ liệu yield");
  });
});

describe("§2 — model TỪ CHỐI ⇒ dòng tool như cũ", () => {
  it("★ answerQuestion", async () => {
    llm(TU_CHOI);
    const r = await answerQuestion("Lỗi NG theo defectType được tính thế nào? (a2)", 3);
    expect(r.answer).toContain(CAU_RONG);
    expect(r.answer).not.toContain(TU_CHOI);
  });
  it("★ streamAnswer: lời từ chối KHÔNG lọt ra luồng", async () => {
    llm(TU_CHOI);
    const chu = await gom(streamAnswer("Lỗi NG theo defectType được tính thế nào? (s2)", 3));
    expect(chu).toContain(CAU_RONG);
    expect(chu).not.toContain(TU_CHOI);
  });
});

describe("§3 — ĐỐI CHỨNG: câu số liệu SỐNG giữ cổng emptyToolGate", () => {
  it("★★★ answerQuestion: không gọi LLM", async () => {
    const r = await answerQuestion("hôm nay có lỗi NG nào không (a3)", 3);
    expect(generateText).not.toHaveBeenCalled();
    expect(r.answer).toContain(CAU_RONG);
  });
  it("★★★ câu SỐNG mang dấu hiệu quy tắc (ngưỡng…là gì) — chỉ lớp dấu hiệu sống chặn được ⇒ không gọi LLM", async () => {
    const r = await answerQuestion("ngưỡng lỗi NG defectType hiện tại của line 2 là gì? (a4)", 3);
    expect(generateText).not.toHaveBeenCalled();
    expect(r.answer).toContain(CAU_RONG);
  });
  it("★★★ streamAnswer: không gọi LLM", async () => {
    const chu = await gom(streamAnswer("hôm nay có lỗi NG nào không (s3)", 3));
    expect(generateTextStream).not.toHaveBeenCalled();
    expect(chu).toContain(CAU_RONG);
  });
});
