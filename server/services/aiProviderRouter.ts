/**
 * AI Provider Router — LOCAL-ONLY (GGUF / llama.cpp).
 *
 * The OpenAI cloud branch was removed to keep the system fully on-prem.
 * Public API surface kept identical so existing callers
 * (aiAdvancedVision, aiVisionLanguage, aiSettingsRouter, …) keep working.
 *
 * Configuration (env):
 *  - GGUF_DEFAULT_MODEL   = filename in uploads/gguf-models
 *  - GGUF_VISION_MODEL    = LLaVA gguf filename
 *  - GGUF_VISION_MMPROJ   = mmproj-*.gguf filename
 */

import {
  generateText as ggufGenerateText,
  generateJSON as ggufGenerateJSON,
  describeImage as ggufDescribeImage,
} from "./aiGgufEngine";
// doc69 G2-1 — route every model call through the AI Gateway (routing already happens via
// req.modelId set by the caller; the gateway here is ADDITIVE bookkeeping only: per-user
// rate-limit + A/B tagging + token/latency metering into ai_gateway_metrics). See
// planGateway() below for the fail-open contract that keeps this behavior-preserving.
import { planInference, RateLimitError, type GatewayPlan } from "./aiGateway";
// doc69 G2-2 — AI safety layer. `planGateway()` below threads the gateway's redacted
// `safeText` into the actual engine call (see planGateway's PlannedCall.safeText), and
// callers run `sanitizeOutput` on the model's response before returning it.
// doc69 W1-2 fix — `StreamingSecretRedactor` is a STATEFUL per-stream redactor used by
// `generateNarrativeStream` to redact secret-shaped text on individual streamed token chunks
// (see the class doc comment in aiSafety.ts for why a fixed-size window fails on long secrets).
import { StreamingSecretRedactor } from "./ai/aiSafety";
import type { TaskKind } from "./aiModelRouter";

// ─── Types ─────────────────────────────────────────────────────

export type Provider = "openai" | "gguf"; // "openai" kept for type-compat, never returned at runtime
export type Capability = "text" | "json" | "vision";

export interface NarrativeRequest {
  systemPrompt?: string;
  prompt: string;
  /**
   * doc69 G2-1 — AI Gateway task kind for routing/rate-limit/metering bucketing ONLY.
   * Does NOT influence model selection here (callers already control that via `modelId`
   * and their own maxTokens/temperature) — it only tells the gateway which task-shaped
   * bucket to meter this call under. Defaults to "report" when omitted (narrative
   * generation is predominantly report/summary text in this codebase today).
   */
  task?: TaskKind;
  /** doc69 G2-1 — caller's user id, threaded to the AI Gateway for per-user rate-limit +
   * metrics attribution. Omit for system/cron callers — the gateway tolerates undefined. */
  userId?: number;
  /**
   * doc 48 R1 — PIN the GGUF model for this generation (basename sans ".gguf", e.g. the
   * Model Router's `decision.modelId`). Threaded straight into the engine's getOrLoadModel(),
   * exactly like RCA/codegen/chat already pin their model. When undefined the engine falls back
   * to its default resolution (GGUF_DEFAULT_MODEL / the first RESIDENT model) — which is why the
   * exec-summary & ops-chat callers MUST pass this: without it, generation can land on the
   * resident embedding model and emit gibberish instead of a coherent narrative.
   */
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
  language?: "en" | "vi";
  cacheKey?: string;
  cacheTtlMs?: number;
  // FE-W0.3 (doc 46 §2.3) — optional anti-degenerate-loop decode params. All
  // OPTIONAL so existing callers are unaffected; the GGUF engine keeps its own
  // defaults (repeatPenalty 1.1) when these are absent. exec-summary/chat pass a
  // stronger repeatPenalty + stop sequences to reduce the odds of a "cell cell…" loop.
  repeatPenalty?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface NarrativeResult {
  text: string;
  provider: Provider;
  model: string;
  totalTimeMs: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  tokensPerSecond?: number;
  fallbackUsed: boolean;
}

export interface InsightJsonRequest<T> extends NarrativeRequest {
  jsonSchema: object;
}

export interface InsightJsonResult<T> {
  data: T;
  raw: string;
  provider: Provider;
  model: string;
  totalTimeMs: number;
  fallbackUsed: boolean;
}

export interface DescribeImageRequest {
  image: Buffer;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  language?: "en" | "vi";
  /** Ignored — cloud vision removed. Kept for backward compatibility. */
  useCloudVision?: boolean;
  /** doc69 G2-1 — AI Gateway task override for metering bucketing. Defaults to "vision". */
  task?: TaskKind;
  /** doc69 G2-1 — caller's user id for gateway rate-limit + metrics attribution. */
  userId?: number;
}

export interface DescribeImageResult {
  text: string;
  provider: Provider;
  model: string;
  totalTimeMs: number;
  fallbackUsed: boolean;
}

// ─── Telemetry (kept for monitoring dashboard) ────────────────

export interface AiProviderEvent {
  ts: number;
  capability: Capability;
  provider: Provider;
  model: string;
  success: boolean;
  fallbackUsed: boolean;
  totalTimeMs: number;
  tokensGenerated?: number;
  tokensPerSecond?: number;
  error?: string;
}

const recentEvents: AiProviderEvent[] = [];
const MAX_EVENTS = 500;

function emit(ev: AiProviderEvent) {
  recentEvents.push(ev);
  if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
}

export function getRecentEvents(limit = 100): AiProviderEvent[] {
  return recentEvents.slice(-limit).reverse();
}

// ─── AI Gateway adoption (doc69 G2-1) + AI Safety (doc69 G2-2) ─
//
// Every real model call below is wrapped with a gateway "plan": per-user rate-limit check,
// A/B tagging, token/latency METERING into ai_gateway_metrics, AND (G2-2) an injection scan
// + secret/PII redaction of the prompt. This is intentionally the "full adoption" shape from
// aiGateway.ts's own doc comment (wrap the engine call, record afterwards) — but with ONE
// deliberate deviation from routeInference(): we do NOT let a RateLimitError block the call.
//
// Why: this module is a low-level choke point used by ~10 unrelated services (reports,
// RCA batch jobs, vision/OCR, chat tool-selection, inspection/annotation routers via
// _core/llm.ts) that today NEVER get rate-limited — some of them (aiBatchRcaScheduler)
// legitimately burst dozens of calls back-to-back with no per-request userId, which would
// collide in the gateway's single "anon" bucket. Rate-limiting stays BEHAVIOR-PRESERVING
// (metering/limit *visibility*, not enforcement): when the gateway's budget is exhausted,
// planInference() ALREADY records the rejection (outcome "rate_limited") before throwing —
// we catch that specific error and proceed WITHOUT a plan, so the underlying engine call
// always still happens, exactly like before G2-1. Any other unexpected error from
// planInference (should not happen — it is documented fail-open internally) is NOT
// swallowed, since that would hide a real bug — this includes SafetyBlockedError, which
// stays OFF by default (AI_SAFETY_BLOCK_HIGH_RISK) and, when explicitly enabled, is meant
// to propagate exactly like any other engine failure (callers already catch-and-degrade to
// their offline/rule-based fallback, see aiProviderGatewayRouting.test.ts §3).
//
// G2-2 redaction, unlike rate-limiting, is NOT best-effort/skippable: `safeText` is what
// actually reaches ggufGenerateText/JSON/describeImage below — see each call site.
interface PlannedCall {
  plan: GatewayPlan | null;
  /** doc69 G2-2 — sanitized prompt (secrets/PII redacted); THIS is what must reach the
   * engine, not the raw `text` argument. Falls back to the raw text only in the (should
   * never happen) case a RateLimitError is thrown without the redacted text attached. */
  safeText: string;
}

function planGateway(
  task: TaskKind,
  text: string | undefined,
  userId: number | undefined,
): PlannedCall {
  try {
    const plan = planInference({ task, text, userId });
    return { plan, safeText: plan.safeText };
  } catch (err) {
    if (err instanceof RateLimitError) return { plan: null, safeText: err.safeText ?? text ?? "" };
    throw err;
  }
}

// ─── Circuit breaker shim (no-op in local-only mode) ──────────

export function getBreakerSnapshot(): Record<
  string,
  { open: boolean; consecutiveFailures: number; openUntil: number; lastError?: string }
> {
  return {};
}

export function resetBreaker(_key?: string) {
  // no-op
}

// ─── Provider configuration shim ──────────────────────────────

export function setProviderConfig(_opts: { primary?: Provider; fallbackEnabled?: boolean }) {
  // Local-only: nothing to switch. Returned for API symmetry.
  return getProviderConfig();
}

export function getProviderConfig() {
  return {
    primary: "gguf" as Provider,
    fallbackEnabled: false,
    cloudTextModel: null,
    cloudVisionModel: null,
    ggufTextModel: process.env.GGUF_DEFAULT_MODEL || null,
    ggufVisionModel: process.env.GGUF_VISION_MODEL || null,
    ggufVisionMmproj: process.env.GGUF_VISION_MMPROJ || null,
  };
}

// ─── Public API — text / json / vision ────────────────────────

async function runText(req: NarrativeRequest): Promise<NarrativeResult> {
  const start = Date.now();
  // doc69 G2-2 — `safeText` is the redacted prompt; it (NOT req.prompt) is what reaches the engine.
  const { plan, safeText } = planGateway(req.task ?? "report", req.prompt, req.userId);
  try {
    const r = await ggufGenerateText({
      systemPrompt: req.systemPrompt,
      prompt: safeText,
      maxTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      language: req.language,
      // FE-W0.3 (doc 46 §2.3) — forward optional anti-loop decode params when supplied.
      ...(req.repeatPenalty != null ? { repeatPenalty: req.repeatPenalty } : {}),
      ...(req.topP != null ? { topP: req.topP } : {}),
      ...(req.topK != null ? { topK: req.topK } : {}),
      ...(req.stopSequences ? { stopSequences: req.stopSequences } : {}),
    // doc 48 R1 — PIN the model (2nd arg → engine getOrLoadModel). undefined = engine default.
    }, req.modelId);
    const result: NarrativeResult = {
      // doc69 G2-2 — output safety: redact any secret the model echoed back before it returns.
      text: plan?.sanitizeOutput(r.text) ?? r.text,
      provider: "gguf",
      model: r.modelId,
      totalTimeMs: r.totalTimeMs,
      tokensGenerated: r.tokensGenerated,
      tokensPrompt: r.tokensPrompt,
      tokensPerSecond: r.tokensPerSecond,
      fallbackUsed: false,
    };
    plan?.record({
      tokensIn: r.tokensPrompt,
      tokensOut: r.tokensGenerated,
      latencyMs: r.totalTimeMs,
      outcome: "ok",
    });
    emit({
      ts: Date.now(),
      capability: "text",
      provider: "gguf",
      model: r.modelId,
      success: true,
      fallbackUsed: false,
      totalTimeMs: r.totalTimeMs,
      tokensGenerated: r.tokensGenerated,
      tokensPerSecond: r.tokensPerSecond,
    });
    return result;
  } catch (err: any) {
    plan?.record({ latencyMs: Date.now() - start, outcome: "error" });
    emit({
      ts: Date.now(),
      capability: "text",
      provider: "gguf",
      model: "?",
      success: false,
      fallbackUsed: false,
      totalTimeMs: Date.now() - start,
      error: String(err?.message || err),
    });
    throw err;
  }
}

const NARRATIVE_CACHE_PREFIX = "ai:narrative:";
const INSIGHT_CACHE_PREFIX = "ai:insight:";
const DEFAULT_AI_CACHE_TTL_MS = 5 * 60 * 1000;

export async function generateNarrative(req: NarrativeRequest): Promise<NarrativeResult> {
  if (req.cacheKey) {
    const { cacheService } = await import("./cacheService");
    const key = NARRATIVE_CACHE_PREFIX + req.cacheKey;
    const cached = cacheService.get<NarrativeResult>(key);
    if (cached) return { ...cached, totalTimeMs: 0 };
    const result = await runText(req);
    cacheService.set(key, result, req.cacheTtlMs ?? DEFAULT_AI_CACHE_TTL_MS);
    return result;
  }
  return runText(req);
}

export async function generateInsightJson<T = unknown>(
  req: InsightJsonRequest<T>,
): Promise<InsightJsonResult<T>> {
  const exec = async (): Promise<InsightJsonResult<T>> => {
    const start = Date.now();
    // doc69 G2-1 — structured-JSON extraction defaults to task "extract" (see planGateway()
    // doc comment for the fail-open contract). Callers doing RCA-flavored insight generation
    // (e.g. aiInsightsService) already pin their own model via req.modelId — this task label
    // only affects gateway metering/rate-limit bucketing, not model choice.
    // doc69 G2-2 — safeText (redacted) reaches the engine below, same as runText().
    const { plan, safeText } = planGateway(req.task ?? "extract", req.prompt, req.userId);
    try {
      const r = await ggufGenerateJSON<T>(req.jsonSchema, {
        systemPrompt: req.systemPrompt,
        prompt: safeText,
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.2,
        language: req.language,
      // doc 48 R1 — PIN the model (3rd arg → engine getOrLoadModel). undefined = engine default.
      }, req.modelId);
      // doc69 G2-2 — output safety SCAN ONLY here (flags/stats), deliberately NOT applied to
      // r.raw/r.data: `data` is already the PARSED object by this point, and rewriting `raw`
      // without also deep-rewriting `data` would make the two inconsistent for callers that
      // compare them. Structured-output redaction is left to a follow-up if it proves needed.
      plan?.sanitizeOutput(r.raw);
      const result: InsightJsonResult<T> = {
        data: r.data,
        raw: r.raw,
        provider: "gguf",
        model: r.modelId,
        totalTimeMs: r.totalTimeMs,
        fallbackUsed: false,
      };
      plan?.record({
        tokensIn: r.tokensPrompt,
        tokensOut: r.tokensGenerated,
        latencyMs: r.totalTimeMs,
        outcome: "ok",
      });
      emit({
        ts: Date.now(),
        capability: "json",
        provider: "gguf",
        model: r.modelId,
        success: true,
        fallbackUsed: false,
        totalTimeMs: r.totalTimeMs,
      });
      return result;
    } catch (err: any) {
      plan?.record({ latencyMs: Date.now() - start, outcome: "error" });
      emit({
        ts: Date.now(),
        capability: "json",
        provider: "gguf",
        model: "?",
        success: false,
        fallbackUsed: false,
        totalTimeMs: Date.now() - start,
        error: String(err?.message || err),
      });
      throw err;
    }
  };

  if (req.cacheKey) {
    const { cacheService } = await import("./cacheService");
    const key = INSIGHT_CACHE_PREFIX + req.cacheKey;
    const cached = cacheService.get<InsightJsonResult<T>>(key);
    if (cached) return { ...cached, totalTimeMs: 0 };
    const result = await exec();
    cacheService.set(key, result, req.cacheTtlMs ?? DEFAULT_AI_CACHE_TTL_MS);
    return result;
  }
  return exec();
}

export async function describeImage(req: DescribeImageRequest): Promise<DescribeImageResult> {
  const start = Date.now();

  // WS-G2: vision is gated behind the local llama-server mtmd sidecar. When it is not
  // configured/available we degrade HONESTLY — return fallbackUsed:true with a clear
  // reason so the UI/caller can tell the user vision is off, instead of fabricating text.
  const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
  if (!isVisionSidecarAvailable()) {
    const reason =
      "Vision unavailable: local llama-server mtmd sidecar is not configured " +
      "(set LLAMA_SERVER_BIN, GGUF_VISION_MODEL, GGUF_VISION_MMPROJ).";
    emit({
      ts: Date.now(),
      capability: "vision",
      provider: "gguf",
      model: "none",
      success: false,
      fallbackUsed: true,
      totalTimeMs: Date.now() - start,
      error: "VISION_NOT_AVAILABLE",
    });
    return {
      text: reason,
      provider: "gguf",
      model: "none",
      totalTimeMs: Date.now() - start,
      fallbackUsed: true,
    };
  }

  // doc69 G2-1 — meter/rate-limit ONLY the real inference below; the honest-degrade branch
  // above returns before any model is invoked, so there is nothing to gateway-plan there.
  // doc69 G2-2 — safeText (redacted prompt) reaches the engine below.
  const { plan, safeText } = planGateway(req.task ?? "vision", req.prompt, req.userId);
  try {
    const r = await ggufDescribeImage({
      image: req.image,
      prompt: safeText,
      systemPrompt: req.systemPrompt,
      maxTokens: req.maxTokens ?? 512,
      temperature: req.temperature ?? 0.2,
      language: req.language,
    });
    const result: DescribeImageResult = {
      text: plan?.sanitizeOutput(r.text) ?? r.text,
      provider: "gguf",
      model: r.modelId,
      totalTimeMs: r.totalTimeMs,
      fallbackUsed: false,
    };
    plan?.record({
      tokensIn: r.tokensPrompt,
      tokensOut: r.tokensGenerated,
      latencyMs: r.totalTimeMs,
      outcome: "ok",
    });
    emit({
      ts: Date.now(),
      capability: "vision",
      provider: "gguf",
      model: r.modelId,
      success: true,
      fallbackUsed: false,
      totalTimeMs: r.totalTimeMs,
    });
    return result;
  } catch (err: any) {
    plan?.record({ latencyMs: Date.now() - start, outcome: "error" });
    emit({
      ts: Date.now(),
      capability: "vision",
      provider: "gguf",
      model: "?",
      success: false,
      fallbackUsed: false,
      totalTimeMs: Date.now() - start,
      error: String(err?.message || err),
    });
    throw err;
  }
}

// ─── Streaming Narrative ──────────────────────────────────────

export interface NarrativeStreamChunk {
  type: "token" | "done" | "error";
  token?: string;
  fullText?: string;
  provider?: Provider;
  model?: string;
  fallbackUsed?: boolean;
  totalTimeMs?: number;
  tokensGenerated?: number;
  tokensPerSecond?: number;
  error?: string;
}

// doc69 W1-2 fix — streaming per-chunk secret redaction via a STATEFUL redactor
// (`StreamingSecretRedactor`, aiSafety.ts). Text is held back across "token" events so a secret
// straddling a chunk boundary — including a LONG secret whose opening delimiter
// (`-----BEGIN...KEY-----`, `eyJ...`) arrives many chunks before its closing delimiter — is
// still caught before it reaches the SSE client, instead of only being redacted in the
// aggregated `fullText` on "done" (too late — the raw token chunks already went out by then).
// An earlier version of this fix used a FIXED 64-char trailing window, which looked correct but
// failed exactly on realistic long secrets (a ~180-char PEM key or ~150-char JWT would have its
// start delimiter scroll out of the window before the end arrived, so the two-delimiter regex
// never matched and the secret leaked in full) — see the class doc comment in aiSafety.ts.
// This is defense-in-depth on the OUTPUT side only, using ONLY the secret/API-key patterns (not
// the full PII scan, and not the injection scanner) — the real safety boundary is still the
// INPUT redaction above (`safeText`).

export async function* generateNarrativeStream(
  req: NarrativeRequest,
  signal?: AbortSignal,
): AsyncGenerator<NarrativeStreamChunk> {
  const start = Date.now();
  const { generateTextStream: ggufStream } = await import("./aiGgufEngine");
  // doc69 G2-1 — same fail-open gateway plan as the non-streaming paths (see planGateway()).
  // doc69 G2-2 — safeText (redacted prompt) reaches the engine below.
  const { plan, safeText } = planGateway(req.task ?? "report", req.prompt, req.userId);
  // doc69 W1-2 fix — one stateful redactor instance per stream (never module-level: concurrent
  // streams must not share hold-back state). See the class doc comment in aiSafety.ts.
  const redactor = new StreamingSecretRedactor();
  try {
    for await (const c of ggufStream(
      {
        systemPrompt: req.systemPrompt,
        prompt: safeText,
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
        language: req.language,
      },
      // doc 48 R1 — PIN the model (2nd arg → engine getOrLoadModel) instead of dropping it to
      // undefined; the streaming exec-summary/chat path otherwise lands on the resident embedder.
      req.modelId,
      signal,
    )) {
      if (c.type === "token") {
        // doc69 W1-2 fix — redact secret-shaped text on the token chunk itself (not just the
        // aggregated fullText on "done") via the stateful redactor, which holds back the WHOLE
        // pending fragment (not just a fixed-size tail) while a secret looks like it's still
        // forming, so long secrets can't scroll their start delimiter out of view before their
        // end arrives. Always yield a "token" event per underlying stream token (even when the
        // released text is "") — mirrors the underlying stream's chunking cadence.
        yield { type: "token", token: redactor.push(c.token ?? ""), provider: "gguf", model: c.modelId };
      } else if (c.type === "done") {
        const remaining = redactor.flush();
        if (remaining) {
          // Flush whatever remains held so the total streamed token text (minus any
          // redactions) matches the source — nothing is silently dropped.
          yield { type: "token", token: remaining, provider: "gguf", model: c.modelId };
        }
        yield {
          type: "done",
          fullText: plan && c.fullText != null ? plan.sanitizeOutput(c.fullText) : c.fullText,
          provider: "gguf",
          model: c.modelId,
          fallbackUsed: false,
          totalTimeMs: c.totalTimeMs,
          tokensGenerated: c.tokensGenerated,
          tokensPerSecond: c.tokensPerSecond,
        };
        plan?.record({
          tokensIn: c.tokensPrompt,
          tokensOut: c.tokensGenerated,
          latencyMs: c.totalTimeMs,
          outcome: "ok",
        });
        emit({
          ts: Date.now(),
          capability: "text",
          provider: "gguf",
          model: c.modelId ?? '',
          success: true,
          fallbackUsed: false,
          totalTimeMs: c.totalTimeMs ?? 0,
          tokensGenerated: c.tokensGenerated,
          tokensPerSecond: c.tokensPerSecond,
        });
      } else if (c.type === "error") {
        plan?.record({ latencyMs: Date.now() - start, outcome: "error" });
        yield { type: "error", error: c.error, provider: "gguf" };
      }
    }
  } catch (err: any) {
    plan?.record({ latencyMs: Date.now() - start, outcome: "error" });
    emit({
      ts: Date.now(),
      capability: "text",
      provider: "gguf",
      model: "?",
      success: false,
      fallbackUsed: false,
      totalTimeMs: Date.now() - start,
      error: String(err?.message || err),
    });
    yield { type: "error", error: String(err?.message || err) };
  }
}
