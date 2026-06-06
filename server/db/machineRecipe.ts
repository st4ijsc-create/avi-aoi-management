/**
 * Sprint F4a — Machine Recipe versioning + deployment DB layer.
 *
 * A logical recipe is identified by `code` (optionally scoped to a machine /
 * machine type). Each save creates a NEW row with an incremented `version`.
 * Exactly one version per `code` is `active` (the currently deployed one); the
 * rest are `draft` or `archived`.
 *
 * deployRecipe / rollbackRecipe record a recipe_deployments row for audit and
 * flip the active version. They DO NOT push anything to a device — pushing a
 * select_recipe command to the machine goes through the HITL write-tool +
 * commandDispatcher (DRY-RUN in F4a). These functions only mutate the recipe
 * catalog / deployment ledger.
 */

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  machineRecipes,
  recipeDeployments,
  type MachineRecipe,
  type RecipeDeployment,
} from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/** Deterministic sha256 of a recipe payload (stable key order). */
export function computeChecksum(payload: Record<string, unknown>): string {
  const stable = stableStringify(payload);
  return createHash("sha256").update(stable).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface CreateRecipeInput {
  machineId?: number | null;
  machineType?: MachineRecipe["machineType"] | null;
  code: string;
  name: string;
  payload: Record<string, unknown>;
  status?: "draft" | "active" | "archived";
  notes?: string | null;
  createdBy?: number | null;
}

/**
 * Create a new recipe version for `code`. Version = max(existing)+1 (starts at 1).
 * Defaults to status='draft' (deploy promotes to active).
 */
export async function createRecipe(input: CreateRecipeInput): Promise<MachineRecipe> {
  const d = await db();
  const versions = await listRecipeVersions(input.code);
  const nextVersion = versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.version)) + 1;
  const checksum = computeChecksum(input.payload);

  const [row] = await d
    .insert(machineRecipes)
    .values({
      machineId: input.machineId ?? null,
      machineType: input.machineType ?? null,
      code: input.code,
      name: input.name,
      version: nextVersion,
      payload: input.payload,
      checksum,
      status: input.status ?? "draft",
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row;
}

export async function getRecipeById(id: number): Promise<MachineRecipe | undefined> {
  const d = await db();
  const [row] = await d.select().from(machineRecipes).where(eq(machineRecipes.id, id)).limit(1);
  return row;
}

/**
 * The currently-active recipe. Identify by code (preferred) or by machineId.
 * Returns undefined when none is active.
 */
export async function getActiveRecipe(opts: { code?: string; machineId?: number }): Promise<MachineRecipe | undefined> {
  const d = await db();
  if (opts.code != null) {
    const [row] = await d
      .select()
      .from(machineRecipes)
      .where(and(eq(machineRecipes.code, opts.code), eq(machineRecipes.status, "active")))
      .limit(1);
    return row;
  }
  if (opts.machineId != null) {
    const [row] = await d
      .select()
      .from(machineRecipes)
      .where(and(eq(machineRecipes.machineId, opts.machineId), eq(machineRecipes.status, "active")))
      .limit(1);
    return row;
  }
  return undefined;
}

/** All versions for a recipe `code`, newest version first. */
export async function listRecipeVersions(code: string): Promise<MachineRecipe[]> {
  const d = await db();
  return d
    .select()
    .from(machineRecipes)
    .where(eq(machineRecipes.code, code))
    .orderBy(desc(machineRecipes.version));
}

/** Archive a recipe version (active → archived). */
export async function archiveRecipe(id: number): Promise<void> {
  const d = await db();
  await d
    .update(machineRecipes)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(machineRecipes.id, id));
}

export interface DeployRecipeInput {
  recipeId: number;
  machineId: number;
  adapterId?: number | null;
  deployedBy: number;
  notes?: string | null;
}

/**
 * Deploy a recipe version to a machine:
 *   - records the previously-active recipe (for that code) as previousRecipeId,
 *   - archives the previous active version,
 *   - marks the target version active,
 *   - inserts a recipe_deployments row (status='deployed').
 *
 * Pure catalog/ledger mutation — no device write happens here.
 */
export async function deployRecipe(input: DeployRecipeInput): Promise<RecipeDeployment> {
  const d = await db();
  const target = await getRecipeById(input.recipeId);
  if (!target) throw new Error(`Recipe #${input.recipeId} not found`);

  // Current active version for the SAME code (the one being superseded).
  const previous = await getActiveRecipe({ code: target.code });
  const previousRecipeId = previous && previous.id !== target.id ? previous.id : null;

  if (previousRecipeId != null) {
    await archiveRecipe(previousRecipeId);
  }

  await d
    .update(machineRecipes)
    .set({ status: "active", machineId: input.machineId, updatedAt: new Date() })
    .where(eq(machineRecipes.id, target.id));

  const [deployment] = await d
    .insert(recipeDeployments)
    .values({
      recipeId: target.id,
      machineId: input.machineId,
      adapterId: input.adapterId ?? null,
      deployedBy: input.deployedBy,
      previousRecipeId,
      status: "deployed",
      notes: input.notes ?? null,
    })
    .returning();
  return deployment;
}

/**
 * Roll back the most recent deployment for a machine: re-deploy the
 * previousRecipeId captured at deploy time. Throws when there is no prior
 * deployment with a recorded previous recipe.
 */
export async function rollbackRecipe(input: { machineId: number; deployedBy: number }): Promise<RecipeDeployment> {
  const d = await db();
  const [last] = await d
    .select()
    .from(recipeDeployments)
    .where(eq(recipeDeployments.machineId, input.machineId))
    .orderBy(desc(recipeDeployments.deployedAt))
    .limit(1);

  if (!last) throw new Error(`No deployment history for machine #${input.machineId}`);
  if (last.previousRecipeId == null) throw new Error(`Latest deployment for machine #${input.machineId} has no previous recipe to roll back to`);

  // Re-deploy the previous recipe; mark the rolled-back-from deployment.
  const deployment = await deployRecipe({
    recipeId: last.previousRecipeId,
    machineId: input.machineId,
    adapterId: last.adapterId,
    deployedBy: input.deployedBy,
    notes: `Rollback of deployment #${last.id}`,
  });

  await d
    .update(recipeDeployments)
    .set({ status: "rolled_back" })
    .where(eq(recipeDeployments.id, last.id));

  return deployment;
}
