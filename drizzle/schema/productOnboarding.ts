// Schema domain: Product onboarding drafts (doc 31 Đợt D · gap UX1 · WD-1)
//
// ════════════════════════════════════════════════════════════════════════════
// Resumable draft for the product-side onboarding wizard (/product-onboarding).
// One row = one product's guided-setup run:
//
//   draft      → in-progress wizard (resumable): currentStep + stepState jsonb
//                keep per-step todo/done/skipped status (+ optional notes) so the
//                engineer can leave and return.
//   completed  → the engineer clicked "Finish" on the review step.
//
// Keyed by productModelId (SOFT ref to product_models.id — no hard FK, same
// convention as measurement_point_defs.productModelId). stepState holds NO
// secrets (only step status + notes), so unlike aoi_commissioning_records there
// is no credential-stripping. Additive table (CREATE TABLE/INDEX, no ALTER TYPE,
// no pg enum); status is varchar so migration 0199 is re-runnable.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const productOnboardingDrafts = pgTable("product_onboarding_drafts", {
  id: serial("id").primaryKey(),
  /** Soft-ref product_models.id (router asserts existence before insert). */
  productModelId: integer("productModelId").notNull(),
  /** The step index (0-based) the engineer was last on. */
  currentStep: integer("currentStep").notNull().default(0),
  /** Per-step status map + optional notes (see client productOnboarding/types). */
  stepState: jsonb("stepState"),
  /** 'draft' | 'completed' (varchar — see header). */
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  /** users.id that started the wizard draft. */
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_onboarding_product").on(table.productModelId),
  index("idx_product_onboarding_status").on(table.status),
]);

export type ProductOnboardingDraft = typeof productOnboardingDrafts.$inferSelect;
export type InsertProductOnboardingDraft = typeof productOnboardingDrafts.$inferInsert;
