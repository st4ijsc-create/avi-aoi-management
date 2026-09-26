/**
 * ★ PDCA vòng 9 — DỊCH câu hỏi Việt→Anh để chấm điểm truy hồi (`ai/dichTruyVan.ts`) trên pipeline THẬT của service.
 * Kho: c1 viết chữ Anh ("Refresh: 1 phút") — vector 0; d1 đoạn Việt gần câu hỏi nhưng không có đáp án; ba đoạn độn. Embedding giả: câu VIỆT ⇒ vector lạc (5),
 * bản dịch ANH ⇒ vector 0 (trúng c1). Không dịch thì c1 không có cách nào lên đầu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
/** vector đơn vị trộn hai trục (cos 0,7 với mỗi trục). */
function tron(a: number, b: number): number[] {
  const v = new Array(DIM).fill(0);
  v[a] = 0.7071;
  v[b] = 0.7071;
  return v;
}
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}

const chunks = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/spc.md", title: "Technical parameters", text: "SPC control chart — Refresh: 1 phút (live charts). Subgroup size = 5.", keywords: [] },
  { id: "d1", sourceType: "feature", sourcePath: "domain/knowledge/bieu-do.md", title: "Tổng quan SPC", text: "SPC hiển thị đường giới hạn trên và dưới cho từng điểm đo.", keywords: [] },
  ...["Quy trình đổi ca làm việc", "Sao lưu cơ sở dữ liệu", "Góc thấm ướt của mối hàn"].map((t, i) => ({ id: `f${i}`, sourceType: "feature", sourcePath: `domain/knowledge/F${i}.md`, title: t, text: t, keywords: [] })),
];
const embeddings = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/spc.md", title: "Technical parameters", keywords: [], textLength: 50, embeddingDim: DIM, embedding: unit(0) },
  // d1: đoạn Việt "gần" câu hỏi (cos 0,7 với vector câu Việt) nhưng KHÔNG có đáp án — thắng khi không dịch.
  { id: "d1", sourceType: "feature", sourcePath: "domain/knowledge/bieu-do.md", title: "Tổng quan SPC", keywords: [], textLength: 60, embeddingDim: DIM, embedding: tron(5, 7) },
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

import { retrieveKnowledge, answerQuestion } from "./aiLocalKnowledgeService";

const CAU = "Biểu đồ kiểm soát SPC tự làm mới sau bao lâu? ";
const DICH = "How often does the SPC control chart refresh?";
let soLanDich = 0;
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_KB_DICH_TRUY_VAN;
  soLanDich = 0;
  isGgufAvailable.mockResolvedValue(true);
  // ⚠ `generateEmbedding` trả `{ embedding }` (xem `embedQuestionGguf`) — mock trả mảng trơn thì cosine = 0 IM LẶNG và lưới
  //   chỉ đo được từ khoá (đo được khi viết lưới này: đột biến "bỏ cosine bản dịch" sống sót).
  generateEmbedding.mockImplementation(async (t: string) => ({ embedding: /refresh|updated/i.test(String(t)) ? unit(0) : unit(5) }));
  generateText.mockImplementation(async (o: { maxTokens?: number }) => {
    if (o?.maxTokens === 96) { soLanDich++; return { text: DICH, tokensPrompt: 5, tokensGenerated: 9 }; }
    return { text: "CO", tokensPrompt: 1, tokensGenerated: 1 };
  });
  tryExecuteToolLoop.mockResolvedValue({ result: null, decision: { tool: null, args: {}, reason: "NONE" }, loop: null });
});

describe("dịch câu hỏi để truy hồi", () => {
  it("★★★ bản dịch đưa đoạn chữ Anh lên ĐẦU; kết quả mang cauHoiDich", async () => {
    const r = await retrieveKnowledge(CAU + "(r1)", 3);
    expect(r.citations[0]?.id).toBe("c1");
    expect(r.cauHoiDich).toBe(DICH);
  });
  it("★★★ ABLATION: AI_KB_DICH_TRUY_VAN=0 ⇒ không dịch, c1 không lên đầu", async () => {
    process.env.AI_KB_DICH_TRUY_VAN = "0";
    const r = await retrieveKnowledge(CAU + "(r2)", 3);
    expect(soLanDich).toBe(0);
    expect(r.cauHoiDich).toBeUndefined();
    expect(r.citations[0]?.id).not.toBe("c1");
  });
  it("★ đệm theo câu hỏi: hỏi lại cùng câu ⇒ không dịch lần hai", async () => {
    await retrieveKnowledge(CAU + "(r3)", 3);
    await retrieveKnowledge(CAU + "(r3)", 3);
    expect(soLanDich).toBe(1);
  });
  it("★★ model ném ⇒ truy hồi như cũ, KHÔNG đệm lỗi (lượt sau thử lại)", async () => {
    generateText.mockRejectedValueOnce(new Error("hết slot"));
    const r = await retrieveKnowledge(CAU + "(r4)", 3);
    expect(r.cauHoiDich).toBeUndefined();
    const r2 = await retrieveKnowledge(CAU + "(r4)", 3);
    expect(r2.cauHoiDich).toBe(DICH);
  });
  it("★★ bản dịch KHÔNG trùng chữ nào với đoạn — cosine của bản dịch vẫn NÂNG điểm c1 (so với tắt dịch)", async () => {
    generateText.mockImplementation(async (o: { maxTokens?: number }) =>
      o?.maxTokens === 96 ? { text: "How frequently is the monitoring display updated?", tokensPrompt: 5, tokensGenerated: 9 } : { text: "CO", tokensPrompt: 1, tokensGenerated: 1 });
    const diemC1 = (r: { citations: { id: string; score: number }[] }) => r.citations.find((c) => c.id === "c1")?.score ?? 0;
    const co = diemC1(await retrieveKnowledge(CAU + "(r7)", 5));
    process.env.AI_KB_DICH_TRUY_VAN = "0";
    const khong = diemC1(await retrieveKnowledge(CAU + "(r8)", 5));
    expect(co).toBeGreaterThan(khong + 0.1);
  });
  it("★★ bản dịch cùng vector với câu gốc — chỉ TỪ KHOÁ của bản dịch nâng điểm c1", async () => {
    // bản dịch MỚI (đệm nhúng theo văn bản — bản DICH đã được nhúng thành vector 0 ở ca trước) và vector KHÔNG gần c1
    generateEmbedding.mockImplementation(async () => ({ embedding: tron(0, 5) })); // câu gốc VÀ bản dịch cùng một vector
    generateText.mockImplementation(async (o: { maxTokens?: number }) =>
      o?.maxTokens === 96 ? { text: "SPC chart refresh setting", tokensPrompt: 5, tokensGenerated: 5 } : { text: "CO", tokensPrompt: 1, tokensGenerated: 1 });
    const diemC1 = (r: { citations: { id: string; score: number }[] }) => r.citations.find((c) => c.id === "c1")?.score ?? 0;
    const co = diemC1(await retrieveKnowledge(CAU + "(r9)", 5));
    process.env.AI_KB_DICH_TRUY_VAN = "0";
    const khong = diemC1(await retrieveKnowledge(CAU + "(r10)", 5));
    expect(co).toBeGreaterThan(khong);
  });
  it("★ câu tiếng Anh không dịch", async () => {
    await retrieveKnowledge("How often does SPC refresh? (r5)", 3);
    expect(soLanDich).toBe(0);
  });
  it("★★★ cổng lạc đề đo độ phủ bằng MAX(gốc, bản dịch) ⇒ câu Việt hỏi đoạn chữ Anh KHÔNG bị tự kiểm/chặn", async () => {
    await answerQuestion(CAU + "(a6)", 3);
    const tuKiem = generateText.mock.calls.filter((c) => (c[0] as { maxTokens?: number })?.maxTokens === 8).length;
    expect(tuKiem).toBe(0);
  });
});
