/**
 * W5-B2 (doc 44 G4.16) — vision-inference-p95 SLO feed.
 *   • flag OFF (default) → record is a NO-OP, observation stays null (bit-compat),
 *   • flag ON → rolling-window (good=≤threshold, total) measured from real samples,
 *   • threshold honors VISION_SLO_P95_MS,
 *   • registered provider drives the sloAlerting evaluator for `vision-inference-p95`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordVisionInferenceLatency,
  visionInferenceSloObservation,
  currentVisionP95Ms,
  visionSloThresholdMs,
  isVisionSloObserveEnabled,
  _resetVisionInferenceSloForTests,
} from "./visionInferenceSlo";
import {
  registerSloObservationProvider,
  evaluateAllOnce,
  getSloSnapshot,
  _resetSloAlerting,
} from "../observability/sloAlerting";

const KEYS = ["VISION_SLO_OBSERVE_ENABLED", "VISION_SLO_P95_MS", "OBSERVABILITY"];
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  _resetVisionInferenceSloForTests();
  _resetSloAlerting();
});
afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k]!;
  }
  _resetVisionInferenceSloForTests();
  _resetSloAlerting();
});

describe("flag OFF (default) — bit-compat no-op", () => {
  it("record is a no-op; observation stays null", () => {
    delete process.env.VISION_SLO_OBSERVE_ENABLED;
    expect(isVisionSloObserveEnabled()).toBe(false);
    for (let i = 0; i < 10; i++) recordVisionInferenceLatency(50);
    expect(visionInferenceSloObservation()).toBeNull();
    expect(currentVisionP95Ms()).toBeNull();
  });
});

describe("flag ON — real measurement", () => {
  beforeEach(() => {
    process.env.VISION_SLO_OBSERVE_ENABLED = "true";
  });

  it("counts good = latency ≤ threshold; total = all", () => {
    // 8 fast (≤200) + 2 slow (>200)
    for (let i = 0; i < 8; i++) recordVisionInferenceLatency(120);
    recordVisionInferenceLatency(500);
    recordVisionInferenceLatency(650);
    const obs = visionInferenceSloObservation();
    expect(obs).not.toBeNull();
    expect(obs!.long.total).toBe(10);
    expect(obs!.long.good).toBe(8);
    expect(currentVisionP95Ms()).toBeGreaterThan(0);
  });

  it("threshold honors VISION_SLO_P95_MS override", () => {
    process.env.VISION_SLO_P95_MS = "100";
    expect(visionSloThresholdMs()).toBe(100);
    recordVisionInferenceLatency(120); // now OVER the 100ms budget
    recordVisionInferenceLatency(80); // under
    const obs = visionInferenceSloObservation();
    expect(obs!.long.total).toBe(2);
    expect(obs!.long.good).toBe(1);
  });

  it("registered provider drives the sloAlerting evaluator", () => {
    for (let i = 0; i < 8; i++) recordVisionInferenceLatency(120);
    recordVisionInferenceLatency(500);
    recordVisionInferenceLatency(650);
    // Register the real feed and sweep the catalogue.
    registerSloObservationProvider("vision-inference-p95", visionInferenceSloObservation);
    evaluateAllOnce();
    const snap = getSloSnapshot().find((s) => s.sloId === "vision-inference-p95");
    expect(snap).toBeTruthy();
    expect(snap!.status).not.toBeNull();
    expect(snap!.status!.sli).toBeCloseTo(0.8, 5); // 8/10 under threshold
    expect(snap!.evaluatedAt).not.toBeNull();
  });
});
