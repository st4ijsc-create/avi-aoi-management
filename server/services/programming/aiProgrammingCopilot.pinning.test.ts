import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateFimMock = vi.fn();
vi.mock("../aiGgufEngine", () => ({
  generateFim: (...a: any[]) => generateFimMock(...a),
  isGgufAvailable: vi.fn(async () => true),
  // completeInline destructures { generateFim, stripThinking } from the same dynamic
  // import in one statement — the sibling aiProgrammingCopilot.test.ts mock proves this
  // export is required too (its absence otherwise throws before generateFim is ever
  // called: "No stripThinking export is defined on the mock").
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));

// Đợt 2 · Task 2, review round 1 (Important-2) — completeInline() giờ gọi
// aiGateway.planInference()/record() để ghi metric (xem aiProgrammingCopilot.ts). File này
// KHÔNG mock "../aiGateway" trước đây vì chưa cần — nhưng đo được (script tsx tạm, xem
// task-2-report.md) rằng REAL planInference()/record() cắm một `setInterval` THẬT (5s mặc
// định) mà khi tự bắn (không cần gọi flush() tay) sẽ tự kết nối DB thật và GHI một dòng
// (`task='fim', model='default'` khi env thiếu) — dù test này chỉ mock generateFim và không
// hề gọi flush(). Vì file này không mock aiGateway/db-connection, DATABASE_URL bị vitest.setup.ts
// ép trỏ vào `..._test` (DB test thật) → rủi ro ghi rác thật vào DB test nếu tiến trình worker
// sống đủ lâu (>FLUSH_INTERVAL_MS) sau khi bài test này chạy trong một lượt `vitest run` dài hơn
// (nhiều file). Mock `planInference` ở đây cắt đứt đường đó tận gốc — không có `record()` thật ⇒
// không `enqueue()` ⇒ không timer nào được cắm ⇒ không có gì để ghi, dù xa hay gần. Đây là cách
// ít xâm lấn nhất tìm được: không đổi `aiGateway.ts` (mã sản xuất, ngoài phạm vi Task 2 + ảnh
// hưởng runtime thật cho MỌI caller khác), chỉ thêm 1 mock test-only vào đúng file bị lộ.
vi.mock("../aiGateway", () => ({
  planInference: vi.fn(async () => ({
    decision: { tier: 1, modelId: "test-fim-model", requiresHitl: false, maxTokens: 128, temperature: 0.1, jsonMode: false },
    abVariant: null,
    record: vi.fn(),
    safeText: "",
    safetyFlags: { scope: "input", risk: "none", matched: [], redactedCount: 0, redactionTypes: [] },
    sanitizeOutput: (t: string) => t,
  })),
}));

import { completeInline } from "./aiProgrammingCopilot";
import { fimModelBasename } from "../ai/modelResolver";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  // vitest.setup.ts deliberately does NOT load GGUF_*/AI_* flags from .env (so tests don't
  // silently inherit production model config) — completeInline's model-resolution chain
  // needs REAL basenames to resolve, cleaned up in afterEach.
  //
  // Final-fix round (C-1) — GGUF_FIM_MODEL is set DELIBERATELY DIFFERENT from GGUF_FAST_MODEL
  // so the two candidate resolution paths (aiModelRouter's "fim" tier vs
  // modelResolver.fimModelBasename()) are DISTINGUISHABLE. The prior version of this test set
  // only GGUF_FAST_MODEL — a bug that silently drops GGUF_FIM_MODEL could never turn any
  // assertion red, which is exactly how C-1 (aiProgrammingCopilot.ts:783-793 ignoring the
  // dedicated FIM model when AI_CODE_ROUTER_ENABLED is off) slipped past this file's own tests.
  process.env.GGUF_FAST_MODEL = "test-fast-model";
  process.env.GGUF_FIM_MODEL = "test-fim-model";
  generateFimMock.mockResolvedValue({ completion: "x" });
});

afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.GGUF_FAST_MODEL;
  delete process.env.GGUF_FIM_MODEL;
  delete process.env.AI_CODE_ROUTER_ENABLED;
});

describe("completeInline — ghim model tường minh", () => {
  it("truyền modelId tường minh cho generateFim (không để engine tự chọn)", async () => {
    await completeInline({ prefix: "MOVE ", suffix: "", language: "zmotion-basic" } as any);
    expect(generateFimMock).toHaveBeenCalled();
    const secondArg = generateFimMock.mock.calls[0][1];
    // Final-fix round (C-1, đi kèm) — so bằng basename THẬT (không chỉ typeof === "string"),
    // vì bản trước từng xanh ngay cả khi modelId là model chat đa dụng sai (xem 2 ca dưới).
    expect(secondArg).toBe(fimModelBasename());
  });

  it("cờ TẮT ⇒ trả completion rỗng, KHÔNG gọi model (fail-safe cũ giữ nguyên)", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
    expect(generateFimMock).not.toHaveBeenCalled();
  });

  it("generateFim ném ⇒ completion rỗng, KHÔNG ném ra ngoài (gõ phím không được vỡ)", async () => {
    generateFimMock.mockRejectedValue(new Error("boom"));
    const r = await completeInline({ prefix: "a", suffix: "", language: "gcode" } as any);
    expect(r.completion).toBe("");
  });

  // C-1 (final-fix round, CRITICAL) — reviewer's real probe: "PINNED MODEL (router OFF) =
  // GENERAL-FAST-CHAT-MODEL ← SAI". Before the fix, completeInline resolved modelId via
  // aiModelRouter.route({task:"fim"}), whose flag-OFF branch is `fastModelId() ??
  // defaultModelId()` (aiModelRouter.ts:373) — it NEVER reads GGUF_FIM_MODEL. This must go RED
  // before the fix (secondArg would be "test-fast-model", not "test-fim-model").
  it("cờ router TẮT ⇒ VẪN dùng GGUF_FIM_MODEL chuyên dụng, KHÔNG rơi về fast/default", async () => {
    delete process.env.AI_CODE_ROUTER_ENABLED;
    await completeInline({ prefix: "MOVEABS(", suffix: "", language: "zmotion-basic" } as any);
    const secondArg = generateFimMock.mock.calls[0][1];
    expect(secondArg).toBe("test-fim-model");
    expect(secondArg).not.toBe("test-fast-model");
  });

  // Bất biến phải giữ (đề bài) — cờ BẬT thì hành vi ghim model KHÔNG được đổi: router's ON
  // branch already resolves via the same fimModelBasename() chain, so this must stay green
  // both before AND after the fix.
  it("cờ router BẬT ⇒ vẫn dùng GGUF_FIM_MODEL chuyên dụng (bất biến không đổi)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    await completeInline({ prefix: "MOVEABS(", suffix: "", language: "zmotion-basic" } as any);
    const secondArg = generateFimMock.mock.calls[0][1];
    expect(secondArg).toBe("test-fim-model");
  });
});
