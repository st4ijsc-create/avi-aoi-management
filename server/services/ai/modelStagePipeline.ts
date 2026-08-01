/**
 * G4.25 (doc 44 W5-A4) — MODEL STAGE PIPELINE with the MANDATORY MLOps gates
 * (SYNAPSE LDS-L4 §11.1 vòng đời + §11.2 các cổng bắt buộc).
 * Flag: MODEL_STAGE_PIPELINE_ENABLED (default OFF — router opt-in; the pure gate
 * evaluator is flag-agnostic + fully unit-testable).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Lifecycle (model_versions.stage): staging → shadow → canary → production → retired.
 *
 *   staging → shadow    : FREE (start running side-by-side, no impact).
 *   shadow  → canary     : GATED — must have been in shadow ≥ MODEL_SHADOW_MIN_HOURS
 *                          AND ≥ MODEL_SHADOW_MIN_INFERENCES observed shadow inferences
 *                          (ml_inference_audit) AND no unresolved drift alert active.
 *   canary  → production : GATED — TWO people (actor ≠ approver, SoD mirrors
 *                          thresholdGovernanceService.assertApprovalSoD) AND the latest
 *                          eval-gate passed. Delegates the status flip + stage write to
 *                          aiModelService.activateModelVersion (the SAME path manual
 *                          activation + auto-rollback use — no registry fork).
 *   production → retired : FREE + audited.
 *
 * Every applied transition APPENDS to model_versions.stage_history. Violations return
 * a clear machine code: SHADOW_TOO_SHORT · NOT_ENOUGH_SHADOW_INFERENCES · DRIFT_ACTIVE
 * · NEEDS_SECOND_APPROVER · EVAL_GATE_NOT_PASSED · INVALID_TRANSITION.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { modelDriftAlerts } from "../../../drizzle/schema";
import type { ModelStage, ModelVersion, ModelStageHistoryEntry } from "../../../drizzle/schema";
import { getModelVersionById, getAiModelById, updateModelVersion } from "../../db/ai";
import {
  activateModelVersion,
  appendStageHistory,
  isModelStagePipelineEnabled,
} from "../aiModelService";
import { countInferenceAudit } from "./featureStore";

export { isModelStagePipelineEnabled };

export const STAGES: ModelStage[] = ["staging", "shadow", "canary", "production", "retired"];

export function shadowMinHours(): number {
  const n = Number(process.env.MODEL_SHADOW_MIN_HOURS);
  return Number.isFinite(n) && n >= 0 ? n : 72;
}
export function shadowMinInferences(): number {
  const n = Number(process.env.MODEL_SHADOW_MIN_INFERENCES);
  return Number.isFinite(n) && n >= 0 ? n : 100;
}

export type PromotionErrorCode =
  | "INVALID_TRANSITION"
  | "SHADOW_TOO_SHORT"
  | "NOT_ENOUGH_SHADOW_INFERENCES"
  | "DRIFT_ACTIVE"
  | "NEEDS_SECOND_APPROVER"
  | "EVAL_GATE_NOT_PASSED";

export interface PromotionFacts {
  currentStage: ModelStage | null;
  /** Hours in the CURRENT stage (null when stage_entered_at is unknown). */
  hoursInStage: number | null;
  shadowInferenceCount: number;
  hasActiveDriftAlert: boolean;
  actor: number;
  approver?: number | null;
  evalGatePassed: boolean;
  minShadowHours: number;
  minShadowInferences: number;
}

export interface PromotionDecision {
  allowed: boolean;
  code?: PromotionErrorCode;
  reason: string;
}

// ─── Pure gate evaluator (unit-testable, no I/O) ────────────────────────────────

/**
 * Decide whether `currentStage → toStage` is permitted given the facts. PURE.
 * Encodes SYNAPSE §11.2 các cổng bắt buộc exactly.
 */
export function evaluatePromotion(toStage: ModelStage, facts: PromotionFacts): PromotionDecision {
  const cur = facts.currentStage;
  const invalid = (): PromotionDecision => ({
    allowed: false,
    code: "INVALID_TRANSITION",
    reason: `Invalid stage transition ${cur ?? "legacy(null)"} → ${toStage}.`,
  });

  switch (toStage) {
    case "staging":
      // Initialize a legacy/new version, or demote back for a retrain.
      if (cur === null || cur === "shadow" || cur === "canary") return { allowed: true, reason: "→ staging." };
      return invalid();

    case "shadow":
      if (cur !== "staging") return invalid();
      return { allowed: true, reason: "staging → shadow (side-by-side, no impact)." };

    case "canary": {
      if (cur !== "shadow") return invalid();
      if (facts.hoursInStage == null || facts.hoursInStage < facts.minShadowHours) {
        return {
          allowed: false,
          code: "SHADOW_TOO_SHORT",
          reason: `Shadow duration ${facts.hoursInStage == null ? "unknown" : facts.hoursInStage.toFixed(1) + "h"} < required ${facts.minShadowHours}h.`,
        };
      }
      if (facts.shadowInferenceCount < facts.minShadowInferences) {
        return {
          allowed: false,
          code: "NOT_ENOUGH_SHADOW_INFERENCES",
          reason: `Only ${facts.shadowInferenceCount} shadow inferences < required ${facts.minShadowInferences}.`,
        };
      }
      if (facts.hasActiveDriftAlert) {
        return { allowed: false, code: "DRIFT_ACTIVE", reason: "An unresolved drift alert is active — cannot widen to canary." };
      }
      return { allowed: true, reason: "shadow → canary (gates passed)." };
    }

    case "production": {
      if (cur !== "canary") return invalid();
      if (facts.approver == null || facts.approver === facts.actor) {
        return {
          allowed: false,
          code: "NEEDS_SECOND_APPROVER",
          reason: "canary → production requires a SECOND approver (actor ≠ approver) — segregation of duties.",
        };
      }
      if (!facts.evalGatePassed) {
        return { allowed: false, code: "EVAL_GATE_NOT_PASSED", reason: "Latest offline eval-gate did not pass." };
      }
      return { allowed: true, reason: "canary → production (two-person + eval-gate passed)." };
    }

    case "retired":
      // A version at any live stage can be retired (audited).
      return { allowed: true, reason: `${cur ?? "legacy(null)"} → retired.` };

    default:
      return invalid();
  }
}

// ─── Fact gathering + apply (DB) ────────────────────────────────────────────────

/** Was the version's most-recent offline eval-gate a PASS? (fail-safe: false when unknown). */
export function evalGatePassedOf(version: Pick<ModelVersion, "evalReport">): boolean {
  const report = version.evalReport as Record<string, unknown> | null | undefined;
  const gate = report?.gate as { pass?: unknown } | undefined;
  return gate?.pass === true;
}

/** Any unresolved drift alert for a model = "drift active". */
export async function hasActiveDriftAlert(modelId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const rows = await db
      .select({ id: modelDriftAlerts.id })
      .from(modelDriftAlerts)
      .where(and(eq(modelDriftAlerts.modelId, modelId), isNull(modelDriftAlerts.resolvedAt)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export interface PromoteResult {
  ok: boolean;
  code?: PromotionErrorCode;
  reason: string;
  versionId: number;
  fromStage: ModelStage | null;
  toStage: ModelStage;
  facts: PromotionFacts;
}

/**
 * Promote ONE version to `toStage`, enforcing the mandatory gates. Returns a result
 * object (ok / code / reason) rather than throwing on a gate violation — the router
 * maps a non-ok result to a TRPC error carrying the code. Throws only on a genuinely
 * exceptional condition (version not found / no DB).
 */
export async function promoteStage(
  versionId: number,
  toStage: ModelStage,
  opts: { actor: number; approver?: number | null; reason?: string; now?: Date },
): Promise<PromoteResult> {
  const version = await getModelVersionById(versionId);
  if (!version) throw new Error(`Model version ${versionId} not found`);
  const model = await getAiModelById(version.modelId);

  const now = opts.now ?? new Date();
  const currentStage = (version.stage as ModelStage | null) ?? null;
  const enteredAt = version.stageEnteredAt ? new Date(version.stageEnteredAt) : null;
  const hoursInStage = enteredAt ? (now.getTime() - enteredAt.getTime()) / 3_600_000 : null;

  // Shadow inference count: audit rows for this model/version since it entered shadow.
  const shadowInferenceCount =
    currentStage === "shadow" && model
      ? await countInferenceAudit(model.code, version.version, enteredAt ?? undefined)
      : 0;

  const facts: PromotionFacts = {
    currentStage,
    hoursInStage,
    shadowInferenceCount,
    hasActiveDriftAlert: await hasActiveDriftAlert(version.modelId),
    actor: opts.actor,
    approver: opts.approver ?? null,
    evalGatePassed: evalGatePassedOf(version),
    minShadowHours: shadowMinHours(),
    minShadowInferences: shadowMinInferences(),
  };

  const decision = evaluatePromotion(toStage, facts);
  if (!decision.allowed) {
    return { ok: false, code: decision.code, reason: decision.reason, versionId, fromStage: currentStage, toStage, facts };
  }

  if (toStage === "production") {
    // Delegate the status flip + production-stage projection to the SHARED path.
    await activateModelVersion(version.modelId, versionId, {
      actor: opts.actor,
      approver: opts.approver ?? null,
      via: "promote",
      reason: opts.reason ?? decision.reason,
    });
  } else {
    const entry: ModelStageHistoryEntry = {
      from: currentStage,
      to: toStage,
      at: now.toISOString(),
      actor: opts.actor,
      approver: opts.approver ?? null,
      via: "promote",
      reason: opts.reason ?? decision.reason,
    };
    await updateModelVersion(versionId, {
      stage: toStage,
      stageEnteredAt: now,
      stageHistory: appendStageHistory(version.stageHistory, entry),
    });
  }

  return { ok: true, reason: decision.reason, versionId, fromStage: currentStage, toStage, facts };
}

/** List versions for a model with their stage + stage_history (registry view). */
export async function listStages(modelId: number): Promise<
  Array<Pick<ModelVersion, "id" | "version" | "status" | "stage" | "stageEnteredAt" | "stageHistory" | "owner" | "trainedOn">>
> {
  const { getModelVersions } = await import("../../db/ai");
  const versions = await getModelVersions(modelId);
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    stage: v.stage,
    stageEnteredAt: v.stageEnteredAt,
    stageHistory: v.stageHistory,
    owner: v.owner,
    trainedOn: v.trainedOn,
  }));
}
