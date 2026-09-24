/**
 * ★ PDCA vòng 5 — cổng câu lạc đề cùng miền trên pipeline THẬT của service (khuôn mock của emptyToolGate).
 * Đoạn c1 (được truy hồi) nói về "defectType"; ba đoạn độn chỉ để IDF có nghĩa; câu hỏi CHUNG từ "NG/defectType" (confidence ≥ 0.30 — đường cũ SẼ gọi model) nhưng hỏi về
 * "nozzle máy gắp đặt" ⇒ độ phủ thấp — đúng hình N19.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
function khongTool() {
  tryExecuteToolLoop.mockResolvedValue({ result: null, decision: { tool: null, args: {}, reason: "NONE" }, loop: null });
}
/** generateText phục vụ CẢ tự kiểm (maxTokens 8) lẫn câu trả lời; phân biệt theo maxTokens. */
function model(tuKiem: string) {
  generateText.mockImplementation(async (o: { maxTokens?: number }) =>
    o?.maxTokens === 8 ? { text: tuKiem, tokensPrompt: 1, tokensGenerated: 1 } : { text: TRA_LOI, tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: TRA_LOI };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
}
async function gom(g: AsyncGenerator<{ type: string; token?: string }>) { let s = ""; for await (const e of g) if (e.type === "token" && e.token) s += e.token; return s; }
const soLanTuKiem = () => generateText.mock.calls.filter((c) => (c[0] as { maxTokens?: number })?.maxTokens === 8).length;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_KB_CONG_LAC_DE;
  generateEmbedding.mockResolvedValue(unit(0));
  isGgufAvailable.mockResolvedValue(true);
  khongTool();
});

describe("§A — độ phủ thấp + tự kiểm KHONG ⇒ từ chối chuẩn, không gọi model trả lời", () => {
  it("★★★ answerQuestion", async () => {
    model("KHONG");
    const r = await answerQuestion("Lỗi NG theo defectType của nozzle máy gắp đặt thì kiểm tra thế nào", 3);
    expect(r.answer).toContain("không có thông tin chính xác");
    expect(r.answer).not.toContain(TRA_LOI);
    expect(soLanTuKiem()).toBe(1);
  });
  it("★★★ streamAnswer", async () => {
    model("KHONG");
    const chu = await gom(streamAnswer("Máy gắp đặt nozzle báo lỗi NG theo defectType", 3));
    expect(chu).toContain("không có thông tin chính xác");
    expect(chu).not.toContain(TRA_LOI);
    expect(generateTextStream).not.toHaveBeenCalled();
  });
});

describe("§B — tự kiểm CO ⇒ trả lời như cũ", () => {
  it("★ streamAnswer", async () => {
    model("CO");
    const chu = await gom(streamAnswer("Máy gắp đặt nozzle báo lỗi NG theo defectType", 3));
    expect(chu).toContain(TRA_LOI);
  });
});

describe("§C — độ phủ cao ⇒ KHÔNG gọi tự kiểm", () => {
  it("★ câu hỏi dùng đúng từ của đoạn", async () => {
    model("KHONG");
    const r = await answerQuestion("Lỗi NG theo defectType nằm ở menu nào?", 3);
    expect(soLanTuKiem()).toBe(0);
    expect(r.answer).toContain(TRA_LOI);
  });
});

describe("§D — công tắc AI_KB_CONG_LAC_DE=0 ⇒ tắt cổng", () => {
  it("★ không tự kiểm, trả lời như cũ", async () => {
    process.env.AI_KB_CONG_LAC_DE = "0";
    model("KHONG");
    const r = await answerQuestion("Lỗi NG theo defectType của nozzle máy gắp đặt thì kiểm tra thế nào", 3);
    expect(soLanTuKiem()).toBe(0);
    expect(r.answer).toContain(TRA_LOI);
  });
});

// ⚠ Đột biến "gỡ vế route !== vscode" SỐNG SÓT ca này, và đó là đúng cấu trúc: route vscode truy hồi ở kho RIÊNG (không chạm
//   kho vận hành) ⇒ 0 đoạn ⇒ `laCauLacDe` thoát ở `contexts.length === 0` trước. Vế vscode là lớp phòng thủ thừa; ca này khoá
//   HÀNH VI (không tự kiểm trên route vscode), không khoá riêng vế đó.
describe("§E — route vscode KHÔNG qua cổng (câu hỏi lập trình có luật riêng)", () => {
  it("★ answerQuestion với route vscode ⇒ không tự kiểm", async () => {
    model("KHONG");
    await answerQuestion("Lỗi NG theo defectType của nozzle máy gắp đặt thì kiểm tra thế nào", 3, [], "engineer", { route: "vscode" } as never);
    expect(soLanTuKiem()).toBe(0);
  });
});
