/**
 * Golden-diff revalidation enforcement — doc 35 Wave W4-B, task 4.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The golden-sample diff pipeline is fully built but NEVER triggered: after a
 * program / threshold change there was no signal that the product's APPROVED
 * golden references might no longer match, so a re-diff was manual-only and thus
 * usually skipped.
 *
 * This service adds the ADVISORY enforcement seam. When a program/threshold
 * change is RELEASED for a product that already has ≥1 approved golden reference,
 * we raise a "golden-revalidation-pending" flag (golden_revalidation_flags). The
 * readiness / release UI surfaces it until a golden diff run CLEARS it. It is a
 * STATUS, never a hard ingest block.
 *
 * FLAG: GOLDEN_REVALIDATION_REQUIRED (default OFF). When OFF, markRevalidationPending
 * is a no-op — current flows are untouched.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  goldenRevalidationFlags,
  type GoldenRevalidationFlag,
} from "../../drizzle/schema/ncr";
import { goldenSampleReferences } from "../../drizzle/schema/goldenSample";

export function isGoldenRevalidationRequired(): boolean {
  return process.env.GOLDEN_REVALIDATION_REQUIRED === "true";
}

/**
 * Does this product have ≥1 APPROVED + ACTIVE golden reference? (Only those are
 * used in production diff, so only those need revalidation.) Resolves by
 * productModelId OR the legacy productCode link.
 */
export async function productHasApprovedGoldens(
  productModelId: number,
  productCode?: string | null,
): Promise<boolean> {
  const d = await getDb();
  if (!d) return false;
  const scope = productCode
    ? sql`(${goldenSampleReferences.productModelId} = ${productModelId} OR ${goldenSampleReferences.productCode} = ${productCode})`
    : eq(goldenSampleReferences.productModelId, productModelId);
  const [row] = await d
    .select({ c: sql<number>`count(*)::int` })
    .from(goldenSampleReferences)
    .where(and(
      scope,
      eq(goldenSampleReferences.active, true),
      eq(goldenSampleReferences.status, "approved"),
    ));
  return Number(row?.c ?? 0) > 0;
}

export interface MarkRevalidationInput {
  productModelId: number;
  productCode?: string | null;
  reason?: string | null;
  triggeredByReleaseId?: number | null;
}

/**
 * Raise (upsert) a PENDING golden-revalidation flag for a product — but ONLY
 * when GOLDEN_REVALIDATION_REQUIRED is ON AND the product actually has approved
 * goldens (nothing to revalidate otherwise). Idempotent: the partial unique index
 * (uq_golden_reval_one_pending) collapses repeat triggers onto the single pending
 * row. Fail-soft: never throws (returns null on any issue) so it can be called
 * from a release path without risking the release.
 */
export async function markRevalidationPending(
  input: MarkRevalidationInput,
): Promise<GoldenRevalidationFlag | null> {
  try {
    if (!isGoldenRevalidationRequired()) return null;
    const d = await getDb();
    if (!d) return null;
    if (!(await productHasApprovedGoldens(input.productModelId, input.productCode))) return null;

    const [row] = await d
      .insert(goldenRevalidationFlags)
      .values({
        productModelId: input.productModelId,
        status: "pending",
        reason: input.reason ?? null,
        triggeredByReleaseId: input.triggeredByReleaseId ?? null,
      })
      .onConflictDoUpdate({
        target: goldenRevalidationFlags.productModelId,
        targetWhere: sql`${goldenRevalidationFlags.status} = 'pending'`,
        set: {
          reason: input.reason ?? sql`${goldenRevalidationFlags.reason}`,
          triggeredByReleaseId: input.triggeredByReleaseId ?? sql`${goldenRevalidationFlags.triggeredByReleaseId}`,
        },
      })
      .returning();
    return row ?? null;
  } catch (err) {
    console.error("[goldenRevalidation] markPending failed (suppressed):", (err as any)?.message ?? err);
    return null;
  }
}

/** The current PENDING flag for a product (null when none / no DB). */
export async function getPendingRevalidation(
  productModelId: number,
): Promise<GoldenRevalidationFlag | null> {
  const d = await getDb();
  if (!d) return null;
  const [row] = await d
    .select()
    .from(goldenRevalidationFlags)
    .where(and(
      eq(goldenRevalidationFlags.productModelId, productModelId),
      eq(goldenRevalidationFlags.status, "pending"),
    ))
    .orderBy(desc(goldenRevalidationFlags.createdAt))
    .limit(1);
  return row ?? null;
}

export interface ClearRevalidationInput {
  productModelId: number;
  clearedBy?: number | null;
  /** golden-diff run / inspection id that cleared it (audit handle). */
  clearedByRef?: string | null;
}

/** Clear the PENDING flag (after a golden diff has been run). */
export async function clearRevalidation(
  input: ClearRevalidationInput,
): Promise<GoldenRevalidationFlag | null> {
  const d = await getDb();
  if (!d) return null;
  const [row] = await d
    .update(goldenRevalidationFlags)
    .set({
      status: "cleared",
      clearedBy: input.clearedBy ?? null,
      clearedByRef: input.clearedByRef ?? null,
      clearedAt: new Date(),
    })
    .where(and(
      eq(goldenRevalidationFlags.productModelId, input.productModelId),
      eq(goldenRevalidationFlags.status, "pending"),
    ))
    .returning();
  return row ?? null;
}
