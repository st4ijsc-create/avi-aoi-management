/**
 * doc 69 Wave 6 (F1), servability + multi-classifier fixed in the F1 review —
 * "no active classifier" health signal.
 *
 * checkActiveClassifierHealth is exercised fully injected (no DB/fs touched):
 * false + reason when nothing is ACTIVE, true when a real classifier is ACTIVE,
 * false when the ACTIVE model is registered but NOT servable by
 * aiInferenceEngine.runInference (an embedding-head with the flag off, OR a
 * plain CUSTOM artifact that isn't a head at all), true/false aggregated
 * correctly across MULTIPLE active classifier rows, and fail-safe (never
 * fabricates "healthy") on a lookup error.
 */
import { describe, it, expect, vi } from "vitest";
import { checkActiveClassifierHealth } from "./aiClassifierHealth";
import { HEAD_KIND } from "./ai/embeddingHead";
import type { AiModel } from "../../drizzle/schema";

describe("checkActiveClassifierHealth", () => {
  it("reports hasActiveClassifier:false with an honest reason when nothing is ACTIVE", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => []),
      seededHeadExists: () => false,
    });
    expect(res.hasActiveClassifier).toBe(false);
    expect(res.reason).toMatch(/inert/i);
    expect(res.checkedAt).toBeTruthy();
  });

  it("mentions the seeded DINOv2 head artifact when present but not yet registered/activated", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => []),
      seededHeadExists: () => true,
    });
    expect(res.hasActiveClassifier).toBe(false);
    expect(res.reason).toMatch(/seeded/i);
  });

  it("reports hasActiveClassifier:true when a real (non-head) classifier is ACTIVE", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => [
        { id: 7, code: "defect-clf", currentVersion: "1.0.0", format: "ONNX", metadata: null } as AiModel,
      ]),
      seededHeadExists: () => false,
    });
    expect(res.hasActiveClassifier).toBe(true);
    expect(res.activeModelId).toBe(7);
    expect(res.activeModelCode).toBe("defect-clf");
  });

  it("reports false when the ACTIVE model is a head but AOI_DL_HEAD_ENABLED is off (registry ≠ serving)", async () => {
    const prev = process.env.AOI_DL_HEAD_ENABLED;
    delete process.env.AOI_DL_HEAD_ENABLED;
    try {
      const res = await checkActiveClassifierHealth({
        listActiveClassifierModels: vi.fn(async () => [
          {
            id: 9, code: "aoi-defect-head-dinov2", currentVersion: "1.0.0", format: "CUSTOM",
            metadata: { headKind: HEAD_KIND },
          } as unknown as AiModel,
        ]),
        seededHeadExists: () => false,
      });
      expect(res.hasActiveClassifier).toBe(false);
      expect(res.reason).toMatch(/AOI_DL_HEAD_ENABLED/);
    } finally {
      if (prev !== undefined) process.env.AOI_DL_HEAD_ENABLED = prev;
    }
  });

  it("reports true when the ACTIVE model is a head AND AOI_DL_HEAD_ENABLED is on", async () => {
    const prev = process.env.AOI_DL_HEAD_ENABLED;
    process.env.AOI_DL_HEAD_ENABLED = "true";
    try {
      const res = await checkActiveClassifierHealth({
        listActiveClassifierModels: vi.fn(async () => [
          {
            id: 9, code: "aoi-defect-head-dinov2", currentVersion: "1.0.0", format: "CUSTOM",
            metadata: { headKind: HEAD_KIND },
          } as unknown as AiModel,
        ]),
        seededHeadExists: () => false,
      });
      expect(res.hasActiveClassifier).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AOI_DL_HEAD_ENABLED;
      else process.env.AOI_DL_HEAD_ENABLED = prev;
    }
  });

  it("F1-review FIX 2: reports false when the ACTIVE model is a CUSTOM artifact that is NOT an embedding-head (e.g. a plain few-shot/transfer classifier) — registered ≠ servable", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => [
        { id: 11, code: "old-fewshot-clf", currentVersion: "1.0.0", format: "CUSTOM", metadata: { bootstrapKind: "bootstrap_fewshot_local" } } as unknown as AiModel,
      ]),
      seededHeadExists: () => false,
    });
    expect(res.hasActiveClassifier).toBe(false);
    expect(res.reason).toMatch(/runInference can dispatch/);
    expect(res.activeModelCode).toBe("old-fewshot-clf");
  });

  it("F1-review FIX 3: with MULTIPLE active classifier rows, reports true and surfaces the SERVABLE one even if it isn't first", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => [
        { id: 11, code: "stale-fewshot-clf", currentVersion: "1.0.0", format: "CUSTOM", metadata: null } as unknown as AiModel,
        { id: 12, code: "real-onnx-clf", currentVersion: "2.0.0", format: "ONNX", metadata: null } as unknown as AiModel,
      ]),
      seededHeadExists: () => false,
    });
    expect(res.hasActiveClassifier).toBe(true);
    expect(res.activeModelId).toBe(12);
    expect(res.activeModelCode).toBe("real-onnx-clf");
    expect(res.reason).toMatch(/other ACTIVE/);
  });

  it("F1-review FIX 3: with MULTIPLE active classifier rows and NONE servable, reports false with an aggregate reason (not just the first row's)", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => [
        { id: 11, code: "stale-fewshot-clf", currentVersion: "1.0.0", format: "CUSTOM", metadata: null } as unknown as AiModel,
        { id: 12, code: "another-fewshot-clf", currentVersion: "1.0.0", format: "CUSTOM", metadata: { bootstrapKind: "bootstrap_fewshot_local" } } as unknown as AiModel,
      ]),
      seededHeadExists: () => false,
    });
    expect(res.hasActiveClassifier).toBe(false);
    expect(res.reason).toMatch(/2 ACTIVE defect-classifier/);
    expect(res.reason).toMatch(/stale-fewshot-clf/);
    expect(res.reason).toMatch(/another-fewshot-clf/);
  });

  it("is fail-safe: a lookup error reports false, never fabricates a healthy state", async () => {
    const res = await checkActiveClassifierHealth({
      listActiveClassifierModels: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(res.hasActiveClassifier).toBe(false);
    expect(res.reason).toMatch(/db down/);
  });
});
