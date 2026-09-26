/**
 * AOI-B — Data access for golden_sample_references (get/set/list golden references).
 *
 * getDb() null-guard: read → returns empty/null safely; write → throws clearly.
 * Additive: does not touch existing accessors.
 */
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { and, eq, or, desc, isNull, SQL } from "drizzle-orm";
import {
  goldenSampleReferences,
  type GoldenSampleReference,
  type InsertGoldenSampleReference,
} from "../../drizzle/schema";

/** Key that identifies a golden-sample slot. Any subset may be set. */
export interface GoldenKey {
  productCode?: string | null;
  recipeCode?: string | null;
  stationCode?: string | null;
  roiKey?: string | null;
}

/** Equality predicate that treats undefined as NULL (exact-key match). */
function keyConds(key: GoldenKey): SQL[] {
  const conds: SQL[] = [];
  conds.push(key.productCode != null ? eq(goldenSampleReferences.productCode, key.productCode) : isNull(goldenSampleReferences.productCode));
  conds.push(key.recipeCode != null ? eq(goldenSampleReferences.recipeCode, key.recipeCode) : isNull(goldenSampleReferences.recipeCode));
  conds.push(key.stationCode != null ? eq(goldenSampleReferences.stationCode, key.stationCode) : isNull(goldenSampleReferences.stationCode));
  conds.push(key.roiKey != null ? eq(goldenSampleReferences.roiKey, key.roiKey) : isNull(goldenSampleReferences.roiKey));
  return conds;
}

/**
 * Fetch the current ACTIVE reference for an exact key (null when none / no DB).
 *
 * W7-C (doc 27 V11) — the resolver additionally requires status='approved':
 * drafts are NEVER production-resolvable. Backward compat is preserved because
 * migration 0189 grandfathered all pre-existing rows to 'approved' (they were
 * created before the workflow existed and are in production use).
 */
export async function getActiveGoldenReference(key: GoldenKey): Promise<GoldenSampleReference | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldenSampleReferences)
    .where(and(
      eq(goldenSampleReferences.active, true),
      eq(goldenSampleReferences.status, "approved"),
      ...keyConds(key),
    ))
    .orderBy(desc(goldenSampleReferences.version))
    .limit(1);
  return row ?? null;
}

/** Highest existing version for a key (0 when none). Used to bump on set. */
export async function getMaxGoldenVersion(key: GoldenKey): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select()
    .from(goldenSampleReferences)
    .where(and(...keyConds(key)))
    .orderBy(desc(goldenSampleReferences.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * W3-C (doc 27 §2 M10) — true when an error (or its cause chain) is the Postgres
 * unique violation (23505) raised by the one-active partial index
 * `uq_golden_ref_one_active` (migration 0182).
 */
function isOneActiveViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e != null && depth < 5; depth++) {
    const anyE = e as { code?: string; constraint_name?: string; message?: string; cause?: unknown };
    const msg = String(anyE.message ?? "");
    if (anyE.code === "23505" && (String(anyE.constraint_name ?? "").includes("uq_golden_ref_one_active") || msg.includes("uq_golden_ref_one_active"))) {
      return true;
    }
    // Some drivers only surface the index name in the message.
    if (msg.includes("uq_golden_ref_one_active")) return true;
    e = anyE.cause;
  }
  return false;
}

/**
 * Set (insert) a new ACTIVE reference for a key and deactivate any prior active rows
 * for the same key. `version` is bumped to max+1. Throws when the DB is unavailable
 * (write path is honest — never silently no-ops).
 *
 * W3-C (doc 27 §2 M10) — the "one active per key" invariant is now DB-enforced by
 * the partial unique index `uq_golden_ref_one_active` (0182). The deactivate+insert
 * pair runs in ONE transaction; if a concurrent setter slips a new active row in
 * between (READ COMMITTED cannot see a not-yet-committed insert, so app-level
 * deactivation can miss it), the index rejects the second insert with 23505 and we
 * retry the transactional deactivate-then-activate once — deterministic outcome:
 * exactly one active row per key, the retry's row.
 */
export async function setGoldenReference(
  values: InsertGoldenSampleReference,
): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const key: GoldenKey = {
    productCode: values.productCode ?? null,
    recipeCode: values.recipeCode ?? null,
    stationCode: values.stationCode ?? null,
    roiKey: values.roiKey ?? null,
  };

  const attempt = async (): Promise<GoldenSampleReference> =>
    db.transaction(async (tx) => {
      // Lock existing rows of this key → concurrent setters on the same key serialize.
      const existing = await tx
        .select({ id: goldenSampleReferences.id, version: goldenSampleReferences.version })
        .from(goldenSampleReferences)
        .where(and(...keyConds(key)))
        .for("update");
      const nextVersion = existing.reduce((m, r) => Math.max(m, r.version), 0) + 1;
      // Deactivate prior active rows for this exact key (same tx as the insert).
      await tx
        .update(goldenSampleReferences)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(goldenSampleReferences.active, true), ...keyConds(key)));
      const [row] = await tx
        .insert(goldenSampleReferences)
        // W7-C — legacy DIRECT-ACTIVATE path (pre-approval-workflow API, kept for
        // backward compat + tests/seeds): the inserted row is immediately
        // status='approved' so it stays resolvable exactly as before 0189. The
        // governed capture path is insertDraftGoldenReference → approveGoldenReference
        // (SoD); routers only expose the governed path.
        .values({ ...values, version: nextVersion, active: true, status: values.status ?? "approved" })
        .returning();
      return row;
    });

  try {
    return await attempt();
  } catch (err) {
    if (!isOneActiveViolation(err)) throw err;
    // Lost a race with a concurrent setter — its committed active row is visible
    // now; the retry deactivates it and activates ours.
    return attempt();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// W7-C (doc 27 §9 V11) — approval workflow: draft → approved (SoD) → retired.
//
// Lifecycle:
//   * insertDraftGoldenReference — capture (upload / from-inspection) creates a
//     DRAFT: active=false, status='draft', version=max(key)+1. NEVER resolvable.
//   * approveGoldenReference     — a DIFFERENT user signs off (capturer ≠ approver,
//     mirroring machineRecipe approveRecipe W2-9). Atomically deactivates the
//     prior active row for the key and activates this one (same 23505-retry
//     pattern as setGoldenReference — the 0182 one-active index stays authoritative).
//   * rejectGoldenReference      — draft → 'retired' (never approved).
//   * retireGoldenReference      — approved → 'retired' + active=false (pulls it
//     from production resolution; history row remains).
// Superseded rows (deactivated by a newer approval) keep status='approved' with
// active=false — honest history of what WAS approved.
// ════════════════════════════════════════════════════════════════════════════

/** Thrown when the capturer tries to approve their own golden (SoD violation). */
export class GoldenSoDError extends Error {
  constructor() {
    super("Segregation of duties — người chụp golden không được tự duyệt; cần một người khác phê duyệt.");
    this.name = "GoldenSoDError";
  }
}

/** Thrown on an illegal lifecycle transition (e.g. approving a retired row). */
export class GoldenStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenStatusError";
  }
}

/** Fetch a reference row by id (null when missing / no DB). */
export async function getGoldenReferenceById(id: number): Promise<GoldenSampleReference | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldenSampleReferences)
    .where(eq(goldenSampleReferences.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Insert a DRAFT reference for a key (active=false, status='draft', version bumped).
 * Drafts are invisible to getActiveGoldenReference until approved.
 */
export async function insertDraftGoldenReference(
  values: InsertGoldenSampleReference,
): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const key: GoldenKey = {
    productCode: values.productCode ?? null,
    recipeCode: values.recipeCode ?? null,
    stationCode: values.stationCode ?? null,
    roiKey: values.roiKey ?? null,
  };
  return db.transaction(async (tx) => {
    // Lock the key's rows so concurrent captures serialize on the version bump.
    const existing = await tx
      .select({ id: goldenSampleReferences.id, version: goldenSampleReferences.version })
      .from(goldenSampleReferences)
      .where(and(...keyConds(key)))
      .for("update");
    const nextVersion = existing.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const [row] = await tx
      .insert(goldenSampleReferences)
      .values({ ...values, version: nextVersion, active: false, status: "draft" })
      .returning();
    return row;
  });
}

export interface ApproveGoldenInput {
  id: number;
  approvedBy: number;
  note?: string | null;
}

/**
 * Approve a DRAFT reference (SoD: capturer ≠ approver) and atomically make it the
 * single ACTIVE row for its key. Uses the same deactivate-then-activate transaction
 * + 23505 retry as setGoldenReference so the 0182 one-active invariant holds under
 * concurrency.
 */
export async function approveGoldenReference(input: ApproveGoldenInput): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const attempt = async (): Promise<GoldenSampleReference> =>
    db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(goldenSampleReferences)
        .where(eq(goldenSampleReferences.id, input.id))
        .for("update");
      if (!target) throw new GoldenStatusError(`Golden reference #${input.id} not found`);
      if (target.status !== "draft") {
        throw new GoldenStatusError(`Chỉ golden ở trạng thái 'draft' mới duyệt được (hiện tại: '${target.status}')`);
      }
      // SoD — mirrors machineRecipe approveRecipe (W2-9): creator may not self-approve.
      if (target.createdBy != null && target.createdBy === input.approvedBy) {
        throw new GoldenSoDError();
      }
      const key: GoldenKey = {
        productCode: target.productCode,
        recipeCode: target.recipeCode,
        stationCode: target.stationCode,
        roiKey: target.roiKey,
      };
      // Serialize with concurrent setters/approvers on the same key.
      await tx
        .select({ id: goldenSampleReferences.id })
        .from(goldenSampleReferences)
        .where(and(...keyConds(key)))
        .for("update");
      await tx
        .update(goldenSampleReferences)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(goldenSampleReferences.active, true), ...keyConds(key)));
      const [row] = await tx
        .update(goldenSampleReferences)
        .set({
          active: true,
          status: "approved",
          approvedBy: input.approvedBy,
          approvedAt: new Date(),
          approvalNote: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(goldenSampleReferences.id, input.id))
        .returning();
      return row;
    });

  try {
    return await attempt();
  } catch (err) {
    if (!isOneActiveViolation(err)) throw err;
    return attempt();
  }
}

/** Reject a DRAFT (→ 'retired', never activated). Throws on non-draft rows. */
export async function rejectGoldenReference(id: number, note?: string | null): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(goldenSampleReferences)
      .where(eq(goldenSampleReferences.id, id))
      .for("update");
    if (!target) throw new GoldenStatusError(`Golden reference #${id} not found`);
    if (target.status !== "draft") {
      throw new GoldenStatusError(`Chỉ golden ở trạng thái 'draft' mới từ chối được (hiện tại: '${target.status}')`);
    }
    const [row] = await tx
      .update(goldenSampleReferences)
      .set({ status: "retired", active: false, approvalNote: note ?? null, updatedAt: new Date() })
      .where(eq(goldenSampleReferences.id, id))
      .returning();
    return row;
  });
}

/**
 * Retire an APPROVED reference (→ 'retired', active=false). Removes it from
 * production resolution; the row stays as history. Idempotent on already-retired.
 */
export async function retireGoldenReference(id: number, note?: string | null): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(goldenSampleReferences)
      .where(eq(goldenSampleReferences.id, id))
      .for("update");
    if (!target) throw new GoldenStatusError(`Golden reference #${id} not found`);
    if (target.status === "draft") {
      throw new GoldenStatusError("Golden 'draft' dùng reject, không dùng retire");
    }
    const [row] = await tx
      .update(goldenSampleReferences)
      .set({ status: "retired", active: false, approvalNote: note ?? target.approvalNote, updatedAt: new Date() })
      .where(eq(goldenSampleReferences.id, id))
      .returning();
    return row;
  });
}

/** W7-C (V7) — toggle per-golden align-before-diff. */
export async function setGoldenAlignBeforeDiff(id: number, enabled: boolean): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [row] = await db
    .update(goldenSampleReferences)
    .set({ alignBeforeDiff: enabled, updatedAt: new Date() })
    .where(eq(goldenSampleReferences.id, id))
    .returning();
  if (!row) throw new GoldenStatusError(`Golden reference #${id} not found`);
  return row;
}

export interface ListGoldenFilter {
  productCode?: string | null;
  recipeCode?: string | null;
  activeOnly?: boolean;
  /** W7-C — filter by workflow status ('draft' | 'approved' | 'retired'). */
  status?: string | null;
  limit?: number;
}

/** List references (optionally filtered). Read-only; returns [] when no DB. */
export async function listGoldenReferences(
  filter: ListGoldenFilter = {},
): Promise<GoldenSampleReference[]> {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [];
  if (filter.productCode != null) conds.push(eq(goldenSampleReferences.productCode, filter.productCode));
  if (filter.recipeCode != null) conds.push(eq(goldenSampleReferences.recipeCode, filter.recipeCode));
  if (filter.activeOnly) conds.push(eq(goldenSampleReferences.active, true));
  if (filter.status != null) conds.push(eq(goldenSampleReferences.status, filter.status));
  return db
    .select()
    .from(goldenSampleReferences)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(goldenSampleReferences.updatedAt))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 31 PM5 / UX8 / OP7 (WB-3) — per-PRODUCT queries.
//
// A golden is linked to a product either by the new FK (productModelId, 0195) or,
// for rows not yet backfilled, by the legacy productCode string. This resolver
// PREFERS the FK when set and FALLS BACK to productCode, so both the product-page
// panel and the release-snapshot provenance see the complete set regardless of
// how a given row was linked.
// ════════════════════════════════════════════════════════════════════════════

export interface ProductGoldenFilter {
  productModelId: number;
  /** The product's code — used to also catch legacy rows linked only by code. */
  productCode?: string | null;
  activeOnly?: boolean;
  status?: string | null;
  limit?: number;
}

/**
 * List a product's goldens. Matches rows where `productModelId` = the id (FK path)
 * OR (FK is NULL AND productCode = the product's code) (legacy path). Read-only;
 * returns [] when no DB. Newest-updated first.
 */
export async function listGoldenReferencesForProduct(
  filter: ProductGoldenFilter,
): Promise<GoldenSampleReference[]> {
  const db = await getDb();
  if (!db) return [];

  const linkCond = filter.productCode
    ? or(
        eq(goldenSampleReferences.productModelId, filter.productModelId),
        and(
          isNull(goldenSampleReferences.productModelId),
          eq(goldenSampleReferences.productCode, filter.productCode),
        ),
      )!
    : eq(goldenSampleReferences.productModelId, filter.productModelId);

  const conds: SQL[] = [linkCond];
  if (filter.activeOnly) conds.push(eq(goldenSampleReferences.active, true));
  if (filter.status != null) conds.push(eq(goldenSampleReferences.status, filter.status));

  return db
    .select()
    .from(goldenSampleReferences)
    .where(and(...conds))
    .orderBy(desc(goldenSampleReferences.updatedAt))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
}

/**
 * OP7 (doc 31) — the ACTIVE + APPROVED goldens of a product, slimmed to the
 * provenance fields a program release records so a released program is
 * reproducible against its known-good images. Decision #1: this is AUDIT-ONLY
 * provenance — it does NOT change what a machine resolves at diff time.
 */
export interface GoldenRefProvenance {
  id: number;
  version: number;
  productModelId: number | null;
  productCode: string | null;
  recipeCode: string | null;
  stationCode: string | null;
  roiKey: string | null;
  status: string;
}

export async function listReleaseGoldenRefs(opts: {
  productModelId: number;
  productCode?: string | null;
}): Promise<GoldenRefProvenance[]> {
  const rows = await listGoldenReferencesForProduct({
    productModelId: opts.productModelId,
    productCode: opts.productCode ?? null,
    activeOnly: true,
    status: "approved",
    limit: 1000,
  });
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    productModelId: r.productModelId ?? null,
    productCode: r.productCode ?? null,
    recipeCode: r.recipeCode ?? null,
    stationCode: r.stationCode ?? null,
    roiKey: r.roiKey ?? null,
    status: r.status,
  }));
}

/** Deactivate a reference by id (soft delete). Throws when no DB. */
export async function deactivateGoldenReference(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db
    .update(goldenSampleReferences)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(goldenSampleReferences.id, id));
}
