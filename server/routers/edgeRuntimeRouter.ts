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
import { nutEdgeGhi } from "./_cauHinhPhamVi";
import { congMaTenant } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { edgeNodes } from "../../drizzle/schema";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
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
// doc 81 Đợt 5 task E2 fix (ruling R-5-d) — the orchestration factory scope: a run outside the caller's scope does not
// exist for them here either (assign / sync are cross-factory mutations; nodeStatus lists only visible runs).
import { filterRunsVisibleTo, runIdVisibleTo } from "../services/orchestration/foe/foeEngine";
import { resolveUserFoeScope } from "../services/orchestration/foe/foeScope";

const scopeOf = (user: { id: number; role: string }) => resolveUserFoeScope({ id: user.id, role: String(user.role) });
/** The coordinator's own answer for a missing run (disabled first, as it does). */
const runNotFound = (runId: number) =>
  edgeRuntimeEnabled()
    ? { ok: false as const, enabled: true, message: `Run ${runId} not found.` }
    : { ok: false as const, enabled: false, message: "Edge runtime is disabled (set EDGE_RUNTIME_ENABLED=true)." };

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
    // phạm vi người dùng (L6c 2026-10-25): nút edge theo MÃ nhà máy của nó; nút không gắn nhà máy chỉ toàn quyền thấy
    .query(async ({ input, ctx }) => listNodes(input?.factoryCode, await congMaTenant({ factoryCode: edgeNodes.factoryCode }, phamViCua(ctx)))),

  /** Status of one node + the runs delegated to it. */
  nodeStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(128) }))
    .query(async ({ input, ctx }) => {
      const node = await getNode(input.code);
      if (!node) return { node: null, runs: [] };
      const runs = await filterRunsVisibleTo(await listRunsForNode(node.id), scopeOf(ctx.user)); // E2 fix (R-5-d)
      return { node, runs };
    }),

  /**
   * Register (upsert) an edge node. Flag-gated. doc 81 Đợt 10 F2 round 3 (R-10-bl, decision D14): ADMIN ONLY, like the
   * `edge-node-credential.ts register-node` CLI — a node's factory decides which devices and runs it may get. The
   * machine_control:canCreate grant is still required on top (never a widening).
   */
  registerNode: adminProcedure
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

  /**
   * doc 81 Đợt 12 task O — RETIRE an edge node for good (mig 0378): ADMIN ONLY (like `edge-node-credential.ts retire-node`), plus
   * machine_control:canDelete on top (never a widening). The actor is the SESSION admin, never an id from the input. Refused —
   * naming what blocks it, nothing changed — while the node owns a device, has an unacknowledged STOP / lock request or a
   * non-terminal run; otherwise every active credential is revoked and the node marked retired in one transaction (never
   * deleted). Audited EDGE_NODE_RETIRE by the service. Not flag-gated: a teardown must work with the edge runtime off.
   */
  retireNode: adminProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ code: z.string().trim().min(1).max(128), reason: z.string().trim().min(3).max(500) }).strict())
    .mutation(async ({ input, ctx }) => {
      const { retireEdgeNode, EdgeCredentialError } = await import("../services/edge/edgeNodeCredentials");
      try {
        const r = await retireEdgeNode({ nodeCode: input.code, actorUserId: ctx.user!.id, reason: input.reason });
        return { ok: true as const, ...r };
      } catch (err) {
        if (!(err instanceof EdgeCredentialError)) throw err;
        if (err.code === "nodeNotFound") throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "edgeNode" }, err.message);
        if (err.code === "notAdmin") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "adminAccess" }, err.message);
        if (err.code === "dbUnavailable") throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, err.message);
        // the blockers (ids, from the DB guard) travel as a param of their own; the message stays the full technical detail
        if (err.code === "retireBlocked") throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "retireEdgeNode", reason: "edgeNodeRetireBlocked", blockers: err.blockers ?? "" }, err.message);
        if (err.code === "nodeRetired") throw appError("CONFLICT", "OPERATION_FAILED", { operation: "retireEdgeNode", reason: "edgeNodeAlreadyRetired" }, err.message);
        // fix 1 (O-R3) — the node row was held by another change past the retirement's lock_timeout: retry
        if (err.code === "nodeBusy") throw appError("CONFLICT", "OPERATION_FAILED", { operation: "retireEdgeNode", reason: "edgeNodeBusy" }, err.message);
        // doc 81 Đợt 12 final fix wave (R-12-e M-7) — migration 0378 not applied: a precondition of the database, not "database unavailable"
        if (err.code === "migrationMissing") throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "retireEdgeNode", reason: "edgeNodeRetireMigrationMissing" }, err.message);
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "retireEdgeNode" }, err.message);
      }
    }),

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
    .mutation(async ({ input, ctx }) => {
      await nutEdgeGhi(ctx, input.id); // phạm vi nhà máy (W14b)
      return deleteNode(input.id);
    }),

  /** Delegate a workflow RUN to an edge node. Flag-gated. */
  assignRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ runId: z.number().int().positive(), edgeNodeId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) =>
      (await runIdVisibleTo(input.runId, scopeOf(ctx.user))) ? assignRun(input.runId, input.edgeNodeId) : runNotFound(input.runId),
    ),

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
    .mutation(async ({ input, ctx }) =>
      (await runIdVisibleTo(input.runId, scopeOf(ctx.user))) ? syncRunResult(input) : runNotFound(input.runId),
    ),
});
