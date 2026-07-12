// Schema domain: ORDER LIFECYCLE transitions (doc 44 W3-A3, G3.6/G3.7)
//                — SYNAPSE LDS-L3 §8.2 order lifecycle · flag ORDER_LIFECYCLE_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// The order lifecycle is a LAYER ON TOP of production_orders: the legacy
// `status` enum (pending/in_progress/completed/cancelled/paused) is untouched
// (clients + station software keep working) and a new nullable
// production_orders.lifecycle_state column carries the spec-§8.2 state
// (created→allocated→running⇄held→done · created/allocated→rejected ·
// running→compensating→failed). Every transition is APPEND-ONLY audited here —
// who moved which order from which state to which state, why, and under which
// correlation id (ALS backbone, §5.12.1).
//
// APPEND-ONLY DISCIPLINE: rows are only ever inserted (by
// orderLifecycleService.transitionOrder inside the same transaction that flips
// the order row). No update/delete path exists in code.
//
// Migration 0258 (additive: ADD COLUMN IF NOT EXISTS + CREATE TABLE/INDEX IF
// NOT EXISTS). varchar states, NOT a pg enum — keeps the migration additive and
// mirrors fleet.ts / fleetResource.ts discipline.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { productionOrders } from "./production";

/**
 * Order State Transition — one append-only audit row per lifecycle transition.
 *
 *  fromState     — effective state BEFORE (null for the very first CREATED mark
 *                  written by ERP intake — there is no prior state).
 *  toState       — lifecycle state AFTER (created|allocated|running|held|
 *                  compensating|done|failed|rejected).
 *  reason        — human/system reason ("no_capacity: line 3 at 1/1", …).
 *  triggeredBy   — actor tag ("erp-intake", "api-key:<name>", "user:<id>", "system").
 *  correlationId — §5.12.1 correlation backbone (from the ALS context when not
 *                  supplied explicitly); nullable.
 *  metadata      — structured context (lineId, strategy, occupancy…).
 */
export const orderStateTransitions = pgTable("order_state_transitions", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull()
    .references(() => productionOrders.id, { onDelete: "cascade" }),
  fromState: varchar("fromState", { length: 24 }),
  toState: varchar("toState", { length: 24 }).notNull(),
  reason: text("reason"),
  triggeredBy: varchar("triggeredBy", { length: 120 }),
  correlationId: varchar("correlationId", { length: 64 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ts: timestamp("ts").defaultNow().notNull(),
}, (table) => [
  // The one read path: "all transitions of order X in time order".
  index("idx_ost_order_ts").on(table.orderId, table.ts),
]);

export type OrderStateTransition = typeof orderStateTransitions.$inferSelect;
export type InsertOrderStateTransition = typeof orderStateTransitions.$inferInsert;
