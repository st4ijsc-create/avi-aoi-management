/**
 * I1-b (doc 16 §6 #4 / §15) — RECIPE VERSIONING SERVICE.  Flag: EQ_INTEG_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A THIN orchestration layer over the EXISTING recipe versioning DB layer
 * (server/db/machineRecipe.ts → machine_recipes / recipe_deployments). It does NOT
 * duplicate version-bump / deploy logic — it COMPOSES the existing functions and adds:
 *   1. the design's vocabulary: status draft | released | archived  (the DB enum stores
 *      'active'; "released" is the design name for the single active contract per code —
 *      mapped 1:1 here so existing reads/writes of 'active' are untouched),
 *   2. an append-only GENEALOGY trail in `recipe_load_log` (WHO did create / release /
 *      archive / rollback / load, WHICH code@version, onto WHICH machine, WHEN),
 *   3. flag-gating: every MUTATION requires EQ_INTEG_ENABLED (off → throws; the caller/
 *      router surfaces a CONFLICT). Reads of the genealogy are always allowed.
 *
 * SAFETY / NO-OP: METADATA only. Releasing/loading a recipe does NOT push anything to a
 * device — a select_recipe command still routes through the EXISTING gated dispatcher.
 * A new version is IMMUTABLE: created as a fresh machine_recipes row (never an in-place
 * edit of a released version).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  createRecipe,
  getRecipeById,
  archiveRecipe as dbArchiveRecipe,
  listRecipeVersions,
  deployRecipe,
  type CreateRecipeInput,
} from "../../db/machineRecipe";
import { machineRecipes, recipeLoadLog, type MachineRecipe, type RecipeLoadLog } from "../../../drizzle/schema";

/** Same master flag as the FOCAS/Euromap frameworks + alarm normalizer. */
export function isEqIntegEnabled(): boolean {
  return process.env.EQ_INTEG_ENABLED === "true";
}

/** Design status vocabulary (draft|released|archived). */
export type RecipeDesignStatus = "draft" | "released" | "archived";

/** Map the DB enum status (draft|active|archived) → the design vocabulary. */
export function toDesignStatus(dbStatus: string): RecipeDesignStatus {
  return dbStatus === "active" ? "released" : (dbStatus as RecipeDesignStatus);
}
/** Map the design vocabulary → the DB enum status. */
export function toDbStatus(design: RecipeDesignStatus): "draft" | "active" | "archived" {
  return design === "released" ? "active" : design;
}

/** A genealogy/lifecycle action recorded in recipe_load_log. */
export type RecipeAction = "create" | "release" | "archive" | "rollback" | "load";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// Handle usable for both the top-level db and a transaction handle (W2-6) — a union so
// recordEventOn accepts EITHER the pooled db (non-transactional callers) OR a tx handle.
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

function requireFlag(): void {
  if (!isEqIntegEnabled()) {
    throw new Error("Equipment integration disabled (set EQ_INTEG_ENABLED=true)");
  }
}

interface TenantTag {
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

/** Append ONE immutable genealogy row on a specific db/tx handle. */
async function recordEventOn(
  dbh: DbOrTx,
  action: RecipeAction,
  recipe: { id?: number | null; code: string; version?: number | null; status?: string | null },
  ctx: {
    machineId?: number | null;
    fromRecipeId?: number | null;
    fromVersion?: number | null;
    performedBy?: number | null;
    notes?: string | null;
    meta?: Record<string, unknown> | null;
  } & TenantTag = {},
): Promise<RecipeLoadLog> {
  const [row] = await dbh
    .insert(recipeLoadLog)
    .values({
      action,
      recipeId: recipe.id ?? null,
      recipeCode: recipe.code,
      recipeVersion: recipe.version ?? null,
      machineId: ctx.machineId ?? null,
      fromRecipeId: ctx.fromRecipeId ?? null,
      fromVersion: ctx.fromVersion ?? null,
      status: recipe.status != null ? toDesignStatus(recipe.status) : null,
      performedBy: ctx.performedBy ?? null,
      notes: ctx.notes ?? null,
      meta: ctx.meta ?? null,
      scope: ctx.scope ?? null,
      corporateCode: ctx.corporateCode ?? null,
      factoryId: ctx.factoryId ?? null,
    })
    .returning();
  return row;
}

/**
 * Append ONE immutable genealogy row on its own connection (non-transactional callers).
 *
 * EXPORTED (W5-22 doc 25 (b)) so the /recipes control router (machineRecipeRouter) can
 * unify EVERY recipe op (create/deploy/archive/rollback) into the SAME recipe_load_log
 * genealogy trail. NOT flag-gated: genealogy is an audit trail and must record regardless
 * of EQ_INTEG_ENABLED (the flag only gates the design-vocabulary MUTATIONS above).
 */
export async function recordEvent(
  action: RecipeAction,
  recipe: { id?: number | null; code: string; version?: number | null; status?: string | null },
  ctx: Parameters<typeof recordEventOn>[3] = {},
): Promise<RecipeLoadLog> {
  const d = await db();
  return recordEventOn(d, action, recipe, ctx);
}

// ── Mutations (flag-gated) ────────────────────────────────────────────────────

/**
 * Create a new IMMUTABLE recipe version (draft). Delegates the version bump to the
 * existing createRecipe (version = max+1). Records a 'create' genealogy event.
 */
export async function createVersion(
  input: CreateRecipeInput & TenantTag,
): Promise<{ recipe: MachineRecipe; event: RecipeLoadLog }> {
  requireFlag();
  const recipe = await createRecipe({ ...input, status: input.status ?? "draft" });
  const event = await recordEvent("create", recipe, {
    performedBy: input.createdBy ?? null,
    notes: input.notes ?? null,
    machineId: input.machineId ?? null,
    scope: input.scope,
    corporateCode: input.corporateCode,
    factoryId: input.factoryId,
    meta: { checksum: recipe.checksum },
  });
  return { recipe, event };
}

/**
 * RELEASE a version (draft → released/active). Archives the currently-released version
 * of the same code (single released contract per code). Records a 'release' event.
 */
export async function releaseVersion(
  recipeId: number,
  performedBy: number,
  tenant: TenantTag = {},
): Promise<{ recipe: MachineRecipe; event: RecipeLoadLog }> {
  requireFlag();
  const d = await db();
  // ATOMIC (W2-6 / doc 25 T5): lock every version of the code with FOR UPDATE, read the
  // currently-released one UNDER the lock, archive it, promote the target, and append the
  // genealogy event — all in ONE transaction. Two concurrent releases now serialize on
  // the code lock (they cannot both create a released version), and a crash mid-way rolls
  // back cleanly (never leaves the code with two released or zero released versions).
  return d.transaction(async (tx) => {
    const [target] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, recipeId)).limit(1);
    if (!target) throw new Error(`Recipe #${recipeId} not found`);

    // Row-lock ALL versions sharing this code → serialize concurrent promoters.
    await tx.select().from(machineRecipes).where(eq(machineRecipes.code, target.code)).for("update");

    const [previouslyReleased] = await tx
      .select()
      .from(machineRecipes)
      .where(and(eq(machineRecipes.code, target.code), eq(machineRecipes.status, "active")))
      .limit(1);
    if (previouslyReleased && previouslyReleased.id !== target.id) {
      await tx
        .update(machineRecipes)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(machineRecipes.id, previouslyReleased.id));
    }
    const [recipe] = await tx
      .update(machineRecipes)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(machineRecipes.id, target.id))
      .returning();

    const event = await recordEventOn(tx, "release", recipe, {
      performedBy,
      fromRecipeId: previouslyReleased?.id ?? null,
      fromVersion: previouslyReleased?.version ?? null,
      ...tenant,
    });
    return { recipe, event };
  });
}

/** ARCHIVE a version (→ archived). Records an 'archive' event. */
export async function archiveVersion(
  recipeId: number,
  performedBy: number,
  tenant: TenantTag = {},
): Promise<{ recipe: MachineRecipe; event: RecipeLoadLog }> {
  requireFlag();
  const target = await getRecipeById(recipeId);
  if (!target) throw new Error(`Recipe #${recipeId} not found`);
  await dbArchiveRecipe(recipeId);
  const recipe = { ...target, status: "archived" as const };
  const event = await recordEvent("archive", recipe, { performedBy, ...tenant });
  return { recipe, event };
}

/**
 * ROLLBACK the released contract for a code to a PRIOR version: release that prior
 * version (archiving the current released one). Records a 'rollback' event capturing
 * both the from- and to- versions. Idempotent-safe: throws if target is not found or is
 * already released.
 */
export async function rollbackToVersion(
  toRecipeId: number,
  performedBy: number,
  tenant: TenantTag = {},
): Promise<{ recipe: MachineRecipe; event: RecipeLoadLog }> {
  requireFlag();
  const d = await db();
  // ATOMIC (W2-6 / doc 25 T5): same discipline as releaseVersion — lock the code, read
  // the current released version UNDER the lock, archive it, promote the target, log the
  // rollback. Serialized + crash-safe.
  return d.transaction(async (tx) => {
    const [target] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, toRecipeId)).limit(1);
    if (!target) throw new Error(`Recipe #${toRecipeId} not found`);

    // Row-lock ALL versions sharing this code → serialize concurrent promoters.
    await tx.select().from(machineRecipes).where(eq(machineRecipes.code, target.code)).for("update");

    const [current] = await tx
      .select()
      .from(machineRecipes)
      .where(and(eq(machineRecipes.code, target.code), eq(machineRecipes.status, "active")))
      .limit(1);
    if (current && current.id === target.id) {
      throw new Error(`Recipe #${toRecipeId} (${target.code} v${target.version}) is already the released version`);
    }
    if (current) {
      await tx
        .update(machineRecipes)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(machineRecipes.id, current.id));
    }
    const [recipe] = await tx
      .update(machineRecipes)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(machineRecipes.id, target.id))
      .returning();

    const event = await recordEventOn(tx, "rollback", recipe, {
      performedBy,
      fromRecipeId: current?.id ?? null,
      fromVersion: current?.version ?? null,
      notes: current ? `Rollback from v${current.version} to v${target.version}` : `Rollback to v${target.version}`,
      ...tenant,
    });
    return { recipe, event };
  });
}

/**
 * Record a LOAD event — a (code@version) recipe was loaded onto a machine. Optionally
 * also records a recipe_deployments row via the existing deployRecipe ledger (when
 * `deploy` is true) so the control-side audit + the genealogy stay consistent. This
 * opens NO device path: a select_recipe command still goes through the gated dispatcher.
 */
export async function recordLoad(
  input: { recipeId: number; machineId: number; performedBy: number; deploy?: boolean; notes?: string | null } & TenantTag,
): Promise<{ recipe: MachineRecipe; event: RecipeLoadLog; deploymentId: number | null }> {
  requireFlag();
  const target = await getRecipeById(input.recipeId);
  if (!target) throw new Error(`Recipe #${input.recipeId} not found`);

  let deploymentId: number | null = null;
  if (input.deploy) {
    const dep = await deployRecipe({
      recipeId: input.recipeId,
      machineId: input.machineId,
      deployedBy: input.performedBy,
      notes: input.notes ?? null,
    });
    deploymentId = dep.id;
  }

  const event = await recordEvent("load", target, {
    machineId: input.machineId,
    performedBy: input.performedBy,
    notes: input.notes ?? null,
    meta: deploymentId != null ? { deploymentId } : null,
    scope: input.scope,
    corporateCode: input.corporateCode,
    factoryId: input.factoryId,
  });
  return { recipe: target, event, deploymentId };
}

// ── Reads (always allowed) ──────────────────────────────────────────────────

/** All versions for a recipe code (newest first), projected to the design status. */
export async function listVersions(
  code: string,
): Promise<Array<MachineRecipe & { designStatus: RecipeDesignStatus }>> {
  const rows = await listRecipeVersions(code);
  return rows.map((r) => ({ ...r, designStatus: toDesignStatus(r.status) }));
}

/** Genealogy / load history for a machine (newest first). */
export async function listLoadHistory(machineId: number, limit = 100): Promise<RecipeLoadLog[]> {
  const d = await db();
  return d
    .select()
    .from(recipeLoadLog)
    .where(eq(recipeLoadLog.machineId, machineId))
    .orderBy(desc(recipeLoadLog.createdAt))
    .limit(limit);
}

/** Genealogy for a recipe code (newest first). */
export async function listCodeHistory(code: string, limit = 200): Promise<RecipeLoadLog[]> {
  const d = await db();
  return d
    .select()
    .from(recipeLoadLog)
    .where(eq(recipeLoadLog.recipeCode, code))
    .orderBy(desc(recipeLoadLog.createdAt))
    .limit(limit);
}
