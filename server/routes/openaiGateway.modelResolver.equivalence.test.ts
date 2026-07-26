/**
 * doc69 G2-5b — equivalence proof: openaiGateway's private `resolveModelId()` (now delegating to
 * the shared modelResolver) resolves the SAME basename it did before the refactor, observed via
 * the `modelId` argument forwarded to the (mocked) GGUF engine at each endpoint — `resolveModelId`
 * itself is not exported, so this is a deliberate black-box/HTTP-level equivalence check (the
 * most faithful "same observable behavior at the call site" proof available).
 *
 * doc69 W1-4 review fix — an EARLIER version of this refactor reconciled the "fim" resolution to
 * a 3-level fallback (…-> GGUF_DEFAULT_MODEL), matching aiModelRouter.ts/aiGgufEngine.ts. That was
 * a genuine, untested BEHAVIOR CHANGE for `POST /v1/chat/completions` (unlike `/v1/completions` →
 * generateFim, `chatCompletion`/`chatCompletionStream` have no internal fallback of their own — an
 * explicit "default" modelId here force-pins that model instead of reusing whatever's already
 * resident). FIXED: `resolveLogicalModel("fim"/"infill")` now resolves EXACTLY as the pre-refactor
 * `openaiGateway.resolveModelId` did (2-level: FIM_MODEL -> FAST_MODEL -> undefined). See
 * server/services/ai/modelResolver.ts's header (STEP 0 finding (b)) and
 * .superpowers/sdd/ai-g2-5b-report.md for the full history.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ last: null as null | { fn: string; modelId?: string } }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async (_opts: any, modelId?: string) => {
    h.last = { fn: "chatCompletion", modelId };
    return { text: "ok", tokensPrompt: 1, tokensGenerated: 1, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateText: vi.fn(async (_opts: any, modelId?: string) => {
    h.last = { fn: "generateText", modelId };
    return { text: "ok", tokensPrompt: 1, tokensGenerated: 1, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateFim: vi.fn(async (_opts: any, modelId?: string) => {
    h.last = { fn: "generateFim", modelId };
    return { text: "ok", tokensPrompt: 1, tokensGenerated: 1, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateEmbedding: vi.fn(async (_t: string, modelId?: string) => {
    h.last = { fn: "generateEmbedding", modelId };
    return { embedding: [0.1], dimensions: 1, modelId: modelId || "embed" };
  }),
  generateEmbeddings: vi.fn(async (_ts: string[], modelId?: string) => {
    h.last = { fn: "generateEmbeddings", modelId };
    return { embeddings: [[0.1]], dimensions: 1, modelId: modelId || "embed" };
  }),
  chatCompletionStream: async function* () {
    yield { type: "done", fullText: "" };
  },
  generateTextStream: async function* () {
    yield { type: "done", fullText: "" };
  },
}));

import { registerOpenAiGateway } from "./openaiGateway";

async function serve(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const API_KEY = "EQUIV-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}` };
let ctx: { url: string; server: Server };

const GGUF_KEYS = ["GGUF_FAST_MODEL", "GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL", "GGUF_FIM_MODEL", "GGUF_EMBED_MODEL"] as const;
const GATEWAY_KEYS = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH"] as const;
const savedGateway: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of GATEWAY_KEYS) savedGateway[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  delete process.env.OPENAI_GATEWAY_PATH;
  const app = express();
  const mounted = registerOpenAiGateway(app);
  expect(mounted).toBe(true);
  ctx = await serve(app);
});

afterEach(() => {
  for (const k of GGUF_KEYS) delete process.env[k];
});

afterAll(async () => {
  for (const k of GATEWAY_KEYS) {
    if (savedGateway[k] === undefined) delete process.env[k];
    else process.env[k] = savedGateway[k];
  }
  await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
});

/**
 * Pre-refactor reference copy (verbatim algorithm) of openaiGateway.ts's OLD resolveModelId(),
 * before delegating to modelResolver.ts. Deliberately duplicated (not imported) — the point is an
 * INDEPENDENT re-implementation to compare against. Note the intentionally-preserved 2-level "fim"
 * fallback (the drift documented above).
 */
function preRefactorResolveModelId(requested: string | undefined): string | undefined {
  const s = (n: string) => (process.env[n] || "").trim();
  const codeModel = s("GGUF_CODE_MODEL");
  const defaultModel = s("GGUF_DEFAULT_MODEL");
  const fastModel = s("GGUF_FAST_MODEL");
  const fimModel = s("GGUF_FIM_MODEL");
  const key = (requested || "").trim().toLowerCase();

  let raw: string | undefined;
  switch (key) {
    case "":
    case "chat":
      raw = defaultModel || undefined;
      break;
    case "code":
    case "coder":
      raw = codeModel || defaultModel || undefined;
      break;
    case "fast":
      raw = fastModel || undefined;
      break;
    case "fim":
    case "infill":
      raw = fimModel || fastModel || undefined; // NOTE: no 3rd-level default fallback (the drift)
      break;
    default:
      raw = requested && requested.trim() ? requested.trim() : undefined;
  }
  return raw ? raw.replace(/\.gguf$/i, "") : undefined;
}

describe("openaiGateway /v1/chat/completions — model resolution equivalence", () => {
  const matrix: Array<{ label: string; env: Record<string, string>; model: string }> = [
    { label: "chat, default set", env: { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, model: "chat" },
    { label: "code, code+default set", env: { GGUF_CODE_MODEL: "Coder.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, model: "code" },
    { label: "code, only default set (fallback)", env: { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, model: "code" },
    { label: "fast, fast set", env: { GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, model: "fast" },
    {
      label: "fim, fim+fast+default set",
      env: { GGUF_FIM_MODEL: "Fim.gguf", GGUF_FAST_MODEL: "Qwen3-4B.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" },
      model: "fim",
    },
    { label: "fim, only fast set (fim unset)", env: { GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, model: "fim" },
    // doc69 W1-4 review fix — THE case: FIM+FAST unset, DEFAULT set. This is the exact scenario
    // the review flagged: chatCompletion/chatCompletionStream have no internal fallback, so
    // resolveModelId must return `undefined` here (matching the pre-refactor reference) so
    // getOrLoadModel(undefined) reuses whatever model is already resident instead of a NEW code
    // path force-pinning GGUF_DEFAULT_MODEL. `preRefactorResolveModelId("fim")` is `undefined` in
    // this config — asserting equality proves the fix, not just documents intent.
    { label: "fim, only default set (fim+fast unset) — MUST NOT force-pin default", env: { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, model: "fim" },
    { label: "infill, only default set (fim+fast unset) — MUST NOT force-pin default", env: { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, model: "infill" },
  ];

  for (const { label, env, model } of matrix) {
    it(`${label} -> matches pre-refactor resolveModelId`, async () => {
      for (const [k, v] of Object.entries(env)) process.env[k] = v;
      const res = await fetch(`${ctx.url}/v1/chat/completions`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(200);
      expect(h.last?.modelId).toBe(preRefactorResolveModelId(model));
    });
  }
});

describe("openaiGateway /v1/completions (native FIM) — PRESERVED fim resolution (doc69 W1-4 fix)", () => {
  it("fim with FAST+FIM unset, DEFAULT set: resolveModelId passes undefined (matches pre-refactor) — generateFim's OWN internal fimModelBasename() backstop (unchanged, still 3-level) is what actually resolves the default at runtime, NOT this gateway", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const res = await fetch(`${ctx.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }), // suffix -> isFim
    });
    expect(res.status).toBe(200);
    expect(h.last?.fn).toBe("generateFim");
    // FIXED (doc69 W1-4): the gateway's resolveModelId() passes `undefined` here — same as the
    // pre-refactor reference — because generateFim (aiGgufEngine.ts, mocked away in THIS test) is
    // the one with the 3-level fallback backstop (`modelId ?? fimModelBasename()`), verified
    // separately/end-to-end in aiGgufEngine.modelResolver.equivalence.test.ts and
    // aiGgufEngine.test.ts. This gateway must not pre-empt that by resolving the default itself.
    expect(h.last?.modelId).toBeUndefined();
    expect(h.last?.modelId).toBe(preRefactorResolveModelId("fim"));
  });

  it("fim with FAST set (FIM unset): unchanged — resolves to fast, same as pre-refactor", async () => {
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const res = await fetch(`${ctx.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }),
    });
    expect(res.status).toBe(200);
    expect(h.last?.modelId).toBe("Qwen3-4B");
    expect(h.last?.modelId).toBe(preRefactorResolveModelId("fim"));
  });
});

describe("openaiGateway /v1/embeddings — model resolution equivalence", () => {
  it("embed model resolves from GGUF_EMBED_MODEL, matching pre-refactor behavior", async () => {
    process.env.GGUF_EMBED_MODEL = "mxbai-embed-large.gguf";
    const res = await fetch(`${ctx.url}/v1/embeddings`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(res.status).toBe(200);
    expect(h.last?.modelId).toBe("mxbai-embed-large");
  });
});
