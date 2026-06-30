/**
 * Khối 2 (doc 16 §7 / §15 G1) — FLEET & TASK ORCHESTRATION router.  Flag: FLEET_ORCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the Dynamic Task Allocation Engine (taskAllocator) and the Zone
 * Traffic/Path manager (trafficManager).
 *
 * SAFETY (ABSOLUTE): this router writes orchestration STATE only (tasks/zones/
 * reservations). It opens NO device path — actual robot/device commands continue to
 * route through the EXISTING gated dispatchers (robotCommandDispatcher /
 * commandDispatcher, dry-run by default). Mutating actions additionally require
 * FLEET_ORCH_ENABLED (off → CONFLICT "fleet orchestration disabled").
 *
 * RBAC (module-level, mirrors orchestrationRouter):
 *   • read  ops → machine_monitoring / canView
 *   • create/cancel/assign/reserve → machine_control / canCreate
 *   • delete-ish (none here; cancel is a status flip)
 * ctx.user is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { tasks, zones, zoneReservations } from "../../drizzle/schema";
import { fleetOrchEnabled, allocateTask, rebalanceDeviceTasks } from "../services/fleet/taskAllocator";
import { reserveZone, releaseZone, getZoneOccupancy, detectDeadlocks } from "../services/fleet/trafficManager";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

/** Guard mutating actions behind the flag (matches the orchestrationRouter discipline). */
function requireFlag() {
  if (!fleetOrchEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Fleet orchestration disabled (set FLEET_ORCH_ENABLED=true)" });
  }
}

const TASK_STATUSES = ["pending", "assigned", "running", "completed", "failed", "cancelled"] as const;

export const fleetRouter = router({
  /** UI gating hint — is the fleet flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: fleetOrchEnabled() })),

  // ── TASKS (read) ──────────────────────────────────────────────────────────
  listTasks: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          status: z.enum(TASK_STATUSES).optional(),
          deviceId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.status) conds.push(eq(tasks.status, input.status));
      if (input?.deviceId != null) conds.push(eq(tasks.assignedDeviceId, input.deviceId));
      return d
        .select()
        .from(tasks)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(tasks.priority), desc(tasks.createdAt))
        .limit(input?.limit ?? 100);
    }),

  getTask: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(tasks).where(eq(tasks.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Task ${input.id} not found` });
      return row;
    }),

  // ── ZONES + occupancy (read) ──────────────────────────────────────────────
  listZones: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await db();
      const rows = await d.select().from(zones).orderBy(zones.code);
      // Derive occupancy (active reservation count) per zone.
      const out = [];
      for (const z of rows) out.push({ ...z, occupancy: await getZoneOccupancy(z.id) });
      return out;
    }),

  listReservations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          zoneId: z.number().int().positive().optional(),
          deviceId: z.number().int().positive().optional(),
          status: z.enum(["active", "queued", "released", "rejected"]).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.zoneId != null) conds.push(eq(zoneReservations.zoneId, input.zoneId));
      if (input?.deviceId != null) conds.push(eq(zoneReservations.deviceId, input.deviceId));
      if (input?.status) conds.push(eq(zoneReservations.status, input.status));
      return d
        .select()
        .from(zoneReservations)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(zoneReservations.createdAt))
        .limit(input?.limit ?? 200);
    }),

  /** Live deadlock check over the reservation wait-graph (read-only). */
  deadlocks: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => detectDeadlocks()),

  // ── TASKS (admin actions) — flag-gated ────────────────────────────────────
  createTask: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        taskKey: z.string().min(1).max(128),
        requiredCapability: z.string().min(1).max(64),
        sourceWorkOrderId: z.number().int().positive().optional(),
        priority: z.number().int().min(1).max(5).default(3),
        locationStart: z.string().max(64).optional(),
        locationEnd: z.string().max(64).optional(),
        estimatedDurationMs: z.number().int().min(0).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
        autoAllocate: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      // Idempotent on taskKey — replay returns the prior row.
      const [existing] = await d.select().from(tasks).where(eq(tasks.taskKey, input.taskKey)).limit(1);
      if (existing) return { ok: true, id: existing.id, created: false };
      const [row] = await d
        .insert(tasks)
        .values({
          taskKey: input.taskKey,
          requiredCapability: input.requiredCapability,
          sourceWorkOrderId: input.sourceWorkOrderId ?? null,
          priority: input.priority,
          status: "pending",
          locationStart: input.locationStart ?? null,
          locationEnd: input.locationEnd ?? null,
          estimatedDurationMs: input.estimatedDurationMs ?? null,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: tasks.id });
      let allocation;
      if (input.autoAllocate && row) allocation = await allocateTask(row.id);
      return { ok: true, id: row?.id, created: true, allocation };
    }),

  /** Run the allocator on a pending task (assign best device). */
  allocate: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return allocateTask(input.taskId);
    }),

  /** Manually (re)assign a task to a specific device. */
  assign: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive(), deviceId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [t] = await d.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: `Task ${input.taskId} not found` });
      if (["completed", "cancelled"].includes(t.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Task ${input.taskId} is terminal (${t.status})` });
      }
      await d
        .update(tasks)
        .set({ status: "assigned", assignedDeviceId: input.deviceId, assignedDeviceKind: "robot", assignedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));
      return { ok: true };
    }),

  /** Rebalance a device's open tasks (e.g. after it went offline). */
  rebalanceDevice: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ deviceId: z.number().int().positive(), reason: z.string().max(200).optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return rebalanceDeviceTasks(input.deviceId, input.reason);
    }),

  /** Cancel a task (terminal). */
  cancelTask: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive(), reason: z.string().max(200).optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [t] = await d.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: `Task ${input.taskId} not found` });
      if (["completed", "cancelled", "failed"].includes(t.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Task ${input.taskId} already terminal (${t.status})` });
      }
      await d
        .update(tasks)
        .set({ status: "cancelled", lastError: input.reason ?? "cancelled by operator", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));
      return { ok: true };
    }),

  // ── ZONES + reservations (admin actions) — flag-gated ─────────────────────
  createZone: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        zoneType: z.enum(["production", "transit", "charging", "human_shared"]).default("production"),
        maxConcurrentRobots: z.number().int().min(1).max(100).default(1),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [clash] = await d.select().from(zones).where(eq(zones.code, input.code)).limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `Zone code "${input.code}" already exists` });
      const [row] = await d
        .insert(zones)
        .values({
          code: input.code,
          name: input.name,
          zoneType: input.zoneType,
          maxConcurrentRobots: input.maxConcurrentRobots,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: zones.id });
      return { ok: true, id: row?.id };
    }),

  reserve: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        zoneId: z.number().int().positive(),
        deviceId: z.number().int().positive(),
        taskId: z.number().int().positive().optional(),
        queueIfFull: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      return reserveZone({ zoneId: input.zoneId, deviceId: input.deviceId, taskId: input.taskId ?? null, queueIfFull: input.queueIfFull });
    }),

  release: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ deviceId: z.number().int().positive(), zoneId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return releaseZone(input.deviceId, input.zoneId);
    }),
});
