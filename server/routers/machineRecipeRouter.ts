/**
 * Sprint G2.2a — Machine Recipe versioning + deployment router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router is a thin wrapper over server/db/machineRecipe.ts. It manages the
 *     recipe CATALOG and the deployment LEDGER only.
 *   - recipes.deploy ONLY flips the active version + writes a recipe_deployments
 *     ledger row (deployRecipe). It does NOT push a select_recipe command to any
 *     device — pushing to a machine still goes through the HITL write-tool +
 *     commandDispatcher (DRY-RUN by default). This router does NOT import
 *     commandDispatcher and has NO driver write path.
 * RBAC via module 'machine_control':
 *   recipes.listCodes/listVersions/get/getActive + deployments.list → canView
 *   recipes.create → canCreate
 *   recipes.archive/deploy/rollback → canEdit
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, actuationProcedure as actuationBase } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
// Doc 38 Đợt Q — license-gate the recipe surface behind MOD_OT_CONTROL (moduleGate is
// pass-through until the deployment's SKU is configured — no-brick). Shadows
// `protectedProcedure`; per-action RBAC (machine_control/*) is unchanged.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
// approve / deploy / rollback change what a MACHINE runs → actuation role-floor
// (admin/supervisor/engineer) + 2FA, plus the MOD_OT_CONTROL license gate.
const actuationProcedure = actuationBase.use(moduleGate("MOD_OT_CONTROL"));
import { machineRecipes, recipeDeployments, machines } from "../../drizzle/schema";
import {
  createRecipe,
  getRecipeById,
  getActiveRecipe,
  listRecipeVersions,
  archiveRecipe,
  approveRecipe,
  deployRecipe,
  rollbackRecipe,
  setGoldenRecipe,
} from "../db/machineRecipe";
import { recordEvent as recordGenealogyEvent, listCodeHistory } from "../services/equipment/recipeVersioningService";

/**
 * W5-22 (doc 25 (b)) — GENEALOGY unification. Every recipe op done from /recipes writes
 * an append-only recipe_load_log row (WHO did WHAT to WHICH code@version onto WHICH
 * machine, WHEN). Fail-soft: the core op has already committed, so a genealogy-write
 * error must NOT surface as an op failure — it is logged and swallowed.
 */
async function recordGenealogySafe(
  ...args: Parameters<typeof recordGenealogyEvent>
): Promise<void> {
  try {
    await recordGenealogyEvent(...args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[machineRecipe] genealogy record failed:", err instanceof Error ? err.message : err);
  }
}

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return db;
}

const machineTypeEnum = z.enum([
  "AVI", "AOI", "SPI", "AXI", "ICT", "FCT", "CMM", "AUTOMATION",
  "FEEDER", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "ICT_FUNC",
  "ROBOT_TEST", "PACKAGING", "PALLETIZER", "ROBOT",
]);

export const machineRecipeRouter = router({
  recipes: router({
    /** Distinct recipe codes with their currently-active version (if any). */
    listCodes: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .query(async () => {
        const db = await getDb();
        // newest createdAt per code, plus whether an active version exists
        const rows = await db
          .select({
            code: machineRecipes.code,
            name: sql<string>`max(${machineRecipes.name})`,
            versions: sql<number>`count(*)::int`,
            maxVersion: sql<number>`max(${machineRecipes.version})::int`,
            activeVersion: sql<number | null>`max(${machineRecipes.version}) filter (where ${machineRecipes.status} = 'active')::int`,
          })
          .from(machineRecipes)
          .groupBy(machineRecipes.code)
          .orderBy(machineRecipes.code);
        return rows;
      }),

    listVersions: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({ code: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        return listRecipeVersions(input.code);
      }),

    get: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const row = await getRecipeById(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Recipe không tồn tại." });
        return row;
      }),

    getActive: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({
        code: z.string().min(1).max(64).optional(),
        machineId: z.number().int().positive().optional(),
      }))
      .query(async ({ input }) => {
        if (input.code == null && input.machineId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cần code hoặc machineId." });
        }
        return (await getActiveRecipe({ code: input.code, machineId: input.machineId })) ?? null;
      }),

    create: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        payload: z.record(z.string(), z.unknown()),
        machineId: z.number().int().positive().nullable().optional(),
        machineType: machineTypeEnum.nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Always created as 'draft'; deploy promotes to active.
        const recipe = await createRecipe({
          code: input.code,
          name: input.name,
          payload: input.payload,
          machineId: input.machineId ?? null,
          machineType: input.machineType ?? null,
          notes: input.notes ?? null,
          status: "draft",
          createdBy: ctx.user.id,
        });
        // W5-22 — ghi vết genealogy cho MỌI thao tác từ /recipes.
        await recordGenealogySafe("create", recipe, {
          performedBy: ctx.user.id,
          machineId: recipe.machineId,
          notes: recipe.notes,
          meta: { checksum: recipe.checksum },
        });
        return recipe;
      }),

    archive: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const existing = await getRecipeById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Recipe không tồn tại." });
        await archiveRecipe(input.id);
        // W5-22 — archive từng làm MẤT actor; nay ghi vết genealogy với người thực hiện.
        await recordGenealogySafe("archive", { ...existing, status: "archived" }, {
          performedBy: ctx.user.id,
          machineId: existing.machineId,
        });
        return { success: true };
      }),

    /**
     * W5-22 (doc 25 (a)) — mark/unmark a recipe version as GOLDEN (master/baseline).
     * Golden is the reference set of parameters a code is diffed/deployed against. This
     * ONLY flips the curator flag — no status change, no device write.
     */
    setGolden: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({ id: z.number().int().positive(), isGolden: z.boolean() }))
      .mutation(async ({ input }) => {
        const existing = await getRecipeById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Recipe không tồn tại." });
        return setGoldenRecipe(input.id, input.isGolden);
      }),

    /**
     * W2-9 (doc 25 T6) — second-approver (segregation of duties). A DIFFERENT person
     * from the creator must approve a recipe version before it can be deployed. The
     * creator self-approving is rejected in the DB layer.
     */
    approve: actuationProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({
        recipeId: z.number().int().positive(),
        note: z.string().max(2000).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await approveRecipe({ recipeId: input.recipeId, approvedBy: ctx.user.id, note: input.note ?? null });
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
        }
      }),

    /**
     * Deploy a recipe version to a machine.
     * SAFETY: only flips the active version + writes a recipe_deployments ledger row.
     * It does NOT push a select_recipe command to the device (no commandDispatcher).
     * W2-9: refuses to deploy a recipe that has not been approved (second-approver).
     */
    deploy: actuationProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({
        recipeId: z.number().int().positive(),
        machineId: z.number().int().positive(),
        adapterId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const deployment = await deployRecipe({
            recipeId: input.recipeId,
            machineId: input.machineId,
            adapterId: input.adapterId ?? null,
            deployedBy: ctx.user.id,
            notes: input.notes ?? null,
          });
          // W5-22 — ghi vết genealogy: recipe được nạp (deploy) lên máy.
          const deployed = await getRecipeById(deployment.recipeId);
          if (deployed) {
            await recordGenealogySafe("load", deployed, {
              performedBy: ctx.user.id,
              machineId: input.machineId,
              notes: input.notes ?? null,
              meta: { deploymentId: deployment.id, previousRecipeId: deployment.previousRecipeId ?? null },
            });
          }
          return deployment;
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
        }
      }),

    rollback: actuationProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({ machineId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          const deployment = await rollbackRecipe({ machineId: input.machineId, deployedBy: ctx.user.id });
          // W5-22 — ghi vết genealogy: rollback về phiên bản trước trên máy.
          const rolledTo = await getRecipeById(deployment.recipeId);
          if (rolledTo) {
            await recordGenealogySafe("rollback", rolledTo, {
              performedBy: ctx.user.id,
              machineId: input.machineId,
              fromRecipeId: deployment.previousRecipeId ?? null,
              notes: deployment.notes ?? null,
              meta: { deploymentId: deployment.id },
            });
          }
          return deployment;
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
        }
      }),

    /** W5-22 (doc 25 (b)) — genealogy (recipe_load_log) for a code, newest first. */
    genealogy: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({ code: z.string().min(1).max(64), limit: z.number().int().min(1).max(500).default(200) }))
      .query(async ({ input }) => listCodeHistory(input.code, input.limit)),
  }),

  deployments: router({
    list: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({
        machineId: z.number().int().positive().optional(),
        recipeId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        const conds = [];
        if (input?.machineId != null) conds.push(eq(recipeDeployments.machineId, input.machineId));
        if (input?.recipeId != null) conds.push(eq(recipeDeployments.recipeId, input.recipeId));
        return db
          .select({
            id: recipeDeployments.id,
            recipeId: recipeDeployments.recipeId,
            machineId: recipeDeployments.machineId,
            adapterId: recipeDeployments.adapterId,
            deployedBy: recipeDeployments.deployedBy,
            deployedAt: recipeDeployments.deployedAt,
            previousRecipeId: recipeDeployments.previousRecipeId,
            status: recipeDeployments.status,
            commandLogId: recipeDeployments.commandLogId,
            notes: recipeDeployments.notes,
            recipeName: machineRecipes.name,
            recipeCode: machineRecipes.code,
            recipeVersion: machineRecipes.version,
            // W5-22 (c) — tên máy để sổ triển khai hiển thị tên thay vì machineId trần.
            machineName: machines.name,
            machineCode: machines.code,
          })
          .from(recipeDeployments)
          .leftJoin(machineRecipes, eq(recipeDeployments.recipeId, machineRecipes.id))
          .leftJoin(machines, eq(recipeDeployments.machineId, machines.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(recipeDeployments.deployedAt))
          .limit(input?.limit ?? 100);
      }),
  }),

  // W5-22 (c) — danh sách máy (id + tên) cho machine-picker trong dialog deploy.
  machines: router({
    list: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .query(async () => {
        const db = await getDb();
        return db
          .select({ id: machines.id, code: machines.code, name: machines.name, machineType: machines.machineType })
          .from(machines)
          .orderBy(machines.name);
      }),
  }),
});
