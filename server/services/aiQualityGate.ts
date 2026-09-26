/**
 * AI Quality Gate Service
 * 
 * Automatically evaluates inspection images using AI models and makes
 * pass/fail decisions based on configurable confidence thresholds.
 * 
 * Flow: Image → Inference (single or ensemble) → Threshold → Decision → Alert
 */
import { getDb } from "../db/connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  aiEnsembleConfigs,
  abTestExperiments,
  abTestResults,
  productInspections,
  inferenceResults,
  predictiveAlerts,
  type AiQualityGateConfig,
  type AiEnsembleConfig,
} from "../../drizzle/schema";
import { runInference } from "./aiInferenceEngine";
import { getAiModelById } from "../db/ai";
import { selectCanaryVariant } from "./aiABTesting";
// AOI-F (doc 24 Wave-4) — quality→control proposal (advisory by default; flag-gated).
// isVisionControlEnabled has NO runtime top-level deps (type-only imports) → cycle-safe.
import { isVisionControlEnabled, proposeControlForInspection } from "./qualityControlProposer";
// W5-B1 (doc 44, gap G4.15) — cost-sensitive / risk-based triage threshold (flag OFF default).
import {
  isCostSensitiveThresholdEnabled,
  applyCostSensitiveTriage,
  buildSeverityMap,
} from "./ai/costSensitiveThreshold";

// ─── Types ───────────────────────────────────────────────────────

export interface QualityGateDecision {
  decision: "AUTO_OK" | "AUTO_NG" | "NEEDS_REVIEW" | "MANUAL";
  confidence: number;
  topLabel: string;
  predictions: Array<{ label: string; confidence: number }>;
  ensembleResults?: Array<{
    modelId: number;
    modelCode: string;
    topLabel: string;
    confidence: number;
    predictions: Array<{ label: string; confidence: number }>;
  }>;
  processingTimeMs: number;
  reviewReason?: string;
}

// ─── Config Lookup ───────────────────────────────────────────────

const configCache = new Map<string, { config: AiQualityGateConfig; ts: number }>();
const CONFIG_TTL = 30_000; // 30s cache

function configKey(machineId: number, productModelId?: number | null): string {
  return `${machineId}:${productModelId ?? 0}`;
}

/**
 * Find the best matching quality gate config for a machine/product pair.
 * Priority: machine+product > machine-only > null (disabled).
 */
export async function getQualityGateConfig(
  machineId: number,
  productModelId?: number | null,
): Promise<AiQualityGateConfig | null> {
  const key = configKey(machineId, productModelId);
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.ts < CONFIG_TTL) return cached.config;

  const db = await getDb();
  if (!db) return null;

  // Try machine + product first
  if (productModelId) {
    const [exact] = await db
      .select()
      .from(aiQualityGateConfigs)
      .where(
        and(
          eq(aiQualityGateConfigs.machineId, machineId),
          eq(aiQualityGateConfigs.productModelId, productModelId),
          eq(aiQualityGateConfigs.enabled, true),
        ),
      )
      .limit(1);
    if (exact) {
      configCache.set(key, { config: exact, ts: Date.now() });
      return exact;
    }
  }

  // Fallback: machine only
  const [machineOnly] = await db
    .select()
    .from(aiQualityGateConfigs)
    .where(
      and(
        eq(aiQualityGateConfigs.machineId, machineId),
        sql`${aiQualityGateConfigs.productModelId} IS NULL`,
        eq(aiQualityGateConfigs.enabled, true),
      ),
    )
    .limit(1);

  if (machineOnly) {
    configCache.set(key, { config: machineOnly, ts: Date.now() });
    return machineOnly;
  }

  return null;
}

/** Invalidate config cache for a specific machine or all */
export function invalidateConfigCache(machineId?: number) {
  if (machineId == null) {
    configCache.clear();
    return;
  }
  for (const key of configCache.keys()) {
    if (key.startsWith(`${machineId}:`)) configCache.delete(key);
  }
}

// ─── Ensemble Logic ──────────────────────────────────────────────

async function runEnsembleInference(
  ensembleConfig: AiEnsembleConfig,
  imageBuffer: Buffer,
  options?: { inspectionId?: number },
) {
  const modelIds = ensembleConfig.modelIds;
  const weights = ensembleConfig.weights ?? modelIds.map(() => 1);

  // Run all models in parallel
  const results = await Promise.allSettled(
    modelIds.map((modelId) =>
      runInference(modelId, imageBuffer, {
        inspectionId: options?.inspectionId,
      }),
    ),
  );

  const successResults: Array<{
    modelId: number;
    modelCode: string;
    topLabel: string;
    confidence: number;
    predictions: Array<{ label: string; confidence: number }>;
  }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      successResults.push({
        modelId: modelIds[i],
        modelCode: r.value.modelCode,
        topLabel: r.value.topLabel ?? "",
        confidence: r.value.confidence,
        predictions: r.value.predictions.map((p) => ({
          label: p.label,
          confidence: p.confidence,
        })),
      });
    }
  }

  if (successResults.length === 0) {
    throw new Error("All ensemble models failed");
  }

  let finalLabel: string;
  let finalConfidence: number;

  switch (ensembleConfig.strategy) {
    case "WEIGHTED_AVERAGE": {
      // Weighted average of confidence scores per label
      const labelScores: Record<string, number> = {};
      let totalWeight = 0;
      for (let i = 0; i < successResults.length; i++) {
        const idx = modelIds.indexOf(successResults[i].modelId);
        const w = weights[idx] ?? 1;
        totalWeight += w;
        for (const pred of successResults[i].predictions) {
          labelScores[pred.label] = (labelScores[pred.label] ?? 0) + pred.confidence * w;
        }
      }
      // Normalize
      for (const key of Object.keys(labelScores)) {
        labelScores[key] /= totalWeight;
      }
      const sorted = Object.entries(labelScores).sort((a, b) => b[1] - a[1]);
      finalLabel = sorted[0]?.[0] ?? "";
      finalConfidence = sorted[0]?.[1] ?? 0;
      break;
    }

    case "CASCADE": {
      // Use first model; if confidence < threshold, try next
      const cascadeThreshold = Number(ensembleConfig.cascadeThreshold ?? 0.8);
      let chosen = successResults[0];
      for (const r of successResults) {
        chosen = r;
        if (r.confidence >= cascadeThreshold) break;
      }
      finalLabel = chosen.topLabel;
      finalConfidence = chosen.confidence;
      break;
    }

    case "VOTING":
    default: {
      // Majority voting
      const votes: Record<string, number> = {};
      const maxConfByLabel: Record<string, number> = {};
      for (const r of successResults) {
        votes[r.topLabel] = (votes[r.topLabel] ?? 0) + 1;
        maxConfByLabel[r.topLabel] = Math.max(
          maxConfByLabel[r.topLabel] ?? 0,
          r.confidence,
        );
      }
      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      finalLabel = sorted[0]?.[0] ?? "";
      finalConfidence = maxConfByLabel[finalLabel] ?? 0;
      break;
    }
  }

  return {
    topLabel: finalLabel,
    confidence: finalConfidence,
    predictions: Object.entries(
      successResults.reduce(
        (acc, r) => {
          for (const p of r.predictions) {
            acc[p.label] = Math.max(acc[p.label] ?? 0, p.confidence);
          }
          return acc;
        },
        {} as Record<string, number>,
      ),
    )
      .map(([label, confidence]) => ({ label, confidence }))
      .sort((a, b) => b.confidence - a.confidence),
    ensembleResults: successResults,
  };
}

// ─── Core Quality Gate ───────────────────────────────────────────

/**
 * Process a single inspection through the AI Quality Gate.
 */
export async function processQualityGate(
  inspectionId: number,
  imageBuffer: Buffer,
  config: AiQualityGateConfig,
): Promise<QualityGateDecision> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const autoOk = Number(config.autoOkThreshold);
  const autoNg = Number(config.autoNgThreshold);
  const reviewTh = Number(config.reviewThreshold);
  const ngLabels = config.ngLabels ?? [];
  const okLabels = config.okLabels ?? [];

  let topLabel: string;
  let confidence: number;
  let predictions: Array<{ label: string; confidence: number }>;
  let ensembleResults: QualityGateDecision["ensembleResults"] | undefined;

  // If ensemble config, use ensemble; otherwise single model
  if (config.ensembleConfigId) {
    const [ensConfig] = await db
      .select()
      .from(aiEnsembleConfigs)
      .where(
        and(
          eq(aiEnsembleConfigs.id, config.ensembleConfigId),
          eq(aiEnsembleConfigs.enabled, true),
        ),
      )
      .limit(1);

    if (ensConfig) {
      const result = await runEnsembleInference(ensConfig, imageBuffer, {
        inspectionId,
      });
      topLabel = result.topLabel;
      confidence = result.confidence;
      predictions = result.predictions;
      ensembleResults = result.ensembleResults;
    } else {
      // Fallback to single model
      const result = await runInference(config.modelId, imageBuffer, {
        inspectionId,
      });
      topLabel = result.topLabel ?? "";
      confidence = result.confidence;
      predictions = result.predictions.map((p) => ({
        label: p.label,
        confidence: p.confidence,
      }));
    }
  } else {
    const result = await runInference(config.modelId, imageBuffer, {
      inspectionId,
    });
    topLabel = result.topLabel ?? "";
    confidence = result.confidence;
    predictions = result.predictions.map((p) => ({
      label: p.label,
      confidence: p.confidence,
    }));
  }

  // Determine decision
  const isNgLabel = ngLabels.length > 0 && ngLabels.includes(topLabel);
  const isOkLabel = okLabels.length > 0 && okLabels.includes(topLabel);
  const hasLabelConfig = ngLabels.length > 0 || okLabels.length > 0;

  let decision: QualityGateDecision["decision"];
  let reviewReason: string | undefined;

  if (!hasLabelConfig) {
    // Labels not configured — cannot make automated decisions safely.
    // Always require human review to prevent defects slipping through.
    decision = "NEEDS_REVIEW";
    reviewReason = "Quality gate has no label configuration (ngLabels and okLabels are empty). Configure labels before enabling auto-decisions.";
  } else if (isNgLabel && confidence >= autoNg) {
    decision = "AUTO_NG";
  } else if (isOkLabel && confidence >= autoOk) {
    decision = "AUTO_OK";
  } else if (confidence < reviewTh) {
    decision = "NEEDS_REVIEW";
    reviewReason = `Low confidence (${(confidence * 100).toFixed(1)}% < ${(reviewTh * 100).toFixed(1)}%)`;
  } else if (isNgLabel && confidence < autoNg) {
    decision = "NEEDS_REVIEW";
    reviewReason = `NG label "${topLabel}" below threshold (${(confidence * 100).toFixed(1)}% < ${(autoNg * 100).toFixed(1)}%)`;
  } else {
    decision = "NEEDS_REVIEW";
    reviewReason = `Confidence in grey zone (${(confidence * 100).toFixed(1)}%)`;
  }

  // ── W5-B1 (doc 44, gap G4.15) — cost-sensitive / risk-based threshold ────────
  // Flag OFF (default) ⇒ no-op → today's fixed-threshold decision stands. When ON,
  // RECALL-FIRST: an over-confident AUTO_OK on a board where a SEVERE defect is
  // even plausible is pulled back to NEEDS_REVIEW (spec §8.2 "lỗi nghi ngờ → đẩy
  // sang người"). Never relaxes an NG/review to OK. Best-effort — never throws.
  if (isCostSensitiveThresholdEnabled() && ngLabels.length > 0) {
    try {
      const override = applyCostSensitiveTriage({
        baseDecision: decision,
        predictions,
        severityMap: buildSeverityMap(ngLabels),
      });
      if (override.overridden) {
        decision = override.decision;
        reviewReason = override.reason ?? reviewReason;
      }
    } catch (err) {
      console.warn(
        `[QualityGate] cost-sensitive threshold skipped for inspection ${inspectionId}: ${(err as Error)?.message}`,
      );
    }
  }

  const processingTimeMs = Date.now() - startTime;

  // Save quality gate result
  await db.insert(aiQualityGateResults).values({
    inspectionId,
    configId: config.id,
    decision,
    confidence: confidence.toFixed(4),
    topLabel,
    predictions,
    ensembleResults,
    processingTimeMs,
  });

  // ── B6 — A/B canary (live) ──────────────────────────────────────
  // Only runs when the config opts in via activeExperimentId AND the experiment is
  // RUNNING. The production decision above is the source of truth for the gate; the
  // canary inference is recorded into ab_test_results in parallel for comparison and
  // is intentionally best-effort (never blocks/poisons the gate decision).
  if (config.activeExperimentId != null) {
    await runCanaryInference(config.activeExperimentId, inspectionId, imageBuffer).catch(
      (err) => {
        console.warn(
          `[QualityGate] canary inference failed for inspection ${inspectionId} ` +
            `(experiment ${config.activeExperimentId}): ${(err as Error).message}`,
        );
      },
    );
  }

  // Update inspection with AI fields
  await db
    .update(productInspections)
    .set({
      aiDecision: decision,
      aiConfidence: confidence.toFixed(4),
      aiModelId: config.modelId,
      aiProcessedAt: new Date(),
      aiDetails: {
        predictions,
        ensembleResults,
        processingTimeMs,
        reviewReason,
      },
    })
    .where(eq(productInspections.id, inspectionId));

  // ── B3 — Unsupervised anomaly detection (best-effort hook) ──────────────────
  // Opt-in qua ANOMALY_DETECTION_ENABLED (default OFF) → backward-compatible: khi
  // tắt, pipeline y hệt cũ. Fire-and-forget (never blocks/poisons gate decision).
  if ((process.env.ANOMALY_DETECTION_ENABLED ?? "false").toLowerCase() === "true") {
    runAnomalyHook(inspectionId, imageBuffer, config).catch((err) => {
      console.warn(
        `[QualityGate] anomaly hook failed for inspection ${inspectionId}: ${(err as Error)?.message}`,
      );
    });
  }

  // ── AOI-F (doc 24 Wave-4) — Quality → Control proposal (best-effort hook) ────
  // When VISION_CONTROL_ENABLED (default OFF) AND the gate returned a hard NG, DRAFT
  // a TYPED control proposal (reject_divert) and land it in the responsible users'
  // inbox as an ai_pending_actions row — PROPOSE ONLY (never actuates; a human must
  // confirm, and even then it stays simulated unless the adapter is commissioned +
  // OT_CONTROL_ENABLED). Fire-and-forget: NEVER blocks/poisons the gate decision.
  // Flag OFF ⇒ this branch is skipped entirely (today's behaviour: record + alert).
  if (isVisionControlEnabled() && decision === "AUTO_NG") {
    runQualityControlHook(inspectionId, { decision, confidence, topLabel }, config).catch((err) => {
      console.warn(
        `[QualityGate] quality→control proposal failed for inspection ${inspectionId}: ${(err as Error)?.message}`,
      );
    });
  }

  return {
    decision,
    confidence,
    topLabel,
    predictions,
    ensembleResults,
    processingTimeMs,
    reviewReason,
  };
}

// ─── V1/V18 (doc 27 Đợt 7.1 — W7-A) — INLINE gate + AI-down circuit breaker ──
//
// The machine-ingest paths (machineApiRouters.processInspectionSubmission and
// aoiPackageRouter.commit) schedule runInlineQualityGate as a fire-and-forget
// setImmediate post-hook AFTER the ingest ACK. It reuses processQualityGate
// unchanged, so the write shape on product_inspections is IDENTICAL to the
// on-demand UI path (aiQualityGateRouter.processInspection) — the UI reads
// both the same way. When the AI stack is down, the circuit breaker routes
// inspections to a NEEDS_REVIEW verdict with an honest aiDetails marker
// ({ skipped: 'ai_unavailable' }) instead of throwing — the same honest-degrade
// posture as embeddingHead.runEmbeddingHeadInference (embeddingHead.ts).

/** Master flag for inline AI on ingestion. Default OFF in code; ON in dev .env. */
export function isInlineGateEnabled(): boolean {
  return (process.env.AI_INLINE_GATE_ENABLED ?? "false").toLowerCase() === "true";
}

type InlineBreakerState = "closed" | "open" | "half_open";

/** Env-tunable breaker parameters (read lazily so tests/ops can retune live). */
function inlineBreakerParams(): { threshold: number; windowMs: number; cooldownMs: number } {
  const n = Number(process.env.AI_INLINE_BREAKER_THRESHOLD);
  const w = Number(process.env.AI_INLINE_BREAKER_WINDOW_MS);
  const c = Number(process.env.AI_INLINE_BREAKER_COOLDOWN_MS);
  return {
    threshold: Number.isFinite(n) && n > 0 ? Math.floor(n) : 5,
    windowMs: Number.isFinite(w) && w > 0 ? w : 60_000,
    cooldownMs: Number.isFinite(c) && c > 0 ? c : 120_000,
  };
}

// Module-level breaker state (per-process, like the WAL/store-forward singletons).
const inlineBreaker = {
  state: "closed" as InlineBreakerState,
  consecutiveFailures: 0,
  streakStartedAt: 0, // Date.now() of the FIRST failure in the current streak
  openedAt: 0,
  lastFailureAt: 0,
  lastError: null as string | null,
  probeInFlight: false,
  totalOpens: 0,
  totalSkips: 0, // inspections skip-stamped while open
};

/** Snapshot shape consumed by the health page (systemHealth wiring: acceptance-time). */
export interface InlineGateBreakerSnapshot {
  enabled: boolean;
  state: InlineBreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
  openedAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  cooldownRemainingMs: number;
  totalOpens: number;
  totalSkips: number;
}

/** Breaker state getter for /system-health (read-only, cheap, never throws). */
export function getInlineGateBreakerState(): InlineGateBreakerSnapshot {
  const p = inlineBreakerParams();
  const now = Date.now();
  return {
    enabled: isInlineGateEnabled(),
    state: inlineBreaker.state,
    consecutiveFailures: inlineBreaker.consecutiveFailures,
    failureThreshold: p.threshold,
    windowMs: p.windowMs,
    cooldownMs: p.cooldownMs,
    openedAt: inlineBreaker.openedAt ? new Date(inlineBreaker.openedAt).toISOString() : null,
    lastFailureAt: inlineBreaker.lastFailureAt ? new Date(inlineBreaker.lastFailureAt).toISOString() : null,
    lastError: inlineBreaker.lastError,
    cooldownRemainingMs:
      inlineBreaker.state === "open" ? Math.max(0, inlineBreaker.openedAt + p.cooldownMs - now) : 0,
    totalOpens: inlineBreaker.totalOpens,
    totalSkips: inlineBreaker.totalSkips,
  };
}

/** TEST-ONLY: reset the module-level breaker (mirrors _reset* conventions). */
export function _resetInlineGateBreaker(): void {
  inlineBreaker.state = "closed";
  inlineBreaker.consecutiveFailures = 0;
  inlineBreaker.streakStartedAt = 0;
  inlineBreaker.openedAt = 0;
  inlineBreaker.lastFailureAt = 0;
  inlineBreaker.lastError = null;
  inlineBreaker.probeInFlight = false;
  inlineBreaker.totalOpens = 0;
  inlineBreaker.totalSkips = 0;
}

/**
 * May an inline inference run right now? open → after cooldown, allow ONE
 * half-open probe (guarded by probeInFlight); otherwise deny.
 */
function acquireInlineBreakerSlot(): { allowed: boolean; probe: boolean } {
  const { cooldownMs } = inlineBreakerParams();
  const now = Date.now();
  switch (inlineBreaker.state) {
    case "closed":
      return { allowed: true, probe: false };
    case "open":
      if (now - inlineBreaker.openedAt >= cooldownMs) {
        inlineBreaker.state = "half_open";
        inlineBreaker.probeInFlight = true;
        return { allowed: true, probe: true };
      }
      return { allowed: false, probe: false };
    case "half_open":
      if (!inlineBreaker.probeInFlight) {
        inlineBreaker.probeInFlight = true;
        return { allowed: true, probe: true };
      }
      return { allowed: false, probe: false };
  }
}

function recordInlineBreakerSuccess(): void {
  inlineBreaker.state = "closed";
  inlineBreaker.consecutiveFailures = 0;
  inlineBreaker.streakStartedAt = 0;
  inlineBreaker.probeInFlight = false;
}

function recordInlineBreakerFailure(message: string, probe: boolean): void {
  const { threshold, windowMs } = inlineBreakerParams();
  const now = Date.now();
  inlineBreaker.lastFailureAt = now;
  inlineBreaker.lastError = message.slice(0, 500);
  if (probe) {
    // Half-open probe failed → straight back to open with a fresh cooldown.
    inlineBreaker.state = "open";
    inlineBreaker.openedAt = now;
    inlineBreaker.probeInFlight = false;
    inlineBreaker.totalOpens += 1;
    console.warn(`[InlineGate] breaker probe failed — re-OPEN (${message})`);
    return;
  }
  // Consecutive failures within the rolling window (success resets the streak).
  if (inlineBreaker.consecutiveFailures === 0 || now - inlineBreaker.streakStartedAt > windowMs) {
    inlineBreaker.consecutiveFailures = 1;
    inlineBreaker.streakStartedAt = now;
  } else {
    inlineBreaker.consecutiveFailures += 1;
  }
  if (inlineBreaker.consecutiveFailures >= threshold && inlineBreaker.state === "closed") {
    inlineBreaker.state = "open";
    inlineBreaker.openedAt = now;
    inlineBreaker.totalOpens += 1;
    console.error(
      `[InlineGate] circuit breaker OPEN after ${inlineBreaker.consecutiveFailures} consecutive AI failures ` +
        `(last: ${message}) — inline inspections will be routed to NEEDS_REVIEW until recovery.`,
    );
  }
}

export interface InlineGateInput {
  inspectionId: number;
  machineId: number;
  productModelId?: number | null;
  /**
   * Lazy defect-image resolver — runs AFTER the ingest ACK (never on the hot
   * path). null / empty ⇒ nothing to gate, skip silently.
   */
  getImage: () => Promise<Buffer | null> | Buffer | null;
  /** Ingest-path provenance, stamped into aiDetails on skip/error markers only. */
  source: "machine_api" | "aoi_package";
}

export type InlineGateOutcome =
  | { status: "disabled" }
  | { status: "no_config" }
  | { status: "no_image" }
  | { status: "skipped"; reason: "ai_unavailable" }
  | { status: "processed"; decision: QualityGateDecision["decision"] }
  | { status: "failed"; error: string };

/**
 * INLINE quality-gate entry point for the ingest post-hooks (V1).
 *
 * Semantics:
 *  • flag-gated (AI_INLINE_GATE_ENABLED, default OFF) — flag off ⇒ no-op;
 *  • per-machine/product enablement = the quality-gate config's own `enabled`
 *    column (getQualityGateConfig only ever returns enabled=true rows);
 *  • SUCCESS path delegates to processQualityGate → identical DB write shape
 *    as the on-demand UI path (aiDecision/aiConfidence/aiModelId/aiProcessedAt/
 *    aiDetails + ai_quality_gate_results + canary/anomaly/control hooks) — the
 *    canary A/B path (V5) therefore receives REAL inline traffic;
 *  • AI DOWN (V18): circuit breaker (N consecutive failures within window →
 *    OPEN for cooldown → single half-open probe). While open, or when the gate
 *    throws, the inspection is stamped aiDecision=NEEDS_REVIEW with
 *    aiDetails.skipped = 'ai_unavailable' | 'ai_error' — routed to human
 *    review, NEVER an ingest error;
 *  • finally calls the W7-B NTF-predictor seam (dynamic, fail-open).
 *
 * NEVER throws — all failure modes are captured and reported in the outcome.
 */
export async function runInlineQualityGate(input: InlineGateInput): Promise<InlineGateOutcome> {
  let outcome: InlineGateOutcome;
  try {
    outcome = await runInlineQualityGateInner(input);
  } catch (err) {
    // Defensive: inner already guards each step; this catches programmer error.
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[InlineGate] unexpected failure for inspection ${input.inspectionId}: ${msg}`);
    outcome = { status: "failed", error: msg };
  }
  return outcome;
}

async function runInlineQualityGateInner(input: InlineGateInput): Promise<InlineGateOutcome> {
  if (!isInlineGateEnabled()) return { status: "disabled" };

  const config = await getQualityGateConfig(input.machineId, input.productModelId ?? null);
  if (!config) return { status: "no_config" };

  // Resolve the image BEFORE consuming a breaker slot: a missing/corrupt image
  // is a DATA problem, not AI-down — it must never trip or probe the breaker.
  let image: Buffer | null = null;
  try {
    image = await input.getImage();
  } catch (err) {
    console.warn(
      `[InlineGate] image resolution failed for inspection ${input.inspectionId}: ${(err as Error)?.message}`,
    );
    return { status: "no_image" };
  }
  if (!image || image.length === 0) return { status: "no_image" };

  const slot = acquireInlineBreakerSlot();
  if (!slot.allowed) {
    inlineBreaker.totalSkips += 1;
    await stampInlineSkipMarker(
      input,
      "ai_unavailable",
      "AI quality gate unavailable (circuit breaker open) — routed to manual review",
    );
    await callNtfPredictorSeam(input);
    return { status: "skipped", reason: "ai_unavailable" };
  }

  let outcome: InlineGateOutcome;
  try {
    const decision = await processQualityGate(input.inspectionId, image, config);
    recordInlineBreakerSuccess();
    outcome = { status: "processed", decision: decision.decision };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    recordInlineBreakerFailure(msg, slot.probe);
    await stampInlineSkipMarker(
      input,
      "ai_error",
      `AI quality gate failed (${msg}) — routed to manual review`,
    );
    outcome = { status: "failed", error: msg };
  }

  await callNtfPredictorSeam(input);
  return outcome;
}

/**
 * Honest AI-down/AI-failed marker (V18): route the inspection to human review
 * WITHOUT inventing a verdict — aiDecision=NEEDS_REVIEW, aiConfidence/aiModelId
 * stay NULL (no inference ran), aiDetails carries the machine-readable reason.
 * Same honest-degrade posture as embeddingHead's degradedResult. Never throws.
 */
async function stampInlineSkipMarker(
  input: InlineGateInput,
  skipped: "ai_unavailable" | "ai_error",
  reviewReason: string,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(productInspections)
      .set({
        aiDecision: "NEEDS_REVIEW",
        aiProcessedAt: new Date(),
        aiDetails: { skipped, reviewReason, inline: true, source: input.source },
      })
      .where(eq(productInspections.id, input.inspectionId));
  } catch (err) {
    console.warn(
      `[InlineGate] failed to stamp ${skipped} marker on inspection ${input.inspectionId}: ${(err as Error)?.message}`,
    );
  }
}

/**
 * W7-B seam — NTF/false-call predictor scoring at ingest (doc 27 Đợt 7.3).
 * Dynamic import + fail-open EXACTLY like the commissioning-tag seam: module or
 * function absent ⇒ skip silently. Deliberately LOOSE-typed (module cast, extra
 * ctx arg is ignored by the current (inspectionId) signature) so W7-B can evolve
 * the service without coupling the inline-gate compile to it.
 */
async function callNtfPredictorSeam(input: InlineGateInput): Promise<void> {
  try {
    const mod = (await import("./ai/ntfPredictorService")) as unknown as {
      scoreInspectionNtf?: (inspectionId: number, ctx?: Record<string, unknown>) => Promise<unknown>;
    } | null;
    if (typeof mod?.scoreInspectionNtf === "function") {
      await mod.scoreInspectionNtf(input.inspectionId, {
        machineId: input.machineId,
        productModelId: input.productModelId ?? null,
        source: "inline_gate",
      });
    }
  } catch {
    /* fail-open — NTF scoring must never affect the ingest/gate outcome */
  }
}

// ─── Statistics ──────────────────────────────────────────────────

export interface QualityGateStats {
  total: number;
  autoOk: number;
  autoNg: number;
  needsReview: number;
  manual: number;
  avgConfidence: number;
  avgProcessingTimeMs: number;
}

export async function getQualityGateStats(options: {
  configId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<QualityGateStats> {
  const db = await getDb();
  if (!db) return { total: 0, autoOk: 0, autoNg: 0, needsReview: 0, manual: 0, avgConfidence: 0, avgProcessingTimeMs: 0 };

  let query = sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE decision = 'AUTO_OK')::int as "autoOk",
      COUNT(*) FILTER (WHERE decision = 'AUTO_NG')::int as "autoNg",
      COUNT(*) FILTER (WHERE decision = 'NEEDS_REVIEW')::int as "needsReview",
      COUNT(*) FILTER (WHERE decision = 'MANUAL')::int as manual,
      COALESCE(AVG(confidence::numeric), 0)::float as "avgConfidence",
      COALESCE(AVG("processingTimeMs"), 0)::float as "avgProcessingTimeMs"
    FROM ai_quality_gate_results
    WHERE 1=1
  `;

  if (options.configId) {
    query = sql`${query} AND "configId" = ${options.configId}`;
  }
  if (options.startDate) {
    query = sql`${query} AND "createdAt" >= ${options.startDate}`;
  }
  if (options.endDate) {
    query = sql`${query} AND "createdAt" <= ${options.endDate}`;
  }

  if (options.machineId) {
    query = sql`${query} AND "inspectionId" IN (
      SELECT id FROM product_inspections WHERE "machineId" = ${options.machineId}
    )`;
  }

  const result = await db.execute(query) as any;
  const row = result.rows?.[0];
  if (!row) return { total: 0, autoOk: 0, autoNg: 0, needsReview: 0, manual: 0, avgConfidence: 0, avgProcessingTimeMs: 0 };

  return {
    total: row.total ?? 0,
    autoOk: row.autoOk ?? 0,
    autoNg: row.autoNg ?? 0,
    needsReview: row.needsReview ?? 0,
    manual: row.manual ?? 0,
    avgConfidence: row.avgConfidence ?? 0,
    avgProcessingTimeMs: row.avgProcessingTimeMs ?? 0,
  };
}

// ─── B6 Canary Live Helpers ──────────────────────────────────────

/**
 * Run the A/B canary variant for a live inspection and record it into
 * ab_test_results alongside the production quality-gate result.
 *
 * Variant selection is deterministic on inspectionId (idempotent for offline sync —
 * the same inspection always hits the same variant). Counters on the experiment row
 * are kept in sync (totalInferences == modelAInferences + modelBInferences).
 *
 * Best-effort: if the experiment is missing/not RUNNING this is a no-op.
 */
export async function runCanaryInference(
  experimentId: number,
  inspectionId: number,
  imageBuffer: Buffer,
): Promise<{ variant: "A" | "B"; modelId: number; confidence: number; processingTimeMs: number } | null> {
  const db = await getDb();
  if (!db) return null;

  const [exp] = await db
    .select()
    .from(abTestExperiments)
    .where(eq(abTestExperiments.id, experimentId))
    .limit(1);
  if (!exp || exp.status !== "RUNNING") return null;

  const variant = selectCanaryVariant(exp, inspectionId);
  const modelId = variant === "A" ? exp.modelAId : exp.modelBId;
  const modelVersion = variant === "A" ? exp.modelAVersion : exp.modelBVersion;

  const startTime = Date.now();
  const result = await runInference(modelId, imageBuffer, { inspectionId });
  const processingTimeMs = Date.now() - startTime;

  const confidence = result.confidence ?? 0;
  const topLabel = result.topLabel ?? "unknown";

  await db.insert(abTestResults).values({
    experimentId,
    variant,
    modelId,
    modelVersion,
    inputReference: String(inspectionId),
    predictions: result.predictions.map((p) => ({ label: p.label, confidence: p.confidence })),
    confidence: confidence.toFixed(4),
    topLabel,
    processingTimeMs,
  });

  // Keep experiment counters in sync (real column names — B6 fix mirrors aiABTesting).
  const updates: Record<string, number> = {
    totalInferences: (exp.totalInferences ?? 0) + 1,
  };
  if (variant === "A") updates.modelAInferences = (exp.modelAInferences ?? 0) + 1;
  else updates.modelBInferences = (exp.modelBInferences ?? 0) + 1;
  await db
    .update(abTestExperiments)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(abTestExperiments.id, experimentId));

  return { variant, modelId, confidence, processingTimeMs };
}

/**
 * Promote a model as the winner of a canary: repoint the quality-gate config at the
 * new model and detach the active experiment so the live path returns to the plain
 * single-model flow. Called by aiABTesting.promoteWinner.
 */
export async function promoteConfigToModel(
  configId: number,
  modelId: number,
  expectedExperimentId?: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const updates: Record<string, unknown> = {
    modelId,
    activeExperimentId: null,
    updatedAt: new Date(),
  };
  // Guard: only repoint configs that were actually wired to this experiment.
  const where =
    expectedExperimentId != null
      ? and(
          eq(aiQualityGateConfigs.id, configId),
          eq(aiQualityGateConfigs.activeExperimentId, expectedExperimentId),
        )
      : eq(aiQualityGateConfigs.id, configId);
  await db.update(aiQualityGateConfigs).set(updates).where(where);
  invalidateConfigCache();
}

// ─── B3 Anomaly Hook ─────────────────────────────────────────────────────────

/**
 * Best-effort unsupervised anomaly check, run only when ANOMALY_DETECTION_ENABLED.
 *
 * Scope của bank = (productModelId, machineId) của inspection + ONNX modelId của
 * config. Khi isAnomaly && !degraded (kết quả từ embedding ONNX thật, không phải
 * fallback) → ghi cờ anomaly vào inferenceResults.metadata mới nhất của inspection
 * và (tùy chọn ANOMALY_CREATE_ALERTS) tạo predictiveAlert PATTERN_ANOMALY.
 *
 * KHÔNG bao giờ throw ra ngoài (caller đã .catch); KHÔNG đụng quyết định gate.
 */
async function runAnomalyHook(
  inspectionId: number,
  imageBuffer: Buffer,
  config: AiQualityGateConfig,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Lookup scope (machine/product) của inspection.
  const [insp] = await db
    .select({
      machineId: productInspections.machineId,
      productModelId: productInspections.productModelId,
    })
    .from(productInspections)
    .where(eq(productInspections.id, inspectionId))
    .limit(1);

  const { scoreImage } = await import("./aiAnomalyDetection");
  const result = await scoreImage({
    buffer: imageBuffer,
    productModelId: insp?.productModelId ?? config.productModelId ?? null,
    machineId: insp?.machineId ?? config.machineId ?? null,
    modelId: config.modelId ?? null,
  });

  // Chỉ hành động khi phát hiện anomaly THẬT (không phải fallback degrade).
  if (!result.isAnomaly || result.degraded) return;

  // ── AOI-F — propose a control action for a CONFIRMED anomaly (best-effort). ──
  // Composes two flags: this hook already requires ANOMALY_DETECTION_ENABLED; the
  // proposal additionally requires VISION_CONTROL_ENABLED. confidence=null (an
  // anomaly score is NOT a 0..1 classifier confidence → honest provenance).
  if (isVisionControlEnabled()) {
    await proposeControlForInspection(
      inspectionId,
      { decision: "ANOMALY", confidence: null, topLabel: "anomaly", source: "anomaly" },
      { modelId: config.modelId ?? null },
    ).catch((err) => {
      console.warn(
        `[QualityGate] anomaly→control proposal failed for inspection ${inspectionId}: ${(err as Error)?.message}`,
      );
    });
  }

  const anomalyMeta = {
    anomaly: {
      score: result.score,
      threshold: result.threshold,
      isAnomaly: result.isAnomaly,
      source: result.source,
      degraded: result.degraded,
      bankSize: result.bankSize,
      k: result.k,
      detectedAt: new Date().toISOString(),
    },
  };

  // Ghi vào inferenceResults.metadata mới nhất của inspection (merge, best-effort).
  const [latest] = await db
    .select({ id: inferenceResults.id, metadata: inferenceResults.metadata })
    .from(inferenceResults)
    .where(eq(inferenceResults.inspectionId, inspectionId))
    .orderBy(desc(inferenceResults.createdAt))
    .limit(1);

  if (latest) {
    const merged = { ...((latest.metadata as Record<string, unknown>) ?? {}), ...anomalyMeta };
    await db.update(inferenceResults).set({ metadata: merged }).where(eq(inferenceResults.id, latest.id));
  }

  // ── C1 (backlog §3) — NGUỒN GHI CUỐI CÙNG NAY ĐI QUA CỬA CHUNG ────────────────────
  //
  // Trước bản này chỗ đây `db.insert(predictiveAlerts)` THẲNG. Hệ quả khi ai đó bật
  // `ANOMALY_CREATE_ALERTS=true`:
  //   • không gộp trùng ⇒ mỗi ảnh bất thường một dòng, đúng thứ Wave 3 đã dọn xong;
  //   • không `expiresAt` ⇒ sweeper không bao giờ đóng được, dòng nằm lại vĩnh viễn;
  //   • **không ghi nhật ký lần-tái-diễn** ⇒ cả nhóm `PATTERN_ANOMALY` VÔ HÌNH với KPI.
  // Và không một dấu hiệu nào: bảng vẫn có dòng, giao diện vẫn hiện, chỉ số đếm là sai.
  // Bật một lá cờ không nên làm hỏng phép đo — nhất là lá cờ mặc định TẮT, vì khi có
  // người bật thì đã không còn ai nhớ chỗ này tồn tại.
  //
  // ⚠ Đi qua `routeAlert` được là nhờ C2 vừa mở đường cho ba trường `predictedValue` /
  //   `productModelCode` / `modelUsed`. Nếu không, chuyển đổi này sẽ ÂM THẦM làm mất dữ
  //   liệu mà đường cũ vẫn ghi — "dọn dẹp" kiểu đó tệ hơn để nguyên.
  if ((process.env.ANOMALY_CREATE_ALERTS ?? "false").toLowerCase() === "true") {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "PATTERN_ANOMALY",
      severity: "MEDIUM",
      machineId: insp?.machineId ?? config.machineId ?? undefined,
      productModelId: insp?.productModelId ?? config.productModelId ?? undefined,
      message:
        `Image for inspection ${inspectionId} exceeded the anomaly threshold ` +
        `(score ${result.score.toFixed(4)} > ${(result.threshold ?? 0).toFixed(4)}, ` +
        `source=${result.source}, bank=${result.bankSize}).`,
      data: {
        predictedValue: result.score.toFixed(4),
        threshold: (result.threshold ?? 0).toFixed(4),
        dataPoints: result.bankSize,
        // Tên thuật toán THẬT, không phải tên bộ định tuyến — xem C2.
        modelUsed: `anomaly:${result.source}`,
      },
    });
  }
}

// ─── AOI-F — Quality → Control proposal hook (best-effort, HITL PROPOSE-ONLY) ────

/**
 * Draft a typed control proposal for a gated NG verdict and emit it via the HITL
 * propose flow (ai_pending_actions). Resolves the model version for provenance
 * (best-effort) then delegates to qualityControlProposer. NEVER actuates, NEVER
 * throws into the caller (the caller already .catch()es). Reached ONLY when
 * VISION_CONTROL_ENABLED (checked by the caller).
 */
async function runQualityControlHook(
  inspectionId: number,
  verdict: { decision: string; confidence: number; topLabel: string | null },
  config: AiQualityGateConfig,
): Promise<void> {
  let modelVersion: string | null = null;
  try {
    const model = config.modelId != null ? await getAiModelById(config.modelId) : null;
    modelVersion = (model as { version?: string | null } | null)?.version ?? null;
  } catch {
    /* best-effort — provenance modelVersion stays null */
  }
  await proposeControlForInspection(
    inspectionId,
    {
      decision: verdict.decision,
      confidence: verdict.confidence,
      topLabel: verdict.topLabel,
      source: "quality_gate",
    },
    { modelId: config.modelId ?? null, modelVersion },
  );
}
