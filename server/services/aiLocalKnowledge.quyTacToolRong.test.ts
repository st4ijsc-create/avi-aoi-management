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
  // PDCA vòng 9 — tắt lượt DỊCH câu hỏi (chỉ để chấm điểm truy hồi, lưới riêng: aiLocalKnowledge.dichTruyVan.test.ts):
  // các ca ở đây đếm lượt gọi model TRẢ LỜI ("không gọi LLM") — lượt dịch không phải lượt trả lời.
  process.env.AI_KB_DICH_TRUY_VAN = "0";
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

// ★ PDCA vòng 6 — VÙNG MƠ HỒ: câu không dấu hiệu sống, không dấu hiệu quy tắc ⇒ model một từ SONG/TAILIEU quyết.
//   generateText phục vụ cả lượt phân loại (maxTokens 8) lẫn lượt trả lời — tách theo maxTokens.
function phanLoai(tu: string) {
  generateText.mockImplementation(async (o: { maxTokens?: number }) =>
    o?.maxTokens === 8 ? { text: tu, tokensPrompt: 1, tokensGenerated: 1 } : { text: CAU_TAI_LIEU, tokensPrompt: 10, tokensGenerated: 20 });
}
const soLanPhanLoai = () => generateText.mock.calls.filter((c) => (c[0] as { maxTokens?: number })?.maxTokens === 8).length;
const lenhPhanLoai = () => JSON.stringify(generateText.mock.calls.find((c) => (c[0] as { maxTokens?: number })?.maxTokens === 8)?.[0] ?? "");

describe("§4 — vùng mơ hồ + tool rỗng", () => {
  // Phân loại chỉ chạy trên model MẶC ĐỊNH mà llama-server đang giữ — dựng môi trường "server giữ model mặc định".
  const ENV = ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_DEFAULT_MODEL"] as const;
  const cu: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) cu[k] = process.env[k];
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:1";
    process.env.GGUF_DEFAULT_MODEL = "mac-dinh.gguf";
    delete process.env.LLAMA_SERVER_MODEL;
  });
  afterEach(() => {
    delete process.env.AI_KB_PHAN_LOAI_TAI_LIEU;
    for (const k of ENV) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
  });
  it("★★★ server KHÔNG giữ model mặc định ⇒ không phân loại, không nạp gì — dòng tool như cũ", async () => {
    process.env.LLAMA_SERVER_ENABLED = "false";
    phanLoai("TAILIEU");
    const r = await answerQuestion("Lỗi NG theo defectType có những giá trị nào? (a9)", 3);
    expect(soLanPhanLoai()).toBe(0);
    expect(r.answer).toContain(CAU_RONG);
    expect(r.answer).not.toContain(CAU_TAI_LIEU);
  });
  it("★★ lượt phân loại xin model MẶC ĐỊNH (id tường minh), không phải model của planner", async () => {
    phanLoai("TAILIEU");
    await answerQuestion("Lỗi NG theo defectType có những giá trị nào? (a10)", 3);
    const goi = generateText.mock.calls.find((c) => (c[0] as { maxTokens?: number })?.maxTokens === 8);
    expect(goi?.[1]).toBe("mac-dinh");
  });
  it("★★★ answerQuestion: model nói TAILIEU ⇒ trả lời theo tài liệu, dòng tool làm ghi chú", async () => {
    phanLoai("TAILIEU");
    const r = await answerQuestion("Lỗi NG theo defectType có những giá trị nào? (a5)", 3);
    expect(soLanPhanLoai()).toBe(1);
    expect(lenhPhanLoai()).toContain("Lỗi NG theo defectType có những giá trị nào?");
    expect(r.answer).toContain(CAU_TAI_LIEU);
    expect(r.answer).toContain(CAU_RONG);
  });
  it("★★★ streamAnswer: model nói TAILIEU ⇒ trả lời theo tài liệu", async () => {
    phanLoai("TAILIEU");
    const chu = await gom(streamAnswer("Lỗi NG theo defectType có những giá trị nào? (s5)", 3));
    expect(chu).toContain(CAU_TAI_LIEU);
    expect(chu).toContain(CAU_RONG);
    expect(promptCua(generateTextStream)).not.toContain("Chưa đủ dữ liệu yield");
  });
  it("★★★ model nói SONG ⇒ dòng tool như cũ, KHÔNG có lượt trả lời", async () => {
    phanLoai("SONG");
    const r = await answerQuestion("Lỗi NG theo defectType có những giá trị nào? (a6)", 3);
    expect(soLanPhanLoai()).toBe(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(r.answer).toContain(CAU_RONG);
    expect(r.answer).not.toContain(CAU_TAI_LIEU);
  });
  it("★★ model trả chữ lạ ⇒ như SONG (nghi ngờ thì giữ đường cũ)", async () => {
    phanLoai("Có thể là tài liệu");
    const chu = await gom(streamAnswer("Lỗi NG theo defectType có những giá trị nào? (s6)", 3));
    expect(chu).toContain(CAU_RONG);
    expect(chu).not.toContain(CAU_TAI_LIEU);
  });
  it("★ công tắc AI_KB_PHAN_LOAI_TAI_LIEU=0 ⇒ không phân loại, dòng tool như cũ", async () => {
    process.env.AI_KB_PHAN_LOAI_TAI_LIEU = "0";
    phanLoai("TAILIEU");
    const r = await answerQuestion("Lỗi NG theo defectType có những giá trị nào? (a7)", 3);
    expect(soLanPhanLoai()).toBe(0);
    expect(r.answer).toContain(CAU_RONG);
    expect(r.answer).not.toContain(CAU_TAI_LIEU);
  });
  it("★★★ câu mang dấu hiệu SỐNG không vào vùng ⇒ không phân loại (model nói TAILIEU cũng vô can)", async () => {
    phanLoai("TAILIEU");
    const r = await answerQuestion("lỗi NG theo defectType của line 2 có những giá trị nào? (a8)", 3);
    expect(soLanPhanLoai()).toBe(0);
    expect(r.answer).toContain(CAU_RONG);
  });
});
