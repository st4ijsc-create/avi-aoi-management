/**
 * ★★★ G5-D — COPILOT LẬP TRÌNH KHÔNG ĐƯỢC NUỐT LỖI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐANG VÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `runCodeModel()` kết bằng `catch { console.warn(...); return null; }`, và MỌI điểm gọi dịch
 * `null` thành **một câu duy nhất**: *"AI code model offline — no suggestion generated
 * (fail-safe)."* Nghĩa là ba tình huống hoàn toàn khác nhau nói cùng một câu:
 *   • GGUF thật sự chưa bật              → việc của người vận hành;
 *   • model chạy, đầu ra thoái hoá/rỗng  → thử diễn đạt lại;
 *   • **HỆ THỐNG HỎNG** — cổng G1-D chặn nạp trùng · vượt ngữ cảnh · model cạn token vào suy
 *     luận · llama-server chết → thử lại một trăm lần cũng vô ích.
 * Ca thứ ba là ca ĐANG XẢY RA ở cấu hình `GGUF_CODE_MODEL == LLAMA_SERVER_MODEL`, và câu "AI
 * offline" gửi kỹ sư đi sai hướng — trong khi `console.warn` thì không ai đọc lúc bấm nút.
 *
 * Theo văn hoá **TỪ CHỐI TRUNG THỰC** đã có ở `aiLocalKnowledgeService` (7 cổng): nói ra chuyện gì
 * hỏng, đừng giả vờ là *"AI không nghĩ ra gì"*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isGgufAvailableMock = vi.fn(async () => true);
const chatCompletionMock = vi.fn();

vi.mock("../aiGgufEngine", () => ({
  // `isGgufAvailableMock` khai 0 tham số ⇒ spread `any[]` vào nó là TS2556. Ép kiểu tại chỗ gọi
  // (không đổi hành vi), cùng khuôn với `aiGgufEngine.serverCtxOverflow.test.ts`.
  isGgufAvailable: (...a: any[]) => (isGgufAvailableMock as (...x: any[]) => any)(...a),
  chatCompletion: (...a: any[]) => chatCompletionMock(...a),
  warmModel: vi.fn(async () => true),
  generateJSON: vi.fn(async () => {
    throw new Error("không dùng đường JSON trong bộ này");
  }),
  generateFim: vi.fn(),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));

vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({
    query: "", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [],
  })),
}));
vi.mock("../aiLocalTools/readToolsProgramming", () => ({
  gatherRepoIndexContext: vi.fn(async () => ""),
}));
vi.mock("../aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));

async function fresh() {
  vi.resetModules();
  return await import("./aiProgrammingCopilot");
}

const YEU_CAU = {
  mode: "generate" as const,
  kind: "st" as const,
  request: "viết một khối ST bật băng tải",
};

beforeEach(() => {
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  process.env.PROG_KB_ENABLED = "false";
  chatCompletionMock.mockReset();
  isGgufAvailableMock.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.PROG_KB_ENABLED;
});

describe("G5-D — ba ca hỏng nói BA câu khác nhau, không gộp thành \"offline\"", () => {
  it("★★★ cổng G1-D chặn nạp trùng (ca đang xảy ra thật) ⇒ nói ra HỎNG + nguyên văn lý do", async () => {
    const CAU_CONG =
      "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, chat): llama-server còn SỐNG (vừa qua thăm dò) " +
      "nhưng lượt sinh chữ hỏng… KHÔNG lùi về đường in-process cho chính model đó";
    chatCompletionMock.mockRejectedValue(new Error(CAU_CONG));
    const { generateProgram } = await fresh();
    const r = await generateProgram(YEU_CAU);

    expect(r.ok).toBe(false);
    // ⚠ Câu "offline" cho một hệ thống KHÔNG offline là lời khai SAI, không chỉ là mơ hồ.
    expect(r.note, "vẫn đang nói 'offline' cho một ca hệ thống hỏng").not.toMatch(/offline/i);
    expect(r.note).toMatch(/HỆ THỐNG HỎNG/);
    // Nguyên văn lý do phải đi tới người đọc — nếu chỉ ghi "có lỗi" thì vẫn phải mò log.
    expect(r.note).toMatch(/G1-D|llama-server/);
  });

  it("★★ model cạn token vào suy luận (G5-D ca B) ⇒ lý do đi nguyên tới người dùng", async () => {
    chatCompletionMock.mockRejectedValue(
      new Error("[llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, chat): model đã tiêu HẾT hạn mức 1536 token vào chuỗi SUY LUẬN"),
    );
    const { generateProgram } = await fresh();
    const r = await generateProgram(YEU_CAU);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/HỆ THỐNG HỎNG/);
    expect(r.note).toMatch(/SUY LUẬN/);
    expect(r.note).not.toMatch(/offline/i);
  });

  it("★ GGUF thật sự chưa bật ⇒ VẪN là câu \"offline\" (ca duy nhất xứng đáng với nó)", async () => {
    isGgufAvailableMock.mockResolvedValue(false);
    const { generateProgram } = await fresh();
    const r = await generateProgram(YEU_CAU);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/offline/i);
    expect(r.note, "ca offline KHÔNG được bị gắn nhãn hệ-thống-hỏng — sai theo chiều ngược lại").not.toMatch(
      /HỆ THỐNG HỎNG/,
    );
  });

  it("★ model chạy nhưng trả chuỗi rỗng ⇒ \"không nghĩ ra gì\", KHÔNG phải hỏng, KHÔNG phải offline", async () => {
    chatCompletionMock.mockResolvedValue({
      text: "   ", tokensGenerated: 0, tokensPrompt: 10, totalTimeMs: 5, tokensPerSecond: 0, modelId: "m",
    });
    const { generateProgram } = await fresh();
    const r = await generateProgram(YEU_CAU);
    expect(r.ok).toBe(false);
    expect(r.note).not.toMatch(/HỆ THỐNG HỎNG/);
    expect(r.note).not.toMatch(/offline/i);
    expect(r.note).toMatch(/không đưa ra được|rỗng/i);
  });

  it("★★ `explain` mode cũng vậy — cả BA điểm gọi runCodeModel, không chỉ điểm sinh mã", async () => {
    chatCompletionMock.mockRejectedValue(new Error("[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, chat): bản thứ hai"));
    const { generateProgram } = await fresh();
    const r = await generateProgram({
      mode: "explain",
      kind: "st",
      request: "giải thích",
      contextCode: "VAR x : BOOL; END_VAR",
    });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/HỆ THỐNG HỎNG/);
    expect(r.note).not.toMatch(/offline/i);
  });

  it("đường sống bình thường KHÔNG bị bản vá làm hỏng: có mã ⇒ trả mã", async () => {
    chatCompletionMock.mockResolvedValue({
      text: "```st\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;\n```",
      tokensGenerated: 17, tokensPrompt: 42, totalTimeMs: 120, tokensPerSecond: 141, modelId: "m",
    });
    const { generateProgram } = await fresh();
    const r = await generateProgram(YEU_CAU);
    expect(r.code).toMatch(/run := TRUE/);
    expect(r.note ?? "").not.toMatch(/HỆ THỐNG HỎNG|offline/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ CHẾT ĐỌC NHƯ FAIL-OPEN — `stripThinking(raw).answer ?? raw`
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("G5-D — `?? raw` đã bị xoá khỏi runCodeModel", () => {
  it("★ vị từ trên MÃ NGUỒN: không còn đường lùi \"cắt hỏng thì trả nguyên văn\"", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "server/services/programming/aiProgrammingCopilot.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    // `answer` LUÔN là `string` ⇒ `??` không bao giờ chạy ⇒ mã chết. Nhưng nó ĐỌC như fail-open:
    // "cắt suy luận hỏng thì trả lại nguyên văn" — đúng hàng rào R2 mà `thinkingStrip` bỏ đi.
    // Một dòng mã chết trông giống một lỗ vẫn là nợ: người sửa sau tưởng đường lùi ấy có thật.
    expect(src).not.toMatch(/stripThinking\([^)]*\)\.answer\s*\?\?/);
    expect(src).toMatch(/stripThinking\(raw\)\.answer/); // phép cắt VẪN còn — không xoá nhầm hàng rào
  });
});
