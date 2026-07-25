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

// ─── AI Gateway adoption (doc69 G2-1) ──────────────────────────
//
// Every real model call below is wrapped with a gateway "plan" purely for bookkeeping:
// per-user rate-limit check, A/B tagging, and token/latency METERING into
// ai_gateway_metrics. This is intentionally the "full adoption" shape from aiGateway.ts's
// own doc comment (wrap the engine call, record afterwards) — but with ONE deliberate
// deviation from routeInference(): we do NOT let a RateLimitError block the call.
//
// Why: this module is a low-level choke point used by ~10 unrelated services (reports,
// RCA batch jobs, vision/OCR, chat tool-selection, inspection/annotation routers via
// _core/llm.ts) that today NEVER get rate-limited — some of them (aiBatchRcaScheduler)
// legitimately burst dozens of calls back-to-back with no per-request userId, which would
// collide in the gateway's single "anon" bucket. This task is a BEHAVIOR-PRESERVING
// refactor (metering/limit *visibility*, not enforcement) — real blocking/enforcement is
// the next task (doc69 G2-2, the AI-safety layer). So: when the gateway's budget is
// exhausted, planInference() ALREADY records the rejection (outcome "rate_limited") before
// throwing — we catch that specific error and proceed WITHOUT a plan, so the underlying
// engine call always still happens, exactly like before this task. Any other unexpected
// error from planInference (should not happen — it is documented fail-open internally) is
// NOT swallowed, since that would hide a real bug.
function planGateway(
  task: TaskKind,
  text: string | undefined,
  userId: number | undefined,
): GatewayPlan | null {
  try {
    return planInference({ task, text, userId });
  } catch (err) {
    if (err instanceof RateLimitError) return null;
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
  const plan = planGateway(req.task ?? "report", req.prompt, req.userId);
  try {
    const r = await ggufGenerateText({
      systemPrompt: req.systemPrompt,
      prompt: req.prompt,
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
      text: r.text,
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
    const plan = planGateway(req.task ?? "extract", req.prompt, req.userId);
    try {
      const r = await ggufGenerateJSON<T>(req.jsonSchema, {
        systemPrompt: req.systemPrompt,
        prompt: req.prompt,
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.2,
        language: req.language,
      // doc 48 R1 — PIN the model (3rd arg → engine getOrLoadModel). undefined = engine default.
      }, req.modelId);
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
  const plan = planGateway(req.task ?? "vision", req.prompt, req.userId);
  try {
    const r = await ggufDescribeImage({
      image: req.image,
      prompt: req.prompt,
      systemPrompt: req.systemPrompt,
      maxTokens: req.maxTokens ?? 512,
      temperature: req.temperature ?? 0.2,
      language: req.language,
    });
    const result: DescribeImageResult = {
      text: r.text,
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

export async function* generateNarrativeStream(
  req: NarrativeRequest,
  signal?: AbortSignal,
): AsyncGenerator<NarrativeStreamChunk> {
  const start = Date.now();
  const { generateTextStream: ggufStream } = await import("./aiGgufEngine");
  // doc69 G2-1 — same fail-open gateway plan as the non-streaming paths (see planGateway()).
  const plan = planGateway(req.task ?? "report", req.prompt, req.userId);
  try {
    for await (const c of ggufStream(
      {
        systemPrompt: req.systemPrompt,
        prompt: req.prompt,
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
        yield { type: "token", token: c.token, provider: "gguf", model: c.modelId };
      } else if (c.type === "done") {
        yield {
          type: "done",
          fullText: c.fullText,
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
