/**
 * U3 (doc 21 §6 / §3 G-4, G-5) — Machine & Robot Cockpit: tRPC router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TWO aggregation endpoints so a cockpit page renders EVERYTHING for ONE machine
 * (`/machine/:id`) or ONE robot (`/robot/:id`) from a SINGLE call, plus a reusable
 * thin PER-MACHINE normalized-alarm query the audit flagged missing.
 *
 * Every procedure is a THIN wrapper over assetCockpitService — which AGGREGATES over
 * EXISTING services (capabilityModel, deviceTypeRegistry, oeeService,
 * predictiveMaintenanceService, recipeVersioningService, twin/modelRegistry,
 * sim/kinematicModel, andon/safety stores, program_* + tasks + genealogy tables).
 * NO health / OEE / alarm / kinematic logic is recomputed here.
 *
 * NO CONTROL PATH: `gatedActions` is METADATA ONLY (which capability commands the
 * user MAY propose); execution still routes through the existing gated dispatcher.
 *
 * RBAC: read-only; every procedure requires machine_status/canView (doc 40 — was the
 * phantom `machine_monitoring` moduleName which no role is seeded for → admin-only).
 * Tenant scope is honored by
 * the identity join (corporateCode surfaced from the machine's factory) — the FE
 * scopes on it; no cross-tenant write is possible (read-only). NO writes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { machineDetail, robotDetail, machineAlarms } from "../services/ecosystem/assetCockpitService";

export const assetCockpitRouter = router({
  /**
   * Aggregate EVERYTHING for one machine into a single typed payload. NOT_FOUND when
   * the machine does not exist; otherwise each section is honest-null when its source
   * is absent/disabled (never fabricated).
   */
  machineDetail: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const detail = await machineDetail(input.machineId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Machine ${input.machineId} not found` });
      }
      return detail;
    }),

  /**
   * Aggregate EVERYTHING for one robot into a single typed payload. NOT_FOUND when the
   * robot does not exist; sections honest-null otherwise. Kinematic model is the
   * authored SAMPLE chain until real URDF import (T2a) — flagged `isSample`.
   */
  robotDetail: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const detail = await robotDetail(input.robotId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Robot ${input.robotId} not found` });
      }
      return detail;
    }),

  /**
   * The thin PER-MACHINE normalized alarm feed (the audit's missing query). Pulls this
   * machine's recent andon events and normalizes each into an ISA-18.2-shaped record
   * { standardCode, severity, description, recommendedAction, ts, source }. Reusable
   * per-asset feed (the cockpit + any per-machine alarm rail consume it).
   */
  machineAlarms: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({ machineId: z.number().int().positive(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => {
      const alarms = await machineAlarms(input.machineId, input.limit ?? 50);
      return { alarms };
    }),
});
