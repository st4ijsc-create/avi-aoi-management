/**
 * Wave 2 đường B (Task 4, Vòng sửa 1) — kiểm `retrieveKnowledge()` THẬT SỰ trộn kết quả
 * Studio, không chỉ `gatherStudioHits` đứng riêng (đó là phạm vi của
 * aiLocalKnowledge.studioMerge.test.ts).
 *
 * BỐI CẢNH: `kb_studio_chunks` đang có 0 hàng trong DB dev, nên MỌI test tích hợp trước
 * vòng sửa này (kể cả aiLocalKnowledge.gguf.test.ts chạy DB thật) đều thấy
 * `gatherStudioHits()` trả về `[]` — khối push/sort/trim ở
 * aiLocalKnowledgeService.ts:1780-1814 CHƯA TỪNG THỰC THI qua bất kỳ test nào. File này
 * ép nhánh đó chạy thật bằng cách mock thẳng module `./aiLocalKnowledgeStudio` (không cần
 * DB thật, không cần model thật).
 *
 * Khung mock embedding/corpus mirror của aiLocalKnowledge.gguf.test.ts (WS-G4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}
const QUERY_VEC = unit(0);

// Hai chunk hệ thống — cả hai khớp gần như tuyệt đối với QUERY_VEC (semantic≈1) và có
// từ khoá "aoi" để đảm bảo cả hai vượt MIN_CITATION_SCORE và có mặt trong `ranked`
// (không chỉ dựa vào luật "giữ top-1 dù yếu").
const chunks = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/A.md", title: "A", text: "SYSTEM_TEXT_C1", keywords: ["aoi"] },
  { id: "c2", sourceType: "doc", sourcePath: "docs/B.md", title: "B", text: "SYSTEM_TEXT_C2", keywords: ["aoi"] },
];
const embeddings = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/A.md", title: "A", keywords: ["aoi"], textLength: 20, embeddingDim: DIM, embedding: unit(0) },
  { id: "c2", sourceType: "doc", sourcePath: "docs/B.md", title: "B", keywords: ["aoi"], textLength: 20, embeddingDim: DIM, embedding: unit(0) },
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

// Tránh kéo tool handler / DB thật cho nhánh tryExecuteTool.
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));

// Mock TRỰC TIẾP aiLocalKnowledgeStudio's gatherStudioHits — không đụng DB/kbVectorStore/
// kbStudioService thật, kiểm soát hoàn toàn nội dung/điểm số của "kho Studio" cho từng test.
const gatherStudioHitsMock = vi.fn();
vi.mock("./aiLocalKnowledgeStudio", () => ({ gatherStudioHits: (...a: any[]) => gatherStudioHitsMock(...a) }));

import { retrieveKnowledge, reloadKbArtifacts } from "./aiLocalKnowledgeService";

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
  reloadKbArtifacts();
});

describe("retrieveKnowledge — trộn kho Training Studio (tích hợp, Vòng sửa 1)", () => {
  it("(a) sau khi trộn, citations[i] và contexts[i] vẫn ghép đúng cặp ở mọi vị trí", async () => {
    gatherStudioHitsMock.mockResolvedValue([
      { id: 101, text: "STUDIO_TEXT_HIGH", sourceRef: "studio-high.pdf", score: 0.97, corpus: "manuals" },
      { id: 102, text: "STUDIO_TEXT_LOW", sourceRef: "studio-low.pdf", score: 0.3, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);

    expect(res.citations.length).toBe(res.contexts.length);
    const expectedTextById: Record<string, string> = {
      c1: "SYSTEM_TEXT_C1",
      c2: "SYSTEM_TEXT_C2",
      "studio:manuals:101": "STUDIO_TEXT_HIGH",
      "studio:manuals:102": "STUDIO_TEXT_LOW",
    };
    res.citations.forEach((c, i) => {
      expect(res.contexts[i]).toBe(expectedTextById[c.id]);
    });
    // Cả 2 studio hit đều phải có mặt (không bị lạc/trùng lặp trong lúc ghép cặp).
    expect(res.citations.map((c) => c.id)).toEqual(
      expect.arrayContaining(["studio:manuals:101", "studio:manuals:102"]),
    );
  });

  it("(b) nguồn hệ thống không bị mất khi có nguồn Studio", async () => {
    gatherStudioHitsMock.mockResolvedValue([
      { id: 201, text: "STUDIO_TEXT", sourceRef: "studio.pdf", score: 0.5, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    const ids = res.citations.map((c) => c.id);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("(c) citations sắp theo điểm giảm dần sau khi trộn — kể cả khi KHÔNG vượt finalK", async () => {
    // 2 nguồn hệ thống + 1 hit Studio = 3 mục, finalK mặc định (topK=5) KHÔNG vượt ⇒
    // đây chính xác là nhánh mà code trước Vòng sửa 1 bỏ qua bước sắp-lại (chỉ sort khi
    // citations.length > finalK).
    gatherStudioHitsMock.mockResolvedValue([
      { id: 301, text: "STUDIO_TOP", sourceRef: "studio-top.pdf", score: 0.99, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);

    expect(res.citations.length).toBeLessThanOrEqual(5);
    const scores = res.citations.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    // Hit Studio điểm cao nhất PHẢI đứng đầu — chứng minh không còn bị "nối đuôi" sau
    // nguồn hệ thống (bug đã sửa: buildExtractiveAnswer chỉ đọc citations[0]?.score).
    expect(res.citations[0].id).toBe("studio:manuals:301");
    expect(res.citations[0].origin).toBe("studio");
  });

  it("(d) gatherStudioHits ném lỗi ⇒ vẫn trả về đủ kết quả hệ thống, không hỏng cả lượt", async () => {
    gatherStudioHitsMock.mockRejectedValue(new Error("studio branch down"));
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    const ids = res.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(res.citations.every((c) => c.origin !== "studio")).toBe(true);
    expect(res.citations.length).toBe(res.contexts.length);
  });

  it("(e) hit Studio dưới ngưỡng MIN_CITATION_SCORE (0.18) KHÔNG xuất hiện trong citations", async () => {
    gatherStudioHitsMock.mockResolvedValue([
      { id: 401, text: "STUDIO_WEAK", sourceRef: "studio-weak.pdf", score: 0.05, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    expect(res.citations.some((c) => c.id === "studio:manuals:401")).toBe(false);
    expect(res.contexts).not.toContain("STUDIO_WEAK");
  });

  it("kho Studio rỗng ([]) ⇒ kết quả y hệt trước Task 4 (không có citation origin=studio)", async () => {
    gatherStudioHitsMock.mockResolvedValue([]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    const ids = res.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(res.citations.every((c) => c.origin === undefined)).toBe(true);
  });
});
