/**
 * Doc 69 · Wave 4 / C1 — programming.copilotComplete (inline FIM ghost-text) unit tests.
 *
 * Mocks generateFim (server/services/aiGgufEngine.ts) — no GGUF load — and drives the REAL
 * router (`createCaller`) so this covers the whole path: read-gate → copilotEnabled() gate →
 * completeInline() → generateFim(). Also mocks `../db/connection` (`getDb`) so the
 * read-gate test never needs a live DB: for a non-admin caller, `checkPermission` calls
 * `getDb()`; with it mocked to resolve `undefined` (DB "down"), a non-admin is denied
 * (accessControl.ts: `if (!db) return isAdmin;`) while an admin still short-circuits the
 * gate WITHOUT touching the DB at all — so admin-role assertions below are unaffected by
 * this mock (same pattern as aiChatRouter.tools.test.ts / aiAnalyticsScope.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGenerateFim = vi.fn();
vi.mock("../services/aiGgufEngine", () => ({
  generateFim: (...a: unknown[]) => mockGenerateFim(...a),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));

const mockGetDb = vi.fn(async () => undefined);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

const importRouter = async () => (await import("./programmingRouter")).programmingRouter;
const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

/** Build a GgufGenerateResult-shaped mock return from a text body (mirrors generateFim's shape). */
function fim(text: string) {
  return { text, tokensGenerated: 1, tokensPrompt: 1, totalTimeMs: 1, tokensPerSecond: 1, modelId: "mock" };
}

beforeEach(() => {
  mockGenerateFim.mockReset();
  mockGetDb.mockClear();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
});

describe("programming.copilotComplete", () => {
  it("returns the FIM completion when enabled (admin — read-gate passes)", async () => {
    mockGenerateFim.mockResolvedValueOnce(fim("  END_IF;"));
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    const r = await caller.copilotComplete({ prefix: "IF x THEN\n", suffix: "\n" });

    expect(r).toEqual({ completion: "END_IF;" }); // stripThinking().trim() applied
    expect(mockGenerateFim).toHaveBeenCalledTimes(1);
    const call = mockGenerateFim.mock.calls[0][0];
    expect(call.prefix).toBe("IF x THEN\n");
    expect(call.suffix).toBe("\n");
  });

  it("copilotEnabled() off → {completion:''} WITHOUT calling generateFim", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    const r = await caller.copilotComplete({ prefix: "MOVEABS(0,0)" });

    expect(r).toEqual({ completion: "" });
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("generateFim throws → {completion:''}, no throw across the procedure", async () => {
    mockGenerateFim.mockRejectedValueOnce(new Error("model offline"));
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    await expect(caller.copilotComplete({ prefix: "x := " })).resolves.toEqual({ completion: "" });
  });

  it("generateFim resolves with empty text → {completion:''}", async () => {
    mockGenerateFim.mockResolvedValueOnce(fim(""));
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    const r = await caller.copilotComplete({ prefix: "x := " });

    expect(r).toEqual({ completion: "" });
  });

  it("blank prefix AND suffix → {completion:''} WITHOUT calling generateFim (nothing to infill)", async () => {
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    const r = await caller.copilotComplete({ prefix: "   ", suffix: "" });

    expect(r).toEqual({ completion: "" });
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("read-gate REJECTS an unauthorized user (non-admin, no permission row / DB down)", async () => {
    const caller = (await importRouter()).createCaller(ctxFor(999999, "operator"));

    await expect(caller.copilotComplete({ prefix: "x" })).rejects.toThrow(/FORBIDDEN|quyền/i);
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("input length bounds enforced — oversized prefix is rejected before completeInline runs", async () => {
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));
    const hugePrefix = "a".repeat(4001); // over the router's z.string().max(4000)

    await expect(caller.copilotComplete({ prefix: hugePrefix })).rejects.toThrow();
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("input length bounds enforced — oversized suffix is rejected", async () => {
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    await expect(
      caller.copilotComplete({ prefix: "x", suffix: "a".repeat(2001) }),
    ).rejects.toThrow();
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("input length bounds enforced — maxTokens above the cap is rejected", async () => {
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    await expect(
      caller.copilotComplete({ prefix: "x", maxTokens: 129 }),
    ).rejects.toThrow();
    expect(mockGenerateFim).not.toHaveBeenCalled();
  });

  it("clamps an over-long completion to the inline char cap (belt-and-braces bound)", async () => {
    mockGenerateFim.mockResolvedValueOnce(fim("x".repeat(1000)));
    const caller = (await importRouter()).createCaller(ctxFor(1, "admin"));

    const r = await caller.copilotComplete({ prefix: "x" });

    expect(r.completion.length).toBeLessThanOrEqual(480);
  });
});
