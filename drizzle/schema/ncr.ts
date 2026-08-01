// Schema domain: Non-Conformance Reports (NCR/MRB) + Golden-Revalidation flags
// (doc 35 Wave W4-B — quality hold enforcement / NCR / golden-diff enforcement)
//
// ════════════════════════════════════════════════════════════════════════════
// TWO small, additive quality-governance tables. Both use plain varchar for their
// state/kind columns (NO new pg enums) so migration 0226 stays CREATE TABLE/INDEX
// only — no ALTER TYPE (mirrors goldenSample.ts / defectDisposition.ts reasoning).
//
// 1. nonconformance_reports — the missing NCR/MRB entity. A quality event
//    (from an inspection / a lot disposition / an audit) is RAISED (open), goes
//    to REVIEW, gets a DISPOSITION (MRB decision), then is CLOSED. Segregation of
//    duties is app-enforced (raiser ≠ decider — see server/services/ncrService.ts,
//    mirrors thresholdGovernanceService.assertApprovalSoD). All links are SOFT
//    refs (no FK): product_inspections may be a Timescale hypertable and
//    lotNumber/serialNumber are denormalised traceability handles.
//
// 2. golden_revalidation_flags — advisory "golden-revalidation-pending" marker.
//    When a program/threshold change is released for a product that already has
//    APPROVED golden references, the released goldens may no longer match the new
//    program, so a golden diff should be re-run before the change is trusted. One
//    PENDING row per product (partial unique index) records that debt until a
//    golden diff clears it. This is a STATUS, never a hard ingest block.
// ════════════════════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Where an NCR originated. */
export const NCR_SOURCES = ["inspection", "lot", "audit"] as const;
export type NcrSource = (typeof NCR_SOURCES)[number];

/** MRB disposition decision kinds (plain varchar in DB — see header). */
export const NCR_DISPOSITIONS = [
  "use_as_is",
  "rework",
  "scrap",
  "return",
  "rtv", // return-to-vendor
] as const;
export type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];

/** NCR lifecycle states (plain varchar in DB — see header). */
export const NCR_STATUSES = [
  "open",
  "in_review",
  "dispositioned",
  "closed",
] as const;
export type NcrStatus = (typeof NCR_STATUSES)[number];

export const nonconformanceReports = pgTable("nonconformance_reports", {
  id: serial("id").primaryKey(),
  // Human-facing key (e.g. "NCR-20260706-0001"); generated in the service when
  // the caller does not supply one. Unique.
  ncrKey: varchar("ncrKey", { length: 64 }).notNull(),
  source: varchar("source", { length: 20 }).notNull().$type<NcrSource>(),
  // SOFT refs / traceability handles (no FK — see header).
  linkedInspectionId: integer("linkedInspectionId"),
  lotNumber: varchar("lotNumber", { length: 128 }),
  serialNumber: varchar("serialNumber", { length: 128 }),
  productModelId: integer("productModelId"),
  defectSummary: text("defectSummary"),
  // Set at disposition time (NULL while open / in_review).
  disposition: varchar("disposition", { length: 20 }).$type<NcrDisposition>(),
  status: varchar("status", { length: 20 }).default("open").notNull().$type<NcrStatus>(),
  // Optional soft ref -> a quarantine location (hierarchy / storage id).
  quarantineLocationId: integer("quarantineLocationId"),
  // Actors (users.id). SoD: decidedBy MUST differ from raisedBy (app-enforced).
  raisedBy: integer("raisedBy"),
  reviewedBy: integer("reviewedBy"),
  decidedBy: integer("decidedBy"),
  closedBy: integer("closedBy"),
  reason: text("reason"),
  note: text("note"),
  raisedAt: timestamp("raisedAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  decidedAt: timestamp("decidedAt"),
  closedAt: timestamp("closedAt"),
  // Tenant scope (mirrors neighbouring tables; RLS wired inert by default).
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_ncr_key").on(table.ncrKey),
  index("idx_ncr_status").on(table.status),
  index("idx_ncr_source").on(table.source),
  index("idx_ncr_lot").on(table.lotNumber),
  index("idx_ncr_serial").on(table.serialNumber),
  index("idx_ncr_inspection").on(table.linkedInspectionId),
  index("idx_ncr_product").on(table.productModelId),
]);

export type NonconformanceReport = typeof nonconformanceReports.$inferSelect;
export type InsertNonconformanceReport = typeof nonconformanceReports.$inferInsert;

/** Golden-revalidation flag lifecycle. */
export const GOLDEN_REVALIDATION_STATUSES = ["pending", "cleared"] as const;
export type GoldenRevalidationStatus = (typeof GOLDEN_REVALIDATION_STATUSES)[number];

export const goldenRevalidationFlags = pgTable("golden_revalidation_flags", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  status: varchar("status", { length: 16 }).default("pending").notNull().$type<GoldenRevalidationStatus>(),
  // Why revalidation is required (e.g. "program release #123").
  reason: text("reason"),
  // SOFT ref -> inspection_program_releases.id that triggered the flag.
  triggeredByReleaseId: integer("triggeredByReleaseId"),
  clearedBy: integer("clearedBy"),
  // SOFT ref -> the golden-diff run / inspection that cleared it (audit handle).
  clearedByRef: varchar("clearedByRef", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  clearedAt: timestamp("clearedAt"),
}, (table) => [
  index("idx_golden_reval_product").on(table.productModelId),
  index("idx_golden_reval_status").on(table.status),
  // At most ONE pending flag per product (partial unique — Postgres treats the
  // predicate rows as the uniqueness scope). markPending upserts against this.
  uniqueIndex("uq_golden_reval_one_pending")
    .on(table.productModelId)
    .where(sql`"status" = 'pending'`),
]);

export type GoldenRevalidationFlag = typeof goldenRevalidationFlags.$inferSelect;
export type InsertGoldenRevalidationFlag = typeof goldenRevalidationFlags.$inferInsert;
