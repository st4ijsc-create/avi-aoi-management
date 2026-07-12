// WD-1 (doc 31 Đợt D · UX1) — unit tests for the PURE product-onboarding step
// logic (no React / no network). Mirrors aoiWizardState.unit.test.ts.
import { describe, it, expect } from "vitest";
import {
  PRODUCT_ONBOARDING_STEPS,
  REVIEW_STEP_INDEX,
  pointHasLimits,
  deriveStepStatuses,
  mergeStepStatus,
  computeReadiness,
  requiredIncompleteSteps,
  type OnboardingReadinessInput,
} from "./types";

const EMPTY: OnboardingReadinessInput = {
  hasProduct: false,
  hasImageDims: false,
  fiducialCount: 0,
  pointCount: 0,
  pointsWithLimits: 0,
  goldenCount: 0,
  panelCount: 0,
  releaseCount: 0,
  mappingCount: 0,
};

describe("step model", () => {
  it("has 9 steps ending in review", () => {
    expect(PRODUCT_ONBOARDING_STEPS).toHaveLength(9);
    expect(PRODUCT_ONBOARDING_STEPS[0].key).toBe("product");
    expect(PRODUCT_ONBOARDING_STEPS[REVIEW_STEP_INDEX].key).toBe("review");
  });
  it("marks golden + panel as the only optional steps", () => {
    const optional = PRODUCT_ONBOARDING_STEPS.filter((s) => s.optional).map((s) => s.key);
    expect(optional.sort()).toEqual(["golden", "panel"]);
  });
});

describe("pointHasLimits", () => {
  it("requires BOTH lower and upper", () => {
    expect(pointHasLimits({ lowerLimit: "1", upperLimit: "2" })).toBe(true);
    expect(pointHasLimits({ lowerLimit: "1" })).toBe(false);
    expect(pointHasLimits({ lowerLimit: null, upperLimit: "2" })).toBe(false);
    expect(pointHasLimits({ lowerLimit: "", upperLimit: "" })).toBe(false);
  });
});

describe("deriveStepStatuses", () => {
  it("all todo when nothing configured", () => {
    const s = deriveStepStatuses(EMPTY);
    expect(s.product).toBe("todo");
    expect(s.fiducials).toBe("todo");
    expect(s.thresholds).toBe("todo");
  });
  it("thresholds done ONLY when every point has limits", () => {
    const partial = deriveStepStatuses({ ...EMPTY, pointCount: 10, pointsWithLimits: 4 });
    expect(partial.points).toBe("done");
    expect(partial.thresholds).toBe("todo"); // 4/10 → not done
    const full = deriveStepStatuses({ ...EMPTY, pointCount: 10, pointsWithLimits: 10 });
    expect(full.thresholds).toBe("done");
  });
});

describe("mergeStepStatus", () => {
  it("data 'done' beats a stale manual 'skipped'", () => {
    expect(mergeStepStatus("points", "done", { status: "skipped" })).toBe("done");
  });
  it("honors an explicit skip on an optional step with no data", () => {
    expect(mergeStepStatus("golden", "todo", { status: "skipped" })).toBe("skipped");
  });
  it("falls back to todo with no data and no mark", () => {
    expect(mergeStepStatus("panel", "todo", undefined)).toBe("todo");
  });
});

describe("computeReadiness", () => {
  it("0% when empty; required total excludes optional + review", () => {
    const r = computeReadiness(EMPTY);
    expect(r.percent).toBe(0);
    expect(r.limitPct).toBe(0);
    // 8 scored steps, 6 required (product, fiducials, points, thresholds, release, mapping)
    expect(r.requiredTotal).toBe(6);
    expect(r.requiredComplete).toBe(0);
  });
  it("computes limit percentage + progresses as config lands", () => {
    const r = computeReadiness({
      ...EMPTY,
      hasProduct: true,
      fiducialCount: 3,
      pointCount: 20,
      pointsWithLimits: 10,
      mappingCount: 1,
    });
    expect(r.limitPct).toBe(50);
    // done: product, fiducials, points, mapping = 4 of 8 scored → 50%
    expect(r.percent).toBe(50);
    // required-done: product, fiducials, points, mapping = 4 of 6
    expect(r.requiredComplete).toBe(4);
  });
});

describe("requiredIncompleteSteps (Finish guard)", () => {
  it("lists all 6 required steps when nothing is configured", () => {
    const missing = requiredIncompleteSteps(deriveStepStatuses(EMPTY), {});
    expect(missing.sort()).toEqual(
      ["fiducials", "mapping", "points", "product", "release", "thresholds"].sort(),
    );
  });
  it("excludes optional steps + never lists review", () => {
    const missing = requiredIncompleteSteps(deriveStepStatuses(EMPTY), {});
    expect(missing).not.toContain("golden");
    expect(missing).not.toContain("panel");
    expect(missing).not.toContain("review");
  });
  it("is empty once every required step has real data", () => {
    const full = deriveStepStatuses({
      ...EMPTY,
      hasProduct: true,
      fiducialCount: 2,
      pointCount: 5,
      pointsWithLimits: 5,
      releaseCount: 1,
      mappingCount: 1,
    });
    expect(requiredIncompleteSteps(full, {})).toEqual([]);
  });
  it("a skip mark never satisfies a required step (only real data does)", () => {
    const derived = deriveStepStatuses({ ...EMPTY, hasProduct: true });
    const missing = requiredIncompleteSteps(derived, { fiducials: { status: "skipped" } });
    expect(missing).toContain("fiducials");
    expect(missing).not.toContain("product"); // product has data → satisfied
  });
  it("honors an explicit manual 'done' on a required step", () => {
    const derived = deriveStepStatuses({ ...EMPTY, hasProduct: true });
    const missing = requiredIncompleteSteps(derived, { release: { status: "done" } });
    expect(missing).not.toContain("release");
  });
});
