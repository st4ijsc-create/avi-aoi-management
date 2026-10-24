/**
 * ★ Đợt 9 (2026-10-24, e2e KB 0/3 → sửa) — ẢNH ĐÃ ĐỌC (máy chủ đặt `context.cauHoiGoc`) trên pipeline THẬT của service (khuôn mock
 * của congLacDe): (1) KHÔNG chạy vòng công cụ dữ liệu sống — đo được: "oee"/"L1" trong câu/ảnh kéo tool OEE / tra mã lỗi; (2) LUÔN qua
 * LLM — câu trả lời TRÍCH (độ tin < 0,30) không dùng được bản đọc ảnh (đo: "Tôi không có thông tin chính xác…"); (3) KHÔNG cổng lạc đề.
 * Đối chứng: vắng `cauHoiGoc` ⇒ hành vi cũ (tool chạy, độ tin thấp ⇒ trích). Đột biến bỏ `coAnhDaDoc` ở mỗi nhánh ⇒ ca tương ứng đỏ.
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
  generateEmbedding.mockResolvedValue({ embedding: unit(500) }); // KHÔNG khớp đoạn nào ⇒ độ tin thấp
  isGgufAvailable.mockResolvedValue(true);
  khongTool();
  model("CO");
});
const CAU = "Lỗi ở dòng nào, giữ kiểu number cho oee";
const ANH = { cauHoiGoc: CAU, maTuAnh: ["TS2322"] };
const CAU_CO_ANH = CAU + "\n\n<<<DU_LIEU_KHONG_TIN_CAY nguồn=ảnh\nerror TS2322 dòng 7\nHET_DU_LIEU_KHONG_TIN_CAY>>>";

describe("có ảnh đã đọc", () => {
  it("answerQuestion: không gọi vòng công cụ, câu trả lời từ MODEL (không trích/từ chối)", async () => {
    const r = await answerQuestion(CAU_CO_ANH, 3, [], "engineer", ANH);
    expect(tryExecuteToolLoop).not.toHaveBeenCalled();
    expect(r.answer).toContain(TRA_LOI);
    expect(r.answer).not.toContain("không có thông tin chính xác");
  });
  it("streamAnswer: không gọi vòng công cụ, câu trả lời từ MODEL", async () => {
    const chu = await gom(streamAnswer(CAU_CO_ANH, 3, [], "engineer", ANH));
    expect(tryExecuteToolLoop).not.toHaveBeenCalled();
    expect(chu).toContain(TRA_LOI);
  });
});
describe("đối chứng — không ảnh ⇒ hành vi cũ", () => {
  it("answerQuestion: vòng công cụ CÓ chạy; độ tin thấp ⇒ không gọi model trả lời", async () => {
    const r = await answerQuestion(CAU, 3);
    expect(tryExecuteToolLoop).toHaveBeenCalled();
    expect(r.answer).not.toContain(TRA_LOI);
  });
  it("streamAnswer: vòng công cụ CÓ chạy", async () => {
    await gom(streamAnswer(CAU, 3));
    expect(tryExecuteToolLoop).toHaveBeenCalled();
  });
});
