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
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "./connection";
import {
  machineRecipes,
  recipeDeployments,
  users,
  type MachineRecipe,
  type RecipeDeployment,
} from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// Handle usable for both the top-level db and a transaction handle (W2-6). Derived
// from the db's own transaction callback so the query-builder surface (.for("update"))
// stays fully typed.
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbOrTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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

/**
 * All versions for a recipe `code`, newest version first.
 * U6 (doc 26) — kèm tên người tạo (createdByName) qua left-join users để chỗ
 * duyệt/bảng phiên bản hiển thị "ai tạo" mà không cần tra cứu thêm.
 */
export async function listRecipeVersions(
  code: string,
): Promise<Array<MachineRecipe & { createdByName: string | null }>> {
  const d = await db();
  const rows = await d
    .select({ ...getTableColumns(machineRecipes), createdByName: users.name })
    .from(machineRecipes)
    .leftJoin(users, eq(machineRecipes.createdBy, users.id))
    .where(eq(machineRecipes.code, code))
    .orderBy(desc(machineRecipes.version));
  return rows;
}

export interface ApproveRecipeInput {
  recipeId: number;
  approvedBy: number;
  note?: string | null;
}

/**
 * W2-9 (doc 25 T6) — second-approver (segregation of duties). Marks a recipe version
 * as approved by `approvedBy`. The CREATOR may NOT approve their own recipe — a
 * different person must sign off. Throws when the recipe is missing or self-approved.
 */
export async function approveRecipe(input: ApproveRecipeInput): Promise<MachineRecipe> {
  const d = await db();
  const [target] = await d.select().from(machineRecipes).where(eq(machineRecipes.id, input.recipeId)).limit(1);
  if (!target) throw new Error(`Recipe #${input.recipeId} not found`);
  // Phân tách nhiệm vụ: người tạo không được tự duyệt recipe của mình.
  if (target.createdBy != null && target.createdBy === input.approvedBy) {
    throw new Error("Segregation of duties — người tạo recipe không được tự duyệt; cần một người khác trình duyệt.");
  }
  const [row] = await d
    .update(machineRecipes)
    .set({
      approvedBy: input.approvedBy,
      approvedAt: new Date(),
      approvalNote: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(machineRecipes.id, input.recipeId))
    .returning();
  return row;
}

/** Archive a recipe version (active → archived). */
export async function archiveRecipe(id: number): Promise<void> {
  const d = await db();
  await d
    .update(machineRecipes)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(machineRecipes.id, id));
}

/**
 * W5-22 (doc 25 (a)) — mark/unmark a recipe version as GOLDEN (master/baseline).
 * Golden is a curator flag used as the reference when deploying/diffing; it does NOT
 * change the deployment status. Returns the updated row.
 */
export async function setGoldenRecipe(id: number, isGolden: boolean): Promise<MachineRecipe> {
  const d = await db();
  const [row] = await d
    .update(machineRecipes)
    .set({ isGolden, updatedAt: new Date() })
    .where(eq(machineRecipes.id, id))
    .returning();
  return row;
}

export interface DeployRecipeInput {
  recipeId: number;
  machineId: number;
  adapterId?: number | null;
  deployedBy: number;
  notes?: string | null;
}

/**
 * ATOMIC core of a deploy — MUST run inside a transaction (W2-6 / doc 25 T5). Before
 * reading the previously-active version it LOCKS every version of the target's `code`
 * with SELECT … FOR UPDATE, so two concurrent deploys/releases of the same code
 * serialize on that lock and can never both flip a version to active (the read →
 * archive → set-active → ledger steps are now indivisible; a crash mid-way rolls the
 * whole thing back, never leaving the code with zero or two active versions).
 */
async function deployWithinTx(tx: DbOrTx, input: DeployRecipeInput): Promise<RecipeDeployment> {
  const [target] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, input.recipeId)).limit(1);
  if (!target) throw new Error(`Recipe #${input.recipeId} not found`);

  // Row-lock ALL versions sharing this code → serialize concurrent promoters.
  await tx.select().from(machineRecipes).where(eq(machineRecipes.code, target.code)).for("update");

  // Current active version for the SAME code (the one being superseded) — read UNDER the lock.
  const [previous] = await tx
    .select()
    .from(machineRecipes)
    .where(and(eq(machineRecipes.code, target.code), eq(machineRecipes.status, "active")))
    .limit(1);
  const previousRecipeId = previous && previous.id !== target.id ? previous.id : null;

  if (previousRecipeId != null) {
    await tx
      .update(machineRecipes)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(machineRecipes.id, previousRecipeId));
  }

  await tx
    .update(machineRecipes)
    .set({ status: "active", machineId: input.machineId, updatedAt: new Date() })
    .where(eq(machineRecipes.id, target.id));

  const [deployment] = await tx
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
 * Deploy a recipe version to a machine:
 *   - records the previously-active recipe (for that code) as previousRecipeId,
 *   - archives the previous active version,
 *   - marks the target version active,
 *   - inserts a recipe_deployments row (status='deployed').
 *
 * Pure catalog/ledger mutation — no device write happens here. All steps run inside a
 * single transaction with a FOR UPDATE lock on the code (W2-6 — closes the TOCTOU that
 * let two concurrent deploys both create an active version).
 */
export async function deployRecipe(input: DeployRecipeInput): Promise<RecipeDeployment> {
  const d = await db();
  return d.transaction(async (tx) => {
    // W2-9 (doc 25 T6) — SoD gate: only an APPROVED recipe (approved by someone other
    // than its creator, enforced at approveRecipe) may be deployed. Blocks the deploy of
    // a self-authored, un-reviewed recipe. Rollback re-deploys a PREVIOUSLY-active recipe
    // (already approved) and goes through deployWithinTx directly, so it is unaffected.
    const [target] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, input.recipeId)).limit(1);
    if (!target) throw new Error(`Recipe #${input.recipeId} not found`);
    if (target.approvedBy == null) {
      throw new Error("Recipe chưa được trình duyệt (second-approver) — cần một người khác duyệt trước khi deploy.");
    }
    return deployWithinTx(tx, input);
  });
}

/**
 * Roll back the most recent deployment for a machine: re-deploy the
 * previousRecipeId captured at deploy time. Throws when there is no prior
 * deployment with a recorded previous recipe.
 */
export async function rollbackRecipe(input: { machineId: number; deployedBy: number }): Promise<RecipeDeployment> {
  const d = await db();
  // ATOMIC (W2-6): the whole rollback — pick last deployment, re-deploy its previous
  // recipe (under the code FOR UPDATE lock), and mark the rolled-back-from deployment —
  // runs in ONE transaction. A crash mid-way leaves neither a half-flipped active
  // version nor a deployment ledger inconsistent with the catalog.
  return d.transaction(async (tx) => {
    const [last] = await tx
      .select()
      .from(recipeDeployments)
      .where(eq(recipeDeployments.machineId, input.machineId))
      .orderBy(desc(recipeDeployments.deployedAt))
      .limit(1);

    if (!last) throw new Error(`No deployment history for machine #${input.machineId}`);
    if (last.previousRecipeId == null) throw new Error(`Latest deployment for machine #${input.machineId} has no previous recipe to roll back to`);

    // Re-deploy the previous recipe within the SAME transaction; mark the rolled-back-from deployment.
    const deployment = await deployWithinTx(tx, {
      recipeId: last.previousRecipeId,
      machineId: input.machineId,
      adapterId: last.adapterId,
      deployedBy: input.deployedBy,
      notes: `Rollback of deployment #${last.id}`,
    });

    await tx
      .update(recipeDeployments)
      .set({ status: "rolled_back" })
      .where(eq(recipeDeployments.id, last.id));

    return deployment;
  });
}
