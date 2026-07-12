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

// ─── Config helpers (read at call-time so flags flip without a module reload) ──

function envStr(name: string): string {
  return (process.env[name] || "").trim();
}
function envBool(name: string): boolean {
  const v = envStr(name).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
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
      const ggufMessages = toGgufMessages(messages);
      const id = genId("chatcmpl");
      const created = nowUnix();

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
        for await (const chunk of stream) {
          if (res.destroyed) break;
          if (chunk.type === "token" && chunk.token) {
            const delta = {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelLabel,
              choices: [{ index: 0, delta: { content: chunk.token }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(delta)}\n\n`);
          } else if (chunk.type === "error") {
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
      res.json({
        id,
        object: "chat.completion",
        created,
        model: modelLabel,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.text },
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

      // Native fill-in-middle via the engine's generateFim (LlamaCompletion.generateInfillCompletion
      // when the coder model supports infill; raw completion otherwise) — no chat template, so the
      // model returns clean inline code for Continue autocomplete. `suffix` present → real infill.
      const fimOpts = { prefix: prompt, suffix, maxTokens, temperature, topP };

      const id = genId("cmpl");
      const created = nowUnix();

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
          if (!res.destroyed && result.text) {
            res.write(
              `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: result.text, finish_reason: null }] })}\n\n`,
            );
          }
        } catch (e: any) {
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
      res.json({
        id,
        object: "text_completion",
        created,
        model: modelLabel,
        choices: [{ index: 0, text: result.text, finish_reason: "stop", logprobs: null }],
        usage: {
          prompt_tokens: result.tokensPrompt,
          completion_tokens: result.tokensGenerated,
          total_tokens: result.tokensPrompt + result.tokensGenerated,
        },
      });
    } catch (err: any) {
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
