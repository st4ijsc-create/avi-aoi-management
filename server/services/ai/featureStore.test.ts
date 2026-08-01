/**
 * G4.23 — Feature Store tests.
 *
 * Pure/registry coverage (no DB required) + a DB-guarded cache hit/miss/persist
 * round-trip. The anti train/serve-skew contract is proven by showing the group-(a)
 * compute returns exactly parseVectorLiteral's vector (so the store-ON train path is
 * byte-compatible with the store-OFF inline parse) and that prepareImageEmbeddingVector
 * is identity for finite vectors (so ON-serve == OFF-serve numerically).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/connection";
import { mlFeatureCache } from "../../../drizzle/schema";
import { parseVectorLiteral } from "../aiImageEmbedding";
import {
  isFeatureStoreEnabled,
  inferenceAuditSampleRate,
  prepareImageEmbeddingVector,
  getFeatures,
  invalidate,
  listFeatureDefinitions,
  getFeatureDefinition,
  recordInference,
  IMAGE_EMBEDDING_FEATURE,
  IMAGE_EMBEDDING_ENTITY,
  PDM_SENSOR_FEATURE,
  PDM_SENSOR_ENTITY,
} from "./featureStore";

describe("featureStore — flags", () => {
  beforeEach(() => {
    delete process.env.FEATURE_STORE_ENABLED;
    delete process.env.INFERENCE_AUDIT_SAMPLE_RATE;
  });

  it("FEATURE_STORE_ENABLED defaults OFF (bit-compat old path)", () => {
    expect(isFeatureStoreEnabled()).toBe(false);
    process.env.FEATURE_STORE_ENABLED = "true";
    expect(isFeatureStoreEnabled()).toBe(true);
  });

  it("inference audit sample rate clamps to [0,1], default 0", () => {
    expect(inferenceAuditSampleRate()).toBe(0);
    process.env.INFERENCE_AUDIT_SAMPLE_RATE = "0.25";
    expect(inferenceAuditSampleRate()).toBeCloseTo(0.25, 6);
    process.env.INFERENCE_AUDIT_SAMPLE_RATE = "5";
    expect(inferenceAuditSampleRate()).toBe(1);
    process.env.INFERENCE_AUDIT_SAMPLE_RATE = "-1";
    expect(inferenceAuditSampleRate()).toBe(0);
  });
});

describe("featureStore — registry (static, no eval)", () => {
  it("registers the two real built-in feature groups", () => {
    const names = listFeatureDefinitions().map((d) => d.name);
    expect(names).toContain(IMAGE_EMBEDDING_FEATURE);
    expect(names).toContain(PDM_SENSOR_FEATURE);
    expect(getFeatureDefinition(IMAGE_EMBEDDING_FEATURE)?.entityType).toBe(IMAGE_EMBEDDING_ENTITY);
    expect(getFeatureDefinition(PDM_SENSOR_FEATURE)?.entityType).toBe(PDM_SENSOR_ENTITY);
    // compute is a real function (not a string to eval)
    expect(typeof getFeatureDefinition(IMAGE_EMBEDDING_FEATURE)?.compute).toBe("function");
  });
});

describe("featureStore — image-embedding contract (anti train/serve skew)", () => {
  it("prepareImageEmbeddingVector is identity for finite vectors", () => {
    const v = [0.1, -0.2, 0.3, 0.99];
    expect(prepareImageEmbeddingVector(v)).toEqual(v);
  });

  it("prepareImageEmbeddingVector drops non-finite entries", () => {
    expect(prepareImageEmbeddingVector([1, NaN, 2, Infinity, 3])).toEqual([1, 2, 3]);
  });

  it("group-(a) compute (via seed) equals parseVectorLiteral (store-ON == store-OFF)", async () => {
    const literal = "[0.11,0.22,0.33,0.44]";
    const feats = await getFeatures(IMAGE_EMBEDDING_ENTITY, "123", [IMAGE_EMBEDDING_FEATURE], {
      seed: { embedding: literal, embeddingDim: 4, modelCode: "dinov2-small", label: "OK" },
    });
    const f = feats[IMAGE_EMBEDDING_FEATURE] as { embedding: number[]; embeddingDim: number; label: string };
    expect(f.embedding).toEqual(parseVectorLiteral(literal));
    expect(f.embeddingDim).toBe(4);
    expect(f.label).toBe("OK");
  });

  it("skips a definition whose entityType does not match", async () => {
    const feats = await getFeatures("machine", "1", [IMAGE_EMBEDDING_FEATURE], {
      seed: { embedding: "[0.1,0.2]" },
    });
    expect(feats[IMAGE_EMBEDDING_FEATURE]).toBeUndefined();
  });
});

describe("featureStore — PdM sensor group wraps buildSensorFeatureSeries", () => {
  it("computes multivariate + temp series from seeded readings", async () => {
    const t0 = Date.now();
    const rows = [
      { sensorType: "vibration", value: 1.0, timestamp: t0 },
      { sensorType: "current", value: 5.0, timestamp: t0 + 1 },
      { sensorType: "temperature", value: 60, timestamp: t0 + 2 },
      { sensorType: "vibration", value: 1.2, timestamp: t0 + 3 },
      { sensorType: "current", value: 5.1, timestamp: t0 + 4 },
      { sensorType: "temperature", value: 61, timestamp: t0 + 5 },
    ];
    const feats = await getFeatures(PDM_SENSOR_ENTITY, "42", [PDM_SENSOR_FEATURE], { seed: { rows } });
    const f = feats[PDM_SENSOR_FEATURE] as {
      multivariateCount: number;
      tempCount: number;
      latestTemp: number | null;
      latestMultivariate: Record<string, number> | null;
    };
    expect(f.tempCount).toBe(2);
    expect(f.latestTemp).toBe(61);
    expect(f.multivariateCount).toBeGreaterThan(0);
    expect(f.latestMultivariate).toHaveProperty("vibration");
    expect(f.latestMultivariate).toHaveProperty("current");
  });
});

describe("featureStore — cache hit/miss/persist + invalidate (DB-guarded)", () => {
  it("miss → compute → persist → hit; invalidate evicts", async () => {
    const db = await getDb();
    if (!db) return; // no DB in this env — the pure paths above already cover the logic

    // Probe: is ml_feature_cache present + writable in this (cloned test) DB? If the
    // clone predates the g3 tables, soft-skip — the compute/contract logic above stands.
    try {
      await db.select().from(mlFeatureCache).limit(1);
    } catch {
      return;
    }

    const entityId = `test-emb-${Date.now()}`;
    const literal = "[0.5,0.25,0.125,0.0625]";
    await invalidate({ entityType: IMAGE_EMBEDDING_ENTITY, entityId });

    // 1st call: cache miss → compute (seeded) → persist
    const first = await getFeatures(IMAGE_EMBEDDING_ENTITY, entityId, [IMAGE_EMBEDDING_FEATURE], {
      seed: { embedding: literal, embeddingDim: 4, modelCode: "m", label: "OK" },
    });
    expect((first[IMAGE_EMBEDDING_FEATURE] as { embedding: number[] }).embedding).toEqual(
      parseVectorLiteral(literal),
    );

    // 2nd call WITHOUT seed: must hit the persisted cache row (no re-query needed)
    const second = await getFeatures(IMAGE_EMBEDDING_ENTITY, entityId, [IMAGE_EMBEDDING_FEATURE]);
    expect((second[IMAGE_EMBEDDING_FEATURE] as { embedding: number[] }).embedding).toEqual(
      parseVectorLiteral(literal),
    );

    // invalidate evicts at least the one row
    const evicted = await invalidate({ entityType: IMAGE_EMBEDDING_ENTITY, entityId });
    expect(evicted).toBeGreaterThanOrEqual(1);
  });
});

describe("featureStore — inference audit sampling", () => {
  beforeEach(() => {
    delete process.env.FEATURE_STORE_ENABLED;
    delete process.env.INFERENCE_AUDIT_SAMPLE_RATE;
  });

  it("no-op when the flag is off (unless forced)", async () => {
    const wrote = await recordInference({ modelName: "m", confidence: 0.9 });
    expect(wrote).toBe(false);
  });

  it("rate 0 → never writes even when enabled", async () => {
    process.env.FEATURE_STORE_ENABLED = "true";
    const wrote = await recordInference({ modelName: "m", confidence: 0.9 }, { sampleRate: 0 });
    expect(wrote).toBe(false);
  });

  it("deterministic rng gate: roll ≥ rate → skip", async () => {
    process.env.FEATURE_STORE_ENABLED = "true";
    // rate 0.3, rng returns 0.9 → 0.9 >= 0.3 → skip (no DB touched)
    const wrote = await recordInference({ modelName: "m", confidence: 0.9 }, { sampleRate: 0.3, rng: () => 0.9 });
    expect(wrote).toBe(false);
  });
});
