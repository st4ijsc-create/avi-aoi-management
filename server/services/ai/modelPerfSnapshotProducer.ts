/**
 * doc 22 P2 — MODEL PERFORMANCE SNAPSHOT PRODUCER.
 * Flag: AI_MODEL_PERF_SNAPSHOTS_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY: `model_performance_snapshots` was READ by the auto-rollback monitor
 * (server/services/ai/modelAutoRollback.ts → readLiveSignal) but NEVER WRITTEN by
 * any producer — so `evaluateRollback` had no live signal and was a permanent
 * no-op. This service closes that seam: it periodically materializes a snapshot
 * row (live accuracy + confidence distribution) per model version from the REAL
 * feedback telemetry the operators already generate.
 *
 * SIGNAL SOURCE (honest, label-based): `ai_feedback` rows joined to their
 * `ai_suggestions`. `feedbackType` gives ground truth (CORRECT vs INCORRECT); the
 * suggestion carries `modelName` + `modelVersion` + `confidence`. We resolve
 * modelName → ai_models.code → ai_models.id (the SAME numeric id the snapshot
 * table + rollback monitor key on). Live accuracy = correct / evaluated over the
 * window. When there is no feedback, NO snapshot is written (never fabricate a
 * metric).
 *
 * SAFETY / GOVERNANCE:
 *   - ADVISORY ONLY. This service NEVER rolls back, swaps, retrains, or
 *     deactivates a model. It only writes an append-only telemetry row. Whether
 *     that row causes a rollback is decided EXCLUSIVELY by modelAutoRollback, gated
 *     by its OWN flag (AI_MODEL_AUTOROLLBACK_ENABLED).
 *   - Flag-gated: no-op (writes 0 rows) when AI_MODEL_PERF_SNAPSHOTS_ENABLED is
 *     off. In-process timer registration is cheap; the sweep self-gates.
 *   - Offline-first + fail-safe: internal Postgres only; any error degrades to a
 *     no-op result and NEVER throws into the caller / hot path.
 *   - The pure aggregation core `aggregatePerformance()` is unit-testable (no I/O).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { getDb } from "../../db/connection";
import { and, eq, gte, lt, inArray } from "drizzle-orm";
import { aiFeedback, aiSuggestions, aiModels } from "../../../drizzle/schema";
import { createPerformanceSnapshot } from "../../db/aiAdvanced";

export function isModelPerfSnapshotsEnabled(): boolean {
  return (
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED === "true" ||
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED === "1"
  );
}

/** Window (hours) of feedback aggregated into one snapshot. Default 24h. */
function windowHours(): number {
  const n = Number(process.env.AI_MODEL_PERF_SNAPSHOTS_WINDOW_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
}
/** Min evaluated feedback samples in the window before a snapshot is trustworthy. */
function minSamples(): number {
  const n = Number(process.env.AI_MODEL_PERF_SNAPSHOTS_MIN_SAMPLES);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// ─── Pure aggregation core (no I/O — unit-testable) ─────────────────────────────

/** One feedback datum joined to its suggestion. */
export interface FeedbackDatum {
  /** ai_suggestions.modelName — resolved to a modelId by the caller. */
  modelName: string;
  /** ai_suggestions.modelVersion. */
  modelVersion: string;
  /** ai_feedback.feedbackType — ground-truth verdict. */
  feedbackType: "CORRECT" | "INCORRECT" | "PARTIAL" | "UNSURE" | string;
  /** ai_suggestions.confidence (0..1). */
  confidence: number | null;
}

export interface PerformanceAggregate {
  modelName: string;
  modelVersion: string;
  /** Total feedback rows seen for this model version in the window. */
  total: number;
  /** Rows that count toward accuracy (CORRECT | INCORRECT | PARTIAL). */
  evaluated: number;
  correct: number;
  /** correct / evaluated (0..1), or null when nothing evaluated. */
  accuracy: number | null;
  /** Mean of available suggestion confidences (0..1), or null. */
  avgConfidence: number | null;
  /** Normalized 10-bin confidence histogram keyed "0.0-0.1"…"0.9-1.0". */
  confidenceDistribution: Record<string, number>;
}

const N_BINS = 10;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function binLabel(i: number): string {
  const lo = (i / N_BINS).toFixed(1);
  const hi = ((i + 1) / N_BINS).toFixed(1);
  return `${lo}-${hi}`;
}

interface Group {
  modelName: string;
  modelVersion: string;
  rows: FeedbackDatum[];
}

/**
 * Aggregate a flat list of feedback data into one PerformanceAggregate per
 * (modelName, modelVersion). PURE. A CORRECT verdict counts as accurate; PARTIAL
 * counts as evaluated-but-wrong (conservative); UNSURE is excluded from accuracy.
 */
export function aggregatePerformance(data: FeedbackDatum[]): PerformanceAggregate[] {
  const groups = new Map<string, Group>();
  for (const d of data) {
    if (!d.modelName || !d.modelVersion) continue;
    const key = `${d.modelName}::${d.modelVersion}`;
    let g = groups.get(key);
    if (!g) {
      g = { modelName: d.modelName, modelVersion: d.modelVersion, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(d);
  }

  const out: PerformanceAggregate[] = [];
  for (const { modelName, modelVersion, rows } of groups.values()) {
    let evaluated = 0;
    let correct = 0;
    let confSum = 0;
    let confN = 0;
    const hist = new Array(N_BINS).fill(0);

    for (const r of rows) {
      const ft = String(r.feedbackType).toUpperCase();
      if (ft === "CORRECT" || ft === "INCORRECT" || ft === "PARTIAL") {
        evaluated += 1;
        if (ft === "CORRECT") correct += 1;
      }
      if (r.confidence != null && Number.isFinite(r.confidence)) {
        const c = clamp01(r.confidence);
        confSum += c;
        confN += 1;
        let idx = Math.floor(c * N_BINS);
        if (idx >= N_BINS) idx = N_BINS - 1;
        hist[idx] += 1;
      }
    }

    const confidenceDistribution: Record<string, number> = {};
    for (let i = 0; i < N_BINS; i++) confidenceDistribution[binLabel(i)] = confN > 0 ? hist[i] / confN : 0;

    out.push({
      modelName,
      modelVersion,
      total: rows.length,
      evaluated,
      correct,
      accuracy: evaluated > 0 ? correct / evaluated : null,
      avgConfidence: confN > 0 ? confSum / confN : null,
      confidenceDistribution,
    });
  }
  return out;
}

// ─── Runtime: read feedback → write snapshots ───────────────────────────────────

export interface SnapshotSweepResult {
  enabled: boolean;
  /** Distinct (model, version) aggregates with enough samples. */
  written: number;
  /** Aggregates skipped for too few evaluated samples. */
  skippedLowSample: number;
  /** Aggregates skipped because modelName didn't resolve to an ai_models row. */
  skippedUnresolved: number;
}

/**
 * Read the last `windowHours` of feedback, aggregate per model version, resolve
 * each to a numeric modelId, and write ONE `model_performance_snapshots` row per
 * model version with enough samples. NO-OP (written:0) when the flag is off.
 * Fail-safe — never throws.
 */
export async function runPerfSnapshotSweep(now = new Date()): Promise<SnapshotSweepResult> {
  const result: SnapshotSweepResult = { enabled: false, written: 0, skippedLowSample: 0, skippedUnresolved: 0 };
  if (!isModelPerfSnapshotsEnabled()) return result;
  result.enabled = true;

  try {
    const db = await getDb();
    if (!db) return result;

    const periodStart = new Date(now.getTime() - windowHours() * 60 * 60 * 1000);

    // Join feedback → suggestion for the window. feedbackAt drives the window so a
    // late-labelled older inspection still lands in the right snapshot period.
    const rows = await db
      .select({
        modelName: aiSuggestions.modelName,
        modelVersion: aiSuggestions.modelVersion,
        feedbackType: aiFeedback.feedbackType,
        confidence: aiSuggestions.confidence,
      })
      .from(aiFeedback)
      .innerJoin(aiSuggestions, eq(aiFeedback.suggestionId, aiSuggestions.id))
      .where(and(gte(aiFeedback.feedbackAt, periodStart), lt(aiFeedback.feedbackAt, now)));

    const data: FeedbackDatum[] = rows.map((r) => ({
      modelName: r.modelName,
      modelVersion: r.modelVersion,
      feedbackType: r.feedbackType,
      confidence: r.confidence != null ? Number(r.confidence) : null,
    }));

    const aggregates = aggregatePerformance(data);
    if (aggregates.length === 0) return result;

    // Resolve every distinct modelName → ai_models.id in one query.
    const names = Array.from(new Set(aggregates.map((a) => a.modelName)));
    const models = await db
      .select({ id: aiModels.id, code: aiModels.code })
      .from(aiModels)
      .where(inArray(aiModels.code, names));
    const idByCode = new Map(models.map((m) => [m.code, m.id]));

    const minN = minSamples();
    for (const agg of aggregates) {
      const modelId = idByCode.get(agg.modelName);
      if (modelId == null) {
        result.skippedUnresolved += 1;
        continue;
      }
      if (agg.evaluated < minN || agg.accuracy == null) {
        result.skippedLowSample += 1;
        continue;
      }
      try {
        await createPerformanceSnapshot({
          modelId,
          modelVersion: agg.modelVersion,
          periodStart,
          periodEnd: now,
          totalInferences: agg.total,
          completedInferences: agg.evaluated,
          failedInferences: 0,
          // decimal columns accept numeric strings.
          accuracy: agg.accuracy.toFixed(4),
          confidenceDistribution: agg.confidenceDistribution,
        });
        result.written += 1;
      } catch (err) {
        console.error(
          `[modelPerfSnapshots] write failed for ${agg.modelName}@${agg.modelVersion}:`,
          (err as Error)?.message ?? err,
        );
      }
    }
  } catch (err) {
    console.error("[modelPerfSnapshots] sweep failed:", (err as Error)?.message ?? err);
  }
  return result;
}

// ─── Flag-gated sweep timer (mirrors modelAutoRollback / fleet charging) ─────────

let sweepTimer: NodeJS.Timeout | null = null;
export function startModelPerfSnapshotSweep(): void {
  if (sweepTimer) return;
  if (!isModelPerfSnapshotsEnabled()) {
    console.log("[modelPerfSnapshots] disabled (set AI_MODEL_PERF_SNAPSHOTS_ENABLED=true to enable)");
    return;
  }
  const intervalMs = Math.max(60_000, Number(process.env.AI_MODEL_PERF_SNAPSHOTS_SWEEP_MS ?? 3_600_000)); // 1h default
  let running = false;
  sweepTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runPerfSnapshotSweep();
      if (r.written > 0) console.log(`[modelPerfSnapshots] sweep: wrote ${r.written} snapshot(s)`);
    } catch (err) {
      console.error("[modelPerfSnapshots] sweep error:", (err as Error)?.message ?? err);
    } finally {
      running = false;
    }
  }, intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  console.log(`[modelPerfSnapshots] sweep started (every ${intervalMs}ms)`);
}

export function stopModelPerfSnapshotSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
