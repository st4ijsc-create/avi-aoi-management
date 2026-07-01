/**
 * doc 22 P2 — Model performance snapshot producer tests.
 *
 * SAFETY INVARIANTS proven here:
 *  - aggregatePerformance (PURE): groups by (model, version), computes live accuracy
 *    (correct / evaluated), excludes UNSURE from accuracy, and returns null accuracy
 *    when nothing is evaluated (never fabricates a metric). Confidence histogram is
 *    normalized.
 *  - The flag helper reflects env; the sweep is a NO-OP (enabled:false, written:0)
 *    when AI_MODEL_PERF_SNAPSHOTS_ENABLED is off — no DB touched.
 *  - With the flag on but no DB, the sweep degrades to written:0 (never throws).
 *
 * The pure core needs no mocks; the sweep tests stub getDb.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import {
  aggregatePerformance,
  isModelPerfSnapshotsEnabled,
  runPerfSnapshotSweep,
  type FeedbackDatum,
} from "./modelPerfSnapshotProducer";

function fb(partial: Partial<FeedbackDatum>): FeedbackDatum {
  return { modelName: "m-onnx", modelVersion: "1.0.0", feedbackType: "CORRECT", confidence: 0.9, ...partial };
}

describe("aggregatePerformance (pure)", () => {
  it("computes accuracy = correct / evaluated per (model, version)", () => {
    const data = [
      fb({ feedbackType: "CORRECT" }),
      fb({ feedbackType: "CORRECT" }),
      fb({ feedbackType: "INCORRECT" }),
      fb({ feedbackType: "PARTIAL" }), // evaluated-but-wrong (conservative)
    ];
    const [agg] = aggregatePerformance(data);
    expect(agg.modelName).toBe("m-onnx");
    expect(agg.evaluated).toBe(4);
    expect(agg.correct).toBe(2);
    expect(agg.accuracy).toBeCloseTo(0.5, 6);
  });

  it("excludes UNSURE from accuracy (evaluated count)", () => {
    const data = [fb({ feedbackType: "CORRECT" }), fb({ feedbackType: "UNSURE" })];
    const [agg] = aggregatePerformance(data);
    expect(agg.total).toBe(2);
    expect(agg.evaluated).toBe(1);
    expect(agg.accuracy).toBe(1);
  });

  it("returns null accuracy when nothing is evaluated (no fabrication)", () => {
    const data = [fb({ feedbackType: "UNSURE" }), fb({ feedbackType: "UNSURE" })];
    const [agg] = aggregatePerformance(data);
    expect(agg.evaluated).toBe(0);
    expect(agg.accuracy).toBeNull();
  });

  it("splits distinct model versions into separate aggregates", () => {
    const data = [
      fb({ modelVersion: "1.0.0", feedbackType: "CORRECT" }),
      fb({ modelVersion: "2.0.0", feedbackType: "INCORRECT" }),
    ];
    const out = aggregatePerformance(data).sort((a, b) => a.modelVersion.localeCompare(b.modelVersion));
    expect(out).toHaveLength(2);
    expect(out[0].accuracy).toBe(1);
    expect(out[1].accuracy).toBe(0);
  });

  it("normalizes the confidence histogram to sum ~1", () => {
    const data = [fb({ confidence: 0.05 }), fb({ confidence: 0.55 }), fb({ confidence: 0.95 })];
    const [agg] = aggregatePerformance(data);
    const sum = Object.values(agg.confidenceDistribution).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(agg.avgConfidence).toBeCloseTo((0.05 + 0.55 + 0.95) / 3, 6);
  });

  it("skips rows missing model name/version", () => {
    const data = [fb({ modelName: "" }), fb({ modelVersion: "" }), fb({})];
    expect(aggregatePerformance(data)).toHaveLength(1);
  });
});

describe("flag helper + sweep no-op", () => {
  const prev = process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED;
  afterEach(() => { process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED = prev; });

  it("reflects env", () => {
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED = "false";
    expect(isModelPerfSnapshotsEnabled()).toBe(false);
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED = "true";
    expect(isModelPerfSnapshotsEnabled()).toBe(true);
  });

  it("sweep is a NO-OP (enabled:false, written:0) when the flag is off", async () => {
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED = "false";
    const r = await runPerfSnapshotSweep();
    expect(r.enabled).toBe(false);
    expect(r.written).toBe(0);
  });

  it("sweep with flag ON but no DB → written:0, never throws", async () => {
    process.env.AI_MODEL_PERF_SNAPSHOTS_ENABLED = "true";
    const r = await runPerfSnapshotSweep();
    expect(r.enabled).toBe(true);
    expect(r.written).toBe(0);
  });
});
