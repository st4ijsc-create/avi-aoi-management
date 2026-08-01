// Schema domain: Routing Master (ISA-95 operations sequence) — doc 35 Wave W4-E
//
// ════════════════════════════════════════════════════════════════════════════
// The ERP order-intake path (server/api/v1/erpIntake.ts) explicitly notes that
// "no routing / process_routing master table exists in the schema", so an ERP
// order can be received but its operations cannot be resolved against a standard
// route. These two additive tables close that gap and become the enabler ERP
// intake resolves operations against.
//
// 1. routing_master — one header per (product, code, version). Lifecycle is a
//    plain-varchar status {draft, active, archived} (NO new pg enum, so migration
//    0229 stays CREATE TABLE / INDEX only — mirrors ncr.ts / lineMaterials.ts).
//    A partial unique index enforces AT MOST ONE `active` routing per product so
//    getActiveRouting(productModelId) is deterministic.
//
// 2. routing_steps — the ordered operation sequence for a routing. Each step is
//    an operation (operationCode) performed at a station / machine class
//    (stationOrMachineType) with a standard time (standardTimeSec). Unique on
//    (routingId, stepNo). SOFT ref to routing_master (no hard FK — mirrors the
//    neighbouring additive-ledger tables' soft-ref convention).
//
// RBAC-gated CRUD; NO feature flag. Inert until routingRouter / erpIntake read it.
// ════════════════════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Routing lifecycle states (plain varchar in DB — see header). */
export const ROUTING_STATUSES = ["draft", "active", "archived"] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];

export const routingMaster = pgTable("routing_master", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  version: integer("version").default(1).notNull(),
  name: varchar("name", { length: 255 }),
  description: text("description"),
  status: varchar("status", { length: 16 }).default("draft").notNull().$type<RoutingStatus>(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_routing_product").on(table.productModelId),
  index("idx_routing_status").on(table.status),
  // A routing is uniquely identified by (code, version).
  uniqueIndex("uq_routing_code_version").on(table.code, table.version),
  // At most ONE active routing per product (partial unique — deterministic
  // getActiveRouting). activate() upserts against this.
  uniqueIndex("uq_routing_one_active_per_product")
    .on(table.productModelId)
    .where(sql`"status" = 'active'`),
]);

export type RoutingMaster = typeof routingMaster.$inferSelect;
export type InsertRoutingMaster = typeof routingMaster.$inferInsert;

export const routingSteps = pgTable("routing_steps", {
  id: serial("id").primaryKey(),
  // SOFT ref -> routing_master.id (no hard FK — see header).
  routingId: integer("routingId").notNull(),
  stepNo: integer("stepNo").notNull(),
  operationCode: varchar("operationCode", { length: 64 }).notNull(),
  // The station id OR the machine class/type this operation runs on (free text
  // so it can name a physical station OR a machine class — resolved at dispatch).
  stationOrMachineType: varchar("stationOrMachineType", { length: 128 }),
  standardTimeSec: integer("standardTimeSec"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_routing_step_routing").on(table.routingId),
  // Step numbers are unique within a routing.
  uniqueIndex("uq_routing_step_no").on(table.routingId, table.stepNo),
]);

export type RoutingStep = typeof routingSteps.$inferSelect;
export type InsertRoutingStep = typeof routingSteps.$inferInsert;
