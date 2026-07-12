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
