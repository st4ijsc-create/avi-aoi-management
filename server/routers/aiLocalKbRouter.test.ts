/**
 * doc69 B3 (Wave 5, AI#2) — aiLocalKbRouter.feedback unit tests.
 *
 * Covers the router's OWN responsibility: calling BOTH the new DB persist
 * (server/services/aiKbFeedbackSignal.ts's recordAnswerFeedback, mocked here — its
 * own fail-safe/isMissingTable behavior is unit-tested directly in
 * aiKbFeedbackSignal.test.ts) AND the legacy JSONL-backing HTTP call (fetchKbApi ->
 * global fetch, mocked here), independently of each other — a DB persist failure
 * must never prevent the JSONL log call, and vice versa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

// Mirrors kbStudioRouter.test.ts: disable the global audit-mutation middleware so
// this router test doesn't fire an async write against a real DB.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

const recordAnswerFeedbackMock = vi.fn();
vi.mock("../services/aiKbFeedbackSignal", () => ({
  recordAnswerFeedback: (...a: unknown[]) => recordAnswerFeedbackMock(...a),
}));

import { aiLocalKbRouter } from "./aiLocalKbRouter";

function callerFor(userId = 7, role = "engineer") {
  return aiLocalKbRouter.createCaller({ user: { id: userId, role, name: "Tester" } } as any);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  recordAnswerFeedbackMock.mockResolvedValue({ persisted: true });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("aiLocalKbRouter.feedback", () => {
  it("persists to the DB (recordAnswerFeedback) with the caller's userId AND still logs to JSONL (fetchKbApi)", async () => {
    const caller = callerFor(7);
    const result = await caller.feedback({
      messageId: "msg-1",
      question: "How do I read a defect report?",
      rating: 1,
      citations: [{ id: "c1", sourcePath: "knowledge/operational/reports.md" }],
    });

    expect(recordAnswerFeedbackMock).toHaveBeenCalledTimes(1);
    expect(recordAnswerFeedbackMock).toHaveBeenCalledWith({
      messageId: "msg-1",
      question: "How do I read a defect report?",
      rating: 1,
      citations: [{ id: "c1", sourcePath: "knowledge/operational/reports.md" }],
      userId: 7,
    });

    // JSONL-backing call still fires (Stage 13.D behavior, unchanged).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/ai/local-kb/feedback");

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(true);
  });

  it("defaults citations to [] when the caller omits them (backward-compatible)", async () => {
    const caller = callerFor(3);
    await caller.feedback({ messageId: "msg-2", question: "q", rating: -1 });
    expect(recordAnswerFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ citations: [], userId: 3 }),
    );
  });

  it("fail-safe: recordAnswerFeedback reports {persisted:false} (e.g. table absent) — the mutation still succeeds via JSONL, never crashes", async () => {
    recordAnswerFeedbackMock.mockResolvedValue({ persisted: false, reason: "missing_table" });
    const caller = callerFor(1);
    const result = await caller.feedback({ messageId: "msg-3", question: "q", rating: 1 });

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(false);
    // The JSONL log path is unaffected by the DB being unmigrated.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fail-safe: the JSONL-backing fetch failing does not prevent the DB persist attempt, and the mutation reports failure without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const caller = callerFor(1);
    const result = await caller.feedback({ messageId: "msg-4", question: "q", rating: 1 });

    expect(recordAnswerFeedbackMock).toHaveBeenCalledTimes(1); // DB persist still attempted
    expect(result.success).toBe(false);
    expect(result.persisted).toBe(true); // DB succeeded even though JSONL failed
  });

  it("requires authentication (protectedProcedure) — an unauthenticated caller is rejected before either write happens", async () => {
    const caller = aiLocalKbRouter.createCaller({ user: null } as any);
    await expect(
      caller.feedback({ messageId: "msg-5", question: "q", rating: 1 }),
    ).rejects.toThrow();
    expect(recordAnswerFeedbackMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
