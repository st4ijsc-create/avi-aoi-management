/**
 * doc69 G2-3 (Wave 1, W1-1b) — AI Safety × AI Gateway wiring on the /v1 OpenAI-compatible
 * gateway (`openaiGateway.ts`). Before this task, `/chat/completions` and `/completions`
 * called the GGUF engine DIRECTLY, bypassing the AI Gateway entirely — zero safety (no
 * redaction), zero metering on this external IDE/API-facing surface.
 *
 * Mocks the GGUF engine + DB only (mirrors `openaiGateway.test.ts` / `aiSafetyGateway.test.ts`)
 * and exercises the REAL `aiGateway`/`ai/aiSafety` wiring — no reimplemented redaction logic.
 *
 * Proves: input redaction reaches the engine, a gateway metric is recorded, and the
 * OpenAI-compatible response shape is unchanged.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  lastChatArgs: null as any,
  lastFimArgs: null as any,
}));

// Review fix (doc69 W1-1b follow-up) — `chatCompletion`/`generateFim`/`chatCompletionStream`
// are plain `const`s (not declared via `vi.hoisted`) referenced from the `vi.mock` factory
// below, mirroring the `getDbMock`/`insertValuesMock` pattern already used in this file: the
// factory function body only runs at import-resolution time, by which point these consts have
// already been initialized. Wrapping `chatCompletionStream` in `vi.fn()` (it used to be a bare
// generator function) lets tests override it per-call via `mockImplementationOnce` to simulate
// a mid-stream engine failure (review fix — error metering test).
const chatCompletionMock = vi.fn(async (opts: any, modelId?: string) => {
  h.lastChatArgs = { opts, modelId };
  return { text: "hello from chat", tokensPrompt: 7, tokensGenerated: 3, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
});
const generateFimMock = vi.fn(async (opts: any, modelId?: string) => {
  h.lastFimArgs = { opts, modelId };
  return { text: "completed text", tokensPrompt: 5, tokensGenerated: 2, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
});
const chatCompletionStreamMock = vi.fn(async function* defaultChatStream() {
  yield { type: "token", token: "hi" };
  yield { type: "done", fullText: "hi", tokensPrompt: 1, tokensGenerated: 1 };
});

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
  generateText: vi.fn(),
  generateFim: (...a: unknown[]) => generateFimMock(...a),
  generateEmbedding: vi.fn(async () => ({ embedding: [0.1], dimensions: 1, modelId: "embed" })),
  generateEmbeddings: vi.fn(async () => ({ embeddings: [[0.1]], dimensions: 1, modelId: "embed" })),
  chatCompletionStream: (...a: unknown[]) => chatCompletionStreamMock(...a),
  generateTextStream: async function* () {},
}));

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { registerOpenAiGateway } from "./openaiGateway";
import { flush as flushGatewayMetrics } from "../services/aiGateway";

async function serve(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const API_KEY = "SAFETY-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}` };
const SECRET = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let enabled: { url: string; server: Server };
const ENV_KEYS = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  delete process.env.OPENAI_GATEWAY_PATH; // default /v1
  const app = express();
  const mounted = registerOpenAiGateway(app);
  expect(mounted).toBe(true);
  enabled = await serve(app);
});

afterAll(async () => {
  await new Promise<void>((resolve) => enabled.server.close(() => resolve()));
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(async () => {
  // Drain any metric rows a PRIOR test left buffered (aiGateway's buffer is module-level)
  // so this test's own assertions on `insertValuesMock` never see a leftover row.
  getDbMock.mockResolvedValue({ insert: insertMock });
  await flushGatewayMetrics();
  vi.clearAllMocks();
  getDbMock.mockResolvedValue({ insert: insertMock });
  h.lastChatArgs = null;
  h.lastFimArgs = null;
});

describe("POST /v1/chat/completions — AI safety + metering", () => {
  it("redacts a secret in the message content before it reaches the engine; response shape unchanged", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "code",
        messages: [{ role: "user", content: `here is my key ${SECRET}, use it` }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // OpenAI-compat response shape identical to the pre-existing contract.
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("code");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "hello from chat" });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });

    // The engine never saw the raw secret.
    expect(h.lastChatArgs).not.toBeNull();
    const sent = h.lastChatArgs.opts.messages;
    const sentContent = sent[sent.length - 1].content;
    expect(sentContent).not.toContain(SECRET);
    expect(sentContent).toContain("[REDACTED_SECRET]");
  });

  it("redacts secrets in EARLIER (non-last) messages too (system/history, defense-in-depth)", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: `remember my password=hunter2ndpass for later` },
          { role: "assistant", content: "Noted." },
          { role: "user", content: "what did I just tell you?" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(h.lastChatArgs).not.toBeNull();
    const sent = h.lastChatArgs.opts.messages as Array<{ content: string }>;
    expect(sent.some((m) => m.content.includes("hunter2ndpass"))).toBe(false);
    expect(sent.some((m) => m.content.includes("[REDACTED_SECRET]"))).toBe(true);
  });

  it("legitimate content with no secret reaches the engine unredacted (no false positive)", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello there" }] }),
    });
    expect(res.status).toBe(200);
    const sent = h.lastChatArgs.opts.messages;
    expect(sent[sent.length - 1].content).toBe("hello there");
  });

  it("records a gateway metric (task chat, outcome ok) for the call", async () => {
    await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "metering check" }] }),
    });
    await flushGatewayMetrics();

    expect(insertValuesMock).toHaveBeenCalled();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    const row = rows.find((r) => r.task === "chat" && r.outcome === "ok");
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ tokensIn: 7, tokensOut: 3 });
  });
});

describe("POST /v1/completions (FIM) — AI safety + metering", () => {
  it("redacts a secret in the prefix/suffix before it reaches generateFim; response shape unchanged", async () => {
    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: `const key = "${SECRET}";\n`, suffix: `\n// password=hunter3rdpass` }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("text_completion");
    expect(body.choices[0].text).toBe("completed text");
    expect(body.usage.total_tokens).toBe(7);

    expect(h.lastFimArgs).not.toBeNull();
    expect(h.lastFimArgs.opts.prefix).not.toContain(SECRET);
    expect(h.lastFimArgs.opts.prefix).toContain("[REDACTED_SECRET]");
    expect(h.lastFimArgs.opts.suffix).not.toContain("hunter3rdpass");
  });

  it("records a gateway metric (task fim, outcome ok) for a FIM call", async () => {
    await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }),
    });
    await flushGatewayMetrics();

    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "fim" && r.outcome === "ok")).toBe(true);
  });
});

// ─── Review fix (doc69 W1-1b follow-up) — Important #2: gateway metering missed 3 of 4 ──
// failure sub-paths (only FIM-streaming recorded outcome:"error" on an engine throw). These
// tests force each of the 4 request shapes' underlying engine call to fail and assert a
// gateway metric with outcome:"error" is still recorded — mirroring aiLocalKnowledgeService's
// record-on-both-success-and-error contract.
describe("gateway metering — 'error' outcome recorded on EVERY failure path (review fix, all 4 request shapes)", () => {
  it("chat non-stream: an engine failure still records an 'error' gateway metric", async () => {
    chatCompletionMock.mockRejectedValueOnce(new Error("chat engine boom"));
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "trigger a chat failure" }] }),
    });
    expect(res.status).toBe(500);

    await flushGatewayMetrics();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "chat" && r.outcome === "error")).toBe(true);
  });

  it("chat stream: a MID-STREAM engine failure (generator throws after SSE headers are already sent) still records an 'error' gateway metric", async () => {
    chatCompletionStreamMock.mockImplementationOnce(async function* () {
      yield { type: "token", token: "partial" };
      throw new Error("stream engine boom");
    });
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "trigger a stream failure" }] }),
    });
    // Headers were already flushed as 200 (SSE) before the generator threw — the outer catch
    // can only fall back to writing an error event + ending the stream, not change the status.
    expect(res.status).toBe(200);
    await res.text(); // drain the SSE body so the request completes

    await flushGatewayMetrics();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "chat" && r.outcome === "error")).toBe(true);
  });

  it("FIM non-stream: an engine failure still records an 'error' gateway metric", async () => {
    generateFimMock.mockRejectedValueOnce(new Error("fim engine boom"));
    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }),
    });
    expect(res.status).toBe(500);

    await flushGatewayMetrics();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "fim" && r.outcome === "error")).toBe(true);
  });

  it("FIM stream: an engine failure still records an 'error' gateway metric (this path already worked before the fix — regression guard)", async () => {
    generateFimMock.mockRejectedValueOnce(new Error("fim stream engine boom"));
    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ stream: true, prompt: "def foo():\n  ", suffix: "\n  return x" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    await flushGatewayMetrics();
    const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
    expect(rows.some((r) => r.task === "fim" && r.outcome === "error")).toBe(true);
  });
});

// ─── Review fix (doc69 W1-1b follow-up) — Important #1: /v1 rate-limit must FAIL OPEN ───
// `/v1` has no per-user identity (shared static Bearer token) — every engineer's IDE
// FIM-autocomplete + coding-chat traffic pools into ONE anon gateway bucket. These tests use a
// FRESH module graph per test (`vi.resetModules()` + dynamic import, same pattern as
// `aiProviderGatewayRouting.test.ts`'s `loadFresh()`) so `AI_GATEWAY_LIMIT_CHEAP_PER_MIN` can be
// tuned to "1" and exhausted deterministically with a single prior request, isolated from the
// shared `enabled` server's default (120/min) budget used by every other test in this file.
describe("rate-limit fail-open (review fix — mirrors aiProviderRouter.planGateway's precedent)", () => {
  afterEach(() => {
    delete process.env.AI_GATEWAY_LIMIT_CHEAP_PER_MIN;
  });

  it("chat: once the shared anon 'cheap' budget is exhausted, the call still PROCEEDS (200, not 429) and a rate_limited metric is recorded", async () => {
    process.env.AI_GATEWAY_LIMIT_CHEAP_PER_MIN = "1"; // exhausted after 1 request
    vi.resetModules();
    const mod = await import("./openaiGateway");
    const freshGateway = await import("../services/aiGateway");
    getDbMock.mockResolvedValue({ insert: insertMock });

    const app = express();
    expect(mod.registerOpenAiGateway(app)).toBe(true);
    const srv = await serve(app);
    try {
      // First call consumes the 1-per-min "cheap" budget (task "chat" on a short message → Tier 1).
      const first = await fetch(`${srv.url}/v1/chat/completions`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(first.status).toBe(200);

      // Second call: budget now exhausted → planInference throws RateLimitError internally.
      // Must fail OPEN (200, generation proceeds), never a hard 429.
      const second = await fetch(`${srv.url}/v1/chat/completions`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "still works after the budget is gone" }] }),
      });
      expect(second.status).toBe(200);
      const body = await second.json();
      // OpenAI-compat response shape unchanged even on the fail-open path.
      expect(body.object).toBe("chat.completion");
      expect(body.choices[0].message).toEqual({ role: "assistant", content: "hello from chat" });
      expect(body.choices[0].finish_reason).toBe("stop");
      expect(body.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });

      await freshGateway.flush();
      const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
      expect(rows.some((r) => r.outcome === "rate_limited")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => srv.server.close(() => resolve()));
    }
  });

  it("FIM: once the shared anon 'cheap' budget is exhausted, the call still PROCEEDS (200, not 429) and a rate_limited metric is recorded", async () => {
    process.env.AI_GATEWAY_LIMIT_CHEAP_PER_MIN = "1";
    vi.resetModules();
    const mod = await import("./openaiGateway");
    const freshGateway = await import("../services/aiGateway");
    getDbMock.mockResolvedValue({ insert: insertMock });

    const app = express();
    expect(mod.registerOpenAiGateway(app)).toBe(true);
    const srv = await serve(app);
    try {
      // FIM always routes to Tier 1 ("cheap") regardless of AI_CODE_ROUTER_ENABLED — see
      // aiModelRouter.route()'s `task === "fim"` branch — so it shares the exact same anon
      // bucket as chat, which is the review-flagged scenario (both traffic types collide).
      const first = await fetch(`${srv.url}/v1/completions`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }),
      });
      expect(first.status).toBe(200);

      const second = await fetch(`${srv.url}/v1/completions`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "def bar():\n  ", suffix: "\n  return y" }),
      });
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body.object).toBe("text_completion");
      expect(body.choices[0].text).toBe("completed text");
      expect(body.choices[0].finish_reason).toBe("stop");

      await freshGateway.flush();
      const rows = insertValuesMock.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
      expect(rows.some((r) => r.outcome === "rate_limited")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => srv.server.close(() => resolve()));
    }
  });
});
