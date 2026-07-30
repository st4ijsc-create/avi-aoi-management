/**
 * Product Onboarding Wizard router (key "productOnboarding") — doc 31 Đợt D
 * (gap UX1) · WD-1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Backend for the guided product-side setup flow (/product-onboarding). The
 * wizard is pure ORCHESTRATION over EXISTING product surfaces (fiducials, point
 * editor, thresholds, golden, panel-def, program-release, machine-mapping) — the
 * only new server state it owns is a RESUMABLE DRAFT so an engineer can leave
 * mid-setup and return:
 *
 *   getDraft     — the product's current 'draft' row (null when none)
 *   listDrafts   — all in-progress drafts (resume picker / products-page badge)
 *   saveDraft    — create/update the product's single draft (on step transitions)
 *   deleteDraft  — abandon the draft
 *   complete     — flip the draft → 'completed' (engineer clicked "Finish")
 *
 * NO GOVERNANCE HERE: the draft is benign UI state (per-step todo/done/skipped +
 * notes). Every real governance action (threshold approval SoD, program-release
 * sign-off, golden approval) still happens in the EMBEDDED panels this wizard
 * reuses, each with its own RBAC + audit. Readiness/completeness scoring is owned
 * by WD-2 (product.getReadiness) — the wizard's review step computes a basic
 * count summary CLIENT-SIDE from existing queries and does not add a server
 * endpoint here.
 *
 * stepState holds NO secrets, so (unlike aoiOnboardingRouter) there is no
 * credential-stripping sanitize pass.
 *
 * RBAC (module "settings_products", the same gate the /products page uses):
 * reads → canView; draft writes → canCreate; complete → canEdit.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { productModels, productOnboardingDrafts } from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Assert the product exists (drizzle-direct so tests can use the FakeDb). */
async function requireProduct(productModelId: number) {
  const d = await db();
  const [p] = await d.select().from(productModels).where(eq(productModels.id, productModelId)).limit(1);
  if (!p) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, `Sản phẩm #${productModelId} không tồn tại.`);
  }
  return p;
}

/** Newest 'draft' row for a product (at most one is maintained). */
async function getDraftRow(productModelId: number) {
  const d = await db();
  const [row] = await d
    .select()
    .from(productOnboardingDrafts)
    .where(and(
      eq(productOnboardingDrafts.productModelId, productModelId),
      eq(productOnboardingDrafts.status, "draft"),
    ))
    .orderBy(desc(productOnboardingDrafts.id))
    .limit(1);
  return row ?? null;
}

// stepState is permissive: a flat map of stepKey → { status, note? } plus any
// forward-compatible client extras. No secrets ever flow through here.
const stepStateSchema = z.record(z.string(), z.unknown());

export const productOnboardingRouter = router({
  /** The product's current resumable draft (null when none). */
  getDraft: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getDraftRow(input.productModelId);
    }),

  /**
   * All in-progress drafts (newest first) joined with the product code/name —
   * powers the "resume an unfinished setup" picker and the products-page badge.
   */
  listDrafts: protectedProcedure
    .use(requirePermission("settings_products", "canView"))
    .query(async () => {
      const d = await db();
      const drafts = await d
        .select()
        .from(productOnboardingDrafts)
        .where(eq(productOnboardingDrafts.status, "draft"))
        .orderBy(desc(productOnboardingDrafts.updatedAt));
      // Enrich with product identity (best-effort; a deleted product still lists).
      const out = [] as Array<
        (typeof drafts)[number] & { productCode: string | null; productName: string | null }
      >;
      for (const dr of drafts) {
        const [p] = await d
          .select()
          .from(productModels)
          .where(eq(productModels.id, dr.productModelId))
          .limit(1);
        out.push({ ...dr, productCode: p?.code ?? null, productName: p?.name ?? null });
      }
      return out;
    }),

  /** Create/update the product's single wizard draft (called on step transitions). */
  saveDraft: protectedProcedure
    .use(requirePermission("settings_products", "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      currentStep: z.number().int().min(0).max(50),
      stepState: stepStateSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireProduct(input.productModelId);
      const d = await db();
      const existing = await getDraftRow(input.productModelId);
      const stepState = (input.stepState ?? {}) as Record<string, unknown>;
      if (existing) {
        const [row] = await d
          .update(productOnboardingDrafts)
          .set({
            currentStep: input.currentStep,
            stepState: stepState as never,
            updatedAt: new Date(),
          })
          .where(eq(productOnboardingDrafts.id, existing.id))
          .returning();
        return row;
      }
      const [row] = await d
        .insert(productOnboardingDrafts)
        .values({
          productModelId: input.productModelId,
          currentStep: input.currentStep,
          stepState: stepState as never,
          status: "draft",
          createdBy: ctx.user.id,
        })
        .returning();
      return row;
    }),

  /** Abandon the product's wizard draft. Returns whether one existed. */
  deleteDraft: protectedProcedure
    .use(requirePermission("settings_products", "canCreate"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const removed = await d
        .delete(productOnboardingDrafts)
        .where(and(
          eq(productOnboardingDrafts.productModelId, input.productModelId),
          eq(productOnboardingDrafts.status, "draft"),
        ))
        .returning();
      return { deleted: removed.length > 0 };
    }),

  /**
   * Mark the product's setup complete (engineer clicked "Finish"). Promotes the
   * draft → 'completed'. Idempotent-ish: with no draft it records a fresh
   * 'completed' row so "Finish" always leaves a marker.
   */
  complete: protectedProcedure
    .use(requirePermission("settings_products", "canEdit"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      currentStep: z.number().int().min(0).max(50).optional(),
      stepState: stepStateSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireProduct(input.productModelId);
      const d = await db();
      const existing = await getDraftRow(input.productModelId);
      const stepState = (input.stepState ?? existing?.stepState ?? {}) as Record<string, unknown>;
      if (existing) {
        const [row] = await d
          .update(productOnboardingDrafts)
          .set({
            status: "completed",
            currentStep: input.currentStep ?? existing.currentStep,
            stepState: stepState as never,
            updatedAt: new Date(),
          })
          .where(eq(productOnboardingDrafts.id, existing.id))
          .returning();
        return row;
      }
      const [row] = await d
        .insert(productOnboardingDrafts)
        .values({
          productModelId: input.productModelId,
          currentStep: input.currentStep ?? 0,
          stepState: stepState as never,
          status: "completed",
          createdBy: ctx.user.id,
        })
        .returning();
      return row;
    }),
});
