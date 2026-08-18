/**
 * G2-A — lưới cho việc NỐI CHỈ MỤC REPO vào `generateProgram()` + NGÂN SÁCH NGỮ CẢNH.
 *
 * Lưới này đi HẾT dây thật: copilot → `gatherRepoIndexContext` → `gatherRepoContext` →
 * `retrieveKnowledge` (chỉ tầng cuối cùng bị mock). Nếu ai đó tháo một mắt xích ở giữa, lưới đỏ.
 *
 * BẤT BIẾN QUAN TRỌNG NHẤT ở đây KHÔNG phải "có chèn được không", mà là:
 *   **prompt sau khi nối dây vẫn LỌT cửa sổ ngữ cảnh của tầng code.**
 * Trần thật là `GGUF_CODE_CTX` (8.192) — `chatCompletion()` KHÔNG có đường llama-server nên lượt
 * sinh mã luôn chạy in-process với đúng cửa sổ đó. Nhồi quá tay ⇒ copilot biến thành "luôn từ
 * chối" (cổng `kiemNganSachNguCanh`) hoặc tràn ctx. Vì thế ca "buffer khổng lồ" dưới đây là ca
 * quan trọng nhất của file: TRƯỚC G2-A `contextCode` (router cho tới 2.000.000 ký tự ≈ 714.000
 * token) đi THẲNG vào prompt không có một cái trần nào.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const retrieveKnowledgeMock = vi.fn();

vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  warmModel: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => ({
    text: "```\nBASE(0)\nMOVEABS(0)\n```",
    tokensGenerated: 0,
    tokensPrompt: 0,
    totalTimeMs: 1,
    tokensPerSecond: 0,
    modelId: "mock",
  })),
  generateJSON: vi.fn(async () => ({ data: null, raw: "", tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 1, tokensPerSecond: 0, modelId: "mock" })),
  generateEmbedding: vi.fn(async () => ({ embedding: [] })),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));
/** Cửa sổ ngữ cảnh do "router" cấp — test lật được để ép ngân sách hẹp lại. */
const mockRouteCfg = { maxTokens: 1536, contextSize: 8192 };
vi.mock("../aiModelRouter", () => ({
  // Gương ĐÚNG quyết định thật của tầng code (aiModelRouter.route: maxTokens 1536, ctx 8192).
  route: () => ({
    tier: 2, modelId: "mock-code", requiresHitl: false,
    maxTokens: mockRouteCfg.maxTokens, temperature: 0.3, jsonMode: false,
    contextSize: mockRouteCfg.contextSize, reason: "mock",
  }),
}));
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({
    query: "",
    enabled: true,
    semanticUsed: true,
    // Manual hãng CỐ TÌNH khổng lồ (~60.000 ký tự ≈ 21.400 token) — nếu không có trần thì
    // riêng khối này đã vượt gấp 2,6 lần cửa sổ 8.192.
    answerContext: "[1] MANUAL_HANG_KHONG_LO " + "m".repeat(60_000),
    citations: [{ vendor: "zmotion", docTitle: "ZBasic", page: 12 }],
    chunks: [],
  })),
}));
vi.mock("../aiLocalKnowledgeService", () => ({
  retrieveKnowledge: retrieveKnowledgeMock,
}));

import { generateProgram } from "./aiProgrammingCopilot";
import { chatCompletion } from "../aiGgufEngine";
import { REPO_INDEX_BLOCK_HEADER, REPO_INDEX_FLAG } from "../ai/repoContextService";
import { uocLuongSoToken } from "../aiLlamaServerClient";

const CTX = 8192;
const TRA_LOI = 1536;

/** Lấy (system, user) của lượt gọi chatCompletion gần nhất. */
function promptCuoi(): { system: string; user: string } {
  const calls = (chatCompletion as any).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const msgs = calls[calls.length - 1][0].messages as Array<{ role: string; content: string }>;
  return {
    system: msgs.find((m) => m.role === "system")?.content ?? "",
    user: msgs.find((m) => m.role === "user")?.content ?? "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  process.env[REPO_INDEX_FLAG] = "true";
  process.env.AI_CODEGEN_SELF_REPAIR = "false"; // vòng tự sửa không liên quan tới lưới này
  retrieveKnowledgeMock.mockResolvedValue({
    question: "q",
    intent: "howto",
    language: "vi",
    entities: [],
    confidence: 0.9,
    contexts: ["export const programmingRouter = router({ copilotGenerate: protectedProcedure ... })"],
    citations: [{ id: "router:1", sourcePath: "server/routers/programmingRouter.ts", title: "Router Summary", sourceType: "router", score: 0.72 }],
  });
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env[REPO_INDEX_FLAG];
  delete process.env.AI_CODEGEN_SELF_REPAIR;
});

describe("G2-A · copilot nhìn thấy chỉ mục repo", () => {
  it("cờ BẬT → prompt CHỨA khối chỉ mục repo, có đường dẫn file thật", async () => {
    await generateProgram({ kind: "zmotion-basic", request: "di chuyển trục 0 về gốc" });
    const { user } = promptCuoi();
    expect(user).toContain(REPO_INDEX_BLOCK_HEADER);
    expect(user).toContain("server/routers/programmingRouter.ts");
    expect(retrieveKnowledgeMock).toHaveBeenCalled();
  });

  it("cờ TẮT → KHÔNG chèn gì và KHÔNG gọi truy hồi (đường lùi thật)", async () => {
    process.env[REPO_INDEX_FLAG] = "false";
    await generateProgram({ kind: "zmotion-basic", request: "di chuyển trục 0 về gốc" });
    const { user } = promptCuoi();
    expect(user).not.toContain(REPO_INDEX_BLOCK_HEADER);
    expect(retrieveKnowledgeMock).not.toHaveBeenCalled();
  });

  it("mode=explain cũng được nối (không chỉ generate)", async () => {
    await generateProgram({ kind: "iec61131-st", mode: "explain", request: "giải thích", contextCode: "run := TRUE;" });
    const { user } = promptCuoi();
    expect(user).toContain(REPO_INDEX_BLOCK_HEADER);
  });

  it("đoạn KHÔNG đạt ngưỡng liên quan → không chèn (không đổ nhiễu vào prompt sinh mã)", async () => {
    retrieveKnowledgeMock.mockResolvedValue({
      question: "q", intent: "howto", language: "vi", entities: [], confidence: 0.1,
      contexts: ["một đoạn chẳng liên quan"],
      citations: [{ id: "doc:9", sourcePath: "docs/linh-tinh.md", title: "x", sourceType: "doc", score: 0.04 }],
    });
    await generateProgram({ kind: "zmotion-basic", request: "di chuyển trục 0 về gốc" });
    const { user } = promptCuoi();
    expect(user).not.toContain(REPO_INDEX_BLOCK_HEADER);
    expect(user).not.toContain("docs/linh-tinh.md");
  });

  it("truy hồi NÉM → vẫn sinh mã bình thường (fail-safe, không mất kết quả)", async () => {
    retrieveKnowledgeMock.mockRejectedValue(new Error("kho hỏng"));
    const r = await generateProgram({ kind: "zmotion-basic", request: "di chuyển trục 0 về gốc" });
    expect(r.code).toContain("MOVEABS");
    const { user } = promptCuoi();
    expect(user).not.toContain(REPO_INDEX_BLOCK_HEADER);
  });
});

describe("G2-A · NGÂN SÁCH — prompt phải LỌT cửa sổ ngữ cảnh", () => {
  it("buffer người dùng 200.000 ký tự + manual 60.000 ký tự + chỉ mục repo ⇒ VẪN lọt 8.192", async () => {
    await generateProgram({
      kind: "zmotion-basic",
      mode: "complete",
      request: "thêm bước chờ IDLE",
      contextCode: "BASE(0)\n" + "z".repeat(200_000),
    });
    const { system, user } = promptCuoi();
    const vao = uocLuongSoToken(system) + uocLuongSoToken(user);
    expect(vao + TRA_LOI).toBeLessThanOrEqual(CTX);
  });

  it("mode=complete giữ ĐUÔI buffer (con trỏ nằm ở cuối, đầu file là thứ bỏ được)", async () => {
    await generateProgram({
      kind: "zmotion-basic",
      mode: "complete",
      request: "thêm bước chờ IDLE",
      contextCode: "DAU_BUFFER\n" + "z".repeat(200_000) + "\nCUOI_BUFFER",
    });
    const { user } = promptCuoi();
    expect(user).toContain("CUOI_BUFFER");
    expect(user).not.toContain("DAU_BUFFER");
  });

  it("mode=translate giữ ĐẦU buffer (dịch phải bắt đầu từ đầu chương trình)", async () => {
    await generateProgram({
      kind: "zmotion-basic",
      targetKind: "iec61131-st",
      mode: "translate",
      request: "dịch sang ST",
      contextCode: "DAU_BUFFER\n" + "z".repeat(200_000) + "\nCUOI_BUFFER",
    });
    const { user } = promptCuoi();
    expect(user).toContain("DAU_BUFFER");
    expect(user).not.toContain("CUOI_BUFFER");
  });

  it("ở cấu hình THẬT (ctx 8.192) request dài tối đa VẪN còn chỗ cho chỉ mục repo", async () => {
    // Đo được, không phải đoán: 8.192 − 1.536 (trả lời) − 320 (dự trữ) = 6.336; system+request
    // (4.000 ký tự) ăn ~1.800 ⇒ vẫn dư sau khi buffer/golden/manual lấy phần của chúng.
    await generateProgram({
      kind: "zmotion-basic",
      mode: "complete",
      request: "x".repeat(3900),
      contextCode: "z".repeat(200_000),
    });
    const { system, user } = promptCuoi();
    expect(uocLuongSoToken(system) + uocLuongSoToken(user) + TRA_LOI).toBeLessThanOrEqual(CTX);
    expect(user).toContain(REPO_INDEX_BLOCK_HEADER);
  });

  it("cửa sổ HẸP → chỉ mục repo bị BỎ TRƯỚC, buffer người dùng được GIỮ (thứ tự ưu tiên có thật)", async () => {
    // Ép router cấp một cửa sổ hẹp: 3.000 − 512 (trả lời) − 320 (dự trữ) = 2.168, mà riêng
    // system + request đã ăn gần hết ⇒ chỉ còn đủ cho buffer, không còn cho chỉ mục repo.
    mockRouteCfg.maxTokens = 512;
    mockRouteCfg.contextSize = 3000;
    try {
      await generateProgram({
        kind: "zmotion-basic",
        mode: "complete",
        request: "x".repeat(3900),
        contextCode: "BUFFER_NGUOI_DUNG_" + "z".repeat(200_000),
      });
      const { system, user } = promptCuoi();
      expect(uocLuongSoToken(system) + uocLuongSoToken(user) + 512).toBeLessThanOrEqual(3000);
      expect(user).not.toContain(REPO_INDEX_BLOCK_HEADER); // ưu tiên 5 — bỏ trước
      expect(user).toContain("EXISTING CODE:"); // ưu tiên 2 — vẫn còn
      expect(retrieveKnowledgeMock).not.toHaveBeenCalled(); // hết hồ ⇒ KHÔNG cả truy hồi
    } finally {
      mockRouteCfg.maxTokens = 1536;
      mockRouteCfg.contextSize = 8192;
    }
  });

  it("mode=explain với chương trình khổng lồ ⇒ vẫn lọt cửa sổ", async () => {
    await generateProgram({
      kind: "iec61131-st",
      mode: "explain",
      request: "giải thích",
      contextCode: "q".repeat(300_000),
    });
    const { system, user } = promptCuoi();
    expect(uocLuongSoToken(system) + uocLuongSoToken(user) + TRA_LOI).toBeLessThanOrEqual(CTX);
  });
});
