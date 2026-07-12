// Schema domain: Enterprise Integration connectors (doc 44 W6-5, G5.24;
// SYNAPSE_Tang5 §8–9 — ISA-95 MES/ERP/WMS/PLM/CMMS).
//
// ════════════════════════════════════════════════════════════════════════════
// Two additive tables backing the WMS/PLM/CMMS connectors. They are the
// ANTI-CORRUPTION + AUDIT layer around the connectors, which REUSE the existing
// integration_outbox (durable outbound + circuit-breaker/dead-letter) for delivery
// — no second outbox is introduced here.
//
//   • enterprise_id_map   — general (system, entityType, externalId) ↔ internalId
//     mapping so external identifiers never leak into canonical rows. W0-F (0250)
//     added external_id/source_system on production_orders only; this generalises
//     it to every entity × every external system.
//   • enterprise_sync_log — one row per sync operation (inbound/outbound) for the
//     admin surface (status) AND inbound idempotency (partial-unique idempotencyKey).
//
// status/system/direction are varchar (NOT new pg enums) → the migration stays
// additive (CREATE TABLE/INDEX only). NOT tenant-scoped (mirrors integration_outbox):
// corporateCode is an optional grouping tag, not an isolation boundary.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, text, varchar, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** External system a connector talks to. */
export const ENTERPRISE_SYSTEMS = ["wms", "plm", "cmms"] as const;
export type EnterpriseSystem = (typeof ENTERPRISE_SYSTEMS)[number];

/**
 * Anti-corruption ID map — (system, entityType, externalId) ↔ internalId.
 *
 *  system     : wms | plm | cmms
 *  entityType : material | lot | pallet | product | recipe | bom | ecn |
 *               work_order | maintenance_schedule …
 *  internalId : canonical id (text, general). NULL = external seen but not yet
 *               mapped to a canonical row (bookkeeping for reconciliation).
 *  externalRef: snapshot of external attributes for audit — NEVER read as canonical.
 */
export const enterpriseIdMap = pgTable("enterprise_id_map", {
  id: serial("id").primaryKey(),
  system: varchar("system", { length: 16 }).notNull(),
  entityType: varchar("entity_type", { length: 48 }).notNull(),
  externalId: text("external_id").notNull(),
  internalId: text("internal_id"),
  externalRef: jsonb("external_ref"),
  corporateCode: varchar("corporate_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_ent_idmap_sys_type_ext").on(table.system, table.entityType, table.externalId),
  index("idx_ent_idmap_internal").on(table.system, table.entityType, table.internalId),
]);

export type EnterpriseIdMap = typeof enterpriseIdMap.$inferSelect;
export type InsertEnterpriseIdMap = typeof enterpriseIdMap.$inferInsert;

/**
 * Sync log — audit of every connector operation + inbound idempotency.
 *
 *  direction : inbound | outbound
 *  operation : dotted op name, e.g. 'wms.material.request', 'plm.bom.upsert',
 *              'cmms.schedule.pull'.
 *  status    : ok | error | skipped | duplicate
 *  A non-null (system, operation, idempotencyKey) is UNIQUE → a replayed inbound
 *  op is detected and applied at most once.
 */
export const enterpriseSyncLog = pgTable("enterprise_sync_log", {
  id: serial("id").primaryKey(),
  system: varchar("system", { length: 16 }).notNull(),
  direction: varchar("direction", { length: 12 }).notNull(),
  operation: varchar("operation", { length: 80 }).notNull(),
  externalId: text("external_id"),
  internalId: text("internal_id"),
  idempotencyKey: varchar("idempotency_key", { length: 200 }),
  status: varchar("status", { length: 16 }).default("ok").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_ent_synclog_sys_created").on(table.system, table.createdAt),
  index("idx_ent_synclog_status").on(table.status),
  uniqueIndex("uq_ent_synclog_idem")
    .on(table.system, table.operation, table.idempotencyKey)
    .where(sql`"idempotency_key" IS NOT NULL`),
]);

export type EnterpriseSyncLog = typeof enterpriseSyncLog.$inferSelect;
export type InsertEnterpriseSyncLog = typeof enterpriseSyncLog.$inferInsert;
