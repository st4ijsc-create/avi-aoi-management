/**
 * Khối 1 (doc 16 §5 / §15 X1-f) — FIELD & DEVICE ABSTRACTION router.  Flag: FIELD_V2_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the X1 field-abstraction services:
 *   • UDM state read incl. the new battery/joint/firmware/safety_zone/heartbeat
 *     columns + a derived staleness flag (from field_device_health).
 *   • field health board (live/stale/lost_connection) + summary badge.
 *   • hot-plug discovery (run a probe; register a discovered device WITHOUT restart).
 *
 * SAFETY (ABSOLUTE): this router writes registry/health STATE only. It opens NO device
 * path — robot/device commands continue through the EXISTING gated dispatchers
 * (robotCommandDispatcher / commandDispatcher, dry-run by default). Discovery probes
 * are READ-ONLY (OPC-UA browse); registration creates a DISABLED adapter row.
 *
 * RBAC (module-level, mirrors fleetRouter):
 *   • read ops              → machine_monitoring / canView
 *   • discovery + register  → machine_control / canCreate + requireFlag(FIELD_V2_ENABLED)
 * ctx.user is the source of truth.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { robots, robotTelemetry } from "../../drizzle/schema";
import {
  fieldV2Enabled,
  listFieldHealth,
  fieldHealthSummary,
  classifyLiveness,
  defaultHeartbeatTtlMs,
  lostFactor,
} from "../services/field/fieldHealthService";
import { discoverDevices, registerDiscoveredDevice, probeSupport } from "../services/field/discoveryService";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Guard mutating actions behind the flag (matches the fleetRouter discipline). */
function requireFlag() {
  if (!fieldV2Enabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "fieldAbstractionV2" }, "Field abstraction v2 disabled (set FIELD_V2_ENABLED=true)");
  }
}

const LIVENESS = ["live", "stale", "lost_connection", "unknown"] as const;
const DISCOVERY_PROTOCOLS = ["opcua", "mdns", "modbus", "s7", "ethernet-ip"] as const;

export const fieldRouter = router({
  /** UI gating hint — is the field-v2 flag on? + the honesty surface for discovery. */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: fieldV2Enabled(), probeSupport: probeSupport() })),

  // ── UDM state (read) — latest robot telemetry incl. the new X1-a columns ─────
  /**
   * Latest UDM snapshot for a robot: the most recent robot_telemetry row (incl.
   * battery_level/joint_states/safety_zone_id/firmware_version/last_heartbeat) plus a
   * DERIVED staleness flag from the heartbeat age (no extra table needed for the basic
   * read — the health row is authoritative when present).
   */
  deviceState: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [r] = await d.select().from(robots).where(eq(robots.id, input.robotId)).limit(1);
      if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, `Robot ${input.robotId} not found`);
      const [tel] = await d
        .select()
        .from(robotTelemetry)
        .where(eq(robotTelemetry.robotId, input.robotId))
        .orderBy(desc(robotTelemetry.timestamp))
        .limit(1);
      const now = new Date();
      const liveness = classifyLiveness(tel?.lastHeartbeat ?? tel?.timestamp ?? null, now, defaultHeartbeatTtlMs(), lostFactor());
      return {
        robot: { id: r.id, code: r.code, name: r.name, kind: r.kind, status: r.status, lastSeenAt: r.lastSeenAt },
        udm: tel
          ? {
              mode: tel.mode,
              busy: tel.busy,
              estop: tel.estop,
              pose: tel.poseJson,
              payloadKg: tel.payloadKg,
              speedPct: tel.speedPct,
              batteryLevel: tel.batteryLevel,
              jointStates: tel.jointStates,
              safetyZoneId: tel.safetyZoneId,
              firmwareVersion: tel.firmwareVersion,
              lastHeartbeat: tel.lastHeartbeat,
              timestamp: tel.timestamp,
            }
          : null,
        liveness,
      };
    }),

  // ── Field health board (read) ───────────────────────────────────────────────
  health: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ state: z.enum(LIVENESS).optional(), deviceKind: z.string().max(24).optional() }).optional())
    .query(async ({ input }) => listFieldHealth(input ?? undefined)),

  healthSummary: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => fieldHealthSummary()),

  // ── Hot-plug discovery (admin actions) — flag-gated ───────────────────────────
  /** Probe an endpoint for candidate devices (OPC-UA = real browse; others = seam). */
  discover: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        protocol: z.enum(DISCOVERY_PROTOCOLS),
        endpoint: z.string().min(1).max(255),
        rootNodeId: z.string().max(255).optional(),
        timeoutMs: z.number().int().min(500).max(30000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      return discoverDevices(input);
    }),

  /** Register a discovered candidate into the registry WITHOUT a restart (disabled). */
  registerDiscovered: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        candidate: z.object({
          protocol: z.enum(DISCOVERY_PROTOCOLS),
          endpoint: z.string().min(1).max(255),
          name: z.string().min(1).max(255),
          detail: z.record(z.string(), z.unknown()).optional(),
        }),
        name: z.string().max(255).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireFlag();
      return registerDiscoveredDevice(input);
    }),
});
