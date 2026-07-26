/**
 * doc69 G2-1 — aiProviderRouter + _core/llm.invokeLLM now route through the AI Gateway
 * (server/services/aiGateway.ts planInference/routeInference), closing the metering/rate-limit/
 * A-B coverage gap for the ~10 services that call aiProviderRouter (and the 2 routers that call
 * invokeLLM) WITHOUT the gateway ever being adopted before this task.
 *
 * Covers (per the task brief):
 *  1. COVERAGE GAP CLOSED — a generateNarrative / generateInsightJson / invokeLLM call now
 *     records a gateway metric (ai_gateway_metrics), which it did NOT before this task (nothing
 *     in aiProviderRouter referenced aiGateway.ts at all until this change).
 *  2. BEHAVIOR PRESERVED — same result shape, streaming still yields multiple chunks, and the
 *     offline/no-model degradation contract (engine throws → caller's rule-based fallback fires,
 *     never swallowed into a fabricated success) still holds.
 *  3. FAIL-OPEN — the gateway's rate limiter must NOT newly block these general-purpose choke
 *     points: even once a caller's budget is exhausted, the underlying engine call still happens
 *     (real enforcement is deferred to the next task, doc69 G2-2 AI-safety layer).
 *
 * The real aiGateway + aiModelRouter modules run unmocked (pure/in-process — no model load, no
 * DB dependency for the metering path itself). Only the GGUF engine boundary (./aiGgufEngine) and
 * the DB connection (../db/connection, used by aiGateway's flush()) are mocked, mirroring the
 * forwarding-mock pattern already used by aiExecutiveReport.test.ts / aiChatAssistant.ws-g3.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Forwarding mocks (stable references survive vi.resetModules(), see aiModelRouter.code.test.ts) ───
const generateTextMock = vi.fn();
const generateJSONMock = vi.fn();
const describeImageMock = vi.fn();
const generateTextStreamMock = vi.fn();
const ggufModelFileExistsMock = vi.fn(() => false);
const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));

vi.mock("./aiGgufEngine", () => ({
  generateText: (...a: unknown[]) => generateTextMock(...a),
  generateJSON: (...a: unknown[]) => generateJSONMock(...a),
  describeImage: (...a: unknown[]) => describeImageMock(...a),
  generateTextStream: (...a: unknown[]) => generateTextStreamMock(...a),
  ggufModelFileExists: (...a: unknown[]) => ggufModelFileExistsMock(...a),
}));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

/** Fresh module graph per test: isolates aiGateway's module-level state (rate-limit windows,
 * hot cache, metric buffer) and lets tests tune env-read consts (AI_GATEWAY_LIMIT_*). */
async function loadFresh() {
  vi.resetModules();
  const gateway = await import("./aiGateway");
  const router = await import("./aiProviderRouter");
  const llm = await import("../_core/llm");
  return { gateway, router, llm };
}

const ENV_KEYS = [
  "AI_GATEWAY_LIMIT_CHEAP_PER_MIN",
  "AI_GATEWAY_LIMIT_DEEP_PER_MIN",
  "AI_GATEWAY_AB_ENABLED",
  "AI_GATEWAY_AB_SPLIT",
  "AI_THINKING_TIER_ENABLED",
  "GGUF_DEFAULT_MODEL",
  "GGUF_FAST_MODEL",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue({ insert: insertMock });
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

// ─── 1. Coverage gap closed ─────────────────────────────────────────────────

describe("aiProviderRouter → AI Gateway metering (coverage gap closed)", () => {
  it("generateNarrative records a gateway metric (task defaults to 'report', tolerates missing userId)", async () => {
    const { gateway, router } = await loadFresh();
    generateTextMock.mockResolvedValue({
      text: "Báo cáo tự động.",
      modelId: "stub-deep-model",
      totalTimeMs: 42,
      tokensGenerated: 12,
      tokensPrompt: 8,
      tokensPerSecond: 285,
    });

    const result = await router.generateNarrative({ prompt: "Tóm tắt chất lượng hôm nay" });

    // Behavior preserved: same NarrativeResult shape as before this task.
    expect(result).toMatchObject({
      text: "Báo cáo tự động.",
      provider: "gguf",
      model: "stub-deep-model",
      fallbackUsed: false,
      tokensGenerated: 12,
      tokensPrompt: 8,
    });

    // Coverage gap closed: a metric now reaches ai_gateway_metrics for this call.
    await gateway.flush();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: "report",
      outcome: "ok",
      tokensIn: 8,
      tokensOut: 12,
      userId: null, // no userId supplied → gateway tolerates it (recorded as null, not thrown)
    });
  });

  it("generateInsightJson records a gateway metric (task defaults to 'extract') and threads userId when supplied", async () => {
    const { gateway, router } = await loadFresh();
    generateJSONMock.mockResolvedValue({
      data: { summary: "ok" },
      raw: '{"summary":"ok"}',
      modelId: "stub-json-model",
      totalTimeMs: 30,
      tokensGenerated: 20,
      tokensPrompt: 40,
      tokensPerSecond: 300,
    });

    const result = await router.generateInsightJson({
      prompt: "phân tích lỗi",
      jsonSchema: { type: "object" },
      userId: 555,
    });

    expect(result).toMatchObject({
      data: { summary: "ok" },
      provider: "gguf",
      model: "stub-json-model",
      fallbackUsed: false,
    });

    await gateway.flush();
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ task: "extract", outcome: "ok", userId: 555 });
  });

  it("invokeLLM (_core/llm.ts) now records a gateway metric too — coverage extends transitively", async () => {
    const { gateway, llm } = await loadFresh();
    generateTextMock.mockResolvedValue({
      text: "Assessment complete.",
      modelId: "stub-deep-model",
      totalTimeMs: 15,
      tokensGenerated: 5,
      tokensPrompt: 10,
      tokensPerSecond: 333,
    });

    const result = await llm.invokeLLM({
      messages: [{ role: "user", content: "Assess this inspection." }],
    });

    // Behavior preserved: OpenAI-shaped InvokeResult, unchanged.
    expect(result.choices[0]!.message.content).toBe("Assessment complete.");
    expect(result.model).toBe("stub-deep-model");

    await gateway.flush();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ task: "report", outcome: "ok" });
  });

  it("invokeLLM threads an explicit userId through to the gateway metric", async () => {
    const { gateway, llm } = await loadFresh();
    generateTextMock.mockResolvedValue({
      text: "hi",
      modelId: "m",
      totalTimeMs: 1,
      tokensGenerated: 1,
      tokensPrompt: 1,
      tokensPerSecond: 1,
    });

    await llm.invokeLLM({
      messages: [{ role: "user", content: "hi" }],
      userId: 42,
    });

    await gateway.flush();
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ userId: 42 });
  });
});

// ─── 2. Behavior preserved: streaming ───────────────────────────────────────

describe("generateNarrativeStream — behavior preserved", () => {
  it("still yields multiple token chunks then a done chunk, AND records a gateway metric on done", async () => {
    const { gateway, router } = await loadFresh();
    async function* fakeStream() {
      yield { type: "token" as const, token: "Xin " };
      yield { type: "token" as const, token: "chào" };
      yield {
        type: "done" as const,
        fullText: "Xin chào",
        tokensGenerated: 4,
        tokensPrompt: 6,
        totalTimeMs: 25,
        tokensPerSecond: 160,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const chunks: Array<{ type: string; token?: string; fullText?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "chào hỏi" })) {
      chunks.push(c);
    }

    // Behavior preserved: token-by-token streaming still chunks (not one flat blob).
    const tokenChunks = chunks.filter((c) => c.type === "token");
    expect(tokenChunks.length).toBeGreaterThanOrEqual(2);
    expect(tokenChunks.map((c) => c.token).join("")).toBe("Xin chào");
    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk?.fullText).toBe("Xin chào");

    await gateway.flush();
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ task: "report", outcome: "ok", tokensOut: 4 });
  });
});

// ─── 2b. Review fix: per-chunk stream secret redaction ──────────────────────

describe("generateNarrativeStream — per-chunk secret redaction (review fix)", () => {
  // Deliberately split so NEITHER half alone satisfies the api_key pattern's `{16,}` minimum
  // (half1 has only 9 alnum chars after "sk-"; the pattern needs a straight run of a
  // contiguous alnum run of at least 16) — the match only completes once both chunks have
  // arrived and are scanned together, which is exactly the boundary-straddle case this fix
  // must catch.
  const SECRET = "sk-ABCDEFGHIJ0123456789"; // "sk-" + 20 alnum chars
  const half1 = SECRET.slice(0, 12); // "sk-ABCDEFGHI" — 9 alnum chars after prefix, no match alone
  const half2 = SECRET.slice(12); // "J0123456789" — completes the run to 20 chars once combined

  it("redacts a secret that appears only in the streamed tokens (split across a chunk boundary) before the consumer ever sees the raw value", async () => {
    const { router } = await loadFresh();
    // The model echoes the secret split across TWO separate token chunks, straddling the
    // hold-back window boundary — exactly the leak this fix closes.
    async function* fakeStream() {
      yield { type: "token" as const, token: `Here is the key: ${half1}` };
      yield { type: "token" as const, token: `${half2} — done.` };
      yield {
        type: "done" as const,
        fullText: `Here is the key: ${SECRET} — done.`,
        tokensGenerated: 10,
        tokensPrompt: 5,
        totalTimeMs: 12,
        tokensPerSecond: 80,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const tokenChunks: Array<{ token?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "repeat the key back" })) {
      if (c.type === "token") tokenChunks.push(c);
    }

    // Every individual token chunk the consumer actually receives must never carry the raw
    // secret — this is the point of the fix (the old code only redacted the aggregated
    // fullText on "done", by which point the raw chunks had already reached the client).
    for (const c of tokenChunks) {
      expect(c.token ?? "").not.toContain(SECRET);
    }
    const joined = tokenChunks.map((c) => c.token ?? "").join("");
    expect(joined).not.toContain(SECRET);
    expect(joined).toContain("[REDACTED_SECRET]");
  });

  it("does not corrupt legitimate streamed manufacturing text (no secret present)", async () => {
    const { router } = await loadFresh();
    async function* fakeStream() {
      yield { type: "token" as const, token: "Tỷ lệ lỗi hôm nay " };
      yield { type: "token" as const, token: "là 2.1%, giảm so với hôm qua." };
      yield {
        type: "done" as const,
        fullText: "Tỷ lệ lỗi hôm nay là 2.1%, giảm so với hôm qua.",
        tokensGenerated: 12,
        tokensPrompt: 5,
        totalTimeMs: 10,
        tokensPerSecond: 120,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const tokenChunks: Array<{ token?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "tóm tắt" })) {
      if (c.type === "token") tokenChunks.push(c);
    }

    const joined = tokenChunks.map((c) => c.token ?? "").join("");
    expect(joined).toBe("Tỷ lệ lỗi hôm nay là 2.1%, giảm so với hôm qua.");
  });
});

// ─── 2c. doc69 W1-2 fix: stateful redactor closes the long-secret streaming leak ────────────
//
// The prior per-chunk redaction used a FIXED 64-char trailing hold-back window, which the
// review proved fails for realistic LONG secrets: a model-echoed PEM private key (~180+ chars)
// or JWT (~150 chars) has its opening delimiter scroll out of a 64-char window before the
// closing delimiter arrives, so the two-delimiter regex never matches and the whole secret
// leaks. These tests split such secrets into TINY (4-6 char) token chunks — the exact shape a
// real token-by-token model stream produces — through the real `generateNarrativeStream`.

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

describe("generateNarrativeStream — stateful redactor closes the long-secret leak (doc69 W1-2 fix)", () => {
  it("fully redacts a long PEM private key (~180+ chars) streamed in tiny 4-char chunks — no chunk ever carries the raw key", async () => {
    const { router } = await loadFresh();
    const body = "MIIEpQIBAAKCAQEA1c7QWERTYUIOPASDFGHJKLZXCVBNM0123456789".repeat(4);
    const PEM_KEY = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
    expect(PEM_KEY.length).toBeGreaterThan(180);
    const prefix = "Sure, here is the credential you asked for: ";
    const suffix = " — done.";
    const fullText = prefix + PEM_KEY + suffix;

    async function* fakeStream() {
      for (const piece of chunkString(fullText, 4)) {
        yield { type: "token" as const, token: piece };
      }
      yield {
        type: "done" as const,
        fullText,
        tokensGenerated: 50,
        tokensPrompt: 5,
        totalTimeMs: 20,
        tokensPerSecond: 200,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const tokenChunks: Array<{ token?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "repeat the private key back" })) {
      if (c.type === "token") tokenChunks.push(c);
    }

    for (const c of tokenChunks) {
      expect(c.token ?? "").not.toContain("-----BEGIN");
      expect(c.token ?? "").not.toContain(body.slice(0, 20));
    }
    const joined = tokenChunks.map((c) => c.token ?? "").join("");
    expect(joined).not.toContain(PEM_KEY);
    expect(joined).not.toContain(body);
    expect(joined).toBe(prefix + "[REDACTED_SECRET]" + suffix);
  });

  it("fully redacts a ~150-char JWT streamed in tiny 6-char chunks", async () => {
    const { router } = await loadFresh();
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlIjoiYWRtaW4ifQ";
    const sig = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c1234567890";
    const JWT = `${header}.${payload}.${sig}`;
    expect(JWT.length).toBeGreaterThan(149);
    const fullText = `Token: ${JWT} (expires soon)`;

    async function* fakeStream() {
      for (const piece of chunkString(fullText, 6)) {
        yield { type: "token" as const, token: piece };
      }
      yield {
        type: "done" as const,
        fullText,
        tokensGenerated: 30,
        tokensPrompt: 5,
        totalTimeMs: 15,
        tokensPerSecond: 200,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const tokenChunks: Array<{ token?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "repeat the token back" })) {
      if (c.type === "token") tokenChunks.push(c);
    }

    for (const c of tokenChunks) expect(c.token ?? "").not.toContain(JWT);
    const joined = tokenChunks.map((c) => c.token ?? "").join("");
    expect(joined).not.toContain(JWT);
    expect(joined).toBe(`Token: [REDACTED_SECRET] (expires soon)`);
  });

  it("normal (non-secret) streamed text still arrives incrementally (multiple non-empty chunks) and uncorrupted", async () => {
    const { router } = await loadFresh();
    const fullText =
      "Tỷ lệ lỗi hôm nay là 2.1%, giảm so với hôm qua. Trạm số 3 ghi nhận nhiều lỗi hàn nhất, " +
      "đề xuất kiểm tra lại nhiệt độ mỏ hàn và lịch bảo trì định kỳ trong tuần tới.";

    async function* fakeStream() {
      for (const piece of chunkString(fullText, 6)) {
        yield { type: "token" as const, token: piece };
      }
      yield {
        type: "done" as const,
        fullText,
        tokensGenerated: 40,
        tokensPrompt: 5,
        totalTimeMs: 20,
        tokensPerSecond: 200,
        modelId: "stub-stream-model",
      };
    }
    generateTextStreamMock.mockReturnValue(fakeStream());

    const tokenChunks: Array<{ token?: string }> = [];
    for await (const c of router.generateNarrativeStream({ prompt: "tóm tắt" })) {
      if (c.type === "token") tokenChunks.push(c);
    }

    const nonEmpty = tokenChunks.filter((c) => (c.token ?? "").length > 0);
    expect(nonEmpty.length).toBeGreaterThan(1);
    expect(tokenChunks.map((c) => c.token ?? "").join("")).toBe(fullText);
  });
});

// ─── 3. Behavior preserved: offline/degradation fallback contract ──────────

describe("offline/degradation fallback — behavior preserved (engine failure still surfaces, never swallowed)", () => {
  it("generateNarrative still THROWS when the engine fails, so a caller's rule-based fallback still fires", async () => {
    const { router } = await loadFresh();
    generateTextMock.mockRejectedValue(new Error("no model loaded"));

    // Mirrors the exact try/catch → offline-template contract used throughout the codebase
    // (aiReportGenerator.generateNarrative, aiInsightsService.generateRCAInsights,
    // aiChatAssistant.processGgufChat): callers catch aiProviderRouter's rejection and
    // substitute a rule-based/offline string — they never see a thrown error bubble past them,
    // but aiProviderRouter itself must keep throwing for that contract to work.
    async function callerWithOfflineFallback(): Promise<{ text: string; source: "model" | "offline" }> {
      try {
        const r = await router.generateNarrative({ prompt: "x" });
        return { text: r.text, source: "model" };
      } catch {
        return { text: "Báo cáo được tạo tự động từ dữ liệu cục bộ (chế độ offline).", source: "offline" };
      }
    }

    const outcome = await callerWithOfflineFallback();
    expect(outcome.source).toBe("offline");
    expect(outcome.text.length).toBeGreaterThan(0);
  });

  it("invokeLLM still throws on engine failure (never fabricates a fake success)", async () => {
    const { llm } = await loadFresh();
    generateTextMock.mockRejectedValue(new Error("engine unavailable"));

    await expect(
      llm.invokeLLM({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("engine unavailable");
  });

  it("describeImage's honest vision-unavailable degrade path is untouched (fallbackUsed:true, no throw, no gateway plan needed)", async () => {
    vi.doMock("./llamaVisionSidecar", () => ({ isVisionSidecarAvailable: () => false }));
    try {
      const { router } = await loadFresh();
      const result = await router.describeImage({ image: Buffer.from([1, 2, 3]), prompt: "describe" });
      expect(result.fallbackUsed).toBe(true);
      expect(describeImageMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("./llamaVisionSidecar");
    }
  });
});

// ─── 4. Fail-open rate limit — must NOT newly reject legitimate traffic ────

describe("AI Gateway adoption is fail-open under rate-limit pressure", () => {
  it("still invokes the engine (never blocks) once a caller's per-minute budget is exhausted, and records the rejection as telemetry", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "1"; // exhausted after 1 request
    const { gateway, router } = await loadFresh();
    generateTextMock.mockResolvedValue({
      text: "ok",
      modelId: "m",
      totalTimeMs: 1,
      tokensGenerated: 1,
      tokensPrompt: 1,
      tokensPerSecond: 1,
    });

    const userId = 9001;
    // "report" always classifies as difficulty "hard" → Tier 2 → the "deep" bucket (budget 1/min).
    const r1 = await router.generateNarrative({ prompt: "call one", userId });
    const r2 = await router.generateNarrative({ prompt: "call two", userId }); // budget exhausted here

    // Fail-open: BOTH calls succeeded — the second was never blocked despite exceeding the budget.
    expect(r1.text).toBe("ok");
    expect(r2.text).toBe("ok");
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    await gateway.flush();
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const outcomes = rows.map((r) => r.outcome).sort();
    // First call metered normally ("ok"); the second's gateway *plan* was rejected (recorded as
    // "rate_limited" telemetry) even though the underlying engine call itself still went through.
    expect(outcomes).toEqual(["ok", "rate_limited"]);
  });

  it("a different user's call after another user's budget is exhausted is unaffected — buckets are per-user", async () => {
    process.env.AI_GATEWAY_LIMIT_DEEP_PER_MIN = "1";
    const { gateway, router } = await loadFresh();
    generateTextMock.mockResolvedValue({
      text: "ok",
      modelId: "m",
      totalTimeMs: 1,
      tokensGenerated: 1,
      tokensPrompt: 1,
      tokensPerSecond: 1,
    });

    await router.generateNarrative({ prompt: "user A call", userId: 1 });
    await router.generateNarrative({ prompt: "user A call again", userId: 1 }); // rate-limited
    const r3 = await router.generateNarrative({ prompt: "user B call", userId: 2 }); // separate bucket

    expect(r3.text).toBe("ok");
    await gateway.flush();
    const rows = insertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const userBRow = rows.find((r) => r.userId === 2);
    expect(userBRow).toMatchObject({ outcome: "ok" });
  });
});
