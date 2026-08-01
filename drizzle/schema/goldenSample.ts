// Schema domain: Golden-Sample References (AOI-B, doc 24 Wave-2)
//
// ════════════════════════════════════════════════════════════════════════════
// A golden-sample reference is the "known-good" image a candidate is registered
// against before defect-diff (imageRegistration.ts). One ACTIVE reference per
// (productCode / recipeCode) key; re-setting a reference bumps `version` and
// deactivates the previous one (soft history), mirroring equipment_3d_models.
//
// STORAGE (self-contained, no filesystem dependency): the reference is kept as a
// GRAYSCALE RAW plane, base64-encoded in `grayBase64` with its width/height, so a
// consumer can reconstruct a Buffer and register against it directly. An optional
// `imageUrl` records provenance (where the original encoded image lives) but the
// pipeline never requires it — the inline gray plane is the source of truth.
// References are small (AOI ROIs, downscaled to <=512px) so base64 in a text
// column is acceptable and avoids a separate blob store.
//
// Additive: every scope column is nullable; `status` / `format` are plain varchar
// (NOT new pg enums) so the migration stays CREATE TABLE/INDEX only — no ALTER TYPE.
// ════════════════════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

export const goldenSampleReferences = pgTable("golden_sample_references", {
  id: serial("id").primaryKey(),
  // Logical key — a product code and/or recipe code identify the reference set.
  productCode: varchar("productCode", { length: 128 }),
  // Doc 31 PM5 (migration 0195) — logical FK to product_models.id. Nullable +
  // no hard REFERENCES (same by-code/soft-FK convention as
  // measurementPointDefs.productModelId / componentCode). Backfilled from
  // productCode; renaming a product code no longer orphans its goldens. The
  // production diff resolver still keys by productCode (compat) — this column is
  // for surfacing (product-page panel), rename-safe linkage and release-snapshot
  // provenance (OP7).
  productModelId: integer("productModelId"),
  recipeCode: varchar("recipeCode", { length: 128 }),
  // Optional binding to a station / ROI so different views can hold distinct golds.
  stationCode: varchar("stationCode", { length: 128 }),
  roiKey: varchar("roiKey", { length: 128 }),
  // Monotonic version per (productCode, recipeCode, stationCode, roiKey).
  version: integer("version").default(1).notNull(),
  // Only ONE row per key is active; setting a new reference deactivates prior ones.
  active: boolean("active").default(true).notNull(),
  // Inline grayscale raw plane (base64) + geometry — self-contained source of truth.
  grayBase64: text("grayBase64").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  // "gray-raw" today; leaves room for future encodings (e.g. "png").
  format: varchar("format", { length: 16 }).default("gray-raw").notNull(),
  // Provenance only — where the original encoded image lives (not required to diff).
  imageUrl: text("imageUrl"),
  notes: text("notes"),
  // ── W7-C (doc 27 §9 V11, migration 0189) — approval workflow ──
  // 'draft' (captured, not yet resolvable) | 'approved' (resolvable when active)
  // | 'retired' (rejected draft OR explicitly pulled approved row). Plain varchar
  // (no pg enum) so the migration stays ALTER ADD COLUMN only. Rows predating
  // 0189 were grandfathered to 'approved' (approvalNote='grandfathered').
  status: varchar("status", { length: 16 }).default("draft").notNull(),
  // Second-person sign-off (SoD app-enforced: capturer ≠ approver, see
  // server/db/goldenSample.ts approveGoldenReference — mirrors machineRecipe W2-9).
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  approvalNote: text("approvalNote"),
  // W7-C (V7) — per-golden enable for sub-pixel registration before diff.
  // ALIGN_BEFORE_DIFF=false in env remains the global kill-switch.
  alignBeforeDiff: boolean("alignBeforeDiff").default(true).notNull(),
  // W7-C (V8) — provenance when captured from a known-good inspection.
  sourceInspectionId: integer("sourceInspectionId"),
  sourceMeasurementId: integer("sourceMeasurementId"),
  // Tenant scope (mirrors neighbouring tables; RLS wired inert by default).
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_golden_ref_product").on(table.productCode),
  // Doc 31 PM5 (0195) — per-product panel query + rename-safe linkage.
  index("idx_golden_ref_product_model").on(table.productModelId).where(sql`${table.productModelId} IS NOT NULL`),
  index("idx_golden_ref_recipe").on(table.recipeCode),
  index("idx_golden_ref_active").on(table.active),
  index("idx_golden_ref_status").on(table.status),
  index("idx_golden_ref_key").on(table.productCode, table.recipeCode, table.stationCode, table.roiKey),
  // W3-C (doc 27 §2 M10) — DB-level "one active per key" invariant. The scope
  // columns are nullable and Postgres treats NULLs as distinct in unique
  // indexes, so each column is folded through COALESCE(x,'') to make the key
  // total. Backed by migration 0182 (which first deactivates historical
  // duplicates, keeping max(id) per key). setGoldenReference relies on this:
  // a concurrent double-activate now fails with 23505 instead of silently
  // producing two active goldens.
  uniqueIndex("uq_golden_ref_one_active")
    .on(
      sql`(COALESCE("productCode", ''))`,
      sql`(COALESCE("recipeCode", ''))`,
      sql`(COALESCE("stationCode", ''))`,
      sql`(COALESCE("roiKey", ''))`,
    )
    .where(sql`"active" = true`),
]);

export type GoldenSampleReference = typeof goldenSampleReferences.$inferSelect;
export type InsertGoldenSampleReference = typeof goldenSampleReferences.$inferInsert;
