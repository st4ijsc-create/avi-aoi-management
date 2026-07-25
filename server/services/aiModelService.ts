import { storagePut, storageGet } from "../storage";
import {
  createAiModel, getAiModelById, getAiModelByCode, updateAiModel,
  createModelVersion, getModelVersions, getModelVersionById, updateModelVersion,
} from "../db/ai";
import { createAuditLog } from "../db/system";
import type {
  InsertAiModel, InsertModelVersion, ModelStage, ModelStageHistoryEntry, ModelVersion,
} from "../../drizzle/schema";

const MODEL_STORAGE_PREFIX = "ai-models";

// ── W5-A4 G4.24/G4.25 — stage pipeline flag + ACTIVE↔production projection ──────

/** Whether the stage-lifecycle projection/pipeline is active (default OFF). */
export function isModelStagePipelineEnabled(): boolean {
  const v = String(process.env.MODEL_STAGE_PIPELINE_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Append an entry to a version's stage_history ledger (append-only). */
export function appendStageHistory(
  existing: ModelStageHistoryEntry[] | null | undefined,
  entry: ModelStageHistoryEntry,
): ModelStageHistoryEntry[] {
  return [...(existing ?? []), entry];
}

/** Optional context carried into the stage_history entry on an activation. */
export interface ActivateContext {
  actor?: number | null;
  approver?: number | null;
  via?: string;   // "activate" | "promote" | "rollback" | "manual"
  reason?: string;
}

/**
 * Upload model file to storage and create/update model record
 */
export async function uploadModelFile(
  modelId: number,
  fileBuffer: Buffer,
  filename: string,
  contentType = "application/octet-stream",
) {
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Model ${modelId} not found`);

  const ext = filename.split(".").pop() ?? "onnx";
  const storageKey = `${MODEL_STORAGE_PREFIX}/${model.code}/v${model.currentVersion ?? "1.0.0"}/model.${ext}`;
  const { key, url } = await storagePut(storageKey, fileBuffer, contentType);

  await updateAiModel(modelId, {
    filePath: url,
    fileKey: key,
    fileSize: fileBuffer.length,
    status: "VALIDATING",
  });

  return { key, url, fileSize: fileBuffer.length };
}

/**
 * Upload a new version of a model
 */
export async function uploadModelVersion(
  modelId: number,
  version: string,
  fileBuffer: Buffer,
  filename: string,
  changeLog?: string,
  createdBy?: number,
) {
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Model ${modelId} not found`);

  const ext = filename.split(".").pop() ?? "onnx";
  const storageKey = `${MODEL_STORAGE_PREFIX}/${model.code}/v${version}/model.${ext}`;
  const { key, url } = await storagePut(storageKey, fileBuffer, "application/octet-stream");

  const modelVersion = await createModelVersion({
    modelId,
    version,
    filePath: url,
    fileKey: key,
    fileSize: fileBuffer.length,
    changeLog,
    status: "VALIDATING",
    createdBy,
  });

  return modelVersion;
}

/**
 * Activate a specific model version — sets model to ACTIVE and updates currentVersion.
 *
 * G4.24 stage projection (EXPLICIT ACTIVE↔production): when MODEL_STAGE_PIPELINE_ENABLED
 * is on, the activated version is ALSO projected to stage='production' and any version
 * previously at stage='production' is retired — both appended to stage_history. When
 * the flag is OFF the status writes are byte-identical to before (no stage columns
 * touched), so the legacy path is untouched. `ctx` carries the actor/approver of the
 * caller (pipeline / rollback) for the ledger; unused when the flag is off.
 */
export async function activateModelVersion(
  modelId: number,
  versionId: number,
  ctx?: ActivateContext,
) {
  const versions = await getModelVersions(modelId);
  const target = versions.find(v => v.id === versionId);
  if (!target) throw new Error(`Version ${versionId} not found for model ${modelId}`);

  // Project the stage when the global flag is on OR when the deliberate stage-aware
  // pipeline is the caller (via="promote") — so a canary→production promotion is
  // always coherent, while ordinary activation stays byte-identical when the flag is off.
  const projectStage = isModelStagePipelineEnabled() || ctx?.via === "promote";
  const now = new Date();
  const via = ctx?.via ?? "activate";

  // Mark previous active versions as INACTIVE (+ retire their production stage).
  for (const v of versions) {
    if (v.id !== versionId && v.status === "ACTIVE") {
      if (projectStage && v.stage === "production") {
        await updateModelVersion(v.id, {
          status: "INACTIVE",
          stage: "retired",
          stageEnteredAt: now,
          stageHistory: appendStageHistory(v.stageHistory, {
            from: "production", to: "retired", at: now.toISOString(),
            actor: ctx?.actor ?? null, approver: ctx?.approver ?? null, via,
            reason: ctx?.reason ?? "superseded by a newer production version",
          }),
        });
      } else {
        await updateModelVersion(v.id, { status: "INACTIVE" });
      }
    }
  }

  if (projectStage) {
    await updateModelVersion(versionId, {
      status: "ACTIVE",
      stage: "production",
      stageEnteredAt: now,
      stageHistory: appendStageHistory(target.stageHistory, {
        from: (target.stage as ModelStage | null) ?? null, to: "production",
        at: now.toISOString(), actor: ctx?.actor ?? null, approver: ctx?.approver ?? null,
        via, reason: ctx?.reason,
      }),
    });
  } else {
    await updateModelVersion(versionId, { status: "ACTIVE" });
  }

  await updateAiModel(modelId, {
    currentVersion: target.version,
    filePath: target.filePath,
    fileKey: target.fileKey,
    fileSize: target.fileSize,
    status: "ACTIVE",
  });

  return target;
}

// ── W0-2 (doc 69) — MANUAL activation eval quality gate ─────────────────────────
//
// The automated training pipeline (aiTrainingPipeline.runTrainingPipeline) already
// enforces the eval quality gate (compareBeforeAfter().gate.pass) before it will ever
// activate a version — see aiTrainingPipeline.ts Stage 5/6 (`promotionAllowed`). But
// the MANUAL path — aiModelRouter.ts `activateVersion` (adminProcedure, used by the
// AI Model Management UI) — called the raw activateModelVersion() above DIRECTLY,
// with no gate check at all: an admin could flip any version (never evaluated, or one
// that FAILED the quality gate) to ACTIVE and start serving it for production
// inference.
//
// activateModelVersionManual() is the gated entry point for that path. It reads the
// SAME persisted field the automated pipeline writes — model_versions.evalReport as a
// CompareReport, i.e. `evalReport.gate.pass` (see aiEvalHarness.compareBeforeAfter;
// the identical field-path check already exists as modelStagePipeline.evalGatePassedOf
// for the canary→production gate) — and requires it to be true before activating.
// `force: true` + a non-empty `reason` is an explicit, audited override for
// legitimate cases (e.g. activating a first/bootstrap model that has never been
// evaluated, or a knowing admin override) — it always writes an audit_logs entry via
// createAuditLog (the same mechanism other sensitive mutations use, e.g.
// thresholdApprovalRouter's `revert`) capturing actor/modelId/versionId/reason.
//
// Deliberately NOT folded into the raw activateModelVersion() above — that shared
// primitive is also used by modelStagePipeline.promoteStage (which already enforces
// its OWN, stricter two-person + eval-gate check via evaluatePromotion BEFORE ever
// calling it — so it already satisfies this gate by construction) and by
// modelAutoRollback (an automated SAFETY-NET mechanism that must be able to roll back
// to a prior stable version even when that version predates evalReport tracking —
// gating it there could block the very rollback meant to protect production). Gating
// only the manual entry point closes the real bypass without touching those
// already-correct, already-audited paths.

export interface ManualActivateOptions {
  /** Explicit override — bypasses the eval quality gate. Requires `reason`. */
  force?: boolean;
  /** Required when force === true; also recorded on the audit log entry. */
  reason?: string;
  /** Acting admin's user id — recorded as the audit log's actor. */
  actorUserId?: number | null;
}

/** True only when evalReport.gate.pass === true (mirrors modelStagePipeline.evalGatePassedOf). */
function evalGatePassed(evalReport: unknown): boolean {
  const report = evalReport as { gate?: { pass?: unknown } } | null | undefined;
  return report?.gate?.pass === true;
}

/**
 * MANUAL activation entry point — the gated call the admin-facing `activateVersion`
 * tRPC mutation uses instead of the raw activateModelVersion() (see design note
 * above). Throws (no activation, no audit write) when the gate fails and no override
 * is given, or when force:true is given without a reason.
 */
export async function activateModelVersionManual(
  modelId: number,
  versionId: number,
  opts: ManualActivateOptions = {},
): Promise<ModelVersion> {
  const target = await getModelVersionById(versionId);
  if (!target || target.modelId !== modelId) {
    throw new Error(`Version ${versionId} not found for model ${modelId}`);
  }

  const gatePassed = evalGatePassed(target.evalReport);
  const forced = opts.force === true;

  if (forced) {
    if (!opts.reason || !opts.reason.trim()) {
      throw new Error("Overriding the eval quality gate (force:true) requires a non-empty reason.");
    }
  } else if (!gatePassed) {
    throw new Error(
      `Cannot activate model ${modelId} version ${versionId} (${target.version}): the eval quality gate ` +
      `has not passed (evalReport.gate.pass !== true). Pass { force: true, reason } to explicitly override (audited).`,
    );
  }

  await activateModelVersion(modelId, versionId, {
    actor: opts.actorUserId ?? null,
    via: "manual",
    reason: forced ? opts.reason : undefined,
  });

  if (forced) {
    try {
      await createAuditLog({
        userId: opts.actorUserId ?? null,
        action: "ai_model_version.activate_override",
        entityType: "model_version",
        entityId: versionId,
        entityName: target.version,
        details: {
          modelId,
          versionId,
          version: target.version,
          reason: opts.reason,
          gateOverridden: !gatePassed,
          gateHadPassed: gatePassed,
        },
        status: "success",
      });
    } catch (err) {
      console.warn(
        "[aiModelService] createAuditLog failed for gate override (activation already applied):",
        (err as Error)?.message ?? err,
      );
    }
  }

  const updated = await getModelVersionById(versionId);
  return updated ?? target;
}

/**
 * Get the download URL for a model file
 */
export async function getModelFileUrl(modelId: number) {
  const model = await getAiModelById(modelId);
  if (!model?.fileKey) throw new Error(`Model ${modelId} has no file`);
  return storageGet(model.fileKey);
}

/**
 * Register a new AI model (metadata only — file uploaded separately)
 */
export async function registerModel(data: InsertAiModel) {
  return createAiModel(data);
}
