/**
 * W7-D (doc 27 gap V6) — aiInferenceEngine micro-batching integration tests.
 *
 * onnxruntime-node / sharp / db are mocked; a fake ONNX session records every
 * session.run so the tests can PROVE:
 *  - concurrent classification requests coalesce into ONE stacked [N,C,H,W] run
 *  - the public runInference API (per-request result shape) is unchanged
 *  - graphs that reject N>1 fall back to per-item runs and are remembered no-batch
 *  - per-item error isolation in the fallback path
 *  - detection stays N=1
 *  - AI_BATCH_MAX=1 disables coalescing
 *  - AI_GPU_CONCURRENCY caps concurrent session.run
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("onnxruntime-node", () => {
  class Tensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }
  return { Tensor, InferenceSession: { create: vi.fn() } };
});

vi.mock("sharp", () => ({
  default: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.resize = vi.fn(() => chain);
    chain.grayscale = vi.fn(() => chain);
    chain.removeAlpha = vi.fn(() => chain);
    chain.raw = vi.fn(() => chain);
    chain.toBuffer = vi.fn(async () => Buffer.alloc(8 * 8 * 3));
    return chain;
  }),
}));

vi.mock("../server/db/ai", () => ({
  getAiModelById: vi.fn(),
  createInferenceResult: vi.fn(async () => ({})),
}));

import fs from "fs";

const CLS_MODEL = {
  id: 1,
  code: "clf-test",
  currentVersion: "1.0",
  status: "ACTIVE",
  filePath: "/uploads/models/clf.onnx",
  preprocessConfig: { resize: { width: 8, height: 8 }, colorSpace: "RGB", channelFirst: true },
  inputShape: [1, 3, 8, 8],
  labels: ["ok", "ng"],
  postprocessConfig: { outputType: "classification", confidenceThreshold: 0, topK: 2 },
};

const DET_MODEL = {
  ...CLS_MODEL,
  id: 2,
  code: "det-test",
  postprocessConfig: { outputType: "detection", confidenceThreshold: 0.5 },
};

interface RunRecord { dims: number[] }

function makeSession(opts?: {
  failBatched?: boolean;
  failOnIndividualCall?: number; // 1-based index among N=1 calls
  delayMs?: number;
  onConcurrency?: (inFlight: number) => void;
}) {
  const runs: RunRecord[] = [];
  let individualCalls = 0;
  let inFlight = 0;
  const session = {
    inputNames: ["input"],
    outputNames: ["logits"],
    run: vi.fn(async (feeds: Record<string, { data: Float32Array; dims: number[] }>) => {
      const tensor = feeds.input;
      const N = tensor.dims[0];
      runs.push({ dims: [...tensor.dims] });
      inFlight++;
      opts?.onConcurrency?.(inFlight);
      try {
        if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts?.failBatched && N > 1) throw new Error("static batch dim: expected 1, got " + N);
        if (N === 1) {
          individualCalls++;
          if (opts?.failOnIndividualCall === individualCalls) throw new Error("individual run boom");
        }
        // logits [N,2] — item i gets [i, i+0.5] so splits are distinguishable
        const data = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) {
          data[i * 2] = 1;
          data[i * 2 + 1] = 0;
        }
        return { logits: { data, dims: [N, 2] } };
      } finally {
        inFlight--;
      }
    }),
  };
  return { session, runs };
}

async function loadEngine(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const ort = await import("onnxruntime-node");
  const dbAi = await import("../server/db/ai");
  const engine = await import("../server/services/aiInferenceEngine");
  return { ort, dbAi, engine };
}

const ENV_KEYS = ["AI_BATCH_MAX", "AI_BATCH_WINDOW_MS", "AI_GPU_CONCURRENCY", "AI_SESSION_CACHE_MAX", "AOI_DL_HEAD_ENABLED"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.AOI_DL_HEAD_ENABLED;
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

describe("micro-batching (classification)", () => {
  it("coalesces concurrent requests into ONE stacked [N,C,H,W] run — API unchanged", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "8", AI_BATCH_WINDOW_MS: "20", AI_GPU_CONCURRENCY: "2" });
    const { session, runs } = makeSession();
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => engine.runInference(1, Buffer.from("img"))),
    );

    // ONE session.run with the whole batch (5 ≤ batchMax 8, single window)
    expect(runs.length).toBe(1);
    expect(runs[0].dims).toEqual([5, 3, 8, 8]);

    // Public API preserved per request
    for (const r of results) {
      expect(r.status).toBe("COMPLETED");
      expect(r.modelCode).toBe("clf-test");
      expect(r.modelVersion).toBe("1.0");
      expect(r.topLabel).toBe("ok");
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(Array.isArray(r.predictions)).toBe(true);
      expect(typeof r.processingTimeMs).toBe("number");
    }
    // One inference_results row per request (side-effects unchanged)
    expect((dbAi.createInferenceResult as any).mock.calls.length).toBe(5);
  });

  it("batchMax reached flushes immediately without waiting for the window", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "3", AI_BATCH_WINDOW_MS: "10000" });
    const { session, runs } = makeSession();
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    const t0 = Date.now();
    await Promise.all(Array.from({ length: 3 }, () => engine.runInference(1, Buffer.from("img"))));
    expect(Date.now() - t0).toBeLessThan(5000); // did not wait the 10s window
    expect(runs.some((r) => r.dims[0] === 3)).toBe(true);
  });

  it("graph rejecting N>1 → per-item fallback succeeds, model remembered as no-batch", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "8", AI_BATCH_WINDOW_MS: "15" });
    const { session, runs } = makeSession({ failBatched: true });
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    const wave1 = await Promise.all(
      Array.from({ length: 4 }, () => engine.runInference(1, Buffer.from("img"))),
    );
    expect(wave1.every((r) => r.status === "COMPLETED")).toBe(true);
    // 1 failed batched attempt + 4 individual retries
    expect(runs.filter((r) => r.dims[0] > 1).length).toBe(1);
    expect(runs.filter((r) => r.dims[0] === 1).length).toBe(4);
    expect(engine.getMicroBatchStats().noBatchModels).toContain("1:1.0");

    // Wave 2: no stacked attempt anymore
    const before = runs.length;
    await Promise.all(Array.from({ length: 3 }, () => engine.runInference(1, Buffer.from("img"))));
    const newRuns = runs.slice(before);
    expect(newRuns.every((r) => r.dims[0] === 1)).toBe(true);
  });

  it("per-item error isolation: one failing item rejects ONLY its own request", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "8", AI_BATCH_WINDOW_MS: "15" });
    // Batched run fails → individual fallback; the 2nd individual run also fails.
    const { session } = makeSession({ failBatched: true, failOnIndividualCall: 2 });
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    const settled = await Promise.allSettled(
      Array.from({ length: 3 }, () => engine.runInference(1, Buffer.from("img"))),
    );
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1].status).toBe("rejected"); // order preserved → 2nd item failed
    expect(String((settled[1] as PromiseRejectedResult).reason.message)).toContain("individual run boom");
    expect(settled[2].status).toBe("fulfilled");

    // The failed request recorded a FAILED inference_results row (same as before V6)
    const failedRows = (dbAi.createInferenceResult as any).mock.calls.filter(
      (c: any[]) => c[0].status === "FAILED",
    );
    expect(failedRows.length).toBe(1);
  });

  it("AI_BATCH_MAX=1 disables coalescing (every request its own run)", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "1", AI_BATCH_WINDOW_MS: "15" });
    const { session, runs } = makeSession();
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    await Promise.all(Array.from({ length: 3 }, () => engine.runInference(1, Buffer.from("img"))));
    expect(runs.length).toBe(3);
    expect(runs.every((r) => r.dims[0] === 1)).toBe(true);
  });
});

describe("detection stays N=1", () => {
  it("never stacks detection models", async () => {
    const { ort, dbAi, engine } = await loadEngine({ AI_BATCH_MAX: "8", AI_BATCH_WINDOW_MS: "15" });
    const { runs } = makeSession();
    // Detection output shape [1, boxes, attrs] — give it a real detection tensor
    const detSession = {
      inputNames: ["input"],
      outputNames: ["det"],
      run: vi.fn(async (feeds: Record<string, { dims: number[] }>) => {
        runs.push({ dims: [...feeds.input.dims] });
        // one box row: cx,cy,w,h,obj + 2 class confs
        const data = new Float32Array([0.5, 0.5, 0.2, 0.2, 0.9, 0.8, 0.1]);
        return { det: { data, dims: [1, 1, 7] } };
      }),
    };
    (ort.InferenceSession.create as any).mockResolvedValue(detSession);
    (dbAi.getAiModelById as any).mockResolvedValue(DET_MODEL);

    const results = await Promise.all(
      Array.from({ length: 3 }, () => engine.runInference(2, Buffer.from("img"))),
    );
    expect(runs.length).toBe(3);
    expect(runs.every((r) => r.dims[0] === 1)).toBe(true);
    expect(results.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(results[0].predictions[0]?.box).toBeTruthy(); // detection shape intact
  });
});

describe("GPU concurrency semaphore", () => {
  it("caps concurrent session.run at AI_GPU_CONCURRENCY", async () => {
    let peak = 0;
    const { ort, dbAi, engine } = await loadEngine({
      AI_BATCH_MAX: "1", // force individual runs so the semaphore is the only limiter
      AI_GPU_CONCURRENCY: "2",
    });
    const { session } = makeSession({
      delayMs: 20,
      onConcurrency: (n) => { peak = Math.max(peak, n); },
    });
    (ort.InferenceSession.create as any).mockResolvedValue(session);
    (dbAi.getAiModelById as any).mockResolvedValue(CLS_MODEL);

    await Promise.all(Array.from({ length: 6 }, () => engine.runInference(1, Buffer.from("img"))));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });
});
