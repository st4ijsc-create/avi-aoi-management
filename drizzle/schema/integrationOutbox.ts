// Schema domain: ERP Integration Outbox (Automation Orchestration R0-4, doc 16 §4/§15 Khối 0)
//
// ════════════════════════════════════════════════════════════════════════════
// integration_outbox — the DURABLE outbound publishing store for Khối 0 (the ERP
// integration gateway). Producers (production-event / quality-result / oee-metric
// / genealogy-record) enqueue a row here transactionally with their own work; a
// background worker drains pending rows to the targetEndpoint with exponential
// backoff and a PER-ENDPOINT circuit-breaker. Exhausted rows move to `dead`
// (dead-letter) for inspection.
//
// NOT tenant-scoped: the surrounding integration tables (webhook_configs,
// api_keys, …) are not multi-tenant (they group by corporateCode/factoryId at
// most), so this table follows the same convention. `corporateCode` is an
// optional grouping tag, not an isolation boundary.
//
// status columns are varchar (NOT new pg enums) on purpose → the migration stays
// additive (CREATE TABLE/INDEX only, no ALTER TYPE on an existing enum).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, varchar, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Integration Outbox — one row per outbound integration event awaiting delivery.
 *
 *  eventType : production-event | quality-result | oee-metric | genealogy-record
 *  status    : pending | sent | failed | dead
 *              pending → worker picks it up when nextAttemptAt <= now
 *              failed  → a delivery attempt failed but attempts < max (will retry)
 *              sent    → delivered (2xx) — terminal success
 *              dead    → exhausted max attempts — terminal (dead-letter)
 */
export const integrationOutbox = pgTable("integration_outbox", {
  id: serial("id").primaryKey(),
  // Logical event family (validated by the producer helper).
  eventType: varchar("eventType", { length: 40 }).notNull(),
  // The event body delivered verbatim inside the POST envelope.
  payload: jsonb("payload").notNull(),
  // Destination URL the worker POSTs to.
  targetEndpoint: text("targetEndpoint").notNull(),
  // Delivery lifecycle (see header).
  status: varchar("status", { length: 16 }).default("pending").notNull(),
  // Number of delivery attempts made so far.
  attempts: integer("attempts").default(0).notNull(),
  // Earliest time the worker may (re)attempt this row (backoff schedule).
  nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
  // Last delivery error (truncated) for forensics.
  lastError: text("lastError"),
  // De-dup key: enqueue is idempotent on this key (no double-publish on retried producers).
  idempotencyKey: varchar("idempotencyKey", { length: 200 }),
  // Optional grouping tag (NOT an isolation boundary).
  corporateCode: varchar("corporateCode", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
}, (table) => [
  // Worker drain query: pending/failed rows ordered by nextAttemptAt.
  index("idx_outbox_status_next").on(table.status, table.nextAttemptAt),
  index("idx_outbox_endpoint").on(table.targetEndpoint),
  index("idx_outbox_event_type").on(table.eventType),
  // Idempotent enqueue: a non-null idempotencyKey is unique (NULLs allowed/many).
  uniqueIndex("uq_outbox_idem").on(table.idempotencyKey),
]);

export type IntegrationOutbox = typeof integrationOutbox.$inferSelect;
export type InsertIntegrationOutbox = typeof integrationOutbox.$inferInsert;

/**
 * Inbound Idempotency (R0-3) — records each accepted INBOUND ERP intake by its
 * idempotency key so a retried POST (same key) returns the PRIOR result instead
 * of double-inserting. Keyed by (resource, idempotencyKey). `result` stores the
 * envelope data returned the first time.
 */
export const integrationInboundIdempotency = pgTable("integration_inbound_idempotency", {
  id: serial("id").primaryKey(),
  // Resource family: 'orders' | 'bom' (matches the POST path).
  resource: varchar("resource", { length: 40 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
  // The schemaVersion the client declared on first accept (echoed back).
  schemaVersion: varchar("schemaVersion", { length: 40 }),
  // The data envelope returned on first accept (replayed on duplicate).
  result: jsonb("result").notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_inbound_idem_resource_key").on(table.resource, table.idempotencyKey),
]);

export type IntegrationInboundIdempotency = typeof integrationInboundIdempotency.$inferSelect;
export type InsertIntegrationInboundIdempotency = typeof integrationInboundIdempotency.$inferInsert;
