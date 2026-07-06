/**
 * VDA 5050 router (key "vda5050") — read AGV registry/status + HITL/dry-run-gated
 * Order send + read-only connection test.
 *
 * RBAC:
 *   listAgvs / status / testConnection → machine_monitoring (canView)
 *   sendOrder                          → machine_control     (canCreate)
 *
 * SAFETY: sendOrder routes through the adapter, which routes through the robot
 * commandDispatcher. With ROBOT_CONTROL_ENABLED!=="true" (the default), the
 * dispatcher records a 'simulated' job and NOTHING is published to MQTT — the
 * built Order JSON is returned for inspection only.
 *
 * ⚠ Field mapping/topics are an unvalidated scaffold (must be checked vs a real AGV).
 *
 * NOTE: register in server/routers.ts as `vda5050: vda5050Router` (NOT edited here).
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_OT_CONTROL (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { robots } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

const nodeInput = z.object({
  nodeId: z.string().min(1).max(128).optional(),
  x: z.number(),
  y: z.number(),
  theta: z.number().optional(),
  mapId: z.string().min(1).max(128).default("map"),
});

export const vda5050Router = router({
  /** List AGV robots (kind='agv') the platform knows about. machine_monitoring read. */
  listAgvs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(robots)
        .where(eq(robots.kind, "agv"))
        .orderBy(desc(robots.updatedAt));
    }),

  /** Runtime status for an AGV adapter (online + last error + flags). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { isVda5050Enabled, isVda5050Running, getAgvAdapter } = await import("../services/vda5050");
      const adapter = getAgvAdapter(input.robotId);
      return {
        enabled: isVda5050Enabled(),
        running: isVda5050Running(),
        controlEnabled: process.env.ROBOT_CONTROL_ENABLED === "true",
        adapterActive: !!adapter,
        online: adapter?.isOnline() ?? false,
        lastError: adapter?.getLastError(),
        note: "Read-only status. Commands are HITL + dry-run unless ROBOT_CONTROL_ENABLED=true.",
      };
    }),

  /**
   * Build + (gated) send a VDA 5050 Order to an AGV. DRY-RUN by default:
   * the dispatcher records a 'simulated' job and NOTHING is published; the built
   * Order JSON is returned. A real publish requires ROBOT_CONTROL_ENABLED=true
   * AND an active adapter. machine_control (command).
   */
  sendOrder: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        robotId: z.number().int().positive(),
        nodes: z.array(nodeInput).min(1).max(200),
        orderId: z.string().min(1).max(128).optional(),
        idempotencyKey: z.string().min(1).max(128).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { getAgvAdapter } = await import("../services/vda5050");
      const adapter = getAgvAdapter(input.robotId);
      if (!adapter) {
        // No active adapter — still report honestly (cannot dispatch without one).
        return {
          ok: false,
          status: "rejected" as const,
          published: false,
          error: "No active VDA5050 adapter for this robot (is VDA5050_ENABLED and the AGV enabled?).",
          dryRun: process.env.ROBOT_CONTROL_ENABLED !== "true",
        };
      }
      const res = await adapter.sendOrder({
        nodes: input.nodes.map((n, i) => ({
          nodeId: n.nodeId ?? `n${i}`,
          x: n.x,
          y: n.y,
          theta: n.theta,
          mapId: n.mapId,
        })),
        orderId: input.orderId,
        // The tRPC call IS the human action → treat as HITL-confirmed by this user.
        triggerKind: "hitl",
        requestedBy: ctx.user.id,
        confirmedBy: ctx.user.id,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: res.ok,
        status: res.status,
        jobId: res.jobId,
        published: res.published,
        order: res.order,
        error: res.error,
        dryRun: process.env.ROBOT_CONTROL_ENABLED !== "true",
      };
    }),

  /**
   * Read-only connection test: verify the AGV robot row is a usable VDA 5050 AGV
   * and report the resolved topic prefix. Does NOT command the AGV. Adapter-online
   * status is included when the manager is running. machine_monitoring read.
   */
  testConnection: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: false, error: "DB unavailable" };
      const [r] = await db
        .select()
        .from(robots)
        .where(and(eq(robots.id, input.robotId), eq(robots.kind, "agv")))
        .limit(1);
      if (!r) return { ok: false, error: "AGV robot not found (kind must be 'agv')" };

      const { agvConfigFromRobot, getAgvAdapter } = await import("../services/vda5050");
      const cfg = agvConfigFromRobot(r);
      if (!cfg) {
        return {
          ok: false,
          error: "connectionOptions must contain manufacturer + serialNumber, and endpoint must be a broker URL.",
        };
      }
      const { buildVda5050Topic } = await import("../services/vda5050");
      const adapter = getAgvAdapter(r.id);
      return {
        ok: true,
        manufacturer: cfg.manufacturer,
        serialNumber: cfg.serialNumber,
        brokerUrl: cfg.brokerUrl,
        topics: {
          state: buildVda5050Topic(cfg.interfaceName, cfg.manufacturer, cfg.serialNumber, "state"),
          connection: buildVda5050Topic(cfg.interfaceName, cfg.manufacturer, cfg.serialNumber, "connection"),
          order: buildVda5050Topic(cfg.interfaceName, cfg.manufacturer, cfg.serialNumber, "order"),
        },
        adapterActive: !!adapter,
        online: adapter?.isOnline() ?? false,
        note: "Read-only. No command was sent. Validate topic/field mapping against the real AGV.",
      };
    }),
});
