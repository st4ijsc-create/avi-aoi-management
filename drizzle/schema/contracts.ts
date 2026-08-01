// Schema domain: Contract schema registry (doc 44 Batch W0-E, gap G2.5)
//
// ════════════════════════════════════════════════════════════════════════════
// `contract_schemas` persists the LDS-L1 message-contract registry that
// server/services/contracts/schemaRegistry.ts previously held only in-memory
// (runtime had 0 schemas — registerSchema was test-only). Rows are the
// version lineage per SUBJECT (a UNS topic family, e.g.
// "syn/+/+/+/+/+/telemetry"); every new version must pass the BACKWARD
// compat gate (checkBackwardCompat) BEFORE it is persisted, so the table only
// ever contains a compatible lineage (plus explicit allowBreaking majors).
//
// Source of truth stays IN GIT: contracts/canonical/*.schema.json — this table
// is the runtime registry seeded from those files (schema_ref points back to
// the originating file). Plain text (no pg enums) for status/compatibility so
// migration 0248 stays CREATE TABLE/INDEX IF NOT EXISTS only (mirrors ncr.ts
// reasoning). Inert until CONTRACT_REGISTRY_PERSIST_ENABLED=true (default OFF).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Registry compatibility modes (plain text in DB — see header). Only BACKWARD is enforced today. */
export const CONTRACT_COMPATIBILITIES = ["BACKWARD", "NONE"] as const;
export type ContractCompatibility = (typeof CONTRACT_COMPATIBILITIES)[number];

/** Lifecycle of a persisted schema version (plain text in DB — see header). */
export const CONTRACT_SCHEMA_STATUSES = ["active", "deprecated"] as const;
export type ContractSchemaStatus = (typeof CONTRACT_SCHEMA_STATUSES)[number];

export const contractSchemas = pgTable("contract_schemas", {
  id: serial("id").primaryKey(),
  /** Subject = UNS topic family the schema governs, e.g. "syn/+/+/+/+/+/telemetry". */
  subject: text("subject").notNull(),
  /** Monotonic version within a subject (1, 2, 3, …). */
  version: integer("version").notNull(),
  /** Compat mode the version was admitted under (BACKWARD default; NONE = explicit major). */
  compatibility: text("compatibility").default("BACKWARD").notNull().$type<ContractCompatibility>(),
  /** The JSON-Schema document itself (draft-07 subset: type/properties/required/enum/items). */
  schemaJson: jsonb("schema_json").$type<Record<string, unknown>>().notNull(),
  /** Path of the originating as-code file in Git (e.g. "contracts/canonical/telemetry.schema.json"). */
  schemaRef: text("schema_ref"),
  status: text("status").default("active").notNull().$type<ContractSchemaStatus>(),
  /** Owning team/service (governance handle, free text). */
  owner: text("owner"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // One row per (subject, version) — seed/persist upserts against this.
  uniqueIndex("uq_contract_schemas_subject_version").on(table.subject, table.version),
  index("idx_contract_schemas_subject").on(table.subject),
  index("idx_contract_schemas_status").on(table.status),
]);

export type ContractSchema = typeof contractSchemas.$inferSelect;
export type InsertContractSchema = typeof contractSchemas.$inferInsert;

// ════════════════════════════════════════════════════════════════════════════
// doc 44 Batch W2-B2 (gap G2.6) — `contract_quarantine` (migration 0254).
//
// Where contract-INVALID inbound messages land when the ingest-validation seam
// (services/contracts/ingestValidation.ts) runs in mode "quarantine"
// (CONTRACT_VALIDATE_INGEST_MODE — default OFF → this table stays empty).
// Plain text status/source (no pg enums — same reasoning as contract_schemas).
// payload is CAPPED: anything serializing >64KB is stored as a wrapper
// { truncated: true, sizeBytes, preview } — see capQuarantinePayload().
// reviewed_by is a soft-ref to users.id (no FK — repo convention).
// ════════════════════════════════════════════════════════════════════════════

/** Which ingest seam quarantined the message. */
export const CONTRACT_QUARANTINE_SOURCES = ["mqtt", "telemetry_bus", "api"] as const;
export type ContractQuarantineSource = (typeof CONTRACT_QUARANTINE_SOURCES)[number];

/** Review lifecycle of a quarantined message. */
export const CONTRACT_QUARANTINE_STATUSES = ["quarantined", "reviewed", "replayed", "discarded"] as const;
export type ContractQuarantineStatus = (typeof CONTRACT_QUARANTINE_STATUSES)[number];

export const contractQuarantine = pgTable("contract_quarantine", {
  id: serial("id").primaryKey(),
  /** Canonical subject the payload FAILED against (e.g. "syn/+/+/+/+/+/telemetry"). */
  subject: text("subject").notNull(),
  source: text("source").notNull().$type<ContractQuarantineSource>(),
  /** The offending payload (any JSON) — capped at 64KB serialized (truncated wrapper beyond). */
  payload: jsonb("payload").$type<unknown>().notNull(),
  /** Validation errors from jsonSchemaValidator (string[], capped at 50 entries). */
  errors: jsonb("errors").$type<string[]>().notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  status: text("status").default("quarantined").notNull().$type<ContractQuarantineStatus>(),
  /** Soft-ref users.id of the reviewer (mark reviewed/discarded/replayed). */
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => [
  index("idx_contract_quarantine_subject_received").on(table.subject, table.receivedAt),
  index("idx_contract_quarantine_status").on(table.status),
]);

export type ContractQuarantine = typeof contractQuarantine.$inferSelect;
export type InsertContractQuarantine = typeof contractQuarantine.$inferInsert;
