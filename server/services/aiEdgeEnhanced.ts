/**
 * AI Edge Enhanced Service — Edge deployment runtime (WS-2)
 *
 * Live responsibilities (all 100% local, no cloud):
 *  - WS-2 package lifecycle: packageModelForDeployment / confirmDeployment /
 *    recordEdgeHeartbeat / syncEdgeResults / markStaleDeployments
 *  - Fleet read model + rollback: getFleetOverview / rollbackDevice
 *
 * The Phase-4.1 quantization, OTA push, batch-deploy and conflict-resolution
 * sync helpers (only ever reachable via the disabled aiEdgeEnhancedRouter) were
 * removed in the 2026 local-AI cleanup (X1).
 */

import { getDb } from "../db/connection";
import { sql, eq, and } from "drizzle-orm";
import { edgeInferenceSync, type InsertEdgeDeployment } from "../../drizzle/schema/ai";
import * as db from "../db/aiAdvanced";
import { updateMachineHeartbeat } from "../db/hierarchy";
import { storagePut, storageGet } from "../storage";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Types ─────────────────────────────────────────────────────────────────

// NOTE: Quantization* and OTAUpdate* types were removed in the 2026 local-AI
// cleanup (X1) together with the dead aiEdgeEnhancedRouter implementations.

export interface FleetDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  machineId?: number | null;
  status: string;
  currentModel?: string;
  currentVersion?: string;
  lastHeartbeat?: Date | null;
  avgInferenceTime?: number;
  totalInferences: number;
  accuracy?: number;
  isOnline: boolean;
}

export interface FleetOverview {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  activeDeployments: number;
  pendingUpdates: number;
  avgInferenceTime: number;
  totalInferencesToday: number;
  devices: FleetDevice[];
}

// ─── Shared storage helpers (WS-2) ─────────────────────────────────────────

/**
 * Read a stored file (by storage key) into a Buffer, handling both local-disk
 * mode (`/uploads/...`) and the object-store mode (absolute http(s) URL, e.g.
 * S3/MinIO). Used by the WS-2 edge packaging path.
 */
export async function readStorageBuffer(storageKey: string): Promise<Buffer> {
  const { url } = await storageGet(storageKey);
  if (url.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsRoot, url.replace("/uploads/", ""));
    return fs.promises.readFile(filePath);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download model file (key=${storageKey})`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Compute sha256 hex digest of a buffer. */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ─── WS-2: Edge package lifecycle ──────────────────────────────────────────

export interface PackageModelResult {
  deploymentId: number;
  status: "READY" | "FAILED";
  packageKey?: string;
  packageUrl?: string;
  packageHash?: string;
  packageSize?: number;
  packageVersion?: string;
  error?: string;
}

/**
 * Package the model bound to a deployment for edge delivery.
 *
 * Reads the deployment's model version file from storage, computes its sha256,
 * stores a copy under a stable edge-package key, and marks the deployment READY
 * with packageUrl/Key/Hash/Size + packageVersion. On any failure the deployment
 * is marked FAILED with an errorMessage (so the fleet view + stale checker can
 * surface it) and the error is re-thrown for the caller.
 *
 * NOTE: packageUrl stored here is the *internal* storage URL/key — it is NEVER
 * handed to a machine directly. Machines download via the apiKey-verified
 * Express proxy (/api/edge/download/:deploymentId), per the WS-2 security model.
 */
export async function packageModelForDeployment(deploymentId: number): Promise<PackageModelResult> {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  // Resolve the model version file. modelVersion is the canonical pointer;
  // if absent, fall back to the model's currentVersion is the caller's job —
  // here we require modelVersion on the deployment.
  const version = deployment.modelVersion
    ? await db.getModelVersionForDeployment(deployment.modelId, deployment.modelVersion)
    : null;

  await db.updateEdgeDeployment(deploymentId, { status: "PACKAGING", errorMessage: null });

  try {
    if (!version) {
      throw new Error(
        `Model version '${deployment.modelVersion ?? "(none)"}' not found for model ${deployment.modelId}`,
      );
    }
    if (!version.fileKey) {
      throw new Error(
        `Model version ${version.id} has no fileKey to package — the artifact was never uploaded. ` +
          `Re-upload the model version, then re-package.`,
      );
    }

    // W7-D (doc 27 gap V19) — verify the artifact BEFORE packaging: missing
    // file ⇒ actionable error (not a raw ENOENT); recorded sha256 mismatch ⇒
    // abort (never ship corrupt bytes to a machine).
    let buffer: Buffer;
    try {
      buffer = await readStorageBuffer(version.fileKey);
    } catch (readErr) {
      throw new Error(
        `Model artifact MISSING/unreadable for model ${deployment.modelId} v${version.version} ` +
          `(key ${version.fileKey}): ${readErr instanceof Error ? readErr.message : String(readErr)} — ` +
          `re-upload the model version or fix storage, then re-package.`,
      );
    }
    const hash = sha256Hex(buffer);
    const recordedHash = (version as { fileHash?: string | null }).fileHash?.toLowerCase() ?? null;
    if (recordedHash && recordedHash !== hash) {
      throw new Error(
        `Model artifact CHECKSUM MISMATCH for model ${deployment.modelId} v${version.version}: ` +
          `recorded sha256 ${recordedHash}, actual ${hash}. The stored file is corrupt or was overwritten — ` +
          `re-upload the version before packaging.`,
      );
    }
    const size = buffer.length;

    const packageKey = `models/edge-packages/${deployment.modelId}/${version.version}.pkg`;
    const { url } = await storagePut(packageKey, buffer);

    await db.updateEdgeDeployment(deploymentId, {
      status: "READY",
      packageKey,
      packageUrl: url,
      packageHash: hash,
      packageSize: size,
      packageVersion: version.version,
      errorMessage: null,
    });

    return {
      deploymentId,
      status: "READY",
      packageKey,
      packageUrl: url,
      packageHash: hash,
      packageSize: size,
      packageVersion: version.version,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateEdgeDeployment(deploymentId, { status: "FAILED", errorMessage: message }).catch(() => {});
    throw err;
  }
}

/**
 * Confirm a machine finished downloading + verifying a package.
 * If the machine-reported localHash matches the stored packageHash → DEPLOYED
 * (with deployedAt audit). Otherwise → FAILED (integrity mismatch).
 */
export async function confirmDeployment(
  deploymentId: number,
  localHash: string,
): Promise<{ deploymentId: number; status: "DEPLOYED" | "FAILED"; matched: boolean }> {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const expected = (deployment.packageHash ?? "").toLowerCase();
  const got = (localHash ?? "").toLowerCase();
  const matched = !!expected && expected === got;

  if (matched) {
    const now = new Date();
    // W7-D (doc 27 gap V19) — delivery verification record: the device proved
    // (by sha256) that it holds the exact packaged bytes. Stamped additively in
    // the deployConfig jsonb (NO DDL); the Step-5 wizard reads it to show
    // packaged → downloaded → VERIFIED honestly.
    const deployConfig = {
      ...((deployment.deployConfig as Record<string, unknown> | null) ?? {}),
      deployVerifiedAt: now.toISOString(),
      verifiedHash: got,
    } as InsertEdgeDeployment["deployConfig"];
    await db.updateEdgeDeployment(deploymentId, {
      status: "DEPLOYED",
      deployedAt: now,
      deployConfig,
      errorMessage: null,
    });
    return { deploymentId, status: "DEPLOYED", matched: true };
  }

  await db.updateEdgeDeployment(deploymentId, {
    status: "FAILED",
    errorMessage: `Package hash mismatch: expected ${expected || "(none)"}, got ${got || "(none)"}`,
  });
  return { deploymentId, status: "FAILED", matched: false };
}

/**
 * Record a heartbeat from an edge device. DEPLOYED → ACTIVE (first heartbeat
 * promotes the deployment + stamps activatedAt). ACTIVE stays ACTIVE. Also
 * refreshes lastHeartbeatAt + the machine row's lastHeartbeat when machineId is
 * known.
 */
export async function recordEdgeHeartbeat(
  deploymentId: number,
): Promise<{ deploymentId: number; status: string }> {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const now = new Date();
  const patch: Record<string, unknown> = { lastHeartbeatAt: now };

  if (deployment.status === "DEPLOYED") {
    patch.status = "ACTIVE";
    patch.activatedAt = now;
    patch.errorMessage = null;
  } else if (deployment.status === "OUTDATED" || deployment.status === "FAILED") {
    // A device that comes back online after going stale is healthy again.
    patch.status = "ACTIVE";
    patch.errorMessage = null;
  }

  const updated = await db.updateEdgeDeployment(deploymentId, patch);

  if (deployment.machineId) {
    await updateMachineHeartbeat(deployment.machineId).catch(() => {});
  }

  return { deploymentId, status: (updated?.status as string) ?? (patch.status as string) ?? deployment.status };
}

/**
 * Idempotent sync of offline edge inference results.
 *
 * Each result carries a client-generated localResultId. We skip any result whose
 * (deploymentId, localResultId) already exists, so re-sending the same batch
 * (machine retries after a flaky link) never creates duplicates. On success we
 * decrement offlineResultsPending and stamp lastSyncAt.
 */
export async function syncEdgeResults(
  deploymentId: number,
  results: Array<{
    localResultId: string;
    inputReference?: string;
    predictions: unknown;
    confidence: number;
    topLabel: string;
    processingTimeMs?: number;
    inferredAt: Date;
    inspectionId?: number;
  }>,
): Promise<{ synced: number; duplicates: number }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  let synced = 0;
  let duplicates = 0;

  for (const result of results) {
    // Idempotency guard — check existing (deploymentId, localResultId).
    const existing = await database
      .select({ id: edgeInferenceSync.id })
      .from(edgeInferenceSync)
      .where(
        and(
          eq(edgeInferenceSync.deploymentId, deploymentId),
          eq(edgeInferenceSync.localResultId, result.localResultId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      duplicates++;
      continue;
    }

    await db.createEdgeInferenceSync({
      deploymentId,
      modelId: deployment.modelId,
      modelVersion: deployment.modelVersion,
      deviceId: deployment.deviceId,
      inputReference: result.inputReference,
      predictions: result.predictions as any,
      confidence: result.confidence,
      topLabel: result.topLabel,
      processingTimeMs: result.processingTimeMs,
      inferredAt: result.inferredAt,
      inspectionId: result.inspectionId,
      localResultId: result.localResultId,
      synced: true,
      syncedAt: new Date(),
    } as any);
    synced++;
  }

  await db.updateEdgeDeployment(deploymentId, {
    lastSyncAt: new Date(),
    offlineResultsPending: Math.max(0, (deployment.offlineResultsPending ?? 0) - synced),
  });

  return { synced, duplicates };
}

/**
 * Stale checker — mark ACTIVE deployments whose last heartbeat is older than
 * thresholdMinutes as OUTDATED (device presumed offline). Returns affected ids.
 * Reuses db.getStaleDeployments (ACTIVE + lastHeartbeatAt < threshold).
 */
export async function markStaleDeployments(thresholdMinutes = 15): Promise<number[]> {
  const stale = await db.getStaleDeployments(thresholdMinutes);
  const ids: number[] = [];
  for (const d of stale) {
    await db.updateEdgeDeployment(d.id, {
      status: "OUTDATED",
      errorMessage: `No heartbeat for >${thresholdMinutes} min — device offline`,
    });
    ids.push(d.id);
  }
  return ids;
}

// ─── Fleet management + rollback ───────────────────────────────────────────
// (Phase-4.1 quantization / OTA / batch-deploy / conflict-sync helpers, only
//  reachable via the disabled aiEdgeEnhancedRouter, were removed — cleanup X1.)

/**
 * Rollback a device to its previous model version
 */
export async function rollbackDevice(deploymentId: number): Promise<{ rolledBack: boolean; previousVersion?: string }> {
  const deployment = await db.getEdgeDeployment(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const config = deployment.deployConfig as Record<string, unknown> ?? {};
  const previousDeploymentId = config.previousDeploymentId as number | undefined;

  if (!previousDeploymentId) {
    throw new Error("No previous deployment found for rollback");
  }

  // Restore previous deployment
  const previousDeployment = await db.getEdgeDeployment(previousDeploymentId);
  if (!previousDeployment) {
    throw new Error("Previous deployment record not found");
  }

  // Mark current as rolled back
  await db.updateEdgeDeployment(deploymentId, {
    status: "FAILED",
    errorMessage: "Rolled back to previous version",
  });

  // Reactivate previous deployment
  await db.updateEdgeDeployment(previousDeploymentId, {
    status: "ACTIVE",
    errorMessage: null,
    lastHeartbeatAt: new Date(),
  });

  return {
    rolledBack: true,
    previousVersion: previousDeployment.modelVersion ?? undefined,
  };
}

// ─── 3. Device Fleet Management ───────────────────────────────────────────

/**
 * Get comprehensive fleet overview with all device statuses
 */
export async function getFleetOverview(): Promise<FleetOverview> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const onlineThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min threshold
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Get all unique devices with their latest deployment
  const devicesResult = (await database.execute(
    sql`SELECT DISTINCT ON (device_id)
          id, model_id, model_version, device_id, device_name, device_type,
          machine_id, status, last_heartbeat_at, offline_results_pending
        FROM edge_deployments
        ORDER BY device_id, created_at DESC`
  )) as any;

  const devices: FleetDevice[] = [];
  let onlineCount = 0;
  let totalInferenceTime = 0;
  let inferenceTimeCount = 0;

  for (const row of devicesResult.rows ?? devicesResult) {
    // Get inference stats for this device
    const inferenceStats = (await database.execute(
      sql`SELECT 
            COUNT(*)::int as total_inferences,
            AVG(processing_time_ms)::float as avg_time
          FROM edge_inference_sync
          WHERE device_id = ${row.device_id}
            AND created_at >= ${todayStart.toISOString()}`
    )) as any;

    const stats = (inferenceStats.rows ?? inferenceStats)[0] ?? {};
    const isOnline = row.last_heartbeat_at && new Date(row.last_heartbeat_at) > onlineThreshold;

    if (isOnline) onlineCount++;
    if (stats.avg_time) {
      totalInferenceTime += stats.avg_time;
      inferenceTimeCount++;
    }

    devices.push({
      deviceId: row.device_id,
      deviceName: row.device_name ?? row.device_id,
      deviceType: row.device_type ?? "GENERIC",
      machineId: row.machine_id,
      status: row.status,
      currentModel: row.model_id ? String(row.model_id) : undefined,
      currentVersion: row.model_version ?? undefined,
      lastHeartbeat: row.last_heartbeat_at,
      avgInferenceTime: stats.avg_time ? Number(stats.avg_time.toFixed(1)) : undefined,
      totalInferences: stats.total_inferences ?? 0,
      isOnline: !!isOnline,
    });
  }

  // Get pending updates count
  const pendingResult = (await database.execute(
    sql`SELECT COUNT(*)::int as count FROM edge_deployments 
        WHERE status IN ('PENDING', 'PACKAGING', 'DOWNLOADING')`
  )) as any;
  const pendingUpdates = (pendingResult.rows ?? pendingResult)[0]?.count ?? 0;

  // Get today's total inferences
  const todayInferences = (await database.execute(
    sql`SELECT COUNT(*)::int as count FROM edge_inference_sync WHERE created_at >= ${todayStart.toISOString()}`
  )) as any;
  const totalInferencesToday = (todayInferences.rows ?? todayInferences)[0]?.count ?? 0;

  return {
    totalDevices: devices.length,
    onlineDevices: onlineCount,
    offlineDevices: devices.length - onlineCount,
    activeDeployments: devices.filter(d => d.status === "ACTIVE").length,
    pendingUpdates,
    avgInferenceTime: inferenceTimeCount > 0
      ? Number((totalInferenceTime / inferenceTimeCount).toFixed(1))
      : 0,
    totalInferencesToday,
    devices,
  };
}
