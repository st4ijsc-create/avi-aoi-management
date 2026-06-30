// Schema domain: Multi-Site Federation (doc 13 — F0 sites registry).
//
// A `sites` row represents a remote (or local self-enrolled) deployment of the
// platform that the CORE control-tower will later poll read-only (F1) for KPI
// roll-up. F0 = registry + enrollment + probe only; no aggregator/roll-up here.
//
// SECURITY: the per-site read token is NEVER stored raw. `authTokenRef` holds a
// reference only; the actual secret is resolved at call time from the env var
// `SITE_TOKEN_<CODE>` (mirrors the MASTER_API_KEY env pattern). A DB dump leaks
// no site secrets.
import { pgTable, serial, integer, text, timestamp, varchar, boolean, index } from "drizzle-orm/pg-core";

export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(), // e.g. "HCM01" — also keys SITE_TOKEN_<CODE>
  name: varchar("name", { length: 255 }).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }), // links to corporates.code (rollup parent; not a new hierarchy level)
  baseUrl: text("baseUrl").notNull(), // https://hcm.factory.local — root for /api/external/*
  region: varchar("region", { length: 100 }),
  // --- auth: reference only, secret resolved from env SITE_TOKEN_<CODE> ---
  authType: varchar("authType", { length: 20 }).default("master_key").notNull(), // master_key | bearer
  authTokenRef: varchar("authTokenRef", { length: 128 }), // e.g. "SITE_TOKEN_HCM01" (a ref, NOT the secret)
  // --- streaming (F3, optional — declared now, unused in F0) ---
  unsBrokerUrl: text("unsBrokerUrl"),
  // --- operations ---
  pollIntervalSec: integer("pollIntervalSec").default(60).notNull(),
  status: varchar("status", { length: 20 }).default("unknown").notNull(), // active | paused | error | unknown
  isLocal: boolean("isLocal").default(false).notNull(), // self-enroll core as a "local" site
  lastSyncAt: timestamp("lastSyncAt"),
  lastError: text("lastError"),
  consecutiveFailures: integer("consecutiveFailures").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("idx_sites_code").on(t.code),
  index("idx_sites_corporate").on(t.corporateCode),
  index("idx_sites_status").on(t.status),
]);

export type Site = typeof sites.$inferSelect;
export type InsertSite = typeof sites.$inferInsert;

/** Allowed values for sites.status (honest staleness is derived in the UI). */
export const SITE_STATUSES = ["active", "paused", "error", "unknown"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/** Allowed values for sites.authType. */
export const SITE_AUTH_TYPES = ["master_key", "bearer"] as const;
export type SiteAuthType = (typeof SITE_AUTH_TYPES)[number];
