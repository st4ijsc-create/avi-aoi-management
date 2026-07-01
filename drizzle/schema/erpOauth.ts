// Schema domain: ERP OAuth2 client-credentials registry
// (Automation Orchestration K0+, doc 16 §4 Khối 0 / doc 18 §6)
//
// ════════════════════════════════════════════════════════════════════════════
// erp_oauth_clients — one row per registered ERP/MES machine-to-machine client.
// A client authenticates at POST /api/v1/oauth/token (client_credentials grant)
// with its clientId + clientSecret and receives a short-lived signed token
// carrying its granted scopes. This is an ALTERNATIVE inbound credential ADDED
// alongside the existing api_keys / bearer / MASTER_API_KEY auth (see
// server/api/v1/auth.ts) — gated by ERP_OAUTH_ENABLED (default OFF).
//
// Only a SHA-256 hash of the client secret is stored (REUSES the api_keys hashing
// approach — hashApiKey). The plaintext secret is shown ONCE at creation.
//
// NOT tenant-scoped (matches api_keys / integration_outbox): corporateCode is an
// optional grouping tag, not an isolation boundary. varchar/jsonb columns (NO new
// pg enums) keep migration 0151 additive.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, varchar, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

export const erpOauthClients = pgTable("erp_oauth_clients", {
  id: serial("id").primaryKey(),
  // Public client identifier the token endpoint looks up.
  clientId: varchar("clientId", { length: 100 }).notNull(),
  // SHA-256 hex of the client secret. Plaintext shown ONCE at creation, never stored.
  clientSecretHash: varchar("clientSecretHash", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Granted scopes (e.g. ["erp:write"]). "*" = all scopes.
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").default(true).notNull(),
  // Optional grouping tag (NOT an isolation boundary).
  corporateCode: varchar("corporateCode", { length: 50 }),
  createdBy: integer("createdBy"),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_erp_oauth_clients_client_id").on(table.clientId),
  index("idx_erp_oauth_clients_enabled").on(table.enabled),
]);

export type ErpOauthClient = typeof erpOauthClients.$inferSelect;
export type InsertErpOauthClient = typeof erpOauthClients.$inferInsert;
