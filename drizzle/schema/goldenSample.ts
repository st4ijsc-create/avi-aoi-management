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
import { pgTable, serial, integer, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const goldenSampleReferences = pgTable("golden_sample_references", {
  id: serial("id").primaryKey(),
  // Logical key — a product code and/or recipe code identify the reference set.
  productCode: varchar("productCode", { length: 128 }),
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
  // Tenant scope (mirrors neighbouring tables; RLS wired inert by default).
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_golden_ref_product").on(table.productCode),
  index("idx_golden_ref_recipe").on(table.recipeCode),
  index("idx_golden_ref_active").on(table.active),
  index("idx_golden_ref_key").on(table.productCode, table.recipeCode, table.stationCode, table.roiKey),
]);

export type GoldenSampleReference = typeof goldenSampleReferences.$inferSelect;
export type InsertGoldenSampleReference = typeof goldenSampleReferences.$inferInsert;
