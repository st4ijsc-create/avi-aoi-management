/**
 * ★ PDCA 2026-09-24 — CÂU HỎI LẠI NHƯỜNG TÀI LIỆU (`ai/hoiLaiSauTaiLieu.ts`), đo trên pipeline THẬT của service
 * (cùng khuôn mock với `aiLocalKnowledge.emptyToolGate.test.ts`).
 *
 * Đo đầu–cuối: 18/79 câu có đáp án trong tài liệu từng bị trả câu hỏi lại cứng. Ablation (gỡ đúng vị từ nhường) ⇒ 12/12
 * câu mẫu quay lại câu hỏi lại. Lưới này là bản CƠ CHẾ của phép ablation ấy: gỡ vị từ ⇒ §1 đỏ.
 *   §1 truy hồi TIN CẬY + không tool ⇒ trả lời từ tài liệu (LLM), KHÔNG hỏi lại.
 *   §2 truy hồi YẾU ⇒ hỏi lại như cũ, KHÔNG gọi LLM (đối chứng chống-vá-quá-tay).
 *   §3 tin cậy nhưng model TỪ CHỐI ⇒ vẫn đưa câu hỏi lại, nối SAU lời từ chối.
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

const HOI_LAI = "Bạn muốn xem trạng thái **máy nào**? (câu hỏi lại)";
const CAU_LLM = "Theo tài liệu, hiệu chỉnh camera hàng tuần.";
const TU_CHOI = "Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.";

function khongTool() {
  tryExecuteToolLoop.mockResolvedValue({
    result: null,
    decision: { tool: null, args: {}, reason: "NO_TRIGGER_MATCH", clarifyMessage: HOI_LAI },
    loop: null,
  });
}
function traLoiLLM(chu: string) {
  generateText.mockResolvedValue({ text: chu, tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: chu };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
}
async function gomToken(gen: AsyncGenerator<{ type: string; token?: string }>): Promise<string> {
  let s = "";
  for await (const ev of gen) if (ev.type === "token" && typeof ev.token === "string") s += ev.token;
  return s;
}

beforeEach(() => {
  // PDCA vòng 9 — tắt lượt DỊCH câu hỏi (chỉ để chấm điểm truy hồi, lưới riêng: aiLocalKnowledge.dichTruyVan.test.ts):
  // các ca ở đây đếm lượt gọi model TRẢ LỜI ("không gọi LLM") — lượt dịch không phải lượt trả lời.
  process.env.AI_KB_DICH_TRUY_VAN = "0";
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  khongTool();
  traLoiLLM(CAU_LLM);
});

describe("§1 — truy hồi TIN CẬY ⇒ tài liệu thắng câu hỏi lại", () => {
  it("★★★ answerQuestion: gọi LLM, trả câu trả lời, KHÔNG phải câu hỏi lại", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(0) }); // trùng hướng đoạn duy nhất ⇒ tin cậy cao
    const res = await answerQuestion("máy thống kê theo defectType ở đâu (a1)", 3);
    expect(res.answer, "câu có tài liệu liên quan vẫn bị chặn bằng câu hỏi lại").not.toContain(HOI_LAI);
    expect(generateText).toHaveBeenCalled();
    expect(res.answer).toContain(CAU_LLM);
  });
  it("★★★ streamAnswer: cùng luật", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(0) });
    const chu = await gomToken(streamAnswer("máy thống kê theo defectType ở đâu (s1)", 3));
    expect(chu).not.toContain(HOI_LAI);
    expect(chu).toContain(CAU_LLM);
  });
});

describe("§2 — ĐỐI CHỨNG: truy hồi YẾU ⇒ hỏi lại như cũ, không gọi LLM", () => {
  it("★ answerQuestion", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(7) }); // trực giao ⇒ không đoạn nào liên quan
    const res = await answerQuestion("máy số mấy (a2)", 3);
    expect(res.answer).toBe(HOI_LAI);
    expect(generateText).not.toHaveBeenCalled();
  });
  it("★ streamAnswer", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(7) });
    const chu = await gomToken(streamAnswer("máy số mấy (s2)", 3));
    expect(chu).toBe(HOI_LAI);
    expect(generateTextStream).not.toHaveBeenCalled();
  });
});

describe("§3 — tin cậy nhưng model TỪ CHỐI ⇒ vẫn đưa câu hỏi lại", () => {
  it("★ answerQuestion: từ chối + câu hỏi lại", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(0) });
    traLoiLLM(TU_CHOI);
    const res = await answerQuestion("máy thống kê theo defectType ở đâu (a3)", 3);
    expect(res.answer).toContain(TU_CHOI);
    expect(res.answer.indexOf(HOI_LAI)).toBeGreaterThan(res.answer.indexOf(TU_CHOI));
  });
  it("★ streamAnswer: từ chối + câu hỏi lại", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(0) });
    traLoiLLM(TU_CHOI);
    const chu = await gomToken(streamAnswer("máy thống kê theo defectType ở đâu (s3)", 3));
    expect(chu).toContain(TU_CHOI);
    expect(chu.indexOf(HOI_LAI)).toBeGreaterThan(chu.indexOf(TU_CHOI));
  });
});
