/**
 * WS-2 — Edge Deployment admin router (admin-facing control plane).
 *
 * Created as a NEW router (rather than re-enabling the disabled
 * aiEdgeEnhancedRouter) so it is safe alongside the in-flight local-AI
 * migration. Mounted as `edgeDeployment` in server/routers.ts.
 *
 * License gating: enforced at the Express layer (licenseEnforcementMiddleware
 * on /api/trpc). There is no per-procedure license hook in this repo, so the
 * whole tRPC surface (incl. this router) is covered by that middleware.
 *
 * All procedures are admin-only (adminProcedure → role admin + 2FA, IEC 62443).
 */
import { router, adminProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as aiAdvancedDb from "../db/aiAdvanced";
import { getMachineById } from "../db/hierarchy";
import {
  packageModelForDeployment,
  getFleetOverview,
  rollbackDevice,
  markStaleDeployments,
} from "../services/aiEdgeEnhanced";
import { publishModelUpdate } from "../services/mqttService";
import { emitMachineModelAvailable } from "../_core/socket";

const deployConfigSchema = z.object({
  quantization: z.enum(["fp32", "fp16", "int8"]).optional(),
  runtime: z.enum(["ONNX", "TENSORRT", "OPENVINO"]).optional(),
  maxBatchSize: z.number().int().positive().optional(),
  optimizationLevel: z.enum(["basic", "extended", "full"]).optional(),
}).optional();

/** Best-effort notify (MQTT retain + Socket). Never throws into the request. */
async function notifyModelAvailable(deploymentId: number): Promise<void> {
  try {
    const d = await aiAdvancedDb.getEdgeDeployment(deploymentId);
    if (!d) return;
    publishModelUpdate(d.deviceId, d.id, d.packageVersion, d.packageHash);
    emitMachineModelAvailable({
      machineId: d.machineId,
      deviceId: d.deviceId,
      deploymentId: d.id,
      packageVersion: d.packageVersion,
      packageHash: d.packageHash,
    });
  } catch (err) {
    console.error("[edgeDeployment] notify failed:", (err as any)?.message || err);
  }
}

export const edgeDeploymentRouter = router({
  // deployModel — create a deployment record for (model, version, machine/device)
  // then trigger PACKAGING. On READY, notify the device (MQTT + Socket signal).
  deployModel: adminProcedure
    .input(z.object({
      modelId: z.number().int().positive(),
      modelVersion: z.string().min(1).max(50),
      machineId: z.number().int().positive().optional(),
      deviceId: z.string().min(1).max(100).optional(),
      deviceName: z.string().max(255).optional(),
      deviceType: z.string().max(100).optional(),
      deployConfig: deployConfigSchema,
    }).refine((d) => d.machineId || d.deviceId, {
      message: "Either machineId or deviceId must be provided",
    }))
    .mutation(async ({ input, ctx }) => {
      // Resolve deviceId from machine when only machineId given.
      let deviceId = input.deviceId;
      let deviceName = input.deviceName;
      let machineId = input.machineId;
      if (machineId && !deviceId) {
        const machine = await getMachineById(machineId);
        if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
        deviceId = machine.code;
        deviceName = deviceName ?? machine.name;
      }
      if (!deviceId) throw new TRPCError({ code: "BAD_REQUEST", message: "deviceId could not be resolved" });

      const created = await aiAdvancedDb.createEdgeDeployment({
        modelId: input.modelId,
        modelVersion: input.modelVersion,
        deviceId,
        deviceName: deviceName ?? deviceId,
        deviceType: input.deviceType ?? "AOI_MACHINE",
        machineId: machineId ?? undefined,
        status: "PENDING",
        deployConfig: input.deployConfig ?? {
          quantization: "fp32",
          runtime: "ONNX",
          maxBatchSize: 1,
          optimizationLevel: "basic",
        },
        createdBy: ctx.user.id,
      });

      // Trigger packaging (synchronous; packages are produced from existing files).
      const pkg = await packageModelForDeployment(created.id);

      if (pkg.status === "READY") {
        await notifyModelAvailable(created.id);
      }

      return { success: true, deploymentId: created.id, package: pkg };
    }),

  getDeploymentStatus: adminProcedure
    .input(z.object({ deploymentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      return d;
    }),

  listDeployments: adminProcedure
    .input(z.object({
      modelId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    }).optional())
    .query(async ({ input }) => {
      return aiAdvancedDb.getEdgeDeployments(input ?? undefined);
    }),

  getFleetOverview: adminProcedure.query(async () => {
    return getFleetOverview();
  }),

  // Doc 38 T-1 (P1) — UNIFIED fleet-status view: edge_deployments + edge_nodes +
  // device_adapters in one read-only overview (getFleetOverview only covers
  // deployments). Read-only aggregation; admin-only like the rest of this router.
  getUnifiedFleetStatus: adminProcedure.query(async () => {
    const { getUnifiedFleetStatus } = await import("../services/fleetStatusService");
    return getUnifiedFleetStatus();
  }),

  // redeploy — re-package an existing deployment (e.g. after a failed/outdated
  // state) and re-notify the device.
  redeploy: adminProcedure
    .input(z.object({ deploymentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const existing = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      const pkg = await packageModelForDeployment(input.deploymentId);
      if (pkg.status === "READY") await notifyModelAvailable(input.deploymentId);
      return { success: true, deploymentId: input.deploymentId, package: pkg };
    }),

  rollback: adminProcedure
    .input(z.object({ deploymentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const result = await rollbackDevice(input.deploymentId);
      return { success: result.rolledBack, ...result };
    }),

  // testConnection — ad-hoc reachability test for the onboarding wizard (Step 2).
  // Reuses the socket layer's testManualConnection (HTTP/TCP/WS) without needing
  // a persisted manualConnection row. Returns latency + reachability.
  testConnection: adminProcedure
    .input(z.object({
      ipAddress: z.string().min(1).max(45),
      port: z.number().int().min(1).max(65535),
      protocol: z.enum(["websocket", "tcp", "http"]).default("tcp"),
      timeoutMs: z.number().int().min(500).max(30000).optional(),
    }))
    .mutation(async ({ input }) => {
      const { testManualConnection } = await import("../_core/socket");
      const result = await testManualConnection(
        input.ipAddress,
        input.port,
        input.protocol,
        input.timeoutMs ?? 5000,
      );
      return result;
    }),

  // checkStale — admin-triggerable stale sweep (also runs on a scheduler).
  checkStale: adminProcedure
    .input(z.object({ thresholdMinutes: z.number().int().min(1).max(1440).optional() }).optional())
    .mutation(async ({ input }) => {
      const ids = await markStaleDeployments(input?.thresholdMinutes ?? 15);
      return { success: true, markedOutdated: ids.length, deploymentIds: ids };
    }),
});
