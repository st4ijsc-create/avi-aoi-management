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
import { appError } from "../_core/appError";
import { DbUnavailableError } from "../_core/dbErrors";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "./connection";
import {
  machineRecipes,
  machines,
  recipeDeployments,
  recipeLoadLog,
  users,
  type MachineRecipe,
  type RecipeDeployment,
} from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

// Handle usable for both the top-level db and a transaction handle (W2-6). Derived
// from the db's own transaction callback so the query-builder surface (.for("update"))
// stays fully typed.
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DbOrTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Operation names the single release gate reports (keys of `errors.operation.*`). */
export type RecipeReleaseOperation =
  | "deployRecipe"
  | "rollbackRecipeDeployment"
  | "releaseRecipeVersion"
  | "rollbackRecipeVersion";

/**
 * doc 80 Đợt 1 Task 9 (§12 "Còn mở" — T3) — THE one release gate for the release paths the task
 * owns: `/recipes` deploy + rollback (deployWithinTx) and equipmentIntegration release + rollback
 * (recipeVersioningService). Before this, the two surfaces had separate, drifting checks
 * (/recipes rollback checked nothing; deploy/release let an archived version or a recipe of
 * another machine type through). Callers OUTSIDE the task (recipe-set distribute, recordLoad with
 * deploy, changeover.approve) keep their pre-task behaviour through `deployRecipe(…,
 * "legacyApprovedOnly")` — fix round 1, ruling R-T9a.
 *
 * MUST be called on the row read UNDER the code's `SELECT … FOR UPDATE` (same transaction), so a
 * concurrent archive/edit that committed while the promoter waited for the lock is seen.
 * Refuses with PRECONDITION_FAILED + OPERATION_FAILED(reason):
 *   • `recipeNotApproved`         — no second-approver sign-off (approvedBy null);
 *   • `recipeArchived`            — archived version on a FORWARD promotion (deploy/release);
 *   • `recipeRetired`             — ROLLBACK (`rollbackTarget`) to an archived version WITHOUT
 *     positive evidence that it was REPLACED (superseded versions are stored 'archived' too), or
 *     one that was DELIBERATELY archived after its last replacement — see readRollbackEvidence;
 *   • `recipeMachineTypeMismatch` — both the recipe's `machineType` and the target machine's
 *     type are known and differ ("đúng loại máy nếu biết"). Target machine = `opts.machineId`
 *     (deploy/rollback onto a machine) else the recipe's own bound `machineId`.
 */
export async function assertRecipeReleasable(
  tx: DbOrTx,
  recipe: MachineRecipe,
  opts: { operation: RecipeReleaseOperation; machineId?: number | null; rollbackTarget?: boolean },
): Promise<void> {
  const label = `Recipe #${recipe.id} (${recipe.code} v${recipe.version})`;
  if (recipe.approvedBy == null) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: opts.operation, reason: "recipeNotApproved" },
      `${label} has not been approved — a second approver must sign off before it can be deployed/released/rolled back to.`,
    );
  }
  if (recipe.status === "archived") {
    if (!opts.rollbackTarget) {
      throw appError(
        "PRECONDITION_FAILED",
        "OPERATION_FAILED",
        { operation: opts.operation, reason: "recipeArchived" },
        `${label} is archived — create a new version instead of promoting an archived one.`,
      );
    }
    const ev = await readRollbackEvidence(tx, recipe.id);
    if (!ev.replacedAt || (ev.archivedAt && ev.archivedAt.getTime() >= ev.replacedAt.getTime())) {
      throw appError(
        "PRECONDITION_FAILED",
        "OPERATION_FAILED",
        { operation: opts.operation, reason: "recipeRetired" },
        ev.replacedAt
          ? `${label} was deliberately archived after it was last replaced — it cannot be rolled back to.`
          : `${label} is archived with no record of having been replaced — treated as retired; it cannot be rolled back to.`,
      );
    }
  }
  const targetMachineId = opts.machineId ?? recipe.machineId ?? null;
  if (recipe.machineType != null && targetMachineId != null) {
    const [m] = await tx
      .select({ machineType: machines.machineType })
      .from(machines)
      .where(eq(machines.id, targetMachineId))
      .limit(1);
    if (m?.machineType != null && m.machineType !== recipe.machineType) {
      throw appError(
        "PRECONDITION_FAILED",
        "OPERATION_FAILED",
        { operation: opts.operation, reason: "recipeMachineTypeMismatch" },
        `${label} is a ${recipe.machineType} recipe — machine #${targetMachineId} is ${m.machineType}.`,
      );
    }
  }
}

/**
 * Fix round 1 (Task 9) — why is an archived version archived? No migration: the evidence already
 * exists in two append-only trails.
 *   • REPLACED (superseded): the latest of
 *       - recipe_load_log.createdAt where fromRecipeId = id (release/rollback wrote "from" = the
 *         version it displaced; /recipes rollback genealogy too), and
 *       - recipe_deployments.deployedAt where previousRecipeId = id (/recipes deploy ledger).
 *   • DELIBERATELY ARCHIVED: the latest recipe_load_log.createdAt where action='archive' AND
 *     recipeId = id (equipmentIntegration archiveVersion and the /recipes archive route both write
 *     it).
 * Rollback to an archived version is legal only when it was replaced AND not archived again at or
 * after that replacement. Both timestamps are naive `timestamp` columns read through the same
 * driver, so they compare consistently. ⚠ recipe_load_log has tenant RLS (inert unless
 * app.tenant_rls_active='on', which these transactions never set) and the /recipes genealogy
 * write is fail-soft: a lost 'archive' row weakens the "retired" signal (see report).
 */
async function readRollbackEvidence(
  tx: DbOrTx,
  recipeId: number,
): Promise<{ replacedAt: Date | null; archivedAt: Date | null }> {
  const [fromLog] = await tx
    .select()
    .from(recipeLoadLog)
    .where(eq(recipeLoadLog.fromRecipeId, recipeId))
    .orderBy(desc(recipeLoadLog.createdAt))
    .limit(1);
  const [fromLedger] = await tx
    .select()
    .from(recipeDeployments)
    .where(eq(recipeDeployments.previousRecipeId, recipeId))
    .orderBy(desc(recipeDeployments.deployedAt))
    .limit(1);
  const [archived] = await tx
    .select()
    .from(recipeLoadLog)
    .where(and(eq(recipeLoadLog.recipeId, recipeId), eq(recipeLoadLog.action, "archive")))
    .orderBy(desc(recipeLoadLog.createdAt))
    .limit(1);
  const candidates = [fromLog?.createdAt, fromLedger?.deployedAt].filter((d): d is Date => d instanceof Date);
  const replacedAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
  return { replacedAt, archivedAt: archived?.createdAt instanceof Date ? archived.createdAt : null };
}

/**
 * Lock every version of `code` (FOR UPDATE) and return the target row as read UNDER that lock
 * (Task 9 — the release gate must judge the row a concurrent writer may just have changed).
 * Shared by /recipes (deployWithinTx) and equipmentIntegration (releaseVersion/rollbackToVersion).
 */
export async function lockCodeAndReadTarget(tx: DbOrTx, recipeId: number): Promise<MachineRecipe> {
  const [unlocked] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, recipeId)).limit(1);
  if (!unlocked) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, `Recipe #${recipeId} not found`);
  // Row-lock ALL versions sharing this code → serialize concurrent promoters.
  const locked = await tx.select().from(machineRecipes).where(eq(machineRecipes.code, unlocked.code)).for("update");
  const target = locked.find((r) => r.id === recipeId);
  if (!target) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, `Recipe #${recipeId} not found`);
  return target;
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
  if (!target) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, `Recipe #${input.recipeId} not found`);
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
async function deployWithinTx(
  tx: DbOrTx,
  input: DeployRecipeInput,
  gate: { operation: "deployRecipe" | "rollbackRecipeDeployment"; rollbackTarget: boolean } | null,
): Promise<RecipeDeployment> {
  // Row-lock ALL versions sharing this code → serialize concurrent promoters; target read UNDER it.
  const target = await lockCodeAndReadTarget(tx, input.recipeId);
  // doc 80 Đợt 1 Task 9 — the ONE release gate (approved · not archived on deploy · rollback only
  // to a REPLACED version · machine type). `null` = legacy callers (R-T9a): no gate here, their
  // pre-task approvedBy check ran in deployRecipe exactly as at 4fb1ec1e7.
  if (gate) {
    await assertRecipeReleasable(tx, target, { operation: gate.operation, machineId: input.machineId, rollbackTarget: gate.rollbackTarget });
  }

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
/**
 * Fix round 1 (Task 9, ruling R-T9a) — WHICH gate a deploy caller gets, explicitly:
 *   • "strict"             — the shared release gate (assertRecipeReleasable) under the code lock.
 *                            Only `/recipes` recipes.deploy uses it.
 *   • "legacyApprovedOnly" — EXACTLY what deployRecipe enforced at 4fb1ec1e7: an unlocked read,
 *                            NOT_FOUND, then `approvedBy == null` ⇒ plain Error (same Vietnamese
 *                            text). Archived versions and other machine types still go through.
 *                            Used by callers outside Task 9 (constraint 6: byte-identical):
 *                            recipeSetService distribute, recipeVersioningService.recordLoad
 *                            (deploy:true) and changeover.approve. Whether recipe sets should get
 *                            the strict gate is an OWNER decision (task-9 report).
 */
export type RecipeDeployPolicy = "strict" | "legacyApprovedOnly";

export async function deployRecipe(input: DeployRecipeInput, policy: RecipeDeployPolicy): Promise<RecipeDeployment> {
  const d = await db();
  return d.transaction(async (tx) => {
    if (policy === "strict") {
      // doc 80 Đợt 1 Task 9 — shared release gate inside deployWithinTx, under the code lock.
      return deployWithinTx(tx, input, { operation: "deployRecipe", rollbackTarget: false });
    }
    // W2-9 (doc 25 T6) — SoD gate as it was before Task 9 (legacy callers, R-T9a): only an
    // APPROVED recipe (approved by someone other than its creator, enforced at approveRecipe) may
    // be deployed.
    const [target] = await tx.select().from(machineRecipes).where(eq(machineRecipes.id, input.recipeId)).limit(1);
    if (!target) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, `Recipe #${input.recipeId} not found`);
    if (target.approvedBy == null) {
      throw new Error("Recipe chưa được trình duyệt (second-approver) — cần một người khác duyệt trước khi deploy.");
    }
    return deployWithinTx(tx, input, null);
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
    // doc 80 Đợt 1 Task 9 — the target passes the SAME release gate (before: none — an unapproved
    // previous version became active again). rollbackTarget: the version being rolled back TO was
    // archived when it got superseded — allowed only with replacement evidence and no later
    // deliberate archive (fix round 1, reason recipeRetired).
    const deployment = await deployWithinTx(
      tx,
      {
        recipeId: last.previousRecipeId,
        machineId: input.machineId,
        adapterId: last.adapterId,
        deployedBy: input.deployedBy,
        notes: `Rollback of deployment #${last.id}`,
      },
      { operation: "rollbackRecipeDeployment", rollbackTarget: true },
    );

    await tx
      .update(recipeDeployments)
      .set({ status: "rolled_back" })
      .where(eq(recipeDeployments.id, last.id));

    return deployment;
  });
}
