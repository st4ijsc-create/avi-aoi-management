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
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, actuationProcedure as actuationBase } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
// Doc 37 P0-3 — gate the fleet-orchestration (OT) surface behind MOD_OT_CONTROL
// (flag LICENSE_MODULE_GATE_ENABLED → pass-through until SKU configured). Shadows
// `protectedProcedure`; per-action RBAC + FLEET_ORCH_ENABLED guards are unchanged.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
// Doc 38 Đợt Q — every fleet WRITE (task/zone/reservation/resource/charging) drives
// robot/AMR movement → actuation role-floor (admin/supervisor/engineer) + 2FA, plus
// the MOD_OT_CONTROL license gate. requirePermission("machine_control", …) composes on top.
const actuationProcedure = actuationBase.use(moduleGate("MOD_OT_CONTROL"));
import { tasks, zones, zoneReservations, robots, robotTelemetry } from "../../drizzle/schema";
import { operationCodes, operationProgramMap, programVariants, sharedResources, resourceReservations, chargerStations, batteryChargingPlans } from "../../drizzle/schema/fleetResource";
import { fleetOrchEnabled, allocateTask, rebalanceDeviceTasks, deviceSupportsCapability } from "../services/fleet/taskAllocator";
import { publishTaskEvent } from "../services/ecosystem/ecosystemEvents";
import { reserveZone, releaseZone, getZoneOccupancy, detectDeadlocks, resolveDeadlock } from "../services/fleet/trafficManager";
// G2 (doc 16 §7 c&d / §15 G2) — Skill/Resource/Charging. Flag: FLEET_RESOURCE_ENABLED.
import { fleetResourceEnabled, resolveOperation } from "../services/fleet/skillRegistry";
import { pickVariantForProgram, recordVariantOutcome } from "../services/fleet/variantPicker";
import { claimResource, releaseResource, getResourceAvailability } from "../services/fleet/resourceManager";
import { sweepChargingPlans } from "../services/fleet/chargingPlanner";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Guard mutating actions behind the flag (matches the orchestrationRouter discipline). */
function requireFlag() {
  if (!fleetOrchEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Fleet orchestration disabled (set FLEET_ORCH_ENABLED=true)" });
  }
}

/** G2 — guard skill/resource/charging mutations behind FLEET_RESOURCE_ENABLED. */
function requireResourceFlag() {
  if (!fleetResourceEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Fleet resource layer disabled (set FLEET_RESOURCE_ENABLED=true)" });
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
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "fleetTask" }, `Task ${input.id} not found`);
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

  /**
   * W4-18 (3) — live robot positions for the fleet MAP. Latest telemetry pose per
   * enabled robot → { x,y } (from poseJson.cartesian), plus status/battery/zone. Read
   * only (machine_monitoring/canView); returns [] when no db / no robots. Coordinates
   * are null when a robot has no cartesian pose yet (rendered as "unlocated").
   */
  robotPositions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await db();
      const robotRows = await d.select().from(robots).where(eq(robots.isEnabled, true));
      if (robotRows.length === 0) return [];
      const ids = robotRows.map((r) => r.id);
      const telRows = await d
        .select()
        .from(robotTelemetry)
        .where(inArray(robotTelemetry.robotId, ids))
        .orderBy(desc(robotTelemetry.timestamp));
      const latest = new Map<number, (typeof telRows)[number]>();
      for (const tel of telRows) if (!latest.has(tel.robotId)) latest.set(tel.robotId, tel);
      return robotRows.map((r) => {
        const tel = latest.get(r.id);
        const pose = (tel?.poseJson ?? null) as Record<string, unknown> | null;
        const cart = pose?.cartesian as { x?: number; y?: number } | undefined;
        const b = pose?.battery as { charge?: number } | number | undefined;
        const battery =
          typeof b === "number" ? b : b && typeof b.charge === "number" ? b.charge : null;
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          kind: r.kind as string,
          status: r.status,
          x: cart && typeof cart.x === "number" ? cart.x : null,
          y: cart && typeof cart.y === "number" ? cart.y : null,
          zoneId: tel?.safetyZoneId ?? null,
          battery,
        };
      });
    }),

  // ── TASKS (admin actions) — flag-gated ────────────────────────────────────
  createTask: actuationProcedure
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
  allocate: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return allocateTask(input.taskId);
    }),

  /** Manually (re)assign a task to a specific device. */
  assign: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive(), deviceId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [t] = await d.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (!t) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "fleetTask" }, `Task ${input.taskId} not found`);
      if (["completed", "cancelled"].includes(t.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Task ${input.taskId} is terminal (${t.status})` });
      }
      // W4-18 (2) — VALIDATE the destination device before writing the assignment.
      // (a) must exist AND be enabled, (b) must be online (not offline/estop),
      // (c) its capability class must support the task's requiredCapability. This closes
      // the gap where a manual reassign blindly wrote any deviceId (fake "success").
      const [robot] = await d.select().from(robots).where(eq(robots.id, input.deviceId)).limit(1);
      if (!robot || !robot.isEnabled) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, `Device ${input.deviceId} not found or not enabled`);
      }
      if (robot.status === "offline" || robot.status === "estop") {
        throw new TRPCError({ code: "CONFLICT", message: `Device ${input.deviceId} is ${robot.status} — cannot assign work` });
      }
      if (!deviceSupportsCapability(robot.kind, t.requiredCapability)) {
        throw new TRPCError({ code: "CONFLICT", message: `Device ${input.deviceId} (${robot.kind}) does not support capability "${t.requiredCapability}"` });
      }
      await d
        .update(tasks)
        .set({ status: "assigned", assignedDeviceId: input.deviceId, assignedDeviceKind: "robot", assignedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));
      // U1-a — publish task.assigned for the manual (re)assign path too.
      publishTaskEvent("assigned", {
        taskId: input.taskId,
        taskKey: t.taskKey,
        requiredCapability: t.requiredCapability,
        assignedDeviceId: input.deviceId,
        robotId: input.deviceId,
        status: "assigned",
        priority: t.priority,
        corporateCode: t.corporateCode,
        factoryId: t.factoryId,
      });
      return { ok: true };
    }),

  /**
   * Mark a task terminal — `completed` (default) or `failed`. This is the explicit
   * completion transition a FOE workflow / scheduler calls when a task's device work
   * finishes. Publishes task.completed / task.failed on the eventBus (U1-a).
   */
  completeTask: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        taskId: z.number().int().positive(),
        outcome: z.enum(["completed", "failed"]).default("completed"),
        error: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [t] = await d.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (!t) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "fleetTask" }, `Task ${input.taskId} not found`);
      if (["completed", "cancelled", "failed"].includes(t.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Task ${input.taskId} already terminal (${t.status})` });
      }
      await d
        .update(tasks)
        .set({
          status: input.outcome,
          lastError: input.outcome === "failed" ? (input.error ?? "task failed") : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId));
      publishTaskEvent(input.outcome, {
        taskId: input.taskId,
        taskKey: t.taskKey,
        requiredCapability: t.requiredCapability,
        assignedDeviceId: t.assignedDeviceId,
        robotId: t.assignedDeviceId,
        status: input.outcome,
        priority: t.priority,
        corporateCode: t.corporateCode,
        factoryId: t.factoryId,
        error: input.outcome === "failed" ? (input.error ?? null) : null,
      });
      return { ok: true };
    }),

  /** Rebalance a device's open tasks (e.g. after it went offline). */
  rebalanceDevice: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ deviceId: z.number().int().positive(), reason: z.string().max(200).optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return rebalanceDeviceTasks(input.deviceId, input.reason);
    }),

  /** Cancel a task (terminal). */
  cancelTask: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ taskId: z.number().int().positive(), reason: z.string().max(200).optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      const d = await db();
      const [t] = await d.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (!t) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "fleetTask" }, `Task ${input.taskId} not found`);
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
  createZone: actuationProcedure
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

  reserve: actuationProcedure
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

  release: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ deviceId: z.number().int().positive(), zoneId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      requireFlag();
      return releaseZone(input.deviceId, input.zoneId);
    }),

  /**
   * W4-18 (5) — ADVISORY deadlock resolution. Cancels the lowest-priority queued
   * waiter in each detected cycle to break it (reservation STATE only, no device
   * command). Flag-gated + machine_control/canCreate.
   */
  resolveDeadlock: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .mutation(async () => {
      requireFlag();
      return resolveDeadlock();
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // G2 (doc 16 §7 c&d / §15 G2) — Skill/Operation registry, A/B variants, shared
  // resources, predictive charging.  READS gated machine_monitoring/canView;
  // MUTATIONS gated machine_control/canCreate + requireResourceFlag (FLEET_RESOURCE_ENABLED).
  // ══════════════════════════════════════════════════════════════════════════

  /** UI gating hint — is the G2 resource flag on? */
  resourceStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: fleetResourceEnabled() })),

  // ── G2-a OPERATIONS (read) ─────────────────────────────────────────────────
  listOperations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d.select().from(operationCodes).orderBy(operationCodes.code).limit(input?.limit ?? 200);
    }),

  /** Resolve an operation → { requiredCapability, requiredSkillIds, qualifiedPrograms }. */
  resolveOperation: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(64), deviceKind: z.string().max(32).optional() }))
    .query(async ({ input }) => {
      const r = await resolveOperation(input.code, input.deviceKind ?? null);
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: `Operation "${input.code}" not found` });
      return r;
    }),

  // ── G2-a OPERATIONS (admin) — flag-gated ───────────────────────────────────
  createOperation: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        description: z.string().max(2000).optional(),
        requiredCapability: z.string().min(1).max(64),
        requiredSkillIds: z.array(z.number().int().positive()).optional(),
        toolType: z.string().max(32).optional(),
        estimatedCycleMs: z.number().int().min(0).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      const d = await db();
      const [clash] = await d.select().from(operationCodes).where(eq(operationCodes.code, input.code)).limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `Operation code "${input.code}" already exists` });
      const [row] = await d
        .insert(operationCodes)
        .values({
          code: input.code,
          description: input.description ?? null,
          requiredCapability: input.requiredCapability,
          requiredSkillIds: input.requiredSkillIds ?? null,
          toolType: input.toolType ?? null,
          estimatedCycleMs: input.estimatedCycleMs ?? null,
          scope: input.scope ?? null,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: operationCodes.id });
      return { ok: true, id: row?.id };
    }),

  /** Map a qualified program to an operation (deviceKind-scoped). */
  mapOperationProgram: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        operationCodeId: z.number().int().positive(),
        programProjectId: z.number().int().positive(),
        deviceKind: z.string().max(32).optional(),
        compatible: z.boolean().default(true),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      const d = await db();
      const [row] = await d
        .insert(operationProgramMap)
        .values({
          operationCodeId: input.operationCodeId,
          programProjectId: input.programProjectId,
          deviceKind: input.deviceKind ?? null,
          compatible: input.compatible,
          notes: input.notes ?? null,
        })
        .returning({ id: operationProgramMap.id });
      return { ok: true, id: row?.id };
    }),

  // ── G2-b A/B VARIANTS ──────────────────────────────────────────────────────
  listVariants: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ programProjectId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(programVariants)
        .where(input?.programProjectId != null ? eq(programVariants.programProjectId, input.programProjectId) : undefined)
        .orderBy(programVariants.programProjectId, programVariants.variant);
    }),

  /** Deterministically pick a variant arm for a program by seed (e.g. a taskKey). */
  pickVariant: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ programProjectId: z.number().int().positive(), seed: z.string().min(1).max(256) }))
    .query(async ({ input }) => pickVariantForProgram(input.programProjectId, input.seed)),

  /** Record an A/B outcome against a variant arm (folds into rolling metrics). */
  recordVariantOutcome: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ variantId: z.number().int().positive(), success: z.boolean(), cycleMs: z.number().int().min(0).optional() }))
    .mutation(async ({ input }) => {
      requireResourceFlag();
      return recordVariantOutcome(input.variantId, { success: input.success, cycleMs: input.cycleMs });
    }),

  createVariant: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        programProjectId: z.number().int().positive(),
        variant: z.enum(["A", "B", "control"]),
        trafficSplitPct: z.number().int().min(0).max(100).default(0),
        status: z.enum(["active", "paused"]).default("active"),
        scope: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      const d = await db();
      const [row] = await d
        .insert(programVariants)
        .values({
          programProjectId: input.programProjectId,
          variant: input.variant,
          trafficSplitPct: input.trafficSplitPct,
          status: input.status,
          rolloutStartAt: input.status === "active" ? new Date() : null,
          scope: input.scope ?? null,
        })
        .returning({ id: programVariants.id });
      return { ok: true, id: row?.id };
    }),

  // ── G2-c SHARED RESOURCES ──────────────────────────────────────────────────
  listResources: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ type: z.string().max(24).optional(), status: z.string().max(16).optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.type) conds.push(eq(sharedResources.type, input.type));
      if (input?.status) conds.push(eq(sharedResources.status, input.status));
      const rows = await d
        .select()
        .from(sharedResources)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(sharedResources.code);
      // Attach DERIVED availability (active reservation count is authoritative).
      const out = [];
      for (const r of rows) out.push({ ...r, availability: await getResourceAvailability(r.id) });
      return out;
    }),

  listResourceReservations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          resourceId: z.number().int().positive().optional(),
          deviceId: z.number().int().positive().optional(),
          status: z.enum(["active", "queued", "released", "rejected"]).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.resourceId != null) conds.push(eq(resourceReservations.resourceId, input.resourceId));
      if (input?.deviceId != null) conds.push(eq(resourceReservations.deviceId, input.deviceId));
      if (input?.status) conds.push(eq(resourceReservations.status, input.status));
      return d
        .select()
        .from(resourceReservations)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(resourceReservations.createdAt))
        .limit(input?.limit ?? 200);
    }),

  createResource: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().max(255).optional(),
        type: z.enum(["jig", "gripper", "fixture", "tool_changer", "other"]).default("other"),
        locationZoneId: z.number().int().positive().optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      const d = await db();
      const [clash] = await d.select().from(sharedResources).where(eq(sharedResources.code, input.code)).limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `Resource code "${input.code}" already exists` });
      const [row] = await d
        .insert(sharedResources)
        .values({
          code: input.code,
          name: input.name ?? null,
          type: input.type,
          locationZoneId: input.locationZoneId ?? null,
          scope: input.scope ?? null,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: sharedResources.id });
      return { ok: true, id: row?.id };
    }),

  reserveResource: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        resourceId: z.number().int().positive(),
        deviceId: z.number().int().positive(),
        taskId: z.number().int().positive().optional(),
        queueIfFull: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      return claimResource({ resourceId: input.resourceId, deviceId: input.deviceId, taskId: input.taskId ?? null, queueIfFull: input.queueIfFull });
    }),

  releaseResource: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ deviceId: z.number().int().positive(), resourceId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      requireResourceFlag();
      return releaseResource(input.deviceId, input.resourceId);
    }),

  // ── G2-d PREDICTIVE CHARGING ───────────────────────────────────────────────
  listChargers: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await db();
      return d.select().from(chargerStations).orderBy(chargerStations.code);
    }),

  listChargingPlans: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          deviceId: z.number().int().positive().optional(),
          status: z.enum(["planned", "active", "done", "cancelled"]).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.deviceId != null) conds.push(eq(batteryChargingPlans.deviceId, input.deviceId));
      if (input?.status) conds.push(eq(batteryChargingPlans.status, input.status));
      return d
        .select()
        .from(batteryChargingPlans)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(batteryChargingPlans.createdAt))
        .limit(input?.limit ?? 200);
    }),

  createCharger: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().max(255).optional(),
        locationZoneId: z.number().int().positive().optional(),
        chargerType: z.string().max(32).default("contact"),
        powerWatts: z.number().int().min(0).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireResourceFlag();
      const d = await db();
      const [clash] = await d.select().from(chargerStations).where(eq(chargerStations.code, input.code)).limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `Charger code "${input.code}" already exists` });
      const [row] = await d
        .insert(chargerStations)
        .values({
          code: input.code,
          name: input.name ?? null,
          locationZoneId: input.locationZoneId ?? null,
          chargerType: input.chargerType,
          powerWatts: input.powerWatts ?? null,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: chargerStations.id });
      return { ok: true, id: row?.id };
    }),

  /** Run the predictive-charging sweep on demand (also runs on a background timer). */
  sweepCharging: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .mutation(async () => {
      requireResourceFlag();
      return sweepChargingPlans();
    }),
});
