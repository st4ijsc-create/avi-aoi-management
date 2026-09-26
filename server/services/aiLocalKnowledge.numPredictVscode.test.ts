/**
 * ★★★ VIỆC 6 (2026-09-04, `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-v6-report.md`)
 * — hồi quy do CHÍNH Việc 2 gây ra, đo được ở Việc 5 (`task-v5-report.md` B2, 10/10 câu route
 * vscode bị CẮT ở 599-822 ký tự, khớp CHÍNH XÁC ngân sách 220 token của `KB_QA_NUM_PREDICT_GENERAL`).
 *
 * ─── LỖI ĐÃ VÁ ────────────────────────────────────────────────────────────────────────────────
 * Việc 2 ép `intent="general"` cho MỌI câu hỏi route vscode (đúng đắn — tắt 6 regex `*_INTENT`
 * soạn cho câu hỏi VẬN HÀNH). Hệ quả PHỤ chưa từng đo: `pickNumPredict()` không phân biệt được
 * "câu hỏi ngắn kiểu tra cứu" khỏi "câu hỏi vscode xin sinh vài trăm dòng code" nữa, vì cả hai đều
 * rơi vào CÙNG một nhánh `case "general"` (220 token — ngân sách soạn cho câu hỏi ĐỊNH NGHĨA/TRA
 * CỨU ngắn, không phải sinh mã).
 *
 * Vá: `pickNumPredict` nhận thêm tham số `route` (luồn từ `context.route` qua
 * `generateWithOllama`/`generateWithOllamaStream`), và route "vscode" có ngân sách RIÊNG
 * (`KB_QA_NUM_PREDICT_VSCODE`, mặc định 900 — căn cứ chọn số ở docblock cạnh `pickNumPredict`
 * trong `aiLocalKnowledgeService.ts`).
 *
 * ─── MOCK BỘ PHẬN, gọi THẲNG `generateWithOllamaStream` (export) ────────────────────────────────
 * Không đi qua `streamAnswer` (nhiều tầng gate về `confidence`/`toolExec` không liên quan tới điều
 * đang đo) — dựng thẳng một `KbRetrieveResult` với `intent` do TA chọn, gọi hàm export
 * `generateWithOllamaStream` với `route` là tham số MỚI, rồi đọc `maxTokens` mà
 * `generateTextStream` (mock) nhận được. Đây đúng là hàm SSE thật `streamAnswer` gọi cho lượt
 * người dùng thật (`/api/ai/local-kb/stream`).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ nhánh `route === "vscode"` khỏi `pickNumPredict` (hoặc không luồn
 *   `route` xuống lời gọi `pickNumPredict` trong `generateWithOllamaStream`) ⇒ §A ĐỎ (vscode quay
 *   lại 220). Đảo điều kiện (áp trần vscode cho MỌI route) ⇒ §B ĐỎ (đối chứng web đổi hành vi —
 *   đúng B3 của brief: "đường web KHÔNG được đổi một byte trần token").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
delete process.env.KB_QA_NUM_PREDICT_VSCODE;
delete process.env.KB_QA_NUM_PREDICT_GENERAL;
delete process.env.KB_QA_NUM_PREDICT_TOOL;
process.env.GGUF_EMBED_DIM = "1024";

vi.mock("node:fs", () => ({
  default: { existsSync: () => true, readFileSync: () => "" },
  existsSync: () => true,
  readFileSync: () => "",
}));

vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" }, loop: null })),
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

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { generateWithOllamaStream, type KbRetrieveResult } from "./aiLocalKnowledgeService";

/** Trả về một chuỗi rỗng nhanh — phép đo ở đây là `maxTokens` mà mock nhận được, không phải nội
 *  dung phát ra. */
function luongRong() {
  return async function* () {
    yield { type: "done", fullText: "", tokensPrompt: 5, tokensGenerated: 0 };
  };
}

function retrieveChung(intent: KbRetrieveResult["intent"]): KbRetrieveResult {
  return {
    question: "q",
    intent,
    language: "vi",
    entities: [],
    confidence: 0.9,
    citations: [],
    contexts: [],
    rerankMs: null,
  };
}

async function chay(
  route: string | undefined,
  intent: KbRetrieveResult["intent"] = "general",
  toolSummary?: string | null,
): Promise<number> {
  generateTextStream.mockImplementation(luongRong());
  const gen = generateWithOllamaStream("viết giúp mình một hàm C#", retrieveChung(intent), [], "engineer", toolSummary, undefined, route);
  for await (const _ of gen) {
    // chỉ cần chạy hết generator để `generateTextStream` được gọi
  }
  expect(generateTextStream).toHaveBeenCalledTimes(1);
  const opts = generateTextStream.mock.calls[0][0] as { maxTokens: number };
  return opts.maxTokens;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.KB_QA_NUM_PREDICT_VSCODE;
  delete process.env.KB_QA_NUM_PREDICT_GENERAL;
  delete process.env.KB_QA_NUM_PREDICT_TOOL;
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: new Array(1024).fill(0), dimensions: 1024, modelId: "embed-stub" });
  getDbMock.mockResolvedValue({ insert: insertMock });
});

afterEach(() => {
  delete process.env.KB_QA_NUM_PREDICT_VSCODE;
  delete process.env.KB_QA_NUM_PREDICT_GENERAL;
  delete process.env.KB_QA_NUM_PREDICT_TOOL;
});

describe("§A — route vscode: trần token RIÊNG cho sinh mã (vá hồi quy Việc 2)", () => {
  it("★★★ route vscode + intent general (bắt buộc do Việc 2) ⇒ maxTokens = 900 (mặc định MỚI), KHÔNG còn 220", async () => {
    const maxTokens = await chay("vscode", "general");
    expect(maxTokens).toBe(900);
    expect(maxTokens).not.toBe(220);
  });

  it("★★ `KB_QA_NUM_PREDICT_VSCODE` chỉnh được qua biến môi trường, không cần sửa mã", async () => {
    process.env.KB_QA_NUM_PREDICT_VSCODE = "1500";
    const maxTokens = await chay("vscode", "general");
    expect(maxTokens).toBe(1500);
  });

  it("★ route vscode NHƯNG có tóm tắt tool (hasToolSummary=true) ⇒ vẫn dùng ngân sách TOOL (220), không bị trần vscode ghi đè — chưa từng xảy ra thật (tool-loop tắt hẳn cho route vscode) nhưng giữ đúng THỨ TỰ ưu tiên nếu tương lai đổi", async () => {
    const maxTokens = await chay("vscode", "general", "tóm tắt dữ liệu thời gian thực ngắn");
    expect(maxTokens).toBe(220);
  });
});

describe("§B — ĐỐI CHỨNG bắt buộc (B3): đường WEB (route khác 'vscode', hoặc vắng) KHÔNG đổi MỘT BYTE", () => {
  it("★★★ route vắng (web) + intent general ⇒ maxTokens = 220 — Y HỆT trước bản vá", async () => {
    const maxTokens = await chay(undefined, "general");
    expect(maxTokens).toBe(220);
  });

  it("★★★ route = '/factory-command' (path web, không phải 'vscode') + intent general ⇒ vẫn 220", async () => {
    const maxTokens = await chay("/factory-command", "general");
    expect(maxTokens).toBe(220);
  });

  it("★★ route vắng + intent troubleshoot ⇒ vẫn dùng nhánh switch cũ (300), không chạm nhánh vscode", async () => {
    const maxTokens = await chay(undefined, "troubleshoot");
    expect(maxTokens).toBe(300);
  });

  it("★★ route vắng + intent definition ⇒ vẫn dùng nhánh switch cũ (340)", async () => {
    const maxTokens = await chay(undefined, "definition");
    expect(maxTokens).toBe(340);
  });
});
