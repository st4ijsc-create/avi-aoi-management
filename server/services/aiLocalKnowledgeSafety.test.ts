/**
 * doc69 G2-3 (Wave 1, W1-1b) — AI Safety × AI Gateway wiring on the MAIN production RAG
 * assistant (`aiLocalKnowledgeService.ts`, reached via `aiLocalKnowledgeApi.ts` /ask +
 * /stream). Before this task the service called `aiGgufEngine.generateText`/
 * `generateTextStream` DIRECTLY, bypassing the AI Gateway entirely — zero safety (no
 * redaction), zero metering on the surface users actually chat with.
 *
 * Mirrors `aiSafetyGateway.test.ts`'s pattern: mock the GGUF engine + DB only, and exercise
 * the REAL `aiGateway`/`ai/aiSafety` wiring (no reimplemented redaction logic).
 *
 * Proves:
 *   1. A secret in the QUESTION is redacted before the (mocked) engine sees the prompt
 *      (non-stream `answerQuestion` path).
 *   2. A secret in the STREAMED answer (model echo) is redacted before the SSE-facing
 *      consumer sees it (stream `streamAnswer` path).
 *   3. A gateway metric (task "chat") is recorded for a chat call.
 *   4. Behavior preserved: the extractive/offline fallback still works when the LLM is
 *      unavailable, and streaming is still incremental (not collapsed into one blob).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Default GGUF path (USE_LEGACY_OLLAMA unset → false), matching aiLocalKnowledge.gguf.test.ts.
delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}
const QUERY_VEC = unit(0);

// Single KB chunk whose stored embedding == the (mocked) query embedding → cosine ≈ 1,
// so retrieve.confidence clears the 0.30 threshold that gates the LLM-augmentation path.
const chunks = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    text: "Nội dung hướng dẫn kiểm tra AOI: bước 1 kiểm tra camera, bước 2 kiểm tra ánh sáng.",
    keywords: ["aoi"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    keywords: ["aoi"],
    textLength: 60,
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

// No real-time tool matches — exercise the plain retrieval + LLM-augmentation path.
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
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

// AI Gateway metric flush target — mocked so a metric row is captured without a real DB.
const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { answerQuestion, streamAnswer, reloadKbArtifacts, type StreamEvent } from "./aiLocalKnowledgeService";
import { flush as flushGatewayMetrics } from "./aiGateway";

const SECRET = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const ENV_KEYS = ["AI_SAFETY_ENABLED", "AI_SAFETY_BLOCK_HIGH_RISK", "AI_GATEWAY_LIMIT_CHEAP_PER_MIN", "AI_GATEWAY_LIMIT_DEEP_PER_MIN"] as const;

// answerQuestion/streamAnswer share ONE module-level answer cache keyed by
// `${userRole}|${question}|k=${topK}`. Every test below gets its OWN topK so a cache hit
// from an earlier test can never silently swallow this test's mocked-engine call (cache
// TTL is 10 minutes — well beyond a fast test run — so reusing a topK would leak state).
let topKCounter = 100;
function nextTopK(): number {
  return ++topKCounter;
}

beforeEach(async () => {
  // Drain any metric rows a PRIOR test left buffered (aiGateway's buffer is module-level
  // and persists across tests in this file — only flush()ing empties it) so this test's
  // own assertions on `insertValuesMock` never see a leftover row from an earlier test.
  await flushGatewayMetrics();
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "embed-stub" });
  getDbMock.mockResolvedValue({ insert: insertMock });
  reloadKbArtifacts(); // reset the module-level dataCache between tests
});

async function collectStream(question: string, topK: number): Promise<{ events: StreamEvent[]; tokens: string[] }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  for await (const evt of streamAnswer(question, topK)) {
    events.push(evt);
    if (evt.type === "token") tokens.push(evt.token);
  }
  return { events, tokens };
}

describe("aiLocalKnowledgeService — input redaction (answerQuestion, non-stream)", () => {
  it("redacts a secret in the question before the (mocked) engine ever sees the prompt", async () => {
    generateText.mockResolvedValue({
      text: "Đây là câu trả lời không chứa bí mật nào.",
      modelId: "stub-chat-model",
      totalTimeMs: 5,
      tokensGenerated: 4,
      tokensPrompt: 20,
      tokensPerSecond: 1,
    });

    const question = `hướng dẫn kiểm tra AOI, api_key=${SECRET} dùng để đăng nhập`;
    await answerQuestion(question, nextTopK());

    expect(generateText).toHaveBeenCalledTimes(1);
    const [engineArgs] = generateText.mock.calls[0]!;
    expect(typeof engineArgs.prompt).toBe("string");
    expect(engineArgs.prompt).not.toContain(SECRET);
    expect(engineArgs.prompt).toContain("[REDACTED_SECRET]");
  });

  it("legitimate manufacturing question with no secret reaches the engine unredacted (no false positive)", async () => {
    generateText.mockResolvedValue({
      text: "OK.",
      modelId: "stub-chat-model",
      totalTimeMs: 1,
      tokensGenerated: 1,
      tokensPrompt: 10,
      tokensPerSecond: 1,
    });

    await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());

    const [engineArgs] = generateText.mock.calls[0]!;
    expect(engineArgs.prompt).toContain("hướng dẫn kiểm tra AOI là gì");
    expect(engineArgs.prompt).not.toContain("[REDACTED_SECRET]");
  });
});

describe("aiLocalKnowledgeService — output redaction (streamAnswer)", () => {
  it("redacts a secret the model echoes back in the stream before the consumer sees any token", async () => {
    generateTextStream.mockImplementation(async function* () {
      yield { type: "token", token: "Chắc chắn rồi, đây là khóa của bạn: " };
      yield { type: "token", token: SECRET };
      yield { type: "token", token: " — hãy giữ bí mật nhé." };
      yield { type: "done", fullText: `Chắc chắn rồi, đây là khóa của bạn: ${SECRET} — hãy giữ bí mật nhé.`, tokensPrompt: 30, tokensGenerated: 20 };
    });

    const { tokens } = await collectStream("cho tôi xem lại khóa api tôi vừa gửi", nextTopK());
    const joined = tokens.join("");

    expect(joined).not.toContain(SECRET);
    expect(joined).toContain("[REDACTED_SECRET]");
    // Surrounding, non-secret text must survive untouched.
    expect(joined).toContain("Chắc chắn rồi");
    expect(joined).toContain("hãy giữ bí mật nhé");
  });

  it("streaming is still incremental: multiple non-empty token events, not one collapsed blob", async () => {
    const parts = [
      "Đây là hướng dẫn kiểm tra AOI theo từng bước rõ ràng. ",
      "Bước 1: kiểm tra ánh sáng camera trước khi vận hành. ",
      "Bước 2: kiểm tra tiêu cự ống kính cho đúng khoảng cách. ",
      "Bước 3: xác nhận ngưỡng NG đã cấu hình đúng thông số. ",
      "Hoàn tất kiểm tra, máy sẵn sàng vận hành.",
    ];
    generateTextStream.mockImplementation(async function* () {
      for (const p of parts) yield { type: "token", token: p };
      yield { type: "done", fullText: parts.join(""), tokensPrompt: 15, tokensGenerated: 40 };
    });

    const { tokens } = await collectStream("hướng dẫn kiểm tra AOI từng bước", nextTopK());

    // Proves the redactor is not buffering everything until flush(): more than one
    // non-empty token event reaches the consumer as the underlying chunks arrive.
    expect(tokens.filter((t) => t.length > 0).length).toBeGreaterThan(1);
    expect(tokens.join("")).toBe(parts.join(""));
  });
});

describe("aiLocalKnowledgeService — gateway metering", () => {
  it("records a gateway metric (task chat) for a chat completion via answerQuestion", async () => {
    generateText.mockResolvedValue({
      text: "OK.",
      modelId: "stub-chat-model",
      totalTimeMs: 3,
      tokensGenerated: 2,
      tokensPrompt: 12,
      tokensPerSecond: 1,
    });

    await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK(), [], "engineer", undefined, {
      user: { id: 42, role: "engineer" },
      lang: "vi",
    } as any);
    await flushGatewayMetrics();

    expect(insertValuesMock).toHaveBeenCalled();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    const chatRow = rows.find((r) => r.task === "chat" && r.outcome === "ok");
    expect(chatRow).toBeTruthy();
    expect(chatRow).toMatchObject({ tokensIn: 12, tokensOut: 2, userId: 42 });
  });

  it("records a gateway metric (task chat) for a streamed answer via streamAnswer", async () => {
    generateTextStream.mockImplementation(async function* () {
      yield { type: "token", token: "OK." };
      yield { type: "done", fullText: "OK.", tokensPrompt: 8, tokensGenerated: 1 };
    });

    await collectStream("hướng dẫn kiểm tra AOI là gì", nextTopK());
    await flushGatewayMetrics();

    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "chat" && r.outcome === "ok")).toBe(true);
  });
});

describe("aiLocalKnowledgeService — behavior preserved", () => {
  it("extractive fallback still works when the LLM is unavailable (no crash, honest degrade)", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());

    expect(generateText).not.toHaveBeenCalled();
    expect(res.provider).toBe("extractive");
    expect(typeof res.answer).toBe("string");
    expect(res.answer.length).toBeGreaterThan(0);

    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("streaming falls back to extractive tokens (no crash) when the LLM is unavailable", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { events, tokens } = await collectStream("hướng dẫn kiểm tra AOI là gì", nextTopK());

    expect(generateTextStream).not.toHaveBeenCalled();
    expect(tokens.join("").length).toBeGreaterThan(0);
    const done = events.find((e) => e.type === "done") as Extract<StreamEvent, { type: "done" }> | undefined;
    expect(done?.provider).not.toBe("ollama");

    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
