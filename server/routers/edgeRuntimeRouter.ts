/**
 * Phase E4 — Factory Control Plane: EDGE RUNTIME router (key "edgeRuntime").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the EDGE COORDINATOR (server/services/edge/edgeCoordinator.ts):
 * register / list / heartbeat edge nodes, assign a workflow RUN to a node, and
 * receive synced run results (edge→central). A parallel /api/v1/edge/sync endpoint
 * (server/api/v1/router.ts) lets headless edge nodes sync via a scoped API key.
 *
 * SAFETY / HONESTY: this router opens NO device path. The edge runtime REUSES the E2
 * FOE engine, and every command still routes through equipmentRegistry → HITL/dry-run
 * dispatcher. It is COORDINATION only — hard-RT + safety stay on the L1 PLC. Flag-gated
 * by EDGE_RUNTIME_ENABLED (off → the coordinator returns a `disabled` result).
 *
 * RBAC (module-level):
 *   • write ops (register/heartbeat/assignRun/syncRunResult) → machine_control / canCreate.
 *   • read ops  (listNodes/nodeStatus/status) → machine_monitoring / canView.
 * The session user (ctx.user) is the source of truth.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  registerNode,
  listNodes,
  getNode,
  heartbeat,
  assignRun,
  syncRunResult,
  listRunsForNode,
  deleteNode,
  edgeRuntimeEnabled,
} from "../services/edge/edgeCoordinator";

const syncedStepSchema = z.object({
  stepId: z.string().min(1).max(128),
  stepType: z.string().min(1).max(32),
  status: z.string().min(1).max(32),
  attempt: z.number().int().min(0).optional(),
  result: z.record(z.string(), z.unknown()).nullish(),
  error: z.string().nullish(),
  startedAt: z.union([z.string(), z.date()]).nullish(),
  finishedAt: z.union([z.string(), z.date()]).nullish(),
});

export const edgeRuntimeRouter = router({
  /** Whether the edge runtime flag is enabled (UI gating hint). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: edgeRuntimeEnabled() })),

  /** List registered edge nodes (optionally by factory). */
  listNodes: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ factoryCode: z.string().max(128).optional() }).optional())
    .query(async ({ input }) => listNodes(input?.factoryCode)),

  /** Status of one node + the runs delegated to it. */
  nodeStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const node = await getNode(input.code);
      if (!node) return { node: null, runs: [] };
      const runs = await listRunsForNode(node.id);
      return { node, runs };
    }),

  /** Register (upsert) an edge node. Flag-gated. */
  registerNode: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(128),
        name: z.string().max(255).optional(),
        factoryCode: z.string().max(128).nullish(),
        assignedLineCodes: z.array(z.string().max(128)).nullish(),
        version: z.string().max(64).nullish(),
      }),
    )
    .mutation(async ({ input }) => registerNode(input)),

  /** Heartbeat from an edge node. Flag-gated. */
  heartbeat: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(128),
        status: z.enum(["online", "degraded"]).optional(),
        version: z.string().max(64).nullish(),
        health: z.record(z.string(), z.unknown()).nullish(),
      }),
    )
    .mutation(async ({ input }) => heartbeat(input)),

  /**
   * Deregister (delete) an edge node. Flag-gated; guarded against deleting a node that
   * still has non-terminal runs delegated to it. RBAC: machine_control / canDelete.
   */
  deleteNode: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => deleteNode(input.id)),

  /** Delegate a workflow RUN to an edge node. Flag-gated. */
  assignRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ runId: z.number().int().positive(), edgeNodeId: z.number().int().positive() }))
    .mutation(async ({ input }) => assignRun(input.runId, input.edgeNodeId)),

  /**
   * Receive a run-result SYNC from an edge node (edge→central). Idempotent — replays
   * upsert the same rows. Also exposed as POST /api/v1/edge/sync for headless nodes.
   */
  syncRunResult: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        edgeNodeCode: z.string().min(1).max(128),
        runId: z.number().int().positive(),
        status: z.string().min(1).max(32),
        error: z.string().nullish(),
        currentStepId: z.string().max(128).nullish(),
        contextJson: z.record(z.string(), z.unknown()).nullish(),
        startedAt: z.union([z.string(), z.date()]).nullish(),
        finishedAt: z.union([z.string(), z.date()]).nullish(),
        steps: z.array(syncedStepSchema).default([]),
      }),
    )
    .mutation(async ({ input }) => syncRunResult(input)),
});
