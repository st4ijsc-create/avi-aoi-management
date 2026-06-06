import * as db from "../db/aiAdvanced";
import { getAiModelById } from "../db/ai";
import { storagePut, storageGet } from "../storage";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Create a new edge deployment for a device
 */
export async function createEdgeDeployment(options: {
  modelId: number;
  modelVersion: string;
  deviceId: string;
  deviceName: string;
  deviceType?: string;
  machineId?: number;
  deployConfig?: {
    quantization?: string;
    runtime?: string;
    maxBatchSize?: number;
    optimizationLevel?: string;
  };
  createdBy?: number;
}) {
  const model = await getAiModelById(options.modelId);
  if (!model) throw new Error(`Model ${options.modelId} not found`);

  return db.createEdgeDeployment({
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    deviceId: options.deviceId,
    deviceName: options.deviceName,
    deviceType: options.deviceType ?? "GENERIC",
    machineId: options.machineId,
    deployConfig: options.deployConfig ?? ({
      quantization: "none",
      runtime: "onnxruntime",
      maxBatchSize: 1,
      optimizationLevel: "basic",
    } as any),
    createdBy: options.createdBy,
  });
}

/**
 * Package a model for edge deployment (create downloadable bundle)
 */
export async function packageModelForEdge(deploymentId: number) {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  await db.updateEdgeDeployment(deploymentId, { status: "PACKAGING" });

  try {
    // Get model version to find the file
    const version = await db.getModelVersionForDeployment(deployment.modelId, deployment.modelVersion ?? "");
    if (!version) throw new Error(`Model version ${deployment.modelVersion} not found`);

    // Get the model file URL from storage
    const v = version as any;
    const { url } = await storageGet(v.storageKey || v.fileKey || v.filePath || "");
    // Read file from local filesystem if local mode
    let modelBuffer: Buffer;
    if (url.startsWith("/uploads/")) {
      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const filePath = path.join(uploadsRoot, url.replace("/uploads/", ""));
      modelBuffer = await fs.promises.readFile(filePath);
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to download model file");
      modelBuffer = Buffer.from(await resp.arrayBuffer());
    }

    // Create deployment package with metadata
    const packageMeta = {
      modelId: deployment.modelId,
      modelVersion: deployment.modelVersion,
      deviceId: deployment.deviceId,
      deployConfig: deployment.deployConfig,
      labels: v.labels ?? [],
      inputWidth: v.inputWidth,
      inputHeight: v.inputHeight,
      createdAt: new Date().toISOString(),
    };

    const metaBuffer = Buffer.from(JSON.stringify(packageMeta));
    const packageKey = `edge-packages/${deployment.deviceId}/${deployment.modelId}_${deployment.modelVersion}_${Date.now()}.bin`;

    // Store package (model + metadata combined)
    // Simple format: [4-byte meta length][meta JSON][model binary]
    const metaLenBuf = Buffer.alloc(4);
    metaLenBuf.writeUInt32LE(metaBuffer.length);
    const packageBuffer = Buffer.concat([metaLenBuf, metaBuffer, modelBuffer]);

    const packageHash = crypto.createHash("sha256").update(packageBuffer).digest("hex");

    await storagePut(packageKey, packageBuffer);

    await db.updateEdgeDeployment(deploymentId, {
      status: "READY",
      packageKey,
      packageSize: packageBuffer.length,
      packageHash,
    });

    return {
      packageKey,
      packageSize: packageBuffer.length,
      packageHash,
    };
  } catch (err: unknown) {
    await db.updateEdgeDeployment(deploymentId, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update deployment status (called by edge device)
 */
export async function updateDeploymentStatus(
  deploymentId: number,
  status: "DOWNLOADING" | "DEPLOYED" | "ACTIVE" | "FAILED",
  errorMessage?: string,
) {
  const updates: Record<string, unknown> = { status };
  if (status === "ACTIVE") {
    updates.lastHeartbeatAt = new Date();
  }
  if (errorMessage) {
    updates.errorMessage = errorMessage;
  }
  return db.updateEdgeDeployment(deploymentId, updates);
}

/**
 * Record heartbeat from edge device
 */
export async function recordHeartbeat(
  deploymentId: number,
  pendingResults: number,
) {
  return db.updateEdgeDeployment(deploymentId, {
    lastHeartbeatAt: new Date(),
    offlineResultsPending: pendingResults,
  });
}

/**
 * Sync inference results from edge device
 */
export async function syncEdgeResults(
  deploymentId: number,
  results: Array<{
    inputReference: string;
    predictions: unknown;
    confidence: number;
    topLabel: string;
    processingTimeMs: number;
    inferredAt: Date;
    inspectionId?: number;
    measurementResultId?: number;
  }>,
) {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const syncedRecords = [];

  for (const result of results) {
    const record = await db.createEdgeInferenceSync({
      deploymentId,
      modelId: deployment.modelId,
      modelVersion: deployment.modelVersion,
      deviceId: deployment.deviceId,
      inputReference: result.inputReference,
      predictions: result.predictions,
      confidence: result.confidence,
      topLabel: result.topLabel,
      processingTimeMs: result.processingTimeMs,
      inferredAt: result.inferredAt,
      inspectionId: result.inspectionId,
      measurementResultId: result.measurementResultId,
      synced: true,
      syncedAt: new Date(),
    } as any);
    syncedRecords.push(record);
  }

  // Update deployment sync info
  const pending = Math.max(0, (deployment.offlineResultsPending ?? 0) - results.length);
  await db.updateEdgeDeployment(deploymentId, {
    lastSyncAt: new Date(),
    offlineResultsPending: pending,
  });

  return { synced: syncedRecords.length, remainingPending: pending };
}

/**
 * Get deployments for a specific device
 */
export async function getDeviceDeployments(deviceId: string) {
  return db.getEdgeDeploymentsByDevice(deviceId);
}

/**
 * Check for stale deployments (no heartbeat in threshold)
 */
export async function checkStaleDeployments(thresholdMinutes: number = 30) {
  return db.getStaleDeployments(thresholdMinutes);
}
