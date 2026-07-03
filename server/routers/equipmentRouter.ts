/**
 * Phase E0 — Factory Control Plane: EQUIPMENT capability/state ROUTER (READ-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY: this router is QUERY-ONLY. It surfaces the resolved Equipment Capability
 * Model + the unified adapter catalog + a machine's PackML/state snapshot. It has
 * NO mutations and does NOT route any command — control comes in E1 via the existing
 * HITL dispatcher (commandDispatcher / robotCommandDispatcher), never through here.
 *
 * RBAC via module 'machine_monitoring' → canView on every endpoint.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { machines } from "../../drizzle/schema";
import {
  getCapabilitiesForMachine,
  getDefaultCapability,
  listDefaultProfiles,
  type CapabilityOverride,
} from "../services/equipment/capabilityModel";
import { equipmentRegistry } from "../services/equipment/equipmentAdapter";
import { PACKML_STATES, PACKML_COMMANDS, allowedCommands, type PackmlState } from "../services/equipment/packml";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return db;
}

async function loadMachine(machineId: number) {
  const db = await getDb();
  const [m] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Machine ${machineId} not found` });
  return m;
}

export const equipmentRouter = router({
  /**
   * List machines with their RESOLVED capability contract (default ⊕ jsonb override)
   * + the adapter kind that fulfils each. Optional station filter.
   */
  listEquipment: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          stationId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(1000).default(500),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(machines)
        .where(input?.stationId != null ? eq(machines.stationId, input.stationId) : undefined)
        .limit(input?.limit ?? 500);
      return rows.map((m) => {
        const capability = getCapabilitiesForMachine({
          machineType: m.machineType,
          capabilities: m.capabilities,
        });
        return {
          machineId: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          operationStatus: m.operationStatus,
          // Toạ độ layout đã lưu (0–1) từ Factory Floor Editor — dùng cho cell-twin đặt trạm theo vị trí thật.
          layoutPositionX: m.layoutPositionX,
          layoutPositionY: m.layoutPositionY,
          adapterKind: capability.adapterKind,
          commandCount: capability.supportedCommands.length,
          telemetryCount: capability.telemetryTags.length,
          capability,
        };
      });
    }),

  /** Resolve the full Capability Contract for one machine (default ⊕ jsonb override). */
  getCapabilities: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const m = await loadMachine(input.machineId);
      const capability = getCapabilitiesForMachine({
        machineType: m.machineType,
        capabilities: m.capabilities,
      });
      return {
        machineId: m.id,
        machineType: m.machineType,
        override: (m.capabilities ?? null) as CapabilityOverride | null,
        defaultProfile: getDefaultCapability(m.machineType),
        capability,
      };
    }),

  /** The per-machineType DEFAULT capability profiles (no machine row needed). */
  listDefaultProfiles: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => listDefaultProfiles()),

  /** The unified adapter catalog: every kind + the existing registry it delegates to. */
  listAdapterKinds: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      adapters: equipmentRegistry.listAdapters(),
      otProtocolsRegistered: equipmentRegistry.listOtProtocols(),
    })),

  /** The canonical PackML vocabulary (states + commands) for the orchestration UI. */
  listPackmlModel: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      states: [...PACKML_STATES],
      commands: [...PACKML_COMMANDS],
    })),

  /**
   * A machine's current PackML/device state snapshot. E0 derives a best-effort
   * PackML state from operationStatus (real per-driver state comes via the adapter
   * getState() in E1). Read-only; also returns the legal next commands from here.
   */
  getState: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const m = await loadMachine(input.machineId);
      const capability = getCapabilitiesForMachine({
        machineType: m.machineType,
        capabilities: m.capabilities,
      });
      const packmlState = operationStatusToPackml(m.operationStatus);
      return {
        machineId: m.id,
        operationStatus: m.operationStatus,
        packmlState,
        allowedPackmlCommands: allowedCommands(packmlState),
        adapterKind: capability.adapterKind,
        supportedStates: capability.supportedStates,
      };
    }),
});

/**
 * Best-effort map of the legacy operationStatus enum → a PackML state. This is a
 * READ projection only (E0 has no real per-driver PackML feed yet — that arrives in
 * E1). Fail-safe: anything unknown → Idle.
 */
function operationStatusToPackml(status: string): PackmlState {
  switch (status) {
    case "running":
      return "Execute";
    case "stopped":
      return "Stopped";
    case "error":
      return "Aborted";
    case "maintenance":
      return "Held";
    case "warming_up":
      return "Starting";
    case "changeover":
      return "Suspended";
    case "starved":
    case "blocked":
      return "Held";
    default:
      return "Idle";
  }
}
