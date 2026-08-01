/**
 * G4.23 (doc 44 W5-A4) — FEATURE STORE (SYNAPSE LDS-L4 §3.2).
 * Flag: FEATURE_STORE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *   "Sai lệch giữa đặc trưng lúc huấn luyện và lúc suy luận (train/serve skew) là
 *    nguyên nhân số một khiến mô hình tốt-trong-lab, tệ-ngoài-xưởng." (LDS-L4 §3.2)
 *
 *   ml_feature_cache / ml_inference_audit ĐÃ có schema (drizzle/schema/g3.ts) nhưng
 *   0 code đọc/ghi. This module activates them with a SINGLE definition of each
 *   feature, shared by BOTH the training path and the serving path — the anti-skew
 *   contract the spec demands.
 *
 * REGISTRY (STATIC functions — NO eval, NO dynamic code):
 *   (a) image_embedding — wraps ai_image_embeddings. The SAME canonical vector
 *       contract is used by the head TRAIN path (collectHeadTrainingPairs) and the
 *       head SERVE path (runEmbeddingHeadInference). prepareImageEmbeddingVector is
 *       the one checkpoint both call.
 *   (b) pdm_sensor — wraps predictiveMaintenanceService.buildSensorFeatureSeries
 *       over machine_sensor_readings (the REAL telemetry table).
 *
 * HONEST DEGRADE: when the flag is OFF, callers keep their original path unchanged
 * (this module is not on the hot path). getFeatures / recordInference are safe when
 * there is no DB (return empty / false), and every cache write is best-effort — a
 * cache failure NEVER breaks train or serve.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { and, eq, gte, count } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  mlFeatureCache,
  mlInferenceAudit,
  aiImageEmbeddings,
  machineSensorReadings,
} from "../../../drizzle/schema";
import { parseVectorLiteral } from "../aiImageEmbedding";
import {
  buildSensorFeatureSeries,
  type SensorReadingPoint,
} from "../predictiveMaintenanceService";

// ─── Flags ───────────────────────────────────────────────────────────────────

export function isFeatureStoreEnabled(): boolean {
  const v = String(process.env.FEATURE_STORE_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Fraction [0,1] of inferences to persist into ml_inference_audit (bounded). */
export function inferenceAuditSampleRate(): number {
  const n = Number(process.env.INFERENCE_AUDIT_SAMPLE_RATE);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ─── Registry types ────────────────────────────────────────────────────────────

export type FeatureValue = Record<string, unknown>;

export interface FeatureComputeContext {
  /**
   * A pre-loaded raw row so compute avoids a redundant re-query. The TRAIN path
   * already SELECTed the ai_image_embeddings rows in bulk — it seeds them here so
   * getFeatures does not re-query per row (no N+1).
   */
  seed?: Record<string, unknown>;
}

export interface FeatureDefinition {
  /** featureSet name — the cache key prefix (ml_feature_cache.featureSet = name@version). */
  name: string;
  version: string;
  /** Entity kind this feature is scoped to ("image_embedding" | "machine"). */
  entityType: string;
  /** Cache TTL in seconds (null = no expiry). */
  ttlSeconds: number | null;
  /** STATIC compute — resolves an entity into a feature object. NEVER eval'd. */
  compute: (
    entityId: string,
    ctx?: FeatureComputeContext,
  ) => Promise<FeatureValue | null> | FeatureValue | null;
}

const REGISTRY = new Map<string, FeatureDefinition>();

/** Register (or replace) a static feature definition. Idempotent. */
export function defineFeature(def: FeatureDefinition): FeatureDefinition {
  REGISTRY.set(def.name, def);
  return def;
}

export function getFeatureDefinition(name: string): FeatureDefinition | undefined {
  return REGISTRY.get(name);
}

export function listFeatureDefinitions(): FeatureDefinition[] {
  return [...REGISTRY.values()];
}

function featureSetKey(def: FeatureDefinition): string {
  return `${def.name}@${def.version}`;
}

// ─── getFeatures / invalidate ───────────────────────────────────────────────────

/**
 * Resolve `names` for one entity: cache-hit from ml_feature_cache (respecting
 * expiresAt), miss → static compute → persist. Returns a map keyed by feature name.
 * Definitions whose entityType ≠ `entityType`, or that are absent, are skipped.
 */
export async function getFeatures(
  entityType: string,
  entityId: string | number,
  names: string[],
  ctx?: FeatureComputeContext,
): Promise<Record<string, FeatureValue>> {
  const id = String(entityId);
  const out: Record<string, FeatureValue> = {};
  const db = await getDb();
  const now = new Date();

  for (const name of names) {
    const def = REGISTRY.get(name);
    if (!def || def.entityType !== entityType) continue;
    const setKey = featureSetKey(def);

    // 1) cache hit (unexpired)
    if (db) {
      try {
        const [row] = await db
          .select()
          .from(mlFeatureCache)
          .where(
            and(
              eq(mlFeatureCache.entityType, entityType),
              eq(mlFeatureCache.entityId, id),
              eq(mlFeatureCache.featureSet, setKey),
            ),
          )
          .limit(1);
        if (row && (!row.expiresAt || row.expiresAt.getTime() > now.getTime())) {
          out[name] = row.features as FeatureValue;
          continue;
        }
      } catch {
        /* fall through to compute — cache read is best-effort */
      }
    }

    // 2) miss → compute (static)
    const computed = await def.compute(id, ctx);
    if (computed == null) continue;
    out[name] = computed;

    // 3) persist (best-effort — never breaks the caller)
    if (db) {
      const expiresAt =
        def.ttlSeconds != null ? new Date(now.getTime() + def.ttlSeconds * 1000) : null;
      try {
        await db
          .delete(mlFeatureCache)
          .where(
            and(
              eq(mlFeatureCache.entityType, entityType),
              eq(mlFeatureCache.entityId, id),
              eq(mlFeatureCache.featureSet, setKey),
            ),
          );
        await db.insert(mlFeatureCache).values({
          entityType,
          entityId: id,
          featureSet: setKey,
          features: computed,
          computedAt: now,
          expiresAt,
        });
      } catch {
        /* cache write is best-effort */
      }
    }
  }

  return out;
}

/** Evict cached features for an entity (or a whole entityType / featureSet). */
export async function invalidate(entity: {
  entityType: string;
  entityId?: string | number;
  featureSet?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const conds = [eq(mlFeatureCache.entityType, entity.entityType)];
  if (entity.entityId != null) conds.push(eq(mlFeatureCache.entityId, String(entity.entityId)));
  if (entity.featureSet) conds.push(eq(mlFeatureCache.featureSet, entity.featureSet));
  try {
    const res = await db.delete(mlFeatureCache).where(and(...conds));
    return (res as { rowCount?: number } | undefined)?.rowCount ?? 0;
  } catch {
    return 0;
  }
}

// ─── Group (a): image-embedding feature (train == serve) ────────────────────────

export const IMAGE_EMBEDDING_FEATURE = "image_embedding";
export const IMAGE_EMBEDDING_ENTITY = "image_embedding";

/**
 * THE shared vector contract used by BOTH the head train path and the head serve
 * path. It is the single checkpoint that guarantees the two sides agree on the
 * feature space.
 *
 * Numerically identity: the embedding PIPELINE already L2-normalizes on both sides
 * (extractEmbedding at serve time, and the stored ai_image_embeddings vectors are
 * normalized at write time). Re-normalizing here would only perturb the 6th decimal
 * and drift the dataset checksum, so the canonical feature IS the pipeline's vector.
 * The value this checkpoint adds: a single place both sides funnel through (+ a
 * finite-vector guard), so a future space change can't diverge train from serve.
 */
export function prepareImageEmbeddingVector(raw: number[]): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.every((v) => Number.isFinite(v)) ? raw : raw.filter((v) => Number.isFinite(v));
}

const imageEmbeddingCompute: FeatureDefinition["compute"] = async (entityId, ctx) => {
  let row = ctx?.seed as
    | { embedding?: string | null; embeddingDim?: number | null; modelCode?: string | null; label?: string | null }
    | undefined;

  if (!row || row.embedding == null) {
    const db = await getDb();
    if (!db) return null;
    const idNum = Number(entityId);
    if (!Number.isFinite(idNum)) return null;
    const [r] = await db
      .select({
        embedding: aiImageEmbeddings.embedding,
        embeddingDim: aiImageEmbeddings.embeddingDim,
        modelCode: aiImageEmbeddings.modelCode,
        label: aiImageEmbeddings.label,
      })
      .from(aiImageEmbeddings)
      .where(eq(aiImageEmbeddings.id, idNum))
      .limit(1);
    if (!r) return null;
    row = r;
  }

  const vector = prepareImageEmbeddingVector(parseVectorLiteral(row.embedding ?? null));
  if (vector.length === 0) return null;
  return {
    embedding: vector,
    embeddingDim: row.embeddingDim ?? vector.length,
    modelCode: row.modelCode ?? null,
    label: row.label ?? null,
  };
};

// ─── Group (b): PdM sensor feature (wraps buildSensorFeatureSeries) ─────────────

export const PDM_SENSOR_FEATURE = "pdm_sensor";
export const PDM_SENSOR_ENTITY = "machine";

const pdmSensorCompute: FeatureDefinition["compute"] = async (entityId, ctx) => {
  let rows = ctx?.seed?.rows as SensorReadingPoint[] | undefined;

  if (!rows) {
    const db = await getDb();
    if (!db) return null;
    const machineId = Number(entityId);
    if (!Number.isFinite(machineId)) return null;
    const windowHours = Number(process.env.PDM_FEATURE_WINDOW_HOURS || "72");
    const since = new Date(Date.now() - windowHours * 3600_000);
    const raw = await db
      .select({
        sensorType: machineSensorReadings.sensorType,
        value: machineSensorReadings.value,
        timestamp: machineSensorReadings.timestamp,
      })
      .from(machineSensorReadings)
      .where(and(eq(machineSensorReadings.machineId, machineId), gte(machineSensorReadings.timestamp, since)));
    rows = raw.map((r) => ({
      sensorType: r.sensorType,
      value: Number(r.value),
      timestamp: new Date(r.timestamp).getTime(),
    }));
  }

  // The SAME feature definition PdM's live path uses — no fork.
  const series = buildSensorFeatureSeries(rows);
  const lastMv = series.multivariate.length > 0 ? series.multivariate[series.multivariate.length - 1] : null;
  const lastTemp = series.tempSeries.length > 0 ? series.tempSeries[series.tempSeries.length - 1] : null;
  return {
    multivariateCount: series.multivariate.length,
    tempCount: series.tempSeries.length,
    latestMultivariate: lastMv?.values ?? null,
    latestTemp: lastTemp?.value ?? null,
    multivariate: series.multivariate,
    tempSeries: series.tempSeries,
  };
};

// ─── Built-in registration (idempotent, runs on import) ─────────────────────────

export function registerBuiltinFeatures(): void {
  defineFeature({
    name: IMAGE_EMBEDDING_FEATURE,
    version: "v1",
    entityType: IMAGE_EMBEDDING_ENTITY,
    ttlSeconds: null, // stored embeddings are immutable → never expire
    compute: imageEmbeddingCompute,
  });
  defineFeature({
    name: PDM_SENSOR_FEATURE,
    version: "v1",
    entityType: PDM_SENSOR_ENTITY,
    ttlSeconds: 300, // sensor windows move — short TTL
    compute: pdmSensorCompute,
  });
}

registerBuiltinFeatures();

// ─── ml_inference_audit (bounded, sampled) ──────────────────────────────────────

export interface InferenceAuditEntry {
  modelName: string;
  modelVersion?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  input?: unknown;
  output?: unknown;
  confidence?: number | null;
  latencyMs?: number | null;
  flaggedForReview?: boolean;
}

/**
 * Persist ONE inference-audit row (active-learning + shadow-gate signal). Sampled
 * by INFERENCE_AUDIT_SAMPLE_RATE and flag-gated: a no-op unless FEATURE_STORE_ENABLED
 * (or opts.force for tests). Best-effort — never throws into the caller.
 * Returns true iff a row was written.
 */
export async function recordInference(
  entry: InferenceAuditEntry,
  opts?: { force?: boolean; sampleRate?: number; rng?: () => number },
): Promise<boolean> {
  if (!opts?.force && !isFeatureStoreEnabled()) return false;
  const rate = opts?.sampleRate ?? inferenceAuditSampleRate();
  if (!opts?.force) {
    if (rate <= 0) return false;
    const roll = (opts?.rng ?? Math.random)();
    if (rate < 1 && roll >= rate) return false;
  }
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(mlInferenceAudit).values({
      modelName: entry.modelName,
      modelVersion: entry.modelVersion ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      input: entry.input ?? null,
      output: entry.output ?? null,
      confidence: entry.confidence != null ? String(entry.confidence) : null,
      latencyMs: entry.latencyMs ?? null,
      flaggedForReview: entry.flaggedForReview ?? false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Count inference-audit rows for a model[/version] since a time — the shadow gate signal. */
export async function countInferenceAudit(
  modelName: string,
  modelVersion?: string | null,
  since?: Date,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const conds = [eq(mlInferenceAudit.modelName, modelName)];
  if (modelVersion) conds.push(eq(mlInferenceAudit.modelVersion, modelVersion));
  if (since) conds.push(gte(mlInferenceAudit.createdAt, since));
  try {
    const [r] = await db.select({ n: count() }).from(mlInferenceAudit).where(and(...conds));
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}
