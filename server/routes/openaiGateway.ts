/**
 * OpenAI-compatible HTTP gateway — doc 34 §III.3(a) / §IV-P0 keystone.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET  {base}/models              — list logical models (OpenAI models-list shape)
 *   POST {base}/chat/completions    — chat (stream + non-stream), OpenAI schema
 *   POST {base}/completions         — text completion + FIM (prompt/suffix), stream + non-stream
 *   POST {base}/embeddings          — embeddings (string | string[]), OpenAI shape
 *
 * WHY: the app exposes NO OpenAI-compatible API today (doc 34 §II.1 finding #4 —
 * "keystone thiếu"). This single serving layer unlocks BOTH the in-app copilot
 * AND external IDE tooling (VS Code + Continue) against the SAME local engine —
 * the "khớp nối vạn năng" of the Hybrid strategy (D1/D3). It is an in-process
 * SHIM over the existing GGUF engine (`aiGgufEngine`); the persistent llama-server
 * coder branch (prefix-cache / real FIM) is a separate P0 item and NOT required here.
 *
 * AUTH / GATING (fail-closed):
 *   • Mounted only when OPENAI_GATEWAY_ENABLED is truthy (default OFF).
 *   • Requires OPENAI_GATEWAY_API_KEY. Enabled + empty key ⇒ REFUSES to mount and
 *     logs a clear error — we NEVER expose an unauthenticated LLM endpoint.
 *   • Every request must carry `Authorization: Bearer <OPENAI_GATEWAY_API_KEY>`
 *     (constant-time compared). 401 otherwise.
 *
 * BINDING NOTE: this is intended for localhost / trusted-LAN engineer use (IDE
 * autocomplete + chat). It inherits the app's listen address — do NOT expose the
 * app publicly with this enabled. Keep the app bound to localhost/LAN.
 * ════════════════════════════════════════════════════════════════════════════
 */
import express, {
  Router,
  type Request,
  type Response,
  type Express,
} from "express";
import { timingSafeEqual } from "node:crypto";
import { requireServiceIdentity } from "../services/security/requireServiceIdentity";
import {
  chatCompletion,
  chatCompletionStream,
  generateText,
  generateFim,
  generateEmbedding,
  generateEmbeddings,
  isGgufAvailable,
  type GgufChatMessage,
} from "../services/aiGgufEngine";
// doc69 G2-3 (Wave 1, W1-1b) — this gateway calls the GGUF engine directly, bypassing the
// AI Gateway entirely (zero safety, zero metering on the external IDE / API surface). Wire
// `planInference` in for safety (input/output redaction) + metering, WITHOUT letting the
// gateway's own routing decision override the model the caller explicitly requested via
// `body.model` (resolved by `resolveModelId` below) — this surface's contract is "you get
// the model you asked for", unlike the KB assistant's router-picked model. Reuses the G2-2
// primitives verbatim; no redaction logic is reimplemented here.
import { planInference, RateLimitError, SafetyBlockedError, type TaskKind, type GatewayPlan } from "../services/aiGateway";
import { redactSecretsAndPII, StreamingSecretRedactor } from "../services/ai/aiSafety";

// ─── Config helpers (read at call-time so flags flip without a module reload) ──

function envStr(name: string): string {
  return (process.env[name] || "").trim();
}
function envBool(name: string): boolean {
  const v = envStr(name).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Review fix (doc69 W1-1b follow-up) — mirrors `aiGateway.ts`'s PRIVATE (not exported)
 * `safetyEnabled()`/`envFlagDefaultOn("AI_SAFETY_ENABLED")`: same env var, same default-ON
 * semantics (unset/empty ⇒ true; only an explicit "0"/"false"/"no"/"off" disables it). Needed
 * locally because this gateway's `StreamingSecretRedactor` usage (below) was previously
 * ungated — the documented `AI_SAFETY_ENABLED=false` escape hatch disabled the non-stream
 * `plan.sanitizeOutput` path (gated inside `planInference`/`aiGateway.ts`) but NOT streaming
 * redaction on this surface. Duplicated rather than exported from aiGateway.ts to keep this
 * fix scoped to openaiGateway.ts only.
 */
function aiSafetyEnabled(): boolean {
  const raw = envStr("AI_SAFETY_ENABLED").toLowerCase();
  if (raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Logical model names advertised on GET /models (doc 34 §III.2 router tiers). */
const LOGICAL_MODELS = ["chat", "code", "fast", "fim", "embed"] as const;
type LogicalModel = (typeof LOGICAL_MODELS)[number];

/**
 * Resolve a client-requested `model` to a concrete GGUF basename for the engine.
 * Returns `undefined` when the engine should pick its configured default
 * (GGUF_DEFAULT_MODEL) — passing a non-existent basename would make the engine
 * throw on load, so unknown-but-empty resolutions fall back to the default.
 *
 * Per decision D2 (§VI-bis): `code`/`chat` reuse GGUF_DEFAULT_MODEL (the 30B-A3B
 * instruct) unless GGUF_CODE_MODEL is set; `fim` uses GGUF_FIM_MODEL else the
 * small fast model.
 */
function resolveModelId(requested?: string): string | undefined {
  const codeModel = envStr("GGUF_CODE_MODEL");
  const defaultModel = envStr("GGUF_DEFAULT_MODEL");
  const fastModel = envStr("GGUF_FAST_MODEL");
  const fimModel = envStr("GGUF_FIM_MODEL");
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
      raw = fimModel || fastModel || undefined;
      break;
    case "embed":
    case "embedding":
    case "embeddings":
      raw = envStr("GGUF_EMBED_MODEL") || undefined;
      break;
    default:
      // Unknown, non-empty id: honour it verbatim (client may target a real
      // on-disk basename). The engine will surface a clear error if it is absent.
      raw = requested && requested.trim() ? requested.trim() : undefined;
  }
  // The engine resolves a basename and appends ".gguf"; the GGUF_* env values already
  // include the extension, so strip a trailing ".gguf" to avoid a "...gguf.gguf" miss
  // (the model router strips it the same way — keep the two consistent).
  return raw ? raw.replace(/\.gguf$/i, "") : undefined;
}

/** Backing basename for a logical model (for the models-list `root`/transparency). */
function backingFor(logical: LogicalModel): string {
  return resolveModelId(logical) || envStr("GGUF_DEFAULT_MODEL") || logical;
}

/**
 * doc69 G2-3 — best-effort TaskKind classification for gateway metering/rate-limit
 * bucketing ONLY. Never used to pick the actual generation model (see the import comment
 * above) — `resolveModelId` remains the single source of truth for that.
 */
function inferTaskFromLabel(label: string, fallback: TaskKind = "chat"): TaskKind {
  const key = (label || "").trim().toLowerCase();
  if (key === "code" || key === "coder") return "code";
  if (key === "fim" || key === "infill") return "fim";
  return fallback;
}

// ─── AI Gateway — fail-open rate limit (review fix) ────────────────────────────
//
// `/v1` has NO per-user identity (a single shared static Bearer token, see the module doc
// comment above) — so every engineer's IDE FIM-autocomplete + coding-chat traffic pools into
// ONE "anon" gateway rate-limit bucket. Before this fix, a `RateLimitError` from `planInference`
// propagated to the outer catch and returned a hard HTTP 429 — breaking autocomplete/coding
// tools for EVERY engineer once anyone's combined traffic tripped the shared budget. A
// code-completion API has no graceful client-side degrade for a 429 (unlike the KB assistant,
// which falls back to an extractive answer).
//
// `server/services/aiProviderRouter.ts`'s `planGateway()` already solved this EXACT "unrelated
// callers colliding in the single anon bucket" problem with a deliberate fail-open: catch
// `RateLimitError` (whose rejection `planInference` has ALREADY recorded as `outcome:"rate_limited"`
// telemetry before throwing — see aiGateway.ts) and proceed WITHOUT a `plan`, so the underlying
// engine call always still happens. Mirrored verbatim here. Any OTHER throw (e.g.
// `SafetyBlockedError`, the opt-in hard-block) is NOT swallowed — same posture as `planGateway()`.
interface PlannedCall {
  plan: GatewayPlan | null;
  /** Sanitized (secrets/PII-redacted) text — callers MUST use this, not the raw request text,
   * when building the engine prompt (falls back to the raw text only if a RateLimitError is
   * thrown without redacted text attached, which should never happen). */
  safeText: string;
}
function planGatewayFailOpen(task: TaskKind, text: string | undefined): PlannedCall {
  try {
    const plan = planInference({ task, text });
    return { plan, safeText: plan.safeText };
  } catch (err) {
    if (err instanceof RateLimitError) return { plan: null, safeText: err.safeText ?? text ?? "" };
    throw err;
  }
}

// ─── OpenAI shape helpers ──────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Rough token estimate (chars/4) for usage on paths where we lack an exact count. */
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil((text || "").length / 4));
}

/** Flatten an OpenAI message `content` (string | array of parts) to plain text. */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && (part as any).type === "text") {
          return String((part as any).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

/** Map OpenAI messages → engine chat messages (system/user/assistant only). */
function toGgufMessages(messages: any[]): GgufChatMessage[] {
  return messages
    .filter((m) => m && typeof m.role === "string")
    .map((m) => ({
      role:
        m.role === "system"
          ? "system"
          : m.role === "assistant"
            ? "assistant"
            : "user",
      content: contentToString(m.content),
    }));
}

// FIM prompt assembly + stop sequences now live in aiGgufEngine.generateFim (native infill);
// the gateway just forwards prefix/suffix to it.

function jsonError(
  res: Response,
  status: number,
  message: string,
  type = "invalid_request_error",
  code?: string,
): void {
  res.status(status).json({ error: { message, type, ...(code ? { code } : {}) } });
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

function extractBearer(req: Request): string | null {
  const header = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ─── Router factory ─────────────────────────────────────────────────────────────

export interface OpenAiGatewayConfig {
  /** Bearer token every request must present (constant-time compared). Required. */
  apiKey: string;
}

/**
 * Build the OpenAI-compatible router. Exported so tests can mount it directly.
 * Callers MUST pass a non-empty apiKey (the register function enforces this and
 * refuses to mount otherwise).
 */
export function createOpenAiGatewayRouter(config: OpenAiGatewayConfig): Router {
  const router = Router();
  const apiKey = config.apiKey;

  // Own body parser so the gateway works regardless of global config / in tests.
  // express.json is idempotent (skips when a body was already parsed upstream).
  router.use(express.json({ limit: process.env.OPENAI_GATEWAY_BODY_LIMIT || "20mb" }));

  // doc 44 G5.22 (SERVICE_MTLS) — sample service-to-service identity seam. This is a
  // genuine internal-consumer surface (in-app copilot + engineer tooling call it).
  // Pass-through when SERVICE_MTLS_ENABLED is OFF (default → bit-compat); when ON,
  // callers must present a valid SPIFFE-lite JWT-SVID (Authorization: SVID <token>
  // or x-svid) verified against the internal CA. Additive + non-breaking.
  router.use(requireServiceIdentity({ audience: "openai-gateway" }));

  // Bearer auth on every endpoint. Fail-closed: no key configured ⇒ reject all.
  router.use((req: Request, res: Response, next) => {
    const token = extractBearer(req);
    if (!apiKey || !token || !timingSafeEqualStr(token, apiKey)) {
      jsonError(
        res,
        401,
        "Invalid API key. Provide 'Authorization: Bearer <OPENAI_GATEWAY_API_KEY>'.",
        "invalid_request_error",
        "invalid_api_key",
      );
      return;
    }
    next();
  });

  async function ensureEngine(res: Response): Promise<boolean> {
    if (!(await isGgufAvailable())) {
      jsonError(res, 503, "Local GGUF engine not available.", "server_error");
      return false;
    }
    return true;
  }

  // ─── GET /models ─────────────────────────────────────────────
  router.get("/models", (_req: Request, res: Response) => {
    const created = nowUnix();
    res.json({
      object: "list",
      data: LOGICAL_MODELS.map((id) => ({
        id,
        object: "model",
        created,
        owned_by: "st4i-local",
        root: backingFor(id),
      })),
    });
  });

  // ─── POST /chat/completions ──────────────────────────────────
  router.post("/chat/completions", async (req: Request, res: Response) => {
    // Review fix — hoisted so the outer catch can record metering on EVERY failure path
    // (see planGatewayFailOpen above): `plan` stays null on the fail-open rate-limit path
    // (record() becomes a safe no-op) and on any early return before the plan is created.
    let plan: GatewayPlan | null = null;
    let engineStart = 0;
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const messages = body.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        jsonError(res, 400, "`messages` must be a non-empty array.");
        return;
      }

      const modelLabel = typeof body.model === "string" && body.model ? body.model : "chat";
      const modelId = resolveModelId(body.model);
      const maxTokens = Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : 1024;
      const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : 0.7;
      const topP = Number.isFinite(body.top_p) ? Number(body.top_p) : undefined;

      // doc69 G2-3 / review fix — AI Gateway: `modelId` above (resolved from the caller's
      // EXPLICIT `body.model`) is what actually generates the response; the gateway plan below
      // is used ONLY for the flag-gated/fail-safe redaction of the most-recent message + the
      // metrics row. Rate-limit is FAIL-OPEN (planGatewayFailOpen above) — this surface has no
      // graceful-degrade UX for a hard 429, unlike the KB assistant's extractive fallback.
      // `SafetyBlockedError` (opt-in hard-block) still propagates — mapped to 400 in the catch
      // block below. No numeric per-user principal exists on this surface (shared static
      // Bearer API key + optional SPIFFE service identity, not a user session).
      const ggufMessagesRaw = toGgufMessages(messages);
      const lastIdx = ggufMessagesRaw.length - 1;
      const representativeText = lastIdx >= 0 ? ggufMessagesRaw[lastIdx].content : "";
      const planned = planGatewayFailOpen(inferTaskFromLabel(modelLabel), representativeText);
      plan = planned.plan;
      // Redact every OTHER message directly/ungated (defense-in-depth, mirrors
      // aiChatAssistant's treatment of prior-turn/tool-result text); the last (most recent)
      // message uses the plan's sanitized text so the AI_SAFETY_ENABLED flag governs it uniformly.
      const ggufMessages: GgufChatMessage[] = ggufMessagesRaw.map((m, i) => ({
        ...m,
        content: i === lastIdx ? planned.safeText : redactSecretsAndPII(m.content).text,
      }));
      const id = genId("chatcmpl");
      const created = nowUnix();
      engineStart = Date.now();

      // ── Streaming (SSE, OpenAI chunk shape) ──
      if (body.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const abort = new AbortController();
        req.on("close", () => abort.abort());

        // First chunk announces the assistant role.
        const roleChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

        const stream = chatCompletionStream(
          { messages: ggufMessages, maxTokens, temperature, topP },
          modelId,
          abort.signal,
        );
        // doc69 G2-3 — stateful per-request redactor: holds back a growing secret across
        // chunk boundaries so it never reaches the SSE client unredacted (reuses the exact
        // G2-2 class — see its doc comment in ai/aiSafety.ts). Review fix — gated behind
        // AI_SAFETY_ENABLED (mirrors the non-stream path's plan.sanitizeOutput, which is
        // already gated inside planInference/aiGateway.ts) so the documented escape hatch
        // actually disables streaming redaction on this surface too.
        const redactor = aiSafetyEnabled() ? new StreamingSecretRedactor() : null;
        let tokensIn = 0;
        let tokensOut = 0;
        let outcome: "ok" | "error" = "ok";
        for await (const chunk of stream) {
          if (res.destroyed) break;
          if (chunk.type === "token" && chunk.token) {
            const safe = redactor ? redactor.push(chunk.token) : chunk.token;
            if (safe) {
              const delta = {
                id,
                object: "chat.completion.chunk",
                created,
                model: modelLabel,
                choices: [{ index: 0, delta: { content: safe }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(delta)}\n\n`);
            }
          } else if (chunk.type === "done") {
            tokensIn = chunk.tokensPrompt ?? 0;
            tokensOut = chunk.tokensGenerated ?? 0;
          } else if (chunk.type === "error") {
            outcome = "error";
            const errChunk = {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelLabel,
              choices: [{ index: 0, delta: {}, finish_reason: "error" }],
              error: { message: chunk.error || "generation error", type: "server_error" },
            };
            res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
          }
        }
        // Release whatever the redactor was still holding back (e.g. a short tail).
        const tail = redactor ? redactor.flush() : "";
        if (tail && !res.destroyed) {
          const delta = {
            id,
            object: "chat.completion.chunk",
            created,
            model: modelLabel,
            choices: [{ index: 0, delta: { content: tail }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(delta)}\n\n`);
        }
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        // `plan?.` — no-op when the fail-open rate-limit path left `plan` null.
        plan?.record({ tokensIn, tokensOut, latencyMs: Date.now() - engineStart, outcome });

        const doneChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // ── Non-streaming ──
      const result = await chatCompletion(
        { messages: ggufMessages, maxTokens, temperature, topP },
        modelId,
      );
      // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
      plan?.record({
        tokensIn: result.tokensPrompt,
        tokensOut: result.tokensGenerated,
        latencyMs: Date.now() - engineStart,
        outcome: "ok",
      });
      res.json({
        id,
        object: "chat.completion",
        created,
        model: modelLabel,
        choices: [
          {
            index: 0,
            // doc69 G2-3 — output safety: redact any secret the model echoed back.
            message: { role: "assistant", content: plan?.sanitizeOutput(result.text) ?? result.text },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: result.tokensPrompt,
          completion_tokens: result.tokensGenerated,
          total_tokens: result.tokensPrompt + result.tokensGenerated,
        },
      });
    } catch (err: any) {
      if (err instanceof SafetyBlockedError) {
        // planInference already recorded 'blocked' telemetry internally before throwing
        // (see aiGateway.ts) — nothing more to record here.
        if (!res.headersSent) jsonError(res, 400, err.message, "invalid_request_error", "safety_blocked");
        else res.end();
        return;
      }
      // Review fix — record an 'error' metric on EVERY other failure path (previously only
      // FIM-streaming did this; chat non-stream + chat stream generator-throw were invisible
      // to ai_gateway_metrics). Idempotent (aiGateway.ts's record() only counts the first
      // call) and a safe no-op when `plan` is null (fail-open path, or failure before the
      // plan was created).
      plan?.record({ latencyMs: engineStart ? Date.now() - engineStart : 0, outcome: "error" });
      if (!res.headersSent) {
        jsonError(res, 500, err?.message || "chat completion failed", "server_error");
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: err?.message || "error" } })}\n\n`);
        res.end();
      }
    }
  });

  // ─── POST /completions (text + FIM) ──────────────────────────
  router.post("/completions", async (req: Request, res: Response) => {
    // Review fix — see /chat/completions above for the rationale (fail-open rate limit +
    // complete error metering).
    let plan: GatewayPlan | null = null;
    let engineStart = 0;
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const rawPrompt = body.prompt;
      const prompt = typeof rawPrompt === "string" ? rawPrompt : Array.isArray(rawPrompt) ? String(rawPrompt[0] ?? "") : "";
      const suffix = typeof body.suffix === "string" ? body.suffix : "";
      if (!prompt && !suffix) {
        jsonError(res, 400, "`prompt` (string) is required.");
        return;
      }

      const isFim = suffix.length > 0;
      const modelLabel = typeof body.model === "string" && body.model ? body.model : isFim ? "fim" : "code";
      const modelId = resolveModelId(body.model || (isFim ? "fim" : "code"));
      const maxTokens = Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : isFim ? 256 : 1024;
      const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : isFim ? 0.2 : 0.7;
      const topP = Number.isFinite(body.top_p) ? Number(body.top_p) : undefined;

      // doc69 G2-3 / review fix — AI Gateway (see /chat/completions above for the "never
      // override the caller's explicit model" rationale — `modelId` above stays the single
      // source of truth for generation, and the fail-open rate-limit rationale). `suffix`
      // (FIM's surrounding code context) is redacted directly/ungated, mirroring
      // aiChatAssistant's treatment of supplementary content.
      const planned = planGatewayFailOpen(isFim ? "fim" : "code", prompt);
      plan = planned.plan;
      const safeSuffix = suffix ? redactSecretsAndPII(suffix).text : suffix;

      // Native fill-in-middle via the engine's generateFim (LlamaCompletion.generateInfillCompletion
      // when the coder model supports infill; raw completion otherwise) — no chat template, so the
      // model returns clean inline code for Continue autocomplete. `suffix` present → real infill.
      const fimOpts = { prefix: planned.safeText, suffix: safeSuffix, maxTokens, temperature, topP };

      const id = genId("cmpl");
      const created = nowUnix();
      engineStart = Date.now();

      // ── Streaming (SSE, OpenAI text_completion shape). generateFim is non-streaming, so emit the
      //    whole completion as ONE chunk then [DONE] — fine for short inline autocomplete. ──
      if (body.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        try {
          const result = await generateFim(fimOpts, modelId);
          // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
          plan?.record({
            tokensIn: result.tokensPrompt,
            tokensOut: result.tokensGenerated,
            latencyMs: Date.now() - engineStart,
            outcome: "ok",
          });
          if (!res.destroyed && result.text) {
            res.write(
              // doc69 G2-3 — output safety: redact any secret the model echoed back.
              `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: plan?.sanitizeOutput(result.text) ?? result.text, finish_reason: null }] })}\n\n`,
            );
          }
        } catch (e: any) {
          plan?.record({ latencyMs: Date.now() - engineStart, outcome: "error" });
          res.write(
            `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "error" }], error: { message: e?.message || "generation error" } })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "stop" }] })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // ── Non-streaming ──
      const result = await generateFim(fimOpts, modelId);
      // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
      plan?.record({
        tokensIn: result.tokensPrompt,
        tokensOut: result.tokensGenerated,
        latencyMs: Date.now() - engineStart,
        outcome: "ok",
      });
      res.json({
        id,
        object: "text_completion",
        created,
        model: modelLabel,
        // doc69 G2-3 — output safety: redact any secret the model echoed back.
        choices: [{ index: 0, text: plan?.sanitizeOutput(result.text) ?? result.text, finish_reason: "stop", logprobs: null }],
        usage: {
          prompt_tokens: result.tokensPrompt,
          completion_tokens: result.tokensGenerated,
          total_tokens: result.tokensPrompt + result.tokensGenerated,
        },
      });
    } catch (err: any) {
      if (err instanceof SafetyBlockedError) {
        // planInference already recorded 'blocked' telemetry internally before throwing
        // (see aiGateway.ts) — nothing more to record here.
        if (!res.headersSent) jsonError(res, 400, err.message, "invalid_request_error", "safety_blocked");
        else res.end();
        return;
      }
      // Review fix — record an 'error' metric on the non-stream failure path too (previously
      // only FIM-streaming's inner try/catch did this). Idempotent + safe no-op when `plan`
      // is null (fail-open path, or failure before the plan was created).
      plan?.record({ latencyMs: engineStart ? Date.now() - engineStart : 0, outcome: "error" });
      if (!res.headersSent) {
        jsonError(res, 500, err?.message || "completion failed", "server_error");
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: err?.message || "error" } })}\n\n`);
        res.end();
      }
    }
  });

  // ─── POST /embeddings ────────────────────────────────────────
  router.post("/embeddings", async (req: Request, res: Response) => {
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const input = body.input;
      const modelLabel = typeof body.model === "string" && body.model ? body.model : "embed";

      const inputs: string[] =
        typeof input === "string"
          ? [input]
          : Array.isArray(input)
            ? input.map((x) => String(x))
            : [];
      if (inputs.length === 0 || inputs.every((s) => s.length === 0)) {
        jsonError(res, 400, "`input` must be a non-empty string or array of strings.");
        return;
      }

      // Embeddings always use the dedicated embed model. Pass the RESOLVED (extension-
      // stripped) basename explicitly — the engine appends ".gguf", and GGUF_EMBED_MODEL
      // already carries it, so relying on the undefined-default would double it ("...gguf.gguf").
      const embedId = resolveModelId("embed");
      let vectors: number[][];
      if (inputs.length === 1) {
        const r = await generateEmbedding(inputs[0], embedId);
        vectors = [r.embedding];
      } else {
        const r = await generateEmbeddings(inputs, embedId);
        vectors = r.embeddings;
      }

      const promptTokens = inputs.reduce((s, t) => s + estimateTokens(t), 0);
      res.json({
        object: "list",
        data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
        model: modelLabel,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      });
    } catch (err: any) {
      jsonError(res, 500, err?.message || "embeddings failed", "server_error");
    }
  });

  // OpenAI-shaped 404 for any other path under the gateway base.
  router.use((_req: Request, res: Response) => {
    jsonError(res, 404, "Unknown gateway endpoint.", "invalid_request_error", "not_found");
  });

  return router;
}

// ─── Registration (mirrors registerAiStreamingRoutes in _core/index.ts) ─────────

/**
 * Mount the OpenAI-compatible gateway on the Express app when enabled.
 * Fail-closed: enabled + empty OPENAI_GATEWAY_API_KEY ⇒ do NOT mount + log error.
 * Returns true when mounted, false otherwise (disabled or refused).
 */
export function registerOpenAiGateway(app: Express): boolean {
  if (!envBool("OPENAI_GATEWAY_ENABLED")) {
    return false; // default OFF — not mounted, /v1/* → 404
  }

  const apiKey = envStr("OPENAI_GATEWAY_API_KEY");
  if (!apiKey) {
    console.error(
      "[openaiGateway] REFUSING to mount: OPENAI_GATEWAY_ENABLED is on but " +
        "OPENAI_GATEWAY_API_KEY is empty. An unauthenticated LLM endpoint will " +
        "NOT be exposed. Set OPENAI_GATEWAY_API_KEY to enable the gateway.",
    );
    return false;
  }

  const basePath = envStr("OPENAI_GATEWAY_PATH") || "/v1";
  app.use(basePath, createOpenAiGatewayRouter({ apiKey }));
  console.log(
    `[openaiGateway] OpenAI-compatible gateway mounted at ${basePath} ` +
      `(chat/completions · completions[FIM] · embeddings · models). ` +
      `Bearer-auth required; intended for localhost/LAN engineer use only.`,
  );
  return true;
}
