// Schema domain: Operator / Badge master (doc 29 §3 — gap doc 27 §2 M14)
// Agent W8-B (doc 27 Đợt 8, migration 0192).
//
// Three operator identities coexist today: product_inspections.operatorId is a
// FREE varchar(50) the machine sends ("mã công nhân" = badge code), while
// operator_assignments.operatorId / measurement_samples.operatorId are integer
// users.id. This table is the bridge — it maps a badgeCode string to users.id
// with a validity window (a badge can be re-issued to another person over time).
//
// Unification rules (doc 29 §3.2 — verbatim contract):
//   1. users.id is THE canonical identity. Integer columns stay unchanged.
//   2. product_inspections.operatorId (varchar) is KEPT — hypertable, a type change
//      would rewrite chunks. It is re-defined as the BADGE CODE (0192 updates the
//      column comment).
//   3. Read-side resolution: operatorBadgeService.resolveOperator(badgeCode, at)
//      picks the row whose [validFrom, validTo) window covers `at` (isActive only).
//   4. Write-side resolution: ingest stamps product_inspections.operatorUserId
//      (0192, nullable) fail-open when the badge resolves; old rows resolve on read.
//   5. Unknown badges seen at ingest are auto-registered source='auto_seen'
//      (userId NULL) → the admin page surfaces an "unassigned badges" queue.
//
// UNIQUENESS: one ACTIVE row per badgeCode (partial unique index in 0192:
// uq_operator_badges_code_active ON (badgeCode) WHERE isActive). Historical
// (revoked / superseded) rows keep the code for time-windowed resolution.
import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const operatorBadges = pgTable("operator_badges", {
  id: serial("id").primaryKey(),
  // EXACTLY the string machines send in product_inspections.operatorId.
  badgeCode: varchar("badgeCode", { length: 50 }).notNull(),
  // Soft ref -> users.id. NULL = person has no account yet (or badge unassigned).
  userId: integer("userId"),
  // Display name while no user is mapped (e.g. from HR sync).
  displayName: varchar("displayName", { length: 255 }),
  // manual | hr_sync | auto_seen
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  // Validity window (badge re-issued to someone else over time). NULL = open end.
  validFrom: timestamp("validFrom"),
  validTo: timestamp("validTo"),
  // Soft ref -> users.id (admin who issued/edited this row).
  issuedBy: integer("issuedBy"),
  isActive: boolean("isActive").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_operator_badges_code").on(table.badgeCode),
  index("idx_operator_badges_user").on(table.userId),
  // NOTE: the ACTIVE-uniqueness guarantee is the PARTIAL unique index created in
  // 0192 (WHERE "isActive" = true) — declared there because drizzle's uniqueIndex
  // is used only as metadata here (migrations are hand-written SQL).
]);

export type OperatorBadge = typeof operatorBadges.$inferSelect;
export type InsertOperatorBadge = typeof operatorBadges.$inferInsert;
