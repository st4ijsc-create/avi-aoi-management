/**
 * doc69/W0-B — unit tests for `runAnomalyAndEscalation`'s routing of the
 * auto-generated VLM defect description into `measurement_results.aiAnalysisResult`
 * (Bug 2: previously the description was written ONLY into
 * `ai_image_embeddings.metadata.anomaly.visionDescription`, which Repair Station's
 * "Sparkles" panel never reads — it reads `measurement_results.aiAnalysisResult`).
 *
 * Proves:
 *  - a fresh (empty) aiAnalysisResult is UPDATED with the vision description, tagged
 *    `source:"vision-escalation"` (provenance) and a `description` key (the shape
 *    RepairStation.tsx's vlmSummary() looks for first).
 *  - a pre-existing non-empty aiAnalysisResult (a MANUAL analyzeWithAI result) is
 *    NEVER clobbered — the conditional UPDATE guard blocks the write.
 *  - a DB error (generic, or a wrapped missing-column/table error — the cause-walking
 *    shape drizzle-orm ≥0.44 actually produces) never throws out of the worker.
 *  - no visionDescription (VL didn't escalate / sidecar unavailable) → no write attempted.
 *
 * The DB, GGUF/vision sidecar, ROI crop and event bus are all mocked — no live model/DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Anomaly scoring + VL escalation gate (server/services/aiAnomalyDetection.ts). ──
const scoreImage = vi.fn(async () => ({
  score: 0.9,
  isAnomaly: true,
  threshold: 0.5,
  source: "onnx" as const,
  degraded: false,
  bankSize: 100,
  k: 5,
  reason: undefined as string | undefined,
}));
const shouldEscalateToVision = vi.fn(() => ({
  escalate: true,
  reason: "ng_classified",
  suspectThreshold: 0.5,
}));
vi.mock("./aiAnomalyDetection", () => ({
  scoreImage: (...a: unknown[]) => scoreImage(...(a as [])),
  shouldEscalateToVision: (...a: unknown[]) => shouldEscalateToVision(...(a as [])),
}));

// ── VL sidecar (Qwen3-VL) — describes the defect. ──
const isVisionSidecarAvailable = vi.fn(() => true);
const describeImageViaSidecar = vi.fn(async () => ({
  text: "Scratch visible on the top-left corner.",
  tokensGenerated: 10,
  tokensPrompt: 5,
  totalTimeMs: 100,
  tokensPerSecond: 10,
  modelId: "qwen3-vl",
}));
vi.mock("./llamaVisionSidecar", () => ({
  isVisionSidecarAvailable: () => isVisionSidecarAvailable(),
  describeImageViaSidecar: (...a: unknown[]) => describeImageViaSidecar(...(a as [])),
}));

// ── ROI crop (pre-VL) — pass the buffer through untouched. ──
const cropToRoiForVision = vi.fn(async (buf: Buffer) => ({ buffer: buf, cropped: false, roi: null }));
vi.mock("./aiAdvancedVision", () => ({
  cropToRoiForVision: (...a: unknown[]) => cropToRoiForVision(...(a as [Buffer])),
}));

// ── Ecosystem event bus (best-effort, unrelated to this bug — no-op spy). ──
const publishAnomalyDetected = vi.fn();
vi.mock("./ecosystem/ecosystemEvents", () => ({
  publishAnomalyDetected: (...a: unknown[]) => publishAnomalyDetected(...(a as [])),
}));

// ── Fake DB, table-marker routed (mirrors aiActionInbox.test.ts's style), PLUS a real
//    predicate evaluator for the measurement_results conditional UPDATE so the no-clobber
//    guard is genuinely exercised (not just "was update called"). ──
interface Pred {
  __op: "eq" | "and" | "or" | "isNull";
  col?: { __col: string };
  val?: unknown;
  preds?: Pred[];
}

function evalPred(pred: Pred | undefined, row: Record<string, unknown>): boolean {
  if (!pred) return true;
  switch (pred.__op) {
    case "eq":
      return row[pred.col!.__col] === pred.val;
    case "isNull":
      return row[pred.col!.__col] == null;
    case "and":
      return pred.preds!.every((p) => evalPred(p, row));
    case "or":
      return pred.preds!.some((p) => evalPred(p, row));
    default:
      return true;
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, val: unknown): Pred => ({ __op: "eq", col, val }),
  and: (...preds: Pred[]): Pred => ({ __op: "and", preds }),
  or: (...preds: Pred[]): Pred => ({ __op: "or", preds }),
  isNull: (col: { __col: string }): Pred => ({ __op: "isNull", col }),
  isNotNull: () => ({ __op: "isNotNull" }) as unknown as Pred,
  inArray: () => ({ __op: "inArray" }) as unknown as Pred,
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({ __op: "sql" }),
    {},
  ),
}));

vi.mock("../../drizzle/schema", () => ({
  measurementResults: {
    __table: "measurementResults",
    id: { __col: "id" },
    aiAnalysisResult: { __col: "aiAnalysisResult" },
    inspectionId: { __col: "inspectionId" },
    imageUrl: { __col: "imageUrl" },
    result: { __col: "result" },
  },
  productInspections: {
    __table: "productInspections",
    id: { __col: "id" },
    machineId: { __col: "machineId" },
    productModelId: { __col: "productModelId" },
  },
  aiImageEmbeddings: {
    __table: "aiImageEmbeddings",
    id: { __col: "id" },
    metadata: { __col: "metadata" },
    measurementResultId: { __col: "measurementResultId" },
    modelCode: { __col: "modelCode" },
  },
}));

let embeddingRow: { metadata: unknown } | null = { metadata: null }; // idempotency-check read
let mrRow: { id: number; aiAnalysisResult: string | null } | null = null;
const executeCalls: unknown[] = [];
const updateCalls: Array<{ table: string; patch: Record<string, unknown>; applied: boolean }> = [];

function makeFakeDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (t: { __table: string }) => ({
        where: (_pred: Pred) => ({
          limit: async (_n: number) => {
            if (t.__table === "aiImageEmbeddings") return embeddingRow ? [embeddingRow] : [];
            return [];
          },
        }),
      }),
    }),
    update: (t: { __table: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (pred: Pred) => {
          let applied = false;
          if (t.__table === "measurementResults" && mrRow && evalPred(pred, mrRow as unknown as Record<string, unknown>)) {
            mrRow = { ...mrRow, ...(patch as { aiAnalysisResult?: string }) };
            applied = true;
          }
          updateCalls.push({ table: t.__table, patch, applied });
          return { rowCount: applied ? 1 : 0 };
        },
      }),
    }),
    execute: async (q: unknown) => {
      executeCalls.push(q);
      return [];
    },
  };
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

import { runAnomalyAndEscalation } from "./aoiImageEmbeddingWorker";

const BASE_PARAMS = {
  embeddingId: 1,
  measurementResultId: 42,
  buffer: Buffer.from("fake-image-bytes"),
  classification: "NG",
  machineId: 7,
  productModelId: 3,
  modelId: 9,
};

beforeEach(() => {
  vi.clearAllMocks();
  embeddingRow = { metadata: null };
  mrRow = { id: 42, aiAnalysisResult: null };
  executeCalls.length = 0;
  updateCalls.length = 0;
  scoreImage.mockResolvedValue({
    score: 0.9,
    isAnomaly: true,
    threshold: 0.5,
    source: "onnx",
    degraded: false,
    bankSize: 100,
    k: 5,
    reason: undefined,
  });
  shouldEscalateToVision.mockReturnValue({ escalate: true, reason: "ng_classified", suspectThreshold: 0.5 });
  isVisionSidecarAvailable.mockReturnValue(true);
  describeImageViaSidecar.mockResolvedValue({
    text: "Scratch visible on the top-left corner.",
    tokensGenerated: 10,
    tokensPrompt: 5,
    totalTimeMs: 100,
    tokensPerSecond: 10,
    modelId: "qwen3-vl",
  });
});

describe("runAnomalyAndEscalation — routes visionDescription to measurement_results.aiAnalysisResult", () => {
  it("UPDATEs aiAnalysisResult with the description (source-tagged) when the cell is empty", async () => {
    mrRow = { id: 42, aiAnalysisResult: null };

    await runAnomalyAndEscalation(BASE_PARAMS);

    expect(mrRow?.aiAnalysisResult).toBeTruthy();
    const parsed = JSON.parse(mrRow!.aiAnalysisResult!);
    expect(parsed.description).toBe("Scratch visible on the top-left corner.");
    expect(parsed.source).toBe("vision-escalation");
    expect(parsed.isAnomaly).toBe(true);

    const mrUpdates = updateCalls.filter((u) => u.table === "measurementResults");
    expect(mrUpdates).toHaveLength(1);
    expect(mrUpdates[0].applied).toBe(true);
  });

  it("does NOT clobber an existing non-empty aiAnalysisResult (a prior MANUAL analyzeWithAI result)", async () => {
    const manual = JSON.stringify({ assessment: "OK", defects: [], confidence: 92, recommendations: "none" });
    mrRow = { id: 42, aiAnalysisResult: manual };

    await runAnomalyAndEscalation(BASE_PARAMS);

    // Unchanged — still the manual analysis, byte-for-byte.
    expect(mrRow?.aiAnalysisResult).toBe(manual);
    const mrUpdates = updateCalls.filter((u) => u.table === "measurementResults");
    expect(mrUpdates).toHaveLength(1);
    expect(mrUpdates[0].applied).toBe(false); // guard blocked the write.
  });

  it("empty-string aiAnalysisResult also counts as empty (write proceeds)", async () => {
    mrRow = { id: 42, aiAnalysisResult: "" };

    await runAnomalyAndEscalation(BASE_PARAMS);

    expect(mrRow?.aiAnalysisResult).not.toBe("");
    const mrUpdates = updateCalls.filter((u) => u.table === "measurementResults");
    expect(mrUpdates[0].applied).toBe(true);
  });

  it("no visionDescription (VL did not escalate) → no write attempted, worker still completes", async () => {
    shouldEscalateToVision.mockReturnValue({ escalate: false, reason: "below_threshold", suspectThreshold: 0.5 });
    mrRow = { id: 42, aiAnalysisResult: null };

    await expect(runAnomalyAndEscalation(BASE_PARAMS)).resolves.toBeUndefined();

    expect(mrRow?.aiAnalysisResult).toBeNull();
    expect(updateCalls.filter((u) => u.table === "measurementResults")).toHaveLength(0);
  });

  it("a generic DB error on the write → worker still completes (no throw), row left untouched", async () => {
    mrRow = { id: 42, aiAnalysisResult: null };
    const { getDb } = await import("../db/connection");
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...makeFakeDb(),
      update: () => ({
        set: () => ({
          where: async () => {
            throw new Error("connection refused");
          },
        }),
      }),
    });

    await expect(runAnomalyAndEscalation(BASE_PARAMS)).resolves.toBeUndefined();
    expect(mrRow?.aiAnalysisResult).toBeNull();
  });

  it("a wrapped missing-column error (drizzle-orm cause-chain shape) on the write → worker still completes (no throw)", async () => {
    mrRow = { id: 42, aiAnalysisResult: null };
    const wrapped = new Error('Failed query: update "measurement_results" set "aiAnalysisResult" = $1 where "id" = $2');
    (wrapped as Error & { cause: unknown }).cause = Object.assign(
      new Error('column "aiAnalysisResult" of relation "measurement_results" does not exist'),
      { code: "42703" },
    );
    const { getDb } = await import("../db/connection");
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...makeFakeDb(),
      update: () => ({
        set: () => ({
          where: async () => {
            throw wrapped;
          },
        }),
      }),
    });

    await expect(runAnomalyAndEscalation(BASE_PARAMS)).resolves.toBeUndefined();
    expect(mrRow?.aiAnalysisResult).toBeNull();
  });
});
