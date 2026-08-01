/**
 * G4.24/G4.25 — Model stage pipeline tests.
 *
 * The mandatory MLOps gates (SYNAPSE §11.2) are enforced by the PURE evaluatePromotion,
 * unit-tested here rule-by-rule (shadow-too-short / not-enough-inferences / drift-active
 * / needs-second-approver / eval-gate). Plus the eval-gate reader + the append-only
 * stage_history helper + the ACTIVE↔production projection (DB-guarded).
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePromotion,
  evalGatePassedOf,
  type PromotionFacts,
} from "./modelStagePipeline";
import { appendStageHistory } from "../aiModelService";
import type { ModelStage } from "../../../drizzle/schema";

function facts(over: Partial<PromotionFacts> = {}): PromotionFacts {
  return {
    currentStage: "shadow",
    hoursInStage: 100,
    shadowInferenceCount: 500,
    hasActiveDriftAlert: false,
    actor: 1,
    approver: 2,
    evalGatePassed: true,
    minShadowHours: 72,
    minShadowInferences: 100,
    ...over,
  };
}

describe("evaluatePromotion — free transitions", () => {
  it("null(legacy) → staging is allowed (initialize)", () => {
    expect(evaluatePromotion("staging", facts({ currentStage: null })).allowed).toBe(true);
  });
  it("staging → shadow is free", () => {
    expect(evaluatePromotion("shadow", facts({ currentStage: "staging" })).allowed).toBe(true);
  });
  it("production → retired is free", () => {
    expect(evaluatePromotion("retired", facts({ currentStage: "production" })).allowed).toBe(true);
  });
});

describe("evaluatePromotion — shadow → canary gates", () => {
  it("blocks when shadow duration < MODEL_SHADOW_MIN_HOURS", () => {
    const d = evaluatePromotion("canary", facts({ hoursInStage: 10 }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("SHADOW_TOO_SHORT");
  });

  it("blocks when stage_entered_at is unknown (hoursInStage null)", () => {
    const d = evaluatePromotion("canary", facts({ hoursInStage: null }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("SHADOW_TOO_SHORT");
  });

  it("blocks when shadow inference count < minimum", () => {
    const d = evaluatePromotion("canary", facts({ shadowInferenceCount: 3 }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("NOT_ENOUGH_SHADOW_INFERENCES");
  });

  it("blocks when a drift alert is active", () => {
    const d = evaluatePromotion("canary", facts({ hasActiveDriftAlert: true }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("DRIFT_ACTIVE");
  });

  it("allows when all gates pass", () => {
    expect(evaluatePromotion("canary", facts()).allowed).toBe(true);
  });
});

describe("evaluatePromotion — canary → production two-person + eval gate", () => {
  const base = () => facts({ currentStage: "canary" });

  it("blocks when there is no second approver", () => {
    const d = evaluatePromotion("production", base());
    // note: default facts has approver=2, actor=1 → ok; remove the approver
    const d2 = evaluatePromotion("production", facts({ currentStage: "canary", approver: null }));
    expect(d.allowed).toBe(true); // sanity: two distinct people passes
    expect(d2.allowed).toBe(false);
    expect(d2.code).toBe("NEEDS_SECOND_APPROVER");
  });

  it("blocks when approver === actor (self-approval)", () => {
    const d = evaluatePromotion("production", facts({ currentStage: "canary", actor: 7, approver: 7 }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("NEEDS_SECOND_APPROVER");
  });

  it("blocks when the latest eval-gate did not pass", () => {
    const d = evaluatePromotion("production", facts({ currentStage: "canary", evalGatePassed: false }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("EVAL_GATE_NOT_PASSED");
  });

  it("allows with two distinct approvers + a passing gate", () => {
    const d = evaluatePromotion("production", facts({ currentStage: "canary", actor: 1, approver: 2 }));
    expect(d.allowed).toBe(true);
  });
});

describe("evaluatePromotion — invalid transitions", () => {
  const cases: Array<[ModelStage | null, ModelStage]> = [
    ["staging", "canary"],     // must go through shadow
    ["staging", "production"],
    ["shadow", "production"],  // must go through canary
    ["production", "canary"],
  ];
  for (const [from, to] of cases) {
    it(`${from} → ${to} is INVALID_TRANSITION`, () => {
      const d = evaluatePromotion(to, facts({ currentStage: from }));
      expect(d.allowed).toBe(false);
      expect(d.code).toBe("INVALID_TRANSITION");
    });
  }
});

describe("evalGatePassedOf — fail-safe", () => {
  it("true only when evalReport.gate.pass === true", () => {
    expect(evalGatePassedOf({ evalReport: { gate: { pass: true } } })).toBe(true);
    expect(evalGatePassedOf({ evalReport: { gate: { pass: false } } })).toBe(false);
    expect(evalGatePassedOf({ evalReport: null })).toBe(false);
    expect(evalGatePassedOf({ evalReport: { candidate: { accuracy: 0.9 } } })).toBe(false);
  });
});

describe("appendStageHistory — append-only ledger", () => {
  it("appends without mutating the existing array", () => {
    const existing = [
      { from: null, to: "staging" as ModelStage, at: "t0", via: "promote" },
    ];
    const next = appendStageHistory(existing, {
      from: "staging", to: "shadow", at: "t1", via: "promote", actor: 1,
    });
    expect(next).toHaveLength(2);
    expect(existing).toHaveLength(1); // original untouched
    expect(next[1].to).toBe("shadow");
  });

  it("handles null/undefined existing history", () => {
    const next = appendStageHistory(null, { from: null, to: "staging", at: "t0", via: "activate" });
    expect(next).toHaveLength(1);
  });
});
