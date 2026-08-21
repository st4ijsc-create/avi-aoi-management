/**
 * W3-C (doc 27 §2 M9, Đợt 3 item 3.4) — Inspection-program approval/release workflow.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT: the "inspection program" of a product model is its complete
 * measurement-point set (geometry + thresholds + lighting/tolerance metadata).
 * Until now it had NO release workflow — measurement_point_versions only
 * snapshots per-point edits, product_models.pointsConfigVersion is a bare
 * counter, threshold_approvals covers single thresholds. This service adds an
 * append-only release ledger (inspection_program_releases) MIRRORING the proven
 * server/db/machineRecipe.ts pattern:
 *
 *   draft ──submit──▶ pending_approval ──approve──▶ approved ──release──▶ released
 *                            │                                              │
 *                            └──reject──▶ rejected          (previous released of the
 *                                                            same scope → superseded)
 *
 *   • SoD (segregation of duties): the CREATOR of a release may NOT approve it —
 *     a different person must sign off (same rule as machineRecipe.approveRecipe).
 *   • Atomic release: releaseProgram runs in ONE transaction with a
 *     SELECT … FOR UPDATE lock over every release of the productModelId, so two
 *     concurrent releases serialize and the scope can never end up with zero or
 *     two released versions. A partial unique index (uq_prog_rel_one_released,
 *     migration 0182) is the DB-level safety net.
 *   • Append-only genealogy: rows are never deleted; previousReleaseId records
 *     what a release superseded; every transition is audited via createAuditLog.
 *
 * ENFORCEMENT SEAM (SOFT — consistent with the wave philosophy): editing
 * measurement_point_defs remains allowed (the live point-set is the implicit
 * draft). Consumers that need the production-truth program call
 * getActiveRelease(productModelId, machineId?) and read the released snapshot.
 *
 * DOC 31 DECISION #1 (release = AUDIT-ONLY): a release is a PROVENANCE ledger,
 * NOT the machine's live source of truth. Machines keep resolving points via
 * deltaSync/pointsConfigVersion and goldens live by productCode. The release
 * snapshot captures points + thresholds + (OP7) the active golden refs purely so
 * a released program is reproducible/auditable — it does NOT gate machine
 * behavior. "Real machine gating" is deferred until ≥1 product is actually
 * released in the field (doc 31 §8 #1).
 *
 * ĐỢT 7 WIRING ITEM (out of scope here on purpose): stamping
 * product_inspections.programReleaseId at ingest time. product_inspections is a
 * hypertable owned by Đợt 1/7 agents — adding the column + wiring the ingest
 * path happens there; this service already exposes getActiveRelease for it.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";
import { DbUnavailableError } from "../_core/dbErrors";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { createAuditLog } from "../db/system";
import { listReleaseGoldenRefs, type GoldenRefProvenance } from "../db/goldenSample";
// W4-B (doc 35) — enforcement seams wired into the release path (both flag-OFF
// by default, so release behaviour is unchanged until an operator opts in).
import { assertFaiPassed } from "./faiGateService"; // FAI_GATE_ENABLED
import { markRevalidationPending } from "./goldenRevalidationService"; // GOLDEN_REVALIDATION_REQUIRED
import {
  inspectionProgramReleases,
  measurementPointDefs,
  productModels,
  users,
  type InspectionProgramRelease,
} from "../../drizzle/schema";

// ─── shared plumbing (mirrors server/db/machineRecipe.ts) ────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbOrTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deterministic sha256 of the snapshot POINTS (stable key order). */
export function computeProgramChecksum(points: unknown[]): string {
  return createHash("sha256").update(stableStringify(points)).digest("hex");
}

/**
 * Every workflow action is audited; audit failure must never fail the already
 * committed op (fail-soft, same stance as machineRecipe genealogy writes).
 */
async function auditSafe(
  action: string,
  release: { id: number; productModelId: number; version: number },
  userId: number | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await createAuditLog({
      userId: userId ?? null,
      action,
      entityType: "inspection_program_release",
      entityId: release.id,
      entityName: `product#${release.productModelId} program v${release.version}`,
      details: details ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[inspectionProgram] audit write failed:", err instanceof Error ? err.message : err);
  }
}

/** Null-safe machine-scope equality (NULL = product-level scope). */
function sameScope(a: number | null | undefined, b: number | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

// ─── snapshot capture ────────────────────────────────────────────────────────

export interface CreateReleaseInput {
  productModelId: number;
  /** NULL/undefined = product-level program; set = machine-specific program. */
  machineId?: number | null;
  notes?: string | null;
  createdBy: number;
}

/**
 * Snapshot the CURRENT measurement-point set of the product into an immutable
 * draft release. Version = max(existing per product)+1. Points are the live
 * (deletedAt IS NULL) rows; when machineId is given, machine-specific points of
 * OTHER machines are excluded (a point with machineId NULL applies to all).
 */
export async function createRelease(input: CreateReleaseInput): Promise<InspectionProgramRelease> {
  const d = await db();

  const [product] = await d
    .select()
    .from(productModels)
    .where(eq(productModels.id, input.productModelId))
    .limit(1);
  if (!product) throw new Error(`Product model #${input.productModelId} not found`);

  const allPoints = await d
    .select()
    .from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.productModelId, input.productModelId), isNull(measurementPointDefs.deletedAt)));

  const scopeMachineId = input.machineId ?? null;
  const points = allPoints
    .filter((p) => p.machineId == null || scopeMachineId == null || p.machineId === scopeMachineId)
    .sort((a, b) => (a.code === b.code ? a.id - b.id : a.code < b.code ? -1 : 1))
    // JSON round-trip → plain data (Dates → ISO strings) so snapshot/checksum are stable.
    .map((p) => JSON.parse(JSON.stringify(p)) as Record<string, unknown>);

  if (points.length === 0) {
    throw new Error("Sản phẩm chưa có điểm đo nào (sau khi lọc theo phạm vi máy) — không thể tạo bản phát hành rỗng.");
  }

  const existing = await d
    .select({ version: inspectionProgramReleases.version })
    .from(inspectionProgramReleases)
    .where(eq(inspectionProgramReleases.productModelId, input.productModelId));
  const nextVersion = existing.length === 0 ? 1 : Math.max(...existing.map((r) => r.version)) + 1;

  // ── OP7 (doc 31, decision #1) — golden-ref provenance ──────────────────────
  // Record the product's ACTIVE + APPROVED golden references (id + version + key)
  // into the snapshot so a released program is REPRODUCIBLE against its known-good
  // images. IMPORTANT — release is AUDIT-ONLY (decision #1): machines still resolve
  // goldens LIVE by productCode via deltaSync / getActiveGoldenReference. This
  // provenance changes NOTHING about diff behavior; it only makes the historical
  // release self-describing. Fail-soft: a golden-fetch error must never block a
  // release (the point-set is the primary, mandatory artifact). Golden refs are
  // deliberately EXCLUDED from `checksum` — the program identity is its point-set;
  // golden versions are provenance metadata, not part of that identity.
  const productCode = (product as { code?: string }).code ?? null;
  let goldenRefs: GoldenRefProvenance[] = [];
  try {
    goldenRefs = await listReleaseGoldenRefs({ productModelId: input.productModelId, productCode });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[inspectionProgram] golden-ref snapshot skipped:", err instanceof Error ? err.message : err);
  }

  const checksum = computeProgramChecksum(points);
  const snapshot = {
    productModelId: input.productModelId,
    machineId: scopeMachineId,
    productCode,
    pointsConfigVersion: (product as { pointsConfigVersion?: number }).pointsConfigVersion ?? null,
    capturedAt: new Date().toISOString(),
    points,
    // OP7 — audit-only golden provenance (see note above); not in the checksum.
    goldenRefs,
  };

  const [row] = await d
    .insert(inspectionProgramReleases)
    .values({
      productModelId: input.productModelId,
      machineId: scopeMachineId,
      version: nextVersion,
      status: "draft",
      snapshot,
      checksum,
      pointCount: points.length,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  await auditSafe("inspection_program.release.create", row, input.createdBy, {
    checksum,
    pointCount: points.length,
    machineId: scopeMachineId,
    // OP7 — how many known-good goldens the release captured for provenance.
    goldenRefCount: goldenRefs.length,
  });
  return row;
}

// ─── workflow transitions ────────────────────────────────────────────────────

export async function getReleaseById(id: number): Promise<InspectionProgramRelease | undefined> {
  const d = await db();
  const [row] = await d
    .select()
    .from(inspectionProgramReleases)
    .where(eq(inspectionProgramReleases.id, id))
    .limit(1);
  return row;
}

/** draft → pending_approval. */
export async function submitForApproval(input: { releaseId: number; userId: number }): Promise<InspectionProgramRelease> {
  const d = await db();
  const target = await getReleaseById(input.releaseId);
  if (!target) throw new Error(`Program release #${input.releaseId} not found`);
  if (target.status !== "draft") {
    throw new Error(`Chỉ bản nháp mới được gửi duyệt (trạng thái hiện tại: ${target.status}).`);
  }
  const [row] = await d
    .update(inspectionProgramReleases)
    .set({ status: "pending_approval", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(inspectionProgramReleases.id, input.releaseId))
    .returning();
  await auditSafe("inspection_program.release.submit", row, input.userId);
  return row;
}

/**
 * pending_approval → approved. SoD: the CREATOR may NOT approve their own
 * release — a different person must sign off (mirrors machineRecipe W2-9).
 */
export async function approveRelease(input: {
  releaseId: number;
  approvedBy: number;
  note?: string | null;
}): Promise<InspectionProgramRelease> {
  const d = await db();
  const target = await getReleaseById(input.releaseId);
  if (!target) throw new Error(`Program release #${input.releaseId} not found`);
  if (target.status !== "pending_approval") {
    throw new Error(`Chỉ bản đang chờ duyệt mới được duyệt (trạng thái hiện tại: ${target.status}).`);
  }
  if (target.createdBy != null && target.createdBy === input.approvedBy) {
    throw new Error("Segregation of duties — người tạo bản phát hành không được tự duyệt; cần một người khác duyệt.");
  }
  const [row] = await d
    .update(inspectionProgramReleases)
    .set({
      status: "approved",
      approvedBy: input.approvedBy,
      approvedAt: new Date(),
      approvalNote: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(inspectionProgramReleases.id, input.releaseId))
    .returning();
  await auditSafe("inspection_program.release.approve", row, input.approvedBy, { note: input.note ?? null });
  return row;
}

/** pending_approval → rejected (reason required). */
export async function rejectRelease(input: {
  releaseId: number;
  rejectedBy: number;
  reason: string;
}): Promise<InspectionProgramRelease> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error("Từ chối bản phát hành cần có lý do.");
  }
  const d = await db();
  const target = await getReleaseById(input.releaseId);
  if (!target) throw new Error(`Program release #${input.releaseId} not found`);
  if (target.status !== "pending_approval") {
    throw new Error(`Chỉ bản đang chờ duyệt mới bị từ chối (trạng thái hiện tại: ${target.status}).`);
  }
  const [row] = await d
    .update(inspectionProgramReleases)
    .set({
      status: "rejected",
      rejectedBy: input.rejectedBy,
      rejectedAt: new Date(),
      rejectReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(inspectionProgramReleases.id, input.releaseId))
    .returning();
  await auditSafe("inspection_program.release.reject", row, input.rejectedBy, { reason: input.reason });
  return row;
}

/**
 * approved → released — ATOMIC. Inside ONE transaction:
 *   1. re-read the target and verify status under the lock,
 *   2. SELECT … FOR UPDATE every release of the productModelId (serializes
 *      concurrent releasers — same technique as machineRecipe.deployWithinTx),
 *   3. supersede the previously released version of the SAME machine-scope,
 *   4. mark the target released (+ previousReleaseId genealogy).
 * A crash mid-way rolls the whole thing back — never zero or two released rows.
 */
export async function releaseProgram(input: { releaseId: number; releasedBy: number }): Promise<InspectionProgramRelease> {
  const d = await db();
  const result = await d.transaction(async (tx: DbOrTx) => {
    const [target] = await tx
      .select()
      .from(inspectionProgramReleases)
      .where(eq(inspectionProgramReleases.id, input.releaseId))
      .limit(1);
    if (!target) throw new Error(`Program release #${input.releaseId} not found`);
    if (target.status !== "approved") {
      throw new Error(`Chỉ bản đã duyệt mới được phát hành (trạng thái hiện tại: ${target.status}).`);
    }

    // W4-B task 3 — FAI gate. When FAI_GATE_ENABLED is ON, a program cannot be
    // RELEASED (i.e. accepted into production) for a product/machine until a
    // passing FAI exists; the throw rolls back the release so the operator can
    // act (run + pass FAI, then re-release). Flag OFF ⇒ pure no-op pass-through,
    // so current release flows are unchanged. Release ≠ ingest, so this never
    // hard-breaks the high-volume ingest path.
    await assertFaiPassed(target.productModelId, target.machineId ?? null);

    // Row-lock ALL releases of this product → concurrent releasers serialize here.
    const locked = await tx
      .select()
      .from(inspectionProgramReleases)
      .where(eq(inspectionProgramReleases.productModelId, target.productModelId))
      .for("update");

    const previous = locked.find(
      (r) => r.status === "released" && r.id !== target.id && sameScope(r.machineId, target.machineId),
    );

    if (previous) {
      await tx
        .update(inspectionProgramReleases)
        .set({ status: "superseded", supersededAt: new Date(), updatedAt: new Date() })
        .where(eq(inspectionProgramReleases.id, previous.id));
    }

    const [released] = await tx
      .update(inspectionProgramReleases)
      .set({
        status: "released",
        releasedBy: input.releasedBy,
        releasedAt: new Date(),
        previousReleaseId: previous?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(inspectionProgramReleases.id, target.id))
      .returning();
    return { released, previousId: previous?.id ?? null };
  });

  await auditSafe("inspection_program.release.release", result.released, input.releasedBy, {
    supersededReleaseId: result.previousId,
  });

  // W4-B task 4 — golden-diff enforcement. A newly released program may no longer
  // match the product's APPROVED goldens, so (when GOLDEN_REVALIDATION_REQUIRED is
  // ON and the product has approved goldens) raise an advisory
  // "golden-revalidation-pending" flag the readiness/release UI surfaces until a
  // golden diff clears it. Fail-soft + flag-gated inside the service — never
  // blocks or fails the already-committed release.
  await markRevalidationPending({
    productModelId: result.released.productModelId,
    reason: `program release #${result.released.id} (v${result.released.version})`,
    triggeredByReleaseId: result.released.id,
  });

  return result.released;
}

// ─── reads ───────────────────────────────────────────────────────────────────

/**
 * The production-truth program for a product (optionally machine-specific).
 * Resolution: a released row for the EXACT machine scope wins; a machine
 * without its own released program falls back to the product-level (machineId
 * NULL) released program. Returns null when nothing is released — callers
 * (ingest/analytics, Đợt 7) treat that as "running unreleased/draft program".
 */
export async function getActiveRelease(opts: {
  productModelId: number;
  machineId?: number | null;
}): Promise<InspectionProgramRelease | null> {
  const d = await db();
  const rows = await d
    .select()
    .from(inspectionProgramReleases)
    .where(
      and(
        eq(inspectionProgramReleases.productModelId, opts.productModelId),
        eq(inspectionProgramReleases.status, "released"),
      ),
    );
  const machineId = opts.machineId ?? null;
  if (machineId != null) {
    const exact = rows.find((r) => r.machineId === machineId);
    if (exact) return exact;
  }
  return rows.find((r) => r.machineId == null) ?? null;
}

export type ReleaseWithNames = InspectionProgramRelease & {
  createdByName: string | null;
  approvedByName: string | null;
  rejectedByName: string | null;
  releasedByName: string | null;
};

/** All releases of a product, newest version first, with actor names resolved. */
export async function listReleases(productModelId: number): Promise<ReleaseWithNames[]> {
  const d = await db();
  const rows = await d
    .select()
    .from(inspectionProgramReleases)
    .where(eq(inspectionProgramReleases.productModelId, productModelId))
    .orderBy(desc(inspectionProgramReleases.version));

  const ids = new Set<number>();
  for (const r of rows) {
    for (const v of [r.createdBy, r.approvedBy, r.rejectedBy, r.releasedBy]) {
      if (v != null) ids.add(v);
    }
  }
  const nameById = new Map<number, string | null>();
  if (ids.size > 0) {
    const us = await d
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...ids]));
    for (const u of us) nameById.set(u.id, u.name ?? null);
  }
  const nameOf = (id: number | null) => (id != null ? nameById.get(id) ?? null : null);

  return rows.map((r) => ({
    ...r,
    createdByName: nameOf(r.createdBy),
    approvedByName: nameOf(r.approvedBy),
    rejectedByName: nameOf(r.rejectedBy),
    releasedByName: nameOf(r.releasedBy),
  }));
}

// ─── snapshot diff ───────────────────────────────────────────────────────────

/** Volatile per-row fields that must not count as program differences. */
const DIFF_IGNORED_FIELDS = new Set(["id", "createdAt", "updatedAt", "lastModifiedAt", "deletedAt"]);

export interface PointFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface ProgramDiff {
  added: Array<{ code: string; name: string | null }>;
  removed: Array<{ code: string; name: string | null }>;
  modified: Array<{ code: string; name: string | null; changes: PointFieldChange[] }>;
  unchangedCount: number;
  identical: boolean;
}

type SnapshotPoint = Record<string, unknown> & { code?: string; name?: string };

function pointsOf(snapshot: unknown): SnapshotPoint[] {
  const points = (snapshot as { points?: unknown })?.points;
  return Array.isArray(points) ? (points as SnapshotPoint[]) : [];
}

const norm = (v: unknown) => (v === undefined ? null : v);
const same = (a: unknown, b: unknown) => stableStringify(norm(a)) === stableStringify(norm(b));

/**
 * Structural diff of two program snapshots keyed by point `code` (the stable
 * business key). Deterministic output (codes sorted); volatile row fields
 * ignored. Pure function — reusable outside the DB path (tests, UI preview).
 */
export function diffProgramSnapshots(a: unknown, b: unknown): ProgramDiff {
  const aPoints = new Map(pointsOf(a).map((p) => [String(p.code ?? ""), p]));
  const bPoints = new Map(pointsOf(b).map((p) => [String(p.code ?? ""), p]));

  const added: ProgramDiff["added"] = [];
  const removed: ProgramDiff["removed"] = [];
  const modified: ProgramDiff["modified"] = [];
  let unchangedCount = 0;

  const allCodes = [...new Set([...aPoints.keys(), ...bPoints.keys()])].sort();
  for (const code of allCodes) {
    const pa = aPoints.get(code);
    const pb = bPoints.get(code);
    if (pa && !pb) {
      removed.push({ code, name: (pa.name as string) ?? null });
      continue;
    }
    if (!pa && pb) {
      added.push({ code, name: (pb.name as string) ?? null });
      continue;
    }
    if (!pa || !pb) continue;
    const fields = [...new Set([...Object.keys(pa), ...Object.keys(pb)])]
      .filter((f) => !DIFF_IGNORED_FIELDS.has(f))
      .sort();
    const changes: PointFieldChange[] = [];
    for (const field of fields) {
      if (!same(pa[field], pb[field])) {
        changes.push({ field, before: norm(pa[field]), after: norm(pb[field]) });
      }
    }
    if (changes.length > 0) modified.push({ code, name: (pb.name as string) ?? (pa.name as string) ?? null, changes });
    else unchangedCount++;
  }

  return {
    added,
    removed,
    modified,
    unchangedCount,
    identical: added.length === 0 && removed.length === 0 && modified.length === 0,
  };
}

export interface CompareResult {
  a: { id: number; version: number; status: string; checksum: string; pointCount: number };
  b: { id: number; version: number; status: string; checksum: string; pointCount: number };
  diff: ProgramDiff;
}

/** Diff two releases of the SAME product by id (a = base/older, b = compare/newer). */
export async function compareReleases(aId: number, bId: number): Promise<CompareResult> {
  const [a, b] = await Promise.all([getReleaseById(aId), getReleaseById(bId)]);
  if (!a) throw new Error(`Program release #${aId} not found`);
  if (!b) throw new Error(`Program release #${bId} not found`);
  if (a.productModelId !== b.productModelId) {
    throw new Error("Chỉ so sánh được hai bản phát hành của cùng một sản phẩm.");
  }
  return {
    a: { id: a.id, version: a.version, status: a.status, checksum: a.checksum, pointCount: a.pointCount },
    b: { id: b.id, version: b.version, status: b.status, checksum: b.checksum, pointCount: b.pointCount },
    diff: diffProgramSnapshots(a.snapshot, b.snapshot),
  };
}
