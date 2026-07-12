// WD-1 (doc 31 Đợt D · gap UX1) — shared types + PURE step logic for the
// product-side onboarding wizard (/product-onboarding).
//
// The wizard is ORCHESTRATION: most steps deep-link to or embed an EXISTING
// surface (fiducials, point editor, thresholds, golden, panel-def, release,
// mapping). This module owns only the step model, the resumable draft snapshot
// shape, and the readiness/step-status derivation — all pure + unit-testable.

export type StepStatus = "todo" | "done" | "skipped";

export interface StepMeta {
  /** Stable key persisted into the draft stepState + used for i18n. */
  key: string;
  /** Optional steps can be explicitly skipped and don't count toward "required". */
  optional: boolean;
}

/** The 9-step product setup journey (order matters; index === currentStep). */
export const PRODUCT_ONBOARDING_STEPS: StepMeta[] = [
  { key: "product", optional: false }, // 0 — create/select product (+ image/dims)
  { key: "fiducials", optional: false }, // 1 — mount ProductFiducialsTab (was orphaned)
  { key: "points", optional: false }, // 2 — measurement points (editor deep-link)
  { key: "thresholds", optional: false }, // 3 — LSL/USL limits (editor deep-link)
  { key: "golden", optional: true }, // 4 — golden capture (embed panel + deep-link)
  { key: "panel", optional: true }, // 5 — panel N-up def (embed PanelDefinitionPanel)
  { key: "release", optional: false }, // 6 — program release SoD (embed ProgramReleasePanel)
  { key: "mapping", optional: false }, // 7 — machine mapping (deep-link, prefilled)
  { key: "review", optional: false }, // 8 — readiness summary + finish
];

export const REVIEW_STEP_INDEX = PRODUCT_ONBOARDING_STEPS.findIndex((s) => s.key === "review");

/** A single step's persisted manual mark (explicit user override). */
export interface ManualStepMark {
  status: StepStatus;
  note?: string;
}

/** Draft snapshot persisted server-side (productOnboardingRouter stepState jsonb). */
export type OnboardingStepState = Record<string, ManualStepMark>;

/** Live counts the review step + per-step badges derive from (all from existing queries). */
export interface OnboardingReadinessInput {
  hasProduct: boolean;
  hasImageDims: boolean;
  fiducialCount: number;
  pointCount: number;
  pointsWithLimits: number;
  goldenCount: number;
  panelCount: number;
  releaseCount: number;
  mappingCount: number;
}

export interface OnboardingReadiness {
  /** Data-derived status per step key (before manual overrides are merged). */
  derived: Record<string, StepStatus>;
  limitPct: number; // 0..100 — % of points that have both limits
  /** Number of NON-optional steps (excluding review) that are done/skipped. */
  requiredComplete: number;
  requiredTotal: number;
  /** Overall completion 0..100 across all steps except review. */
  percent: number;
}

/** True when a point row carries both a lower and an upper spec limit. */
export function pointHasLimits(p: { lowerLimit?: unknown; upperLimit?: unknown }): boolean {
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  return has(p.lowerLimit) && has(p.upperLimit);
}

/** Derive each step's data-driven status from live counts (pure). */
export function deriveStepStatuses(input: OnboardingReadinessInput): Record<string, StepStatus> {
  const done = (b: boolean): StepStatus => (b ? "done" : "todo");
  return {
    product: done(input.hasProduct),
    fiducials: done(input.fiducialCount > 0),
    points: done(input.pointCount > 0),
    // "done" only when EVERY point has both limits (partial → still todo, % shown).
    thresholds: done(input.pointCount > 0 && input.pointsWithLimits >= input.pointCount),
    golden: done(input.goldenCount > 0),
    panel: done(input.panelCount > 0),
    release: done(input.releaseCount > 0),
    mapping: done(input.mappingCount > 0),
    review: "todo",
  };
}

/**
 * Merge the data-derived status with an explicit manual mark. Data wins when it
 * says "done" (real config exists); otherwise an explicit "skipped" (only
 * meaningful for optional steps) is honored; else "todo".
 */
export function mergeStepStatus(
  stepKey: string,
  derived: StepStatus,
  manual: ManualStepMark | undefined,
): StepStatus {
  if (derived === "done") return "done";
  if (manual?.status === "skipped") return "skipped";
  if (manual?.status === "done") return "done"; // manual completion of a non-data step
  return "todo";
}

/**
 * Required (non-optional, non-review) step keys that are NOT yet satisfied
 * (doc 42 §10.12 · H3 #1 — Finish guard).
 *
 * A required step is satisfied when its MERGED status is "done" (real config
 * exists, or an explicit manual completion). Required steps can never be
 * "skipped" (only optional steps carry a skip mark), so a stray skip never
 * satisfies one. The review step keeps its "Finish" button disabled while this
 * list is non-empty and renders it as the "còn thiếu" checklist. Pure +
 * unit-testable.
 */
export function requiredIncompleteSteps(
  derived: Record<string, StepStatus>,
  manual: OnboardingStepState = {},
): string[] {
  return PRODUCT_ONBOARDING_STEPS.filter((s) => !s.optional && s.key !== "review")
    .filter((s) => mergeStepStatus(s.key, derived[s.key] ?? "todo", manual[s.key]) !== "done")
    .map((s) => s.key);
}

/** Full readiness roll-up (pure) — powers the review summary + progress badge. */
export function computeReadiness(input: OnboardingReadinessInput): OnboardingReadiness {
  const derived = deriveStepStatuses(input);
  const limitPct =
    input.pointCount > 0 ? Math.round((input.pointsWithLimits / input.pointCount) * 100) : 0;

  const scored = PRODUCT_ONBOARDING_STEPS.filter((s) => s.key !== "review");
  const required = scored.filter((s) => !s.optional);
  const requiredComplete = required.filter((s) => derived[s.key] === "done").length;

  // Overall percent: every step (except review) that is done/skipped counts.
  const complete = scored.filter((s) => derived[s.key] === "done").length;
  const percent = scored.length > 0 ? Math.round((complete / scored.length) * 100) : 0;

  return {
    derived,
    limitPct,
    requiredComplete,
    requiredTotal: required.length,
    percent,
  };
}
