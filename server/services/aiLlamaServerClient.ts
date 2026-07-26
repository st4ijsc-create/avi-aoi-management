/**
 * doc 48 R5 — PERSISTENT LLAMA-SERVER CLIENT.
 *
 * The deep generative model (exec-summary, ops-chat, RCA) is normally loaded
 * IN-PROCESS via node-llama-cpp, where it competes with the always-resident
 * embedder for the single GPU's VRAM (32 GB). Under contention the deep model
 * fails to load and generation silently degrades to offline templates.
 *
 * This client lets the deep model run in a SEPARATE, PERSISTENT llama.cpp server
 * process (`llama-server`, OpenAI-compatible /v1/chat/completions) that owns its
 * own VRAM budget and stays warm. The API process keeps only the small embedder
 * in-process and forwards deep-model text generation over HTTP. No extra GPU
 * purchase: llama-server + the embedder are sized to co-reside (see the runbook
 * scripts/ai/llama-server.md).
 *
 * DEFAULT OFF (LLAMA_SERVER_ENABLED !== "true"): every call returns "not routed"
 * and the engine uses its existing in-process path byte-for-byte. When ON, only
 * text generation for the SERVER'S model is routed; embeddings, vision, and any
 * other model stay in-process. On a server error the engine falls back in-process
 * unless LLAMA_SERVER_STRICT=true (then it throws, so honest-degrade/offline
 * templates kick in rather than a silent wrong-path).
 *
 * doc69 G2-6 — ROBUSTNESS: the engine (aiGgufEngine.generateText/generateJSON) runs
 * preflightHealthy() (short timeout, LLAMA_SERVER_HEALTH_TIMEOUT_MS, default 2s) before EVERY
 * server-routed call. Unhealthy/unreachable → skip straight to in-process (no waiting out the
 * long generation timeout). Healthy but the generation call itself still fails/times out
 * (LLAMA_SERVER_TIMEOUT_MS, default 120s) → the existing try/catch below still falls back
 * in-process. Both paths log a clear console.warn (or throw under LLAMA_SERVER_STRICT). The
 * answer is NEVER lost to a down/flaky server as long as in-process inference is available.
 */
import type { GgufGenerateOptions, GgufGenerateResult } from "./aiGgufEngine";

function basename(file: string): string {
  return file.replace(/\.gguf$/i, "").replace(/^.*[\\/]/, "").trim();
}

/** Basename of the model this server serves. Defaults to the deep model. */
function serverModelBasename(): string {
  const explicit = (process.env.LLAMA_SERVER_MODEL || "").trim();
  if (explicit) return basename(explicit);
  return basename(process.env.GGUF_DEFAULT_MODEL || "");
}

export function llamaServerEnabled(): boolean {
  return process.env.LLAMA_SERVER_ENABLED === "true" && !!(process.env.LLAMA_SERVER_URL || "").trim();
}

export function llamaServerStrict(): boolean {
  return process.env.LLAMA_SERVER_STRICT === "true";
}

/**
 * Route a text-generation call to the server only when it's enabled AND the
 * requested model IS the model the server serves (a single llama-server hosts one
 * model — routing a code/fast/vision model there would silently use the wrong
 * weights). `undefined` modelId means "the deep default", which the server serves.
 */
export function shouldUseServerForText(modelId?: string): boolean {
  if (!llamaServerEnabled()) return false;
  const wanted = modelId ? basename(modelId) : basename(process.env.GGUF_DEFAULT_MODEL || "");
  const served = serverModelBasename();
  return !!served && wanted === served;
}

function baseUrl(): string {
  return (process.env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const key = (process.env.LLAMA_SERVER_API_KEY || "").trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

/**
 * Liveness probe (used by the runbook/health surface + preflightHealthy() below).
 *
 * doc69 G2-6 fix: the /v1/models fallback USED TO fire without an abort signal at all — a
 * server that accepts the TCP connection but never responds (hung, overloaded, mid-restart)
 * could make this "short timeout" health check hang indefinitely, defeating its entire purpose.
 * Both requests now share the SAME AbortController, so the whole probe is bounded by `timeoutMs`
 * regardless of which branch it takes.
 */
export async function llamaServerHealthy(timeoutMs = 3000): Promise<boolean> {
  if (!baseUrl()) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // llama.cpp exposes /health; fall back to /v1/models.
    const res = await fetch(`${baseUrl()}/health`, { headers: authHeaders(), signal: ctrl.signal });
    return res.ok;
  } catch {
    try {
      const res = await fetch(`${baseUrl()}/v1/models`, { headers: authHeaders(), signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(t);
  }
}

/** Short timeout (default 2s) for the PRE-generation preflight probe below — deliberately much
 *  shorter than LLAMA_SERVER_TIMEOUT_MS (generation timeout, default 120s) so a down/unresponsive
 *  server is detected in ~2s instead of only after a long hung POST. Configurable in case the
 *  server's /health itself is slow (e.g. under heavy load) — raise if false negatives occur. */
function healthCheckTimeoutMs(): number {
  const n = Number(process.env.LLAMA_SERVER_HEALTH_TIMEOUT_MS ?? 2000);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

/**
 * doc69 G2-6 — Fast pre-flight liveness check the engine (aiGgufEngine) runs immediately before
 * EVERY server-routed generation call. This is what makes the server→in-process fallback FAST
 * (~2s) rather than merely eventually-correct (waiting out the full generation timeout on a
 * hung connection). Wraps llamaServerHealthy() with the short healthCheckTimeoutMs(); never
 * throws (llamaServerHealthy already swallows all transport errors and resolves false).
 */
export async function preflightHealthy(): Promise<boolean> {
  return llamaServerHealthy(healthCheckTimeoutMs());
}

/** POST an OpenAI chat-completion to the server and return the raw JSON + timing. */
async function postChatCompletion(body: Record<string, unknown>): Promise<{ json: any; totalTimeMs: number }> {
  const url = baseUrl();
  if (!url) throw new Error("[llamaServer] LLAMA_SERVER_URL not set");
  const startTime = Date.now();
  const timeoutMs = Number(process.env.LLAMA_SERVER_TIMEOUT_MS ?? 120_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[llamaServer] HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { json: await res.json(), totalTimeMs: Date.now() - startTime };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Generate via the persistent server's OpenAI-compatible endpoint. Uses proper
 * system/user chat roles (the server applies the model's chat template) and maps
 * the response back to the engine's GgufGenerateResult. Throws on any transport
 * or protocol error so the caller can decide (fall back in-process, or honest
 * offline template under STRICT).
 */
export async function serverGenerateText(
  options: GgufGenerateOptions,
  modelId?: string,
): Promise<GgufGenerateResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  let user = options.prompt;
  if (options.jsonMode) user += "\n\nRespond with valid JSON only. No markdown, no explanations.";
  messages.push({ role: "user", content: user });

  const body: Record<string, unknown> = {
    model: modelId ? basename(modelId) : serverModelBasename(),
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    stream: false,
  };
  if (options.stopSequences?.length) body.stop = options.stopSequences;
  if (options.jsonMode) body.response_format = { type: "json_object" };

  const { json, totalTimeMs } = await postChatCompletion(body);
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  if (typeof text !== "string" || text.length === 0) throw new Error("[llamaServer] empty completion");

  const tokensPrompt = Number(json?.usage?.prompt_tokens ?? 0);
  const tokensGenerated = Number(json?.usage?.completion_tokens ?? 0);
  const tokensPerSecond = totalTimeMs > 0 && tokensGenerated > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;

  return {
    text,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
    modelId: String(body.model),
  };
}

/**
 * Schema-constrained JSON generation via the server. Passes the JSON schema both
 * as llama.cpp's native `json_schema` field AND OpenAI `response_format`, so a
 * schema-aware server constrains the decoder (parity with the in-process GBNF
 * grammar) and a plain OpenAI server still returns valid JSON. Returns the parsed
 * object + raw text + token/timing metadata (shape matches engine.generateJSON).
 */
export async function serverGenerateJSON<T = unknown>(
  jsonSchema: object,
  options: GgufGenerateOptions,
  modelId?: string,
): Promise<{ data: T; raw: string; tokensGenerated: number; tokensPrompt: number; totalTimeMs: number; tokensPerSecond: number; modelId: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  messages.push({ role: "user", content: options.prompt });

  const body: Record<string, unknown> = {
    model: modelId ? basename(modelId) : serverModelBasename(),
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.2,
    top_p: options.topP ?? 0.9,
    stream: false,
    json_schema: jsonSchema, // llama.cpp server extension → constrains decode
    response_format: { type: "json_object" }, // OpenAI fallback → at least valid JSON
  };

  const { json, totalTimeMs } = await postChatCompletion(body);
  const raw: string = json?.choices?.[0]?.message?.content ?? "";
  if (typeof raw !== "string" || raw.length === 0) throw new Error("[llamaServer] empty JSON completion");

  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch (err: any) {
    throw new Error(`[llamaServer] server produced invalid JSON: ${err?.message || err}; raw=${raw.slice(0, 200)}`);
  }

  const tokensPrompt = Number(json?.usage?.prompt_tokens ?? 0);
  const tokensGenerated = Number(json?.usage?.completion_tokens ?? 0);
  return {
    data,
    raw,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: totalTimeMs > 0 && tokensGenerated > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
    modelId: String(body.model),
  };
}
