import { storagePut, storageGet } from "../storage";
import {
  createAiModel, getAiModelById, getAiModelByCode, updateAiModel,
  createModelVersion, getModelVersions, updateModelVersion,
} from "../db/ai";
import type {
  InsertAiModel, InsertModelVersion, ModelStage, ModelStageHistoryEntry,
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
