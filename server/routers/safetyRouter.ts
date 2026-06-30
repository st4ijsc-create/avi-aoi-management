/**
 * S1 (doc 16 §8 / §15 S1) — SAFETY + WORKFORCE router.
 * Flags: SAFETY_AUDIT_ENABLED, WORKFORCE_ENABLED, ANDON_ROBOT_DISPATCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the S1 software-only slice of Khối 3:
 *   • safety_events feed + near-miss trend + near-miss ingest (advisory)
 *   • collaboration (human↔robot handover) sessions
 *   • mixed-workforce operator assignments + the current board
 *
 * ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. The safety feed is an
 *   ADVISORY monitoring/logging record; near-miss ingest raises a yellow Andon +
 *   logs + (at most) PROPOSES a speed reduction via the EXISTING gate — it NEVER
 *   auto-executes a device command. The software performs NO SIL stop and gives NO
 *   sub-second guarantee; a hardware-rated stop is deferred to S2.
 *
 * RBAC (module-level, mirrors fleetRouter; no dedicated 'safety' perm exists):
 *   • read  ops → machine_monitoring / canView
 *   • mutations → machine_control   / canCreate  (+ the relevant flag)
 * ctx.user is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { collaborationSessions, operatorAssignments } from "../../drizzle/schema";
import {
  safetyAuditEnabled,
  record as recordSafetyEvent,
  queryFeed,
  nearMissTrend,
  auditEvent,
} from "../services/safety/safetyAuditService";
import { processDetection } from "../services/safety/nearMissAdvisor";
import { workforceEnabled, assignOperator, reassignOperator, confirmAssignment, closeAssignment, getCurrentBoard } from "../services/workforce/workforceService";
import { startCollaboration, signalHandshake, advancePhase, abortCollaboration } from "../services/workforce/collaborationService";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

function requireSafetyFlag() {
  if (!safetyAuditEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Safety audit disabled (set SAFETY_AUDIT_ENABLED=true) — ADVISORY only, not safety-rated" });
  }
}
function requireWorkforceFlag() {
  if (!workforceEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Workforce disabled (set WORKFORCE_ENABLED=true)" });
  }
}

const EVENT_TYPES = ["estop", "collision", "intrusion", "force_limit", "speed_violation", "near_miss"] as const;

export const safetyRouter = router({
  // ── status (UI gating hints) ───────────────────────────────────────────────
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyAudit: safetyAuditEnabled(),
      workforce: workforceEnabled(),
      advisory: true, // explicit: this subsystem is advisory, not safety-rated
    })),

  // ══════════════════════════════════════════════════════════════════════════
  // SAFETY EVENTS (S1-b) — feed/trend (read) + ingest/audit (mutations)
  // ══════════════════════════════════════════════════════════════════════════
  feed: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          eventType: z.enum(EVENT_TYPES).optional(),
          robotId: z.number().int().positive().optional(),
          isNearMiss: z.boolean().optional(),
          sinceHours: z.number().int().min(1).max(24 * 90).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => queryFeed(input ?? {})),

  nearMissTrend: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ sinceDays: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input }) => nearMissTrend(input?.sinceDays ?? 30)),

  /** Manually record an advisory safety event (flag-gated). */
  recordEvent: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        eventType: z.enum(EVENT_TYPES),
        robotId: z.number().int().positive().optional(),
        deviceId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        responseTimeMs: z.number().int().min(0).optional(),
        detectedBy: z.enum(["vision", "interlock", "operator", "telemetry"]).optional(),
        outcome: z.enum(["stopped", "reduced_speed", "manual_override", "logged_only"]).optional(),
        isNearMiss: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyFlag();
      // operator-recorded events default handledBy=operator (honest provenance).
      return recordSafetyEvent({ ...input, handledBy: "operator" });
    }),

  /** Stamp a human PDCA audit (who reviewed the event). */
  auditEvent: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ eventId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireSafetyFlag();
      const row = await auditEvent(input.eventId, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Safety event ${input.eventId} not found` });
      return row;
    }),

  /**
   * Ingest an ADVISORY human-proximity detection (S1-d). Below the configured margin
   * → records a near_miss + raises a YELLOW Andon + attaches a speed-reduction
   * PROPOSAL (never auto-executes). Provenance limited to vision/manual/test — the
   * server does NOT fabricate a tracker.
   */
  ingestProximity: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        deviceId: z.number().int().positive().optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        distance: z.number().min(0),
        confidence: z.number().min(0).max(1),
        source: z.enum(["vision", "manual", "test"]).default("vision"),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyFlag();
      return processDetection(input);
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // COLLABORATION (S1-a handover) — read + handshake mutations (flag-gated)
  // ══════════════════════════════════════════════════════════════════════════
  listCollaborations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ phase: z.enum(["human_prep", "robot_work", "human_verify", "done"]).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(collaborationSessions)
        .where(input?.phase ? eq(collaborationSessions.phase, input.phase) : undefined)
        .orderBy(desc(collaborationSessions.startedAt))
        .limit(input?.limit ?? 100);
    }),

  startCollaboration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        taskId: z.number().int().positive().optional(),
        operationCode: z.string().max(64).optional(),
        humanOperatorId: z.number().int().positive().optional(),
        robotDeviceId: z.number().int().positive().optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      return startCollaboration(input);
    }),

  signalHandshake: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive(), state: z.enum(["pending", "ack", "clear"]) }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const row = await signalHandshake(input.sessionId, input.state);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Collaboration ${input.sessionId} not found` });
      return row;
    }),

  advancePhase: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      return advancePhase(input.sessionId);
    }),

  abortCollaboration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const row = await abortCollaboration(input.sessionId, input.reason);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Collaboration ${input.sessionId} not found` });
      return row;
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // WORKFORCE (S1-a) — assignments CRUD + current board
  // ══════════════════════════════════════════════════════════════════════════
  /** Current board — who/which-robot is at each station now (read; always allowed). */
  currentBoard: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => getCurrentBoard()),

  listAssignments: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          operatorId: z.number().int().positive().optional(),
          status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
          stationId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const conds = [];
      if (input?.operatorId != null) conds.push(eq(operatorAssignments.operatorId, input.operatorId));
      if (input?.status) conds.push(eq(operatorAssignments.status, input.status));
      if (input?.stationId != null) conds.push(eq(operatorAssignments.stationId, input.stationId));
      // build where lazily to keep the and()-of-conds pattern consistent
      const { and } = await import("drizzle-orm");
      return d
        .select()
        .from(operatorAssignments)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(operatorAssignments.assignedStart))
        .limit(input?.limit ?? 200);
    }),

  assignOperator: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        operatorId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        shiftConfigId: z.number().int().positive().optional(),
        skillLevel: z.string().max(24).optional(),
        assignedStart: z.coerce.date().optional(),
        assignedEnd: z.coerce.date().optional(),
        requiredSkillId: z.number().int().positive().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const r = await assignOperator(input);
      if (!r.ok && r.conflict) {
        throw new TRPCError({ code: "CONFLICT", message: `Double-booking: ${r.conflict.reason} (assignment #${r.conflict.assignmentId})` });
      }
      return r;
    }),

  reassignOperator: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        assignmentId: z.number().int().positive(),
        operatorId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        shiftConfigId: z.number().int().positive().optional(),
        skillLevel: z.string().max(24).optional(),
        assignedStart: z.coerce.date().optional(),
        assignedEnd: z.coerce.date().optional(),
        requiredSkillId: z.number().int().positive().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const { assignmentId, ...rest } = input;
      const r = await reassignOperator(assignmentId, rest);
      if (!r.ok && r.conflict) {
        throw new TRPCError({ code: "CONFLICT", message: `Double-booking: ${r.conflict.reason} (assignment #${r.conflict.assignmentId})` });
      }
      return r;
    }),

  confirmAssignment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ assignmentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const row = await confirmAssignment(input.assignmentId, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Assignment ${input.assignmentId} not found` });
      return row;
    }),

  closeAssignment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ assignmentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const row = await closeAssignment(input.assignmentId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Assignment ${input.assignmentId} not found` });
      return row;
    }),
});
