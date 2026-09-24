/**
 * ★ PDCA vòng 7 — MODEL SINH CÂU TRẢ LỜI KB: mặc định model của planner; `AI_KB_MODEL_TRA_LOI=mac-dinh` ⇒ model MẶC ĐỊNH
 * khi llama-server đang giữ nó (một slot ⇒ xếp hàng sau lượt lập trình — vì thế không bật mặc định).
 * Khuôn mock của `aiLocalKnowledge.congLacDe.test.ts` (pipeline THẬT). Planner thật: câu ngắn ⇒ Tier 1 ⇒ GGUF_FAST_MODEL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tắt cache câu trả lời (đọc lúc nạp module) — mỗi ca là một mẫu độc lập.
vi.hoisted(() => {
  process.env.KB_QA_CACHE_TTL_MS = "0";
});

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
  ...["Hiệu chuẩn camera hằng tuần", "Sao lưu cơ sở dữ liệu bằng pg_dump", "Góc thấm ướt 30 đến 75 độ"].map((t, i) => ({
    id: `f${i}`,
    sourceType: "feature",
    sourcePath: `domain/knowledge/F${i}.md`,
    title: t,
    text: t,
    keywords: [],
  })),
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
  ...[0, 1, 2].map((i) => ({ id: `f${i}`, sourceType: "feature", sourcePath: `domain/knowledge/F${i}.md`, title: "", keywords: [], textLength: 10, embeddingDim: DIM, embedding: unit(100 + i) })),
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

const TRA_LOI = "Câu trả lời của model.";
const ENV = ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_DEFAULT_MODEL", "GGUF_FAST_MODEL", "AI_KB_MODEL_TRA_LOI", "AI_KB_CONG_LAC_DE"] as const;
const cu: Record<string, string | undefined> = {};
async function gom(g: AsyncGenerator<{ type: string; token?: string }>) { let s = ""; for await (const e of g) if (e.type === "token" && e.token) s += e.token; return s; }
/** modelId của lượt TRẢ LỜI (không phải lượt tự kiểm maxTokens 8). */
const modelTraLoi = () => generateText.mock.calls.find((c) => (c[0] as { maxTokens?: number })?.maxTokens !== 8)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV) cu[k] = process.env[k];
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:1";
  process.env.GGUF_DEFAULT_MODEL = "mac-dinh.gguf";
  process.env.GGUF_FAST_MODEL = "nhanh.gguf";
  process.env.AI_KB_CONG_LAC_DE = "0"; // chỉ đo lượt trả lời
  delete process.env.LLAMA_SERVER_MODEL;
  delete process.env.AI_KB_MODEL_TRA_LOI;
  generateEmbedding.mockResolvedValue(unit(0));
  isGgufAvailable.mockResolvedValue(true);
  tryExecuteToolLoop.mockResolvedValue({ result: null, decision: { tool: null, args: {}, reason: "NONE" }, loop: null });
  generateText.mockResolvedValue({ text: TRA_LOI, tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: TRA_LOI };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
});
afterEach(() => {
  for (const k of ENV) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
});

describe("model sinh câu trả lời KB", () => {
  it("★★★ MẶC ĐỊNH (không đặt công tắc) ⇒ model của planner — không xếp hàng sau lượt lập trình trên slot duy nhất", async () => {
    await answerQuestion("Lỗi NG theo defectType nằm ở menu nào? (m0)", 3);
    expect(modelTraLoi()).toBe("nhanh");
  });
  it("★★★ mac-dinh + server giữ model mặc định ⇒ answerQuestion sinh bằng model MẶC ĐỊNH", async () => {
    process.env.AI_KB_MODEL_TRA_LOI = "mac-dinh";
    const r = await answerQuestion("Lỗi NG theo defectType nằm ở menu nào? (m1)", 3);
    expect(r.answer).toContain(TRA_LOI);
    expect(modelTraLoi()).toBe("mac-dinh");
  });
  it("★★★ streamAnswer cũng vậy", async () => {
    process.env.AI_KB_MODEL_TRA_LOI = "mac-dinh";
    await gom(streamAnswer("Lỗi NG theo defectType nằm ở menu nào? (m2)", 3));
    expect(generateTextStream.mock.calls[0]?.[1]).toBe("mac-dinh");
  });
  it("★★★ mac-dinh nhưng server KHÔNG giữ model mặc định ⇒ model của planner (không bao giờ nạp bản mặc định in-process)", async () => {
    process.env.AI_KB_MODEL_TRA_LOI = "mac-dinh";
    process.env.LLAMA_SERVER_ENABLED = "false";
    await answerQuestion("Lỗi NG theo defectType nằm ở menu nào? (m3)", 3);
    expect(modelTraLoi()).toBe("nhanh");
  });
  it("★ AI_KB_MODEL_TRA_LOI=planner ⇒ model của planner", async () => {
    process.env.AI_KB_MODEL_TRA_LOI = "planner";
    await gom(streamAnswer("Lỗi NG theo defectType nằm ở menu nào? (m4)", 3));
    expect(generateTextStream.mock.calls[0]?.[1]).toBe("nhanh");
  });
});
