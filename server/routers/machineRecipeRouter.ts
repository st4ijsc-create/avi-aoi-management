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
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { machineRecipes, recipeDeployments } from "../../drizzle/schema";
import {
  createRecipe,
  getRecipeById,
  getActiveRecipe,
  listRecipeVersions,
  archiveRecipe,
  deployRecipe,
  rollbackRecipe,
} from "../db/machineRecipe";

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
        return createRecipe({
          code: input.code,
          name: input.name,
          payload: input.payload,
          machineId: input.machineId ?? null,
          machineType: input.machineType ?? null,
          notes: input.notes ?? null,
          status: "draft",
          createdBy: ctx.user.id,
        });
      }),

    archive: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const existing = await getRecipeById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Recipe không tồn tại." });
        await archiveRecipe(input.id);
        return { success: true };
      }),

    /**
     * Deploy a recipe version to a machine.
     * SAFETY: only flips the active version + writes a recipe_deployments ledger row.
     * It does NOT push a select_recipe command to the device (no commandDispatcher).
     */
    deploy: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({
        recipeId: z.number().int().positive(),
        machineId: z.number().int().positive(),
        adapterId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await deployRecipe({
            recipeId: input.recipeId,
            machineId: input.machineId,
            adapterId: input.adapterId ?? null,
            deployedBy: ctx.user.id,
            notes: input.notes ?? null,
          });
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
        }
      }),

    rollback: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({ machineId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await rollbackRecipe({ machineId: input.machineId, deployedBy: ctx.user.id });
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
        }
      }),
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
          })
          .from(recipeDeployments)
          .leftJoin(machineRecipes, eq(recipeDeployments.recipeId, machineRecipes.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(recipeDeployments.deployedAt))
          .limit(input?.limit ?? 100);
      }),
  }),
});
