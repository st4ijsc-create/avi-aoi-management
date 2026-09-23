/**
 * Sau R1 — nối dây tiền tố câu hỏi: với model nhúng Qwen3-Embedding, `retrieveKnowledge` phải nhúng
 * CÂU HỎI kèm `Instruct: …\nQuery:` (đo ở `ai/tienToNhungCauHoi.ts`). Hằng `GGUF_EMBED_MODEL_ID` đọc
 * env LÚC IMPORT ⇒ đặt env trước import. Khung mock theo `aiLocalKnowledge.studioMerge.integration.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";
process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16.gguf";

const DIM = 1024;
const unit = () => { const v = new Array(DIM).fill(0); v[0] = 1; return v; };
const chunk = { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/A.md", title: "A", text: "AOI", keywords: ["aoi"] };
const emb = { ...chunk, textLength: 3, embeddingDim: DIM, embedding: unit() };
vi.mock("node:fs", () => {
  const read = (p: string) => (String(p).includes("chunks") ? JSON.stringify(chunk) : JSON.stringify(emb));
  return { default: { existsSync: () => true, readFileSync: read }, existsSync: () => true, readFileSync: read };
});
vi.mock("./aiLocalTools", () => ({ tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })) }));
const generateEmbedding = vi.fn(async () => ({ embedding: unit(), dimensions: DIM, modelId: "Qwen3-Embedding-0.6B-f16" }));
vi.mock("./aiGgufEngine", () => ({ generateEmbedding: (...a: unknown[]) => generateEmbedding(...(a as [])), isGgufAvailable: async () => true }));
vi.mock("./aiLocalKnowledgeStudio", () => ({ gatherStudioHits: async () => [] }));

const { retrieveKnowledge } = await import("./aiLocalKnowledgeService");

describe("embedQuestion — tiền tố câu hỏi theo model nhúng", () => {
  it("Qwen3-Embedding ⇒ câu hỏi đi kèm 'Instruct: …\nQuery:' và vẫn truy hồi được", async () => {
    const r = await retrieveKnowledge("ngưỡng NG rate dừng line", 5, { callerRole: "engineer" });
    const [vanBan] = generateEmbedding.mock.calls[0] as unknown as [string];
    expect(vanBan.startsWith("Instruct: ")).toBe(true);
    expect(vanBan.endsWith("\nQuery:ngưỡng NG rate dừng line")).toBe(true);
    expect(r.citations[0]?.id).toBe("c1");
  });
});
