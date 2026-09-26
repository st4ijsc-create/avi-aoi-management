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
 *
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #2, G113) — TENANT SCOPE IS ENFORCED HERE, NOT BY THE FE.
 * The previous paragraph claimed "tenant scope is honored by the identity join — the FE
 * scopes on it". Measured before this patch (`.qa-dot39/qd18/B-1600x900.json`, dist, real
 * HTTP): `operator1` (0 rows in `user_factory_assignments`) called `machineDetail(257)` and
 * received 200 + the identity of a machine in factory 18. A client-side filter is not a
 * fence — the bytes had already left the server. Every read procedure now hands
 * `phamViCua(ctx)` down to the service (same pattern as `twinCanhRouter`/`maintenanceRouter`):
 *   • by-id (`machineDetail`, `robotDetail`) out of scope ⇒ `null` ⇒ `NOT_FOUND` — NOT
 *     `FORBIDDEN`, because a distinct code confirms the entity exists (G82);
 *   • list-shaped (`machineAlarms`) out of scope ⇒ `[]`, same shape as "no alarms".
 *   • admin / no identity ⇒ `resolveTenantFactoryScope` returns `null` ⇒ no extra clause.
 * ⚠ `phamViTwinCanh.unit.test.ts` scans EVERY procedure of this router: a new one without
 *   `phamViCua(ctx)` is RED. `factoryCommandAssetCockpitPhamVi.db.test.ts` measures both sides.
 * NO writes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { phamViCua } from "./_phamViNguoiXem";
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
    .query(async ({ input, ctx }) => {
      // ★ Đợt 40 — out of scope ⇒ `null` ⇒ NOT_FOUND (same shape as non-existent, G82).
      const detail = await machineDetail(input.machineId, phamViCua(ctx));
      if (!detail) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, `Machine ${input.machineId} not found`);
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
    .query(async ({ input, ctx }) => {
      // ★ Đợt 40 — robots carry no tenant column; scoped via lineId/stationId in the service.
      const detail = await robotDetail(input.robotId, phamViCua(ctx));
      if (!detail) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, `Robot ${input.robotId} not found`);
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
    .query(async ({ input, ctx }) => {
      // ★ Đợt 40 — out of scope ⇒ `[]` (list shape; a machine with no alarms looks the same).
      const alarms = await machineAlarms(input.machineId, input.limit ?? 50, phamViCua(ctx));
      return { alarms };
    }),
});
