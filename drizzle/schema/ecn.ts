// Schema domain: Engineering Change control (ECN / ECO) — doc 35 Wave W4-D.
//
// ════════════════════════════════════════════════════════════════════════════
// The system had NO GENERAL engineering-change workflow. Recipe / threshold /
// program changes each carry their own local approval, but there was no single
// change-REQUEST entity that captures WHAT is changing, WHY, its IMPACT (which
// products / programs / lines are affected) and its EFFECTIVITY (the date the
// change takes effect) under a maker-checker lifecycle.
//
// This adds two additive, idempotent tables. Both use PLAIN VARCHAR for their
// state / kind columns (NO new pg enums, NO ALTER TYPE) so migration 0228 stays
// CREATE TABLE / INDEX only — mirroring ncr.ts / goldenSample.ts reasoning.
//
// 1. engineering_changes — the ECN/ECO header. A change is DRAFTED, SUBMITTED,
//    goes to IN_REVIEW, is APPROVED or REJECTED, then IMPLEMENTED and CLOSED.
//    Segregation of duties (requester ≠ approver) is app-enforced in
//    server/services/ecnService.ts (mirrors thresholdGovernanceService /
//    ncrService). Target links are SOFT refs (no FK) — a change may target a
//    product model, a BOM, a recipe, a program, a process, or just a free-text
//    description (targetDescription).
//
// 2. engineering_change_items — OPTIONAL per-affected-entity line. One ECN may
//    touch several concrete entities (e.g. 3 programs on 2 lines); each is a row
//    here so the impact is itemised and auditable. Soft refs throughout.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** What kind of thing the change targets (plain varchar in DB — see header). */
export const ECN_CHANGE_TYPES = [
  "product",
  "bom",
  "recipe",
  "program",
  "process",
  "document",
] as const;
export type EcnChangeType = (typeof ECN_CHANGE_TYPES)[number];

/** ECN lifecycle states (plain varchar in DB — see header). */
export const ECN_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "implemented",
  "closed",
] as const;
export type EcnStatus = (typeof ECN_STATUSES)[number];

/** Structured impact analysis stored on the header. All members optional. */
export interface EcnImpactSummary {
  /** Affected product model ids / codes. */
  affectedProducts?: Array<number | string>;
  /** Affected inspection / robot / PLC program ids / keys. */
  affectedPrograms?: Array<number | string>;
  /** Affected production line ids / codes. */
  affectedLines?: Array<number | string>;
  /** Free-form notes / risk / rollback plan. */
  notes?: string;
  [k: string]: unknown;
}

export const engineeringChanges = pgTable("engineering_changes", {
  id: serial("id").primaryKey(),
  // Human-facing key (e.g. "ECN-20260706-0001"); generated in the service when
  // the caller does not supply one. Unique.
  ecnKey: varchar("ecnKey", { length: 64 }).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  changeType: varchar("changeType", { length: 20 }).notNull().$type<EcnChangeType>(),
  // SOFT refs (no FK). Whichever ones apply for this changeType may be set; the
  // rest stay NULL. `targetDescription` is a free-text fallback / summary.
  productModelId: integer("productModelId"),
  bomId: integer("bomId"),
  recipeId: integer("recipeId"),
  programId: integer("programId"),
  processId: integer("processId"),
  targetDescription: text("targetDescription"),
  reason: text("reason"),
  // Structured impact analysis (affected products / programs / lines + notes).
  impactSummary: jsonb("impactSummary").$type<EcnImpactSummary>(),
  status: varchar("status", { length: 20 }).default("draft").notNull().$type<EcnStatus>(),
  // When the change takes effect (nullable until planned / approved).
  effectivityDate: timestamp("effectivityDate"),
  // Actors (users.id). SoD: approvedBy MUST differ from requestedBy (app-enforced).
  requestedBy: integer("requestedBy"),
  reviewedBy: integer("reviewedBy"),
  approvedBy: integer("approvedBy"),
  implementedBy: integer("implementedBy"),
  closedBy: integer("closedBy"),
  // Latest decision comment (approve / reject / close reason).
  decisionComment: text("decisionComment"),
  note: text("note"),
  submittedAt: timestamp("submittedAt"),
  reviewedAt: timestamp("reviewedAt"),
  approvedAt: timestamp("approvedAt"),
  implementedAt: timestamp("implementedAt"),
  closedAt: timestamp("closedAt"),
  // Tenant scope (mirrors neighbouring tables; RLS wired inert by default).
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_ecn_key").on(table.ecnKey),
  index("idx_ecn_status").on(table.status),
  index("idx_ecn_change_type").on(table.changeType),
  index("idx_ecn_product").on(table.productModelId),
  index("idx_ecn_effectivity").on(table.effectivityDate),
]);

export type EngineeringChange = typeof engineeringChanges.$inferSelect;
export type InsertEngineeringChange = typeof engineeringChanges.$inferInsert;

/** Per-affected-entity change line (plain varchar for action/entityType). */
export const ECN_ITEM_ACTIONS = ["add", "modify", "remove"] as const;
export type EcnItemAction = (typeof ECN_ITEM_ACTIONS)[number];

export const engineeringChangeItems = pgTable("engineering_change_items", {
  id: serial("id").primaryKey(),
  ecnId: integer("ecnId").notNull(),
  // e.g. "product" | "bom" | "recipe" | "program" | "process" | "document"
  entityType: varchar("entityType", { length: 32 }).notNull(),
  // SOFT ref to the concrete entity + a denormalised human handle.
  entityRef: integer("entityRef"),
  entityCode: varchar("entityCode", { length: 128 }),
  action: varchar("action", { length: 16 }).default("modify").notNull().$type<EcnItemAction>(),
  description: text("description"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ecn_item_ecn").on(table.ecnId),
  index("idx_ecn_item_entity").on(table.entityType, table.entityRef),
]);

export type EngineeringChangeItem = typeof engineeringChangeItems.$inferSelect;
export type InsertEngineeringChangeItem = typeof engineeringChangeItems.$inferInsert;
