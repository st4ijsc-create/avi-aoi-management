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
import { machineRecipes, recipeDeployments, machines, parameterGuardrails } from "../../drizzle/schema";
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
// Doc 56 Đ4 — recipe governance: typed-schema (RECIPE_TYPED_SCHEMA_MODE) + guardrail
// teeth at sign-off (CONFIG-SYNC-5) + config-sync shadow/notify on deploy (CONFIG-SYNC-3).
import {
  recipeTypedSchemaMode,
  validateRecipePayload,
  guardrailParamsFor,
} from "../services/recipes/recipeSchemas";
import { checkAgainstGuardrail } from "../services/ai/parameterGuardrailService";
import { configSyncGenericEnabled, upsertDesiredConfig } from "../services/configDriftService";
import { publishConfigChanged } from "../services/mqttService";

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

// ════════════════════════════════════════════════════════════════════════════
// Doc 56 Đ4 — recipe governance helpers (all inert when RECIPE_TYPED_SCHEMA_MODE=off).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Typed-schema gate for a recipe payload. off → skip; log → warn + accept; enforce →
 * reject a payload that doesn't match its machine-type schema. A machineType with no
 * typed schema always passes. Byte-identical when mode=off (default).
 */
function assertRecipePayloadValid(machineType: string | null, payload: unknown): void {
  const mode = recipeTypedSchemaMode();
  if (mode === "off") return;
  const res = validateRecipePayload(machineType, payload, mode);
  if (res.ok) return;
  if (mode === "log") {
    console.warn(
      `[machineRecipe] typed-schema mismatch (mode=log, kind=${res.kind}): ${res.errors.join("; ")}`,
    );
    return;
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Recipe payload không hợp lệ cho "${res.kind}": ${res.errors.join("; ")}`,
  });
}

/**
 * Resolve the effective guardrail for (machine|type, paramKey). Machine-scope wins
 * over the machine-type default (mirrors parameterGuardrailService.resolveGuardrail,
 * but through the LOCAL db handle so it is mockable in the router tests). Fail-safe → null.
 */
async function resolveRecipeGuardrail(machineId: number | null, machineType: string | null, paramKey: string) {
  try {
    const db = await getDb();
    if (machineId != null) {
      const [m] = await db
        .select()
        .from(parameterGuardrails)
        .where(and(eq(parameterGuardrails.scope, "machine"), eq(parameterGuardrails.machineId, machineId), eq(parameterGuardrails.paramKey, paramKey)))
        .limit(1);
      if (m) return m;
    }
    if (machineType) {
      const [t] = await db
        .select()
        .from(parameterGuardrails)
        .where(and(eq(parameterGuardrails.scope, "machine_type"), eq(parameterGuardrails.machineType, machineType), eq(parameterGuardrails.paramKey, paramKey)))
        .limit(1);
      if (t) return t;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * CONFIG-SYNC-5 — guardrail TEETH at sign-off. Map the typed payload's physical
 * setpoints → param_key, and REJECT the approve if any value is outside the
 * engineer's hard min–max range. A param with NO guardrail passes (strict=false —
 * we do not block sign-off on unbounded params here). Only meaningful when a typed
 * schema exists for the machineType (else guardrailParamsFor yields nothing).
 */
async function assertRecipeWithinGuardrails(recipe: {
  machineId: number | null;
  machineType: string | null;
  payload: unknown;
}): Promise<void> {
  const params = guardrailParamsFor(recipe.machineType, recipe.payload);
  for (const { paramKey, value } of params) {
    const guardrail = await resolveRecipeGuardrail(recipe.machineId ?? null, recipe.machineType ?? null, paramKey);
    const check = checkAgainstGuardrail(guardrail, value);
    if (!check.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Guardrail chặn duyệt recipe: tham số "${paramKey}"=${value} — ${check.detail}`,
      });
    }
  }
}

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
        // Doc 56 Đ4 — typed-schema governance at authoring (RECIPE_TYPED_SCHEMA_MODE).
        // off (default) ⇒ no-op → byte-identical.
        assertRecipePayloadValid(input.machineType ?? null, input.payload);
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
        // Doc 56 Đ4 — governance BEFORE sign-off: typed-schema re-check + guardrail
        // TEETH (CONFIG-SYNC-5). Only engaged when RECIPE_TYPED_SCHEMA_MODE != off (a
        // typed payload to map); default off ⇒ the approve path is byte-identical.
        if (recipeTypedSchemaMode() !== "off") {
          const existing = await getRecipeById(input.recipeId);
          if (existing) {
            assertRecipePayloadValid(existing.machineType ?? null, existing.payload);
            await assertRecipeWithinGuardrails({
              machineId: existing.machineId ?? null,
              machineType: existing.machineType ?? null,
              payload: existing.payload,
            });
          }
        }
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

          // Doc 56 Đ4 (CONFIG-SYNC-3) — write the DESIRED shadow + a RETAINED MQTT notify
          // so the machine converges on the newly-active recipe (payload is always PULLED
          // over HTTP; poll of checkConfigVersion is the backstop). Gated OFF by default →
          // deploy stays byte-identical. Best-effort: a shadow/notify failure must NOT fail
          // a deploy that already committed (the active flip + ledger row are durable).
          if (configSyncGenericEnabled() && deployed) {
            try {
              await upsertDesiredConfig({
                machineId: input.machineId,
                configKind: "recipe",
                code: deployed.code,
                version: deployed.version,
                checksum: deployed.checksum ?? null,
              });
              const db = await getDb();
              const [m] = await db
                .select({ code: machines.code })
                .from(machines)
                .where(eq(machines.id, input.machineId))
                .limit(1);
              if (m?.code) {
                publishConfigChanged(m.code, "recipe", {
                  code: deployed.code,
                  version: deployed.version,
                  checksum: deployed.checksum ?? null,
                });
              }
            } catch (err) {
              console.error(
                "[machineRecipe] config-sync desired/notify failed (deploy already committed):",
                err instanceof Error ? err.message : err,
              );
            }
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
