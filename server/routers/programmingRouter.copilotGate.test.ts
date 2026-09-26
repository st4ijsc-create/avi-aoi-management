/**
 * Doc 80 · Task 10 · D4 (AI-03 / AI-13 / AI-17) — cổng an toàn copilot qua ROUTER THẬT.
 *
 * Trước bản vá: router chạy `isSafetyRelevantProgram(request, contextCode)` SAU khi model đã trả
 * lời (tốn một lượt model rồi mới từ chối), với regex từ-đơn ⇒ dock tự chặn chính chẩn đoán
 * `[safety-lint:missing-interlock]` của nền tảng (AI-13) và chặn cả "giải thích" mã có ESTOP.
 * Sau bản vá: cổng chạy TRƯỚC model trong `generateProgram`; explain được phép (gắn nhãn
 * "không chứng nhận"); review mã an toàn bị chặn bởi `gate`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const chatCompletionMock = vi.fn();
const generateFimMock = vi.fn();
vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  warmModel: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
  generateJSON: vi.fn(async () => {
    throw new Error("không dùng");
  }),
  generateFim: (...a: unknown[]) => generateFimMock(...a),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));
vi.mock("../services/aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({ query: "", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [] })),
}));
vi.mock("../services/aiLocalKnowledgeService", () => ({
  retrieveKnowledge: vi.fn(async () => ({ question: "", intent: "howto", language: "vi", entities: [], confidence: 0, citations: [], contexts: [] })),
}));
vi.mock("../services/aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));
const mockGetDb = vi.fn(async () => undefined);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

const importRouter = async () => (await import("./programmingRouter")).programmingRouter;
const admin = () => ({ user: { id: 1, role: "admin" } }) as never;
const llm = (text: string) => ({ text, tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "m" });

const ST_ESTOP =
  "PROGRAM Press\nVAR\n  ESTOP_OK : BOOL;\n  Q_Motor : BOOL;\nEND_VAR\nIF NOT ESTOP_OK THEN\n  Q_Motor := FALSE;\nEND_IF\nEND_PROGRAM";
const ROBOT_TM = "POINT P1 = (100,0,200,180,0,0)\nHOME\nMOVE P1\nGRIP\nHOME";
const LINT =
  "- [warning] [safety-lint:missing-interlock] Motion/actuation command has no guarding conditional found upstream in its block — confirm an interlock/guard/area-clear/enable signal is present on the certified controller.";

beforeEach(() => {
  chatCompletionMock.mockReset();
  generateFimMock.mockReset();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
});

describe("programming.copilotGenerate — cổng an toàn TRƯỚC model", () => {
  it("review mã có ESTOP_OK ⇒ refused bởi gate, KHÔNG gọi model, reason = userMessage của cổng", async () => {
    const caller = (await importRouter()).createCaller(admin());
    const r: any = await caller.copilotGenerate({ kind: "iec61131-st", mode: "review", request: "Review this program", contextCode: ST_ESTOP });
    expect(r.refused).toBe(true);
    expect(r.refusalSource).toBe("gate");
    expect(r.reasonCode).toBe("SAFETY_CODE_REVIEW");
    expect(r.reason).toBe(r.userMessage);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("explain mã có ESTOP_OK ⇒ CÓ câu trả lời, gắn safetyReviewRequired + certified:false (không chặn)", async () => {
    chatCompletionMock.mockResolvedValueOnce(llm("Motor dừng khi ESTOP_OK = FALSE."));
    const caller = (await importRouter()).createCaller(admin());
    const r: any = await caller.copilotGenerate({ kind: "iec61131-st", mode: "explain", request: "Giải thích chương trình này", contextCode: ST_ESTOP });
    expect(r.refused).toBe(false);
    expect(r.explanation).toMatch(/ESTOP_OK/);
    expect(r.safetyReviewRequired).toBe(true);
    expect(r.certified).toBe(false);
  });

  it("AI-13 — dock 'Giải thích lỗi' trên chẩn đoán missing-interlock ⇒ CÓ câu trả lời, không nhãn an toàn giả", async () => {
    chatCompletionMock.mockResolvedValueOnce(llm("Lệnh MOVE không có điều kiện bảo vệ phía trên."));
    const caller = (await importRouter()).createCaller(admin());
    const r: any = await caller.copilotGenerate({
      kind: "robot-tm",
      mode: "explain",
      request: `Giải thích các chẩn đoán/lỗi sau, nguyên nhân gốc và hướng khắc phục:\n${LINT}`,
      contextCode: ROBOT_TM,
    });
    expect(r.refused).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.explanation).toMatch(/MOVE/);
    expect(r.safetyReviewRequired).toBeUndefined();
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("AI-13 — dock 'Đề xuất sửa' (review) trên chẩn đoán missing-interlock ⇒ CÓ câu trả lời", async () => {
    chatCompletionMock.mockResolvedValueOnce(llm("Thêm IF DI_AreaClear THEN trước MOVE."));
    const caller = (await importRouter()).createCaller(admin());
    const r: any = await caller.copilotGenerate({
      kind: "robot-tm",
      mode: "review",
      request: `Rà soát và đề xuất cách sửa các chẩn đoán/lỗi sau (nêu đoạn sửa cụ thể):\n${LINT}`,
      contextCode: ROBOT_TM,
    });
    expect(r.refused).toBe(false);
    expect(r.explanation).toMatch(/MOVE/);
  });
});

describe("programming.copilotComplete — ghost-text qua cổng", () => {
  it("I4 (bypass e-stop + ESTOP_PRESSED quanh con trỏ) ⇒ completion rỗng, KHÔNG gọi FIM", async () => {
    const caller = (await importRouter()).createCaller(admin());
    const r = await caller.copilotComplete({ prefix: "(* bypass e-stop for maintenance *)\nIF ESTOP_PRESSED THEN\n  Q_Motor := ", suffix: "\nEND_IF" });
    expect(r).toEqual({ completion: "" });
    expect(generateFimMock).not.toHaveBeenCalled();
  });
});
