/**
 * aiCostModel — PURE cloud-equivalent cost estimator (doc69 Giai đoạn 4 / Wave E2,
 * task E2-2).
 *
 * Every inference in this platform runs on a LOCAL GGUF model (see server/services/
 * aiGateway.ts — its `ai_gateway_metrics` table is written exclusively from local-engine
 * calls; grep confirms no cloud/provider concept exists anywhere in this codebase). The
 * marginal $-cost of a local token is therefore ≈ $0 (electricity/amortized hardware,
 * not metered per-request), so the "money saved" by NOT calling a cloud API for the same
 * tokens IS, honestly, the full cloud-equivalent cost of those tokens. This module owns
 * ONLY that cost arithmetic — no I/O, no DB, no env read at import time (every env lookup
 * happens inside the resolver functions below, at CALL time, so tests can `vi.stubEnv`
 * per-case and callers always see the current override).
 *
 * ── Price table ──────────────────────────────────────────────────────────────────────
 * Local models are bucketed into a coarse CLASS ("small"/"medium"/"large") by the
 * parameter count parsed out of the GGUF basename (e.g. "Qwen3-4B-Instruct-Q4_K_M.gguf"
 * → 4 → "small"). Each class carries a DEFAULT cloud-peer $/1K-token price pair
 * (illustrative, deliberately conservative mid-2020s hosted-LLM-API price points — NOT a
 * live pricing feed; every deployment should tune these to its own reference cloud
 * vendor via the env keys below):
 *
 *   class    default in-$/1K   default out-$/1K   illustrative cloud peer
 *   small    0.0002            0.0006              a "mini/flash"-class hosted model
 *   medium   0.003             0.015               a flagship mid-tier hosted model
 *   large    0.015             0.075               a frontier/large hosted model
 *
 * An unparsable/unknown model name (including the literal "default" the gateway uses
 * when no explicit model was resolved) falls back to `DEFAULT_MODEL_CLASS` ("medium") —
 * a middle-of-the-road estimate is more honest than either extreme when the model is
 * genuinely unidentified.
 *
 * ── Env override (read fresh on every call — no caching) ────────────────────────────
 *   AI_CLOUD_PRICE_SMALL_IN_PER_1K   AI_CLOUD_PRICE_SMALL_OUT_PER_1K
 *   AI_CLOUD_PRICE_MEDIUM_IN_PER_1K  AI_CLOUD_PRICE_MEDIUM_OUT_PER_1K
 *   AI_CLOUD_PRICE_LARGE_IN_PER_1K   AI_CLOUD_PRICE_LARGE_OUT_PER_1K
 * Each is a non-negative decimal USD-per-1000-tokens value. Precedence: a valid
 * (finite, >= 0) env value for a class+direction wins over that class's built-in
 * default; an absent/invalid env value silently falls back to the built-in default
 * (never throws, never NaN's the estimate).
 *
 * ── The $0-local-marginal-cost assumption is explicit + tunable ─────────────────────
 * `LOCAL_MARGINAL_USD_PER_1K` is the (currently zero) $/1K-token cost this module
 * attributes to running a token locally. `estimateSavingsUsd` SUBTRACTS
 * `estimateLocalCostUsd(...)` from `estimateCloudEquivalentUsd(...)` rather than
 * returning the cloud-equivalent figure directly — today the two are numerically
 * identical (local cost is 0), but the subtraction is real code, not a comment, so the
 * day this platform ever wants to model a non-zero local marginal cost (e.g. metered
 * GPU-hour amortization), only this one constant needs to change.
 */

// ─── Types ───────────────────────────────────────────────────────────────────────────

export type ModelPriceClass = "small" | "medium" | "large";

export interface CloudPriceRow {
  inputPricePer1kUsd: number;
  outputPricePer1kUsd: number;
}

export interface ResolvedCloudPrice extends CloudPriceRow {
  /** Which class the model was bucketed into (for transparency/debugging/tests). */
  modelClass: ModelPriceClass;
}

// ─── Built-in defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_CLASS_PRICES: Record<ModelPriceClass, CloudPriceRow> = {
  small: { inputPricePer1kUsd: 0.0002, outputPricePer1kUsd: 0.0006 },
  medium: { inputPricePer1kUsd: 0.003, outputPricePer1kUsd: 0.015 },
  large: { inputPricePer1kUsd: 0.015, outputPricePer1kUsd: 0.075 },
};

/** Fallback class for an unparsable/unknown model name (see module docblock). */
export const DEFAULT_MODEL_CLASS: ModelPriceClass = "medium";

/** The $/1K-token cost this module attributes to a LOCAL token (see module docblock). */
export const LOCAL_MARGINAL_USD_PER_1K = 0;

const ENV_PRICE_KEYS: Record<ModelPriceClass, { in: string; out: string }> = {
  small: { in: "AI_CLOUD_PRICE_SMALL_IN_PER_1K", out: "AI_CLOUD_PRICE_SMALL_OUT_PER_1K" },
  medium: { in: "AI_CLOUD_PRICE_MEDIUM_IN_PER_1K", out: "AI_CLOUD_PRICE_MEDIUM_OUT_PER_1K" },
  large: { in: "AI_CLOUD_PRICE_LARGE_IN_PER_1K", out: "AI_CLOUD_PRICE_LARGE_OUT_PER_1K" },
};

/** A valid non-negative finite override, else `null` (never NaN, never negative). */
function envPriceOverride(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The effective $/1K price row for `cls` — env override (read fresh) else built-in default. */
export function getCloudPriceForClass(cls: ModelPriceClass): CloudPriceRow {
  const keys = ENV_PRICE_KEYS[cls];
  const defaults = DEFAULT_CLASS_PRICES[cls];
  return {
    inputPricePer1kUsd: envPriceOverride(keys.in) ?? defaults.inputPricePer1kUsd,
    outputPricePer1kUsd: envPriceOverride(keys.out) ?? defaults.outputPricePer1kUsd,
  };
}

// ─── Model → class classification ───────────────────────────────────────────────────

/** Matches a parameter-count token like "4b", "8B", "32b", "1.5b" in a GGUF basename. */
const PARAM_COUNT_RE = /(\d+(?:\.\d+)?)\s*b(?:illion)?\b/i;

/**
 * classifyModel — PURE, deterministic. Parses a coarse parameter count out of the model
 * name and buckets it into a price class; falls back to `DEFAULT_MODEL_CLASS` when no
 * count can be parsed (covers the literal "default" basename and any unrecognized name).
 */
export function classifyModel(model: string | null | undefined): ModelPriceClass {
  if (!model) return DEFAULT_MODEL_CLASS;
  const m = PARAM_COUNT_RE.exec(model);
  if (!m) return DEFAULT_MODEL_CLASS;
  const billions = Number.parseFloat(m[1]);
  if (!Number.isFinite(billions)) return DEFAULT_MODEL_CLASS;
  if (billions <= 4) return "small";
  if (billions <= 20) return "medium";
  return "large";
}

/** Resolve the effective cloud price row for a model name (class + $/1K in/out). */
export function resolveCloudPrice(model: string | null | undefined): ResolvedCloudPrice {
  const modelClass = classifyModel(model);
  return { ...getCloudPriceForClass(modelClass), modelClass };
}

// ─── Pure cost arithmetic ────────────────────────────────────────────────────────────

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * estimateCloudEquivalentUsd — PURE: what the same `tokensIn`/`tokensOut` would have
 * cost against `model`'s resolved cloud-peer price class. Deterministic given the
 * current env (read fresh via `resolveCloudPrice`).
 */
export function estimateCloudEquivalentUsd(
  tokensIn: number,
  tokensOut: number,
  model: string | null | undefined,
): number {
  const price = resolveCloudPrice(model);
  const inTok = nonNegative(tokensIn);
  const outTok = nonNegative(tokensOut);
  return (inTok / 1000) * price.inputPricePer1kUsd + (outTok / 1000) * price.outputPricePer1kUsd;
}

/** estimateLocalCostUsd — PURE: the (currently $0) local marginal cost of the same tokens. */
export function estimateLocalCostUsd(tokensIn: number, tokensOut: number): number {
  const totalTok = nonNegative(tokensIn) + nonNegative(tokensOut);
  return (totalTok / 1000) * LOCAL_MARGINAL_USD_PER_1K;
}

/**
 * estimateSavingsUsd — PURE: cloud-equivalent minus local marginal cost. Since
 * `LOCAL_MARGINAL_USD_PER_1K` is 0 today this equals `estimateCloudEquivalentUsd`
 * exactly, but the subtraction is real (see module docblock) — this is the function
 * `getSavingsSummary` should call, not `estimateCloudEquivalentUsd` directly.
 */
export function estimateSavingsUsd(
  tokensIn: number,
  tokensOut: number,
  model: string | null | undefined,
): number {
  return estimateCloudEquivalentUsd(tokensIn, tokensOut, model) - estimateLocalCostUsd(tokensIn, tokensOut);
}
