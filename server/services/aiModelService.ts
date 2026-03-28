import { storagePut, storageGet } from "../storage";
import {
  createAiModel, getAiModelById, getAiModelByCode, updateAiModel,
  createModelVersion, getModelVersions, updateModelVersion,
} from "../db/ai";
import type { InsertAiModel, InsertModelVersion } from "../../drizzle/schema";

const MODEL_STORAGE_PREFIX = "ai-models";

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
 * Activate a specific model version — sets model to ACTIVE and updates currentVersion
 */
export async function activateModelVersion(modelId: number, versionId: number) {
  const versions = await getModelVersions(modelId);
  const target = versions.find(v => v.id === versionId);
  if (!target) throw new Error(`Version ${versionId} not found for model ${modelId}`);

  // Mark previous active versions as INACTIVE
  for (const v of versions) {
    if (v.id !== versionId && v.status === "ACTIVE") {
      await updateModelVersion(v.id, { status: "INACTIVE" });
    }
  }

  await updateModelVersion(versionId, { status: "ACTIVE" });
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
