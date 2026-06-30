/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION router.  Flag: EQ_INTEG_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the Khối 1B multi-vendor integration extensions:
 *   • I1-a FOCAS / Euromap adapter FRAMEWORKS — integration status (which protocols
 *     are configured) + an honest read-only snapshot (cached / none; no fabricated data).
 *   • I1-b Recipe versioning genealogy — list versions, recipe load history, and the
 *     mutations create | release | archive | rollback version + record-load.
 *
 * RBAC (mirrors equipmentStandardsRouter / fleetRouter):
 *   • reads     → machine_monitoring / canView
 *   • mutations → machine_control    / canCreate  (+ requireFlag(EQ_INTEG_ENABLED))
 * ctx.user is the source of truth — never the request body.
 *
 * SAFETY / NO-OP: FOCAS/Euromap are READ-ONLY frameworks (no real device attached, no
 *   fabricated telemetry). Recipe mutations are METADATA only — releasing/loading a recipe
 *   opens NO device-control path; a select_recipe command still routes through the EXISTING
 *   gated dispatcher. When the flag is OFF every mutation CONFLICTs; reads still work.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { equipmentRegistry } from "../services/equipment/equipmentAdapter";
import {
  isEqIntegEnabled,
  createVersion,
  releaseVersion,
  archiveVersion,
  rollbackToVersion,
  recordLoad,
  listVersions,
  listLoadHistory,
  listCodeHistory,
} from "../services/equipment/recipeVersioningService";
import { FocasAdapter, FOCAS_CAVEAT, FOCAS_READ_FUNCTIONS, FOCAS_VENDOR } from "../services/focas/focasAdapter";
import { EuromapAdapter, EUROMAP_CAVEAT, EUROMAP_TRANSPORTS, EUROMAP_VENDOR_DEFAULT } from "../services/euromap/euromapAdapter";

/** Guard mutations behind the flag (matches equipmentStandardsRouter discipline). */
function requireFlag(): void {
  if (!isEqIntegEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Equipment integration disabled (set EQ_INTEG_ENABLED=true)" });
  }
}

/** Translate a service Error into a tRPC error (NOT_FOUND for missing recipes, else BAD_REQUEST). */
function toTrpc(err: unknown): TRPCError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) return new TRPCError({ code: "NOT_FOUND", message: msg });
  if (/disabled/i.test(msg)) return new TRPCError({ code: "CONFLICT", message: msg });
  return new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const equipmentIntegrationRouter = router({
  /** UI gating hint — is the integration flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: isEqIntegEnabled() })),

  // ── I1-a — adapter integration status ────────────────────────────────────────
  /**
   * Which adapter protocols are wired + an HONEST framework status for the new
   * FOCAS/Euromap frameworks (read-only, no real device, no fabricated telemetry).
   */
  integrationStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      enabled: isEqIntegEnabled(),
      adapters: equipmentRegistry.listAdapters(),
      frameworks: [
        {
          kind: "focas",
          vendor: FOCAS_VENDOR,
          readOnly: true,
          configured: false, // no native FOCAS (Fwlib32) library linked
          readFunctions: [...FOCAS_READ_FUNCTIONS],
          caveat: FOCAS_CAVEAT,
        },
        {
          kind: "euromap",
          vendor: EUROMAP_VENDOR_DEFAULT,
          readOnly: true,
          configured: false, // no Euromap 63/77/83 transport connected
          transports: [...EUROMAP_TRANSPORTS],
          caveat: EUROMAP_CAVEAT,
        },
      ],
    })),

  /**
   * Honest read-only snapshot for a machine from a FOCAS or Euromap framework adapter.
   * With no connector linked this returns source:'none' and null UEM fields — it NEVER
   * fabricates telemetry. (A future connector feeds the adapter's local cache.)
   */
  frameworkSnapshot: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ kind: z.enum(["focas", "euromap"]), machineCode: z.string().min(1).max(64) }))
    .query(({ input }) => {
      const adapter =
        input.kind === "focas"
          ? new FocasAdapter(input.machineCode)
          : new EuromapAdapter(input.machineCode);
      return adapter.readSnapshot();
    }),

  // ── I1-b — recipe versioning genealogy (reads) ───────────────────────────────
  /** List recipe versions for a recipe code (newest first, projected to design status). */
  listRecipeVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(64) }))
    .query(async ({ input }) => ({ code: input.code, versions: await listVersions(input.code) })),

  /** Recipe LOAD history (genealogy) for a machine. */
  listLoadHistory: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => listLoadHistory(input.machineId, input.limit)),

  /** Recipe genealogy for a code (across machines). */
  listCodeHistory: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(64), limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ input }) => listCodeHistory(input.code, input.limit)),

  // ── I1-b — recipe versioning genealogy (mutations, flag-gated) ───────────────
  /** Create a new IMMUTABLE recipe version (draft). */
  createRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(255),
      payload: z.record(z.string(), z.any()),
      machineId: z.number().int().positive().optional(),
      notes: z.string().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      try {
        return await createVersion({
          code: input.code,
          name: input.name,
          payload: input.payload as Record<string, unknown>,
          machineId: input.machineId ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          scope: input.scope,
          corporateCode: input.corporateCode,
          factoryId: input.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /** Release a version (draft → released). Archives the prior released version of the code. */
  releaseRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      try {
        return await releaseVersion(input.recipeId, ctx.user.id, {
          scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /** Archive a version (→ archived). */
  archiveRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      try {
        return await archiveVersion(input.recipeId, ctx.user.id, {
          scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /** Roll back the released contract for a code to a PRIOR version. */
  rollbackRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      toRecipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      try {
        return await rollbackToVersion(input.toRecipeId, ctx.user.id, {
          scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /**
   * Record that a recipe version was LOADED onto a machine (genealogy). Optionally also
   * writes a recipe_deployments ledger row (deploy=true). Opens NO device path.
   */
  recordRecipeLoad: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      machineId: z.number().int().positive(),
      deploy: z.boolean().default(false),
      notes: z.string().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      try {
        return await recordLoad({
          recipeId: input.recipeId,
          machineId: input.machineId,
          performedBy: ctx.user.id,
          deploy: input.deploy,
          notes: input.notes ?? null,
          scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),
});
