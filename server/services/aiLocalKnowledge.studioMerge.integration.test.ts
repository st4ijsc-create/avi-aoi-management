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
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });

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
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    const ids = res.citations.map((c) => c.id);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("(c) citations sắp theo điểm giảm dần sau khi trộn — Studio MẠNH HƠN theo cùng thang điểm thì đứng đầu", async () => {
    // Sau R1 (xếp hạng chung): Studio và hệ thống cùng qua hybrid 0,72·ngữ nghĩa + 0,28·từ khoá × trọng
    // số. Query trực giao c1/c2 (semantic 0, chỉ còn từ khoá "aoi") ⇒ hit Studio cosine 0,99 thắng THẬT
    // theo cùng thước — không còn nhờ so cosine thô với hybrid.
    generateEmbedding.mockResolvedValue({ embedding: unit(777), dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
    gatherStudioHitsMock.mockResolvedValue([
      { id: 301, text: "STUDIO_TOP", sourceRef: "studio-top.pdf", score: 0.99, corpus: "manuals" },
    ]);
    // Câu hỏi KHÁC các ca khác: `embedQuestion` có cache theo văn bản câu hỏi — cùng câu sẽ trả lại
    // vector unit(0) của ca trước, không phải unit(777) vừa mock.
    const res = await retrieveKnowledge("một câu hỏi AOI khác hẳn", 5, { callerRole: "engineer" });

    expect(res.citations.length).toBeLessThanOrEqual(5);
    const scores = res.citations.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    expect(res.citations[0].id).toBe("studio:manuals:301");
    expect(res.citations[0].origin).toBe("studio");
  });

  it("(c2) ★ R1 — CÙNG thang điểm: hệ thống khớp tuyệt đối (semantic 1 + từ khoá) KHÔNG bị một cosine Studio 0,99 thô vượt mặt", async () => {
    // Bản cũ sort cosine THÔ 0,99 của Studio với hybrid hệ thống ⇒ Studio luôn đứng đầu dù hệ thống
    // khớp tuyệt đối. Nay 0,99 × 0,72 ≈ 0,713 < c1 (1 × 0,72 + từ khoá, × 1,18 feature).
    gatherStudioHitsMock.mockResolvedValue([
      { id: 302, text: "STUDIO_TOP", sourceRef: "studio-top.pdf", score: 0.99, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    expect(res.citations[0].id).toBe("c1");
    const st = res.citations.find((c) => c.id === "studio:manuals:302");
    expect(st?.score).toBeCloseTo(0.99 * 0.72, 3);
  });

  it("(c3) ★ R1 — tín hiệu TỪ KHOÁ nay áp cho Studio như hệ thống: văn bản Studio chứa từ của câu hỏi ⇒ điểm > 0,72·cosine", async () => {
    generateEmbedding.mockResolvedValue({ embedding: unit(777), dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
    gatherStudioHitsMock.mockResolvedValue([
      { id: 303, text: "Ngưỡng NG rate dừng line khi vượt 2 %", sourceRef: "aoi-thresholds.md", score: 0.58, corpus: "st4i" },
    ]);
    const res = await retrieveKnowledge("ngưỡng NG rate dừng line", 5, { callerRole: "engineer" });
    const st = res.citations.find((c) => c.id === "studio:st4i:303");
    expect(st).toBeDefined();
    expect(st!.score).toBeGreaterThan(0.58 * 0.72 + 0.01);
  });

  it("(d) gatherStudioHits ném lỗi ⇒ vẫn trả về đủ kết quả hệ thống, không hỏng cả lượt", async () => {
    gatherStudioHitsMock.mockRejectedValue(new Error("studio branch down"));
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    const ids = res.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(res.citations.every((c) => c.origin !== "studio")).toBe(true);
    expect(res.citations.length).toBe(res.contexts.length);
  });

  it("(e) hit Studio dưới ngưỡng MIN_CITATION_SCORE (0.18) KHÔNG xuất hiện trong citations", async () => {
    gatherStudioHitsMock.mockResolvedValue([
      { id: 401, text: "STUDIO_WEAK", sourceRef: "studio-weak.pdf", score: 0.05, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    expect(res.citations.some((c) => c.id === "studio:manuals:401")).toBe(false);
    expect(res.contexts).not.toContain("STUDIO_WEAK");
  });

  it("(f) I-1 final-fix — kho hệ thống YẾU + hit Studio MẠNH (0.9) ⇒ confidence tính LẠI (>=0.30), không giữ số 0 tính trước khi trộn", async () => {
    // Reviewer's real probe (final-fix-brief.md §3): citations trộn đúng ("studio:manuals:101"
    // score 0.9 đứng đầu) nhưng confidence VẪN 0 vì nó được tính ở dòng 1771 từ `ranked` (CHỈ
    // nguồn hệ thống, TRƯỚC khi trộn Studio) và khối trộn ở dòng 1791-1830 không tính lại.
    // Query vector KHÔNG khớp embedding của c1/c2 (unit(777) trực giao unit(0)) và câu hỏi
    // không chứa token khớp title/path/text/keywords của c1/c2 ⇒ semantic=0, keyword=0 ⇒ điểm
    // hệ thống = 0 cho cả hai (chỉ c1 sống sót nhờ luật "giữ top-1 dù yếu", idx===0 ở dòng 1753).
    generateEmbedding.mockResolvedValue({ embedding: unit(777), dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });
    gatherStudioHitsMock.mockResolvedValue([
      { id: 101, text: "STUDIO_TEXT_HIGH", sourceRef: "studio-high.pdf", score: 0.9, corpus: "manuals" },
    ]);
    const res = await retrieveKnowledge("xyzzy plugh unrelated nonsense query", 5, { callerRole: "engineer" });

    // Citations đã trộn+sắp đúng (Task 4 / vòng sửa 1, KHÔNG phải phần hỏng ở đây).
    expect(res.citations[0]?.id).toBe("studio:manuals:101");
    // Sau R1: điểm Studio là điểm CÙNG THANG (0,72·cosine + 0,28·từ khoá), không phải cosine thô.
    expect(res.citations[0]?.score).toBeCloseTo(0.9 * 0.72, 3);
    // confidence PHẢI phản ánh trích dẫn số 1 thật (0.9), không phải điểm hệ thống cũ (0).
    // Đây chính là mục 1 trong "Ba hậu quả đo được": shouldUseLlm = confidence >= 0.30 ở
    // answerQuestion() (:2187) — confidence=0 ⇒ LLM không bao giờ được gọi cho câu hỏi mà
    // CHỈ tài liệu người dùng (Studio) trả lời được.
    expect(res.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("kho Studio rỗng ([]) ⇒ kết quả y hệt trước Task 4 (không có citation origin=studio)", async () => {
    gatherStudioHitsMock.mockResolvedValue([]);
    const res = await retrieveKnowledge("hỏi về AOI", 5, { callerRole: "engineer" });
    const ids = res.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(res.citations.every((c) => c.origin === undefined)).toBe(true);
  });

  it("Task 6 — bất biến GỐC vẫn đúng nguyên văn: kho Studio rỗng + KHÔNG truyền role nào (context undefined) ⇒ y hệt trước Wave 2", async () => {
    // Bất biến gốc (đã kiểm chứng ở các vòng trước) không nói gì về role — nó phải đúng độc
    // lập với role. Test này giữ nguyên hình dạng gọi gốc (không context) để không đánh mất
    // vùng phủ đó khi Task 6 thêm role gate.
    gatherStudioHitsMock.mockResolvedValue([]);
    const res = await retrieveKnowledge("hỏi về AOI", 5);
    const ids = res.citations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(res.citations.every((c) => c.origin === undefined)).toBe(true);
  });
});
