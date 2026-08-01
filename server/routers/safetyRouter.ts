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
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_OT_CONTROL (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
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
import {
  safetyZoneSwEnabled,
  listZones,
  createZone,
  updateZone,
  evaluateAndRecord,
  evaluateFromProximity,
} from "../services/safety/safetyZoneService";
import { workforceEnabled, assignOperator, reassignOperator, confirmAssignment, closeAssignment, getCurrentBoard } from "../services/workforce/workforceService";
import { startCollaboration, signalHandshake, advancePhase, abortCollaboration } from "../services/workforce/collaborationService";
// S2b — vision human-detection producer + safety-PLC status adapter (advisory).
import {
  safetyVisionEnabled,
  listCalibrations,
  upsertCalibration,
  produce,
} from "../services/safety/vision/humanDetectionProducer";
import type { PersonDetection } from "../services/safety/vision/humanDetectionProducer";
import {
  safetyPlcAdapterEnabled,
  listPlcConfigs,
  upsertPlcConfig,
  readConfigById,
  SimSafetyPlcBackend,
} from "../services/safety/plc/safetyPlcAdapter";

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
function requireSafetyZoneFlag() {
  if (!safetyZoneSwEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Safety zones disabled (set SAFETY_ZONE_SW_ENABLED=true) — ADVISORY only, not SIL" });
  }
}
function requireSafetyVisionFlag() {
  if (!safetyVisionEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Safety vision disabled (set SAFETY_VISION_ENABLED=true) — ADVISORY only, not SIL; needs a real camera + calibration + exported ONNX model" });
  }
}
function requireSafetyPlcFlag() {
  if (!safetyPlcAdapterEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Safety-PLC adapter disabled (set SAFETY_PLC_ADAPTER_ENABLED=true) — READ-ONLY monitoring; the certified Safety PLC performs the rated stop itself" });
  }
}

// S2a geometry input: an AABB and/or a polygon (advisory, mm). Both optional.
const zoneGeometrySchema = z
  .object({
    aabb: z
      .object({
        min: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
        max: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
      })
      .optional(),
    polygon: z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(3) }).optional(),
  })
  .optional();

// Simulated human/robot tracks for the evaluator (no real UWB/LiDAR — testing input).
const simHumanSchema = z.object({
  id: z.union([z.string(), z.number()]),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
const simRobotSchema = z.object({
  id: z.union([z.string(), z.number()]),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
});

const EVENT_TYPES = ["estop", "collision", "intrusion", "zone_intrusion", "force_limit", "speed_violation", "near_miss"] as const;

// S2b — a pixel-space person detection bbox (from any detector / test).
const personDetectionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  confidence: z.number().min(0).max(1),
  id: z.union([z.string(), z.number()]).optional(),
});

// S2b — a precomputed 3×3 homography (9 numbers, row-major).
const homographySchema = z.array(z.number()).length(9);
// S2b — an image↔floor correspondence pair (to solve a homography from ≥4).
const calibrationPairSchema = z.object({
  image: z.object({ u: z.number(), v: z.number() }),
  floor: z.object({ x: z.number(), y: z.number() }),
});

// S2b — a safety-PLC status snapshot (sim-injected, for testing).
const plcStatusSnapshotSchema = z.object({
  estop: z.boolean().optional(),
  zoneOccupied: z.boolean().optional(),
  resetRequired: z.boolean().optional(),
  muting: z.boolean().optional(),
});

export const safetyRouter = router({
  // ── status (UI gating hints) ───────────────────────────────────────────────
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyAudit: safetyAuditEnabled(),
      workforce: workforceEnabled(),
      safetyZoneSw: safetyZoneSwEnabled(), // S2a — advisory 3-level zone evaluator
      safetyVision: safetyVisionEnabled(), // S2b — vision human-detection producer
      safetyPlcAdapter: safetyPlcAdapterEnabled(), // S2b — read-only safety-PLC adapter
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
        detectedBy: z.enum(["vision", "interlock", "operator", "telemetry", "plc", "sim"]).optional(),
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
      // S1 near-miss advisory (unchanged behaviour).
      const nearMiss = await processDetection(input);
      // S2a (ADDITIVE) — when SAFETY_ZONE_SW_ENABLED, ALSO drive the zone evaluator
      // off this same proximity detection (3-level reaction). null when the flag is
      // off → response shape is stable; S1 behaviour is never weakened.
      const zone = await evaluateFromProximity(input);
      return { ...nearMiss, zone };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // SAFETY ZONES (S2a) — zones + 3-level intrusion evaluator (ADVISORY, flag-gated)
  // ⚠ These DETECT/LOG/PROPOSE. rated_stop is LOGGED only — a certified Safety PLC
  //    must perform the actual rated stop (S2 hardware). Software never actuates.
  // ══════════════════════════════════════════════════════════════════════════
  zoneStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ safetyZoneSw: safetyZoneSwEnabled(), advisory: true, ratedStopIsHardware: true })),

  listZones: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          robotId: z.number().int().positive().optional(),
          stationId: z.number().int().positive().optional(),
          lineId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listZones(input ?? {})),

  /** Evaluate a given/simulated human+robot set against zones → 3-level reactions. */
  evaluateZones: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        humans: z.array(simHumanSchema).max(200),
        robots: z.array(simRobotSchema).min(1).max(200),
        filter: z
          .object({
            robotId: z.number().int().positive().optional(),
            stationId: z.number().int().positive().optional(),
            lineId: z.number().int().positive().optional(),
          })
          .optional(),
        minConfidence: z.number().min(0).max(1).optional(),
      }),
    )
    .query(async ({ input }) => {
      requireSafetyZoneFlag();
      // READ-shaped evaluation. Recording is gated by SAFETY_AUDIT_ENABLED inside the
      // service; when audit is off it returns reactions without persisting.
      return evaluateAndRecord({ ...input, source: "sim" });
    }),

  /** Ingest a SIMULATED human track for testing → evaluate + record advisory events. */
  ingestSimulatedHuman: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        humans: z.array(simHumanSchema).max(200),
        robots: z.array(simRobotSchema).min(1).max(200),
        filter: z
          .object({
            robotId: z.number().int().positive().optional(),
            stationId: z.number().int().positive().optional(),
            lineId: z.number().int().positive().optional(),
          })
          .optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      return evaluateAndRecord({ ...input, source: "sim" });
    }),

  createZone: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        robotId: z.number().int().positive().optional(),
        deviceId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        geometry: zoneGeometrySchema,
        speedReduceDistanceMm: z.number().int().positive().optional(),
        stopDistanceMm: z.number().int().positive().optional(),
        ratedStopDistanceMm: z.number().int().positive().optional(),
        reactionSpeedPct: z.number().int().min(0).max(100).optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      const r = await createZone(input);
      if (!r.ok && r.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: r.message ?? "invalid safety zone" });
      return r;
    }),

  updateZone: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(255).optional(),
        robotId: z.number().int().positive().nullable().optional(),
        deviceId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
        lineId: z.number().int().positive().nullable().optional(),
        geometry: zoneGeometrySchema,
        speedReduceDistanceMm: z.number().int().positive().optional(),
        stopDistanceMm: z.number().int().positive().optional(),
        ratedStopDistanceMm: z.number().int().positive().optional(),
        reactionSpeedPct: z.number().int().min(0).max(100).optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      const r = await updateZone(input);
      if (!r.ok && r.enabled) throw new TRPCError({ code: r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", message: r.message ?? "update failed" });
      return r;
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // S2b — VISION HUMAN-DETECTION PRODUCER (advisory, flag SAFETY_VISION_ENABLED)
  // ⚠ Turns pixel person-detections + a per-camera homography into FLOOR positions
  //    → drives the S2a evaluator. NEVER fabricates a detection: no backend / no
  //    calibration ⇒ produces NOTHING. yolo26n.pt is PyTorch → needs a one-time
  //    ONNX export before the ONNX hook can run. ADVISORY, never a rated stop.
  // ══════════════════════════════════════════════════════════════════════════
  visionStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyVision: safetyVisionEnabled(),
      advisory: true,
      // honest: the model inference is a documented seam until yolo26n.pt→.onnx export.
      onnxPersonModelWired: false,
      note: "ADVISORY. Needs a real camera + per-camera homography calibration + an exported ONNX person model (yolo26n.pt is PyTorch — export to .onnx once). No fabricated detections.",
    })),

  /** List camera calibrations (read — always allowed). */
  listCameraCalibrations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          cameraId: z.string().max(128).optional(),
          safetyZoneId: z.number().int().positive().optional(),
          robotId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listCalibrations(input ?? {})),

  /**
   * Upsert a camera calibration (flag-gated). Provide a precomputed homography (9
   * numbers) OR ≥4 image↔floor pairs to SOLVE it from. Returns the mean reprojection
   * residual (mm) as a calibration-quality honesty metric.
   */
  upsertCameraCalibration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        cameraId: z.string().min(1).max(128),
        name: z.string().max(255).optional(),
        homography: homographySchema.optional(),
        pairs: z.array(calibrationPairSchema).min(4).optional(),
        safetyZoneId: z.number().int().positive().optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        imageWidth: z.number().int().positive().optional(),
        imageHeight: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyVisionFlag();
      const r = await upsertCalibration({
        ...input,
        homography: input.homography as
          | [number, number, number, number, number, number, number, number, number]
          | undefined,
      });
      if (!r.ok && r.enabled) throw new TRPCError({ code: r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", message: r.message ?? "calibration upsert failed" });
      return r;
    }),

  /**
   * Ingest a DETECTION FRAME (pixel person boxes) for a calibrated camera → project to
   * floor positions → S2a evaluator (advisory reactions). For testing + external
   * detectors. NEVER fabricates: empty detections ⇒ nothing produced.
   */
  ingestDetectionFrame: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        cameraId: z.string().min(1).max(128),
        detections: z.array(personDetectionSchema).max(200),
        robots: z.array(simRobotSchema).max(200).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyVisionFlag();
      return produce({
        cameraId: input.cameraId,
        detections: input.detections as PersonDetection[],
        robots: input.robots,
        minConfidence: input.minConfidence,
        scope: input.scope ?? null,
        corporateCode: input.corporateCode ?? null,
        factoryId: input.factoryId ?? null,
      });
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // S2b — SAFETY-PLC STATUS ADAPTER (READ-ONLY, flag SAFETY_PLC_ADAPTER_ENABLED)
  // ⚠ Observes a certified Safety PLC's NON-safety-rated status (e-stop/zone/reset/
  //    muting) over Modbus/OPC-UA (or a scripted sim) → advisory safety_events. NEVER
  //    actuates a rated stop — the certified PLC performs that itself in hardware.
  // ══════════════════════════════════════════════════════════════════════════
  plcStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyPlcAdapter: safetyPlcAdapterEnabled(),
      advisory: true,
      readOnly: true,
      note: "READ-ONLY monitoring. The certified Safety PLC performs the rated stop in hardware; this only OBSERVES status and LOGS advisory events. Default backend is a clearly-labelled sim.",
    })),

  listSafetyPlcConfigs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          robotId: z.number().int().positive().optional(),
          stationId: z.number().int().positive().optional(),
          lineId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listPlcConfigs(input ?? {})),

  upsertSafetyPlcConfig: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        vendor: z.enum(["pilz", "sick", "generic"]).optional(),
        backend: z.enum(["sim", "modbus", "opcua"]).optional(),
        endpoint: z.string().max(512).optional(),
        statusMap: z
          .object({
            estop: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            zoneOccupied: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            resetRequired: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            muting: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            simScript: z.array(plcStatusSnapshotSchema).optional(),
          })
          .optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyPlcFlag();
      const r = await upsertPlcConfig(input);
      if (!r.ok && r.enabled) throw new TRPCError({ code: r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", message: r.message ?? "safety-PLC config upsert failed" });
      return r;
    }),

  /**
   * Read one status snapshot from a safety-PLC config (sim or real) → advisory events.
   * READ-ONLY. An optional `simStatus` injects a scripted status for testing (still a
   * clearly-labelled sim). Never actuates.
   */
  readSafetyPlc: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        configId: z.number().int().positive(),
        /** Optional scripted status to inject (test/sim) — a single snapshot. */
        simStatus: plcStatusSnapshotSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyPlcFlag();
      const override = input.simStatus ? new SimSafetyPlcBackend([input.simStatus]) : undefined;
      return readConfigById(input.configId, override);
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
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const row = await abortCollaboration(input.sessionId, input.reason, ctx.user.id);
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
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const row = await closeAssignment(input.assignmentId, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Assignment ${input.assignmentId} not found` });
      return row;
    }),
});
