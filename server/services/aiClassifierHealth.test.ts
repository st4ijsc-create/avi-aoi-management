/**
 * doc 69 Wave 6 (F1) — "no active classifier" health signal.
 *
 * checkActiveClassifierHealth is exercised fully injected (no DB/fs touched):
 * false + reason when nothing is ACTIVE, true when a real classifier is ACTIVE,
 * and fail-safe (never fabricates "healthy") on a lookup error.
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
