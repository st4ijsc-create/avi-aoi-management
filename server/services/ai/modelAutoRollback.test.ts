/**
 * I2-b — Model auto-rollback tests (pure decision core + version-picking helpers).
 * No DB: exercises evaluateRollback / baselineAccuracyOf / pickRollbackTarget and
 * the flag helper. The DB-backed runRollbackForModel is covered indirectly by the
 * pure decision it delegates to.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateRollback,
  baselineAccuracyOf,
  pickRollbackTarget,
  isModelAutoRollbackEnabled,
} from "./modelAutoRollback";
import type { ModelVersion } from "../../../drizzle/schema";

function ver(partial: Partial<ModelVersion>): ModelVersion {
  return {
    id: 1, modelId: 1, version: "1.0.0", filePath: null, fileKey: null, fileSize: null,
    fileHash: null, changeLog: null, metrics: null, accuracy: null, status: "READY",
    datasetId: null, baselineVersionId: null, evalReport: null, createdBy: null,
    createdAt: new Date("2026-01-01"), ...partial,
  } as ModelVersion;
}

describe("evaluateRollback", () => {
  it("rolls back when live accuracy drops beyond the threshold", () => {
    const d = evaluateRollback(0.95, { liveAccuracy: 0.85, driftScore: 0 }, { accDrop: 0.05, drift: 0.25 });
    expect(d.shouldRollback).toBe(true);
    expect(d.trigger).toBe("auto_accuracy");
    expect(d.accuracyDelta).toBeCloseTo(-0.1, 4);
  });

  it("rolls back on high drift regardless of accuracy", () => {
    const d = evaluateRollback(0.95, { liveAccuracy: 0.95, driftScore: 0.4 }, { accDrop: 0.05, drift: 0.25 });
    expect(d.shouldRollback).toBe(true);
    expect(d.trigger).toBe("auto_drift");
  });

  it("no-ops when healthy (accuracy within tolerance, low drift)", () => {
    const d = evaluateRollback(0.95, { liveAccuracy: 0.93, driftScore: 0.05 }, { accDrop: 0.05, drift: 0.25 });
    expect(d.shouldRollback).toBe(false);
    expect(d.trigger).toBeNull();
  });

  it("no-ops (honest) with no baseline — nothing to compare", () => {
    const d = evaluateRollback(null, { liveAccuracy: 0.5, driftScore: 0.05 });
    expect(d.shouldRollback).toBe(false);
    expect(d.reason).toMatch(/no eval baseline/i);
  });

  it("no-ops (honest) with no live signal — no feedback", () => {
    const d = evaluateRollback(0.95, { liveAccuracy: null, driftScore: null });
    expect(d.shouldRollback).toBe(false);
    expect(d.reason).toMatch(/no live accuracy signal/i);
  });
});

describe("baselineAccuracyOf", () => {
  it("prefers metrics.accuracy (0..1)", () => {
    expect(baselineAccuracyOf(ver({ metrics: { accuracy: 0.9 } }))).toBe(0.9);
  });
  it("falls back to evalReport.candidate.accuracy", () => {
    expect(baselineAccuracyOf(ver({ evalReport: { candidate: { accuracy: 0.88 } } as any }))).toBe(0.88);
  });
  it("falls back to accuracy column (0..100 pct → fraction)", () => {
    expect(baselineAccuracyOf(ver({ accuracy: "92.50" as any }))).toBeCloseTo(0.925, 4);
  });
  it("returns null when nothing usable", () => {
    expect(baselineAccuracyOf(ver({}))).toBeNull();
    expect(baselineAccuracyOf(null)).toBeNull();
  });
});

describe("pickRollbackTarget", () => {
  it("picks the most-recent prior stable version with a baseline", () => {
    const active = ver({ id: 3, version: "3.0.0", status: "ACTIVE", metrics: { accuracy: 0.8 }, createdAt: new Date("2026-03-01") });
    const older = ver({ id: 2, version: "2.0.0", status: "INACTIVE", metrics: { accuracy: 0.94 }, createdAt: new Date("2026-02-01") });
    const oldest = ver({ id: 1, version: "1.0.0", status: "INACTIVE", metrics: { accuracy: 0.9 }, createdAt: new Date("2026-01-01") });
    const target = pickRollbackTarget([active, older, oldest], active.id);
    expect(target?.id).toBe(2); // most recent non-active with a baseline
  });

  it("returns null when there is no prior stable version with a baseline", () => {
    const active = ver({ id: 3, status: "ACTIVE", metrics: { accuracy: 0.8 } });
    const draftNoBaseline = ver({ id: 2, status: "UPLOADING" }); // not stable, no baseline
    expect(pickRollbackTarget([active, draftNoBaseline], active.id)).toBeNull();
  });
});

describe("flag helper", () => {
  const prev = process.env.AI_MODEL_AUTOROLLBACK_ENABLED;
  afterEach(() => { process.env.AI_MODEL_AUTOROLLBACK_ENABLED = prev; });
  it("reflects env", () => {
    process.env.AI_MODEL_AUTOROLLBACK_ENABLED = "false";
    expect(isModelAutoRollbackEnabled()).toBe(false);
    process.env.AI_MODEL_AUTOROLLBACK_ENABLED = "true";
    expect(isModelAutoRollbackEnabled()).toBe(true);
  });
});
