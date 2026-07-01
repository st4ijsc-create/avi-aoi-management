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
import { pgTable, serial, integer, text, timestamp, varchar, boolean, jsonb, doublePrecision, index, uniqueIndex } from "drizzle-orm/pg-core";

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

// ════════════════════════════════════════════════════════════════════════════
// F1 — Roll-up store (doc 13 §4 + §9)
//
// The CORE aggregator periodically PULLS each enrolled site's KPIs read-only via
// its /api/external/* feed and lands them here. The core NEVER writes to a site;
// the only data direction is site → core.
//
// HONEST STALENESS is a first-class concern: every roll-up row records both
//   • asOf      — the window the data actually describes (e.g. "today")
//   • fetchedAt — when the core successfully pulled it
// so the dashboard can compute age = now − fetchedAt and badge OK/STALE/DOWN.
// We NEVER pass stale numbers off as live, and we NEVER fabricate values.
// ════════════════════════════════════════════════════════════════════════════

/** Roll-up bucket windows. "snapshot" = latest-known KPI for the site's window. */
export const ROLLUP_WINDOWS = ["snapshot", "hour", "shift", "day"] as const;
export type RollupWindow = (typeof ROLLUP_WINDOWS)[number];

/** Where a roll-up row came from. F1 = "poll"; F3 will add "uns" (near-real-time). */
export const ROLLUP_SOURCES = ["poll", "uns"] as const;
export type RollupSource = (typeof ROLLUP_SOURCES)[number];

/**
 * site_kpi_rollup — one row per (site, metric category, window, bucketStart).
 *
 * Designed for two access patterns:
 *   1. "latest snapshot per site per metric" — dashboard grid (window='snapshot',
 *      one row per (siteId, category) upserted in place each cycle).
 *   2. short history — additional rows with window in (hour|shift|day) +
 *      a distinct bucketStart give a trend without storing raw inspections.
 *
 * Aggregate-only (no raw inspection rows) → small even at N=50 sites.
 */
export const siteKpiRollup = pgTable("site_kpi_rollup", {
  id: serial("id").primaryKey(),
  siteId: integer("siteId")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  corporateCode: varchar("corporateCode", { length: 50 }), // denormalized from sites for cross-corporate rollups/RLS
  // U5 (doc 21 §6): the roll-up is now PER-CATEGORY, not only "overall". A site
  // gets one snapshot row per category — inspection|oee|fleet|safety|pdm (+ the
  // legacy "overall") — so fleet/safety/PdM aggregate across sites too.
  category: varchar("category", { length: 50 }).notNull().default("overall"), // overall | inspection | oee | fleet | safety | pdm | <station/product code>
  window: varchar("window", { length: 20 }).notNull().default("snapshot"), // snapshot | hour | shift | day
  bucketStart: timestamp("bucketStart", { withTimezone: true }), // null for window='snapshot'
  asOf: timestamp("asOf", { withTimezone: true }).notNull(), // the period the KPIs describe
  // --- KPI values (honest: null when the site didn't return that metric) ---
  totalInspections: integer("totalInspections"),
  okCount: integer("okCount"),
  ngCount: integer("ngCount"),
  ntfCount: integer("ntfCount"),
  yieldRate: doublePrecision("yieldRate"), // %
  ngRate: doublePrecision("ngRate"), // %
  throughput: integer("throughput"), // units in window (= totalInspections)
  oee: doublePrecision("oee"), // %, null until a site exposes OEE
  avgCycleTime: doublePrecision("avgCycleTime"), // seconds
  defectPareto: jsonb("defectPareto"), // top-N {pointCode,name,ngCount,pct} — null if not fetched
  // --- U5 (doc 21 §6 / G-7): deepened roll-up (all nullable, honest) ---
  // detailRows: the site's per-machine/station summary rows (PREVIOUSLY fetched-
  //   then-DISCARDED). Retained so a drill site → factory → device can be assembled.
  detailRows: jsonb("detailRows"), // SiteDetailRow[] | null
  // alertRollup: compact per-site alert summary (open/critical counts + top-N) so
  //   the FederationDashboard + Command Center can show cross-site alerts.
  alertRollup: jsonb("alertRollup"), // SiteAlertRollup | null
  // metrics: generalized per-category metric bag (fleet/safety/pdm) — honest null
  //   when a remote site cannot provide the category.
  metrics: jsonb("metrics"), // Record<string, number|null> | null
  // --- provenance / staleness ---
  source: varchar("source", { length: 20 }).notNull().default("poll"), // poll | uns
  fetchedAt: timestamp("fetchedAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Upsert target for the "latest snapshot per site per metric" pattern.
  uniqueIndex("uq_site_kpi_rollup_bucket").on(t.siteId, t.category, t.window, t.bucketStart),
  index("idx_site_kpi_rollup_site_asof").on(t.siteId, t.asOf),
  index("idx_site_kpi_rollup_corporate").on(t.corporateCode),
]);

export type SiteKpiRollup = typeof siteKpiRollup.$inferSelect;
export type InsertSiteKpiRollup = typeof siteKpiRollup.$inferInsert;

/**
 * U5 — the canonical per-category roll-up keys. "overall" is kept for backward
 * compatibility (existing dashboard grid); the aggregator now ALSO writes one row
 * per module category so fleet/safety/PdM aggregate cross-site. A category a remote
 * site cannot provide is simply absent (honest) — never fabricated with zeros.
 */
export const ROLLUP_CATEGORIES = ["overall", "inspection", "oee", "fleet", "safety", "pdm"] as const;
export type RollupCategory = (typeof ROLLUP_CATEGORIES)[number];

/**
 * One retained per-machine/station detail row (from the site's summary feed).
 * PREVIOUSLY fetched-then-discarded; now persisted on the "overall" snapshot's
 * `detailRows` so the Command Center can drill site → factory/station → device.
 */
export interface SiteDetailRow {
  machineId: number | null;
  machineCode: string;
  machineName: string;
  stationId: number | null;
  stationCode: string;
  stationName: string;
  productModelId?: number | null;
  productCode?: string;
  productName?: string;
  totalInspections: number | null;
  okCount: number | null;
  ngCount: number | null;
  ntfCount: number | null;
  yieldRate: number | null;
  avgCycleTime: number | null;
}

/** One aggregated cross-site alert entry (compact — no full DB rows). */
export interface SiteAlertEntry {
  kind: string; // andon | safety | ng | yield | ...
  severity: "info" | "low" | "medium" | "high" | "critical";
  count: number;
  title: string;
  at?: string | null; // ISO of the most recent occurrence, if known
}

/** Compact per-site alert summary landed on the "overall" snapshot row. */
export interface SiteAlertRollup {
  open: number; // total open/active alerts
  critical: number; // subset that are critical/high
  nearMiss?: number | null; // safety near-misses (honest null if not provided)
  top: SiteAlertEntry[]; // small top-N by severity/count
}

/** Allowed values for site_sync_log.status / lastSyncStatus. */
export const SYNC_STATUSES = ["ok", "partial", "failed", "skipped"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/**
 * site_sync_log — one audit row per poll attempt per site. Powers honest
 * staleness debugging (why is a site STALE?) and per-site failure isolation
 * forensics. Pruned on a rolling window by retention (out of F1 scope).
 */
export const siteSyncLog = pgTable("site_sync_log", {
  id: serial("id").primaryKey(),
  siteId: integer("siteId")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  startedAt: timestamp("startedAt", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finishedAt", { withTimezone: true }),
  ok: boolean("ok").notNull().default(false),
  status: varchar("status", { length: 20 }).notNull().default("failed"), // ok | partial | failed | skipped
  httpStatus: integer("httpStatus"),
  error: text("error"),
  durationMs: integer("durationMs"),
  metricsFetched: integer("metricsFetched").notNull().default(0), // # of endpoints/metrics landed
  endpointsHit: jsonb("endpointsHit"), // string[] of /api/external/* paths attempted
}, (t) => [
  index("idx_site_sync_log_site_started").on(t.siteId, t.startedAt),
]);

export type SiteSyncLog = typeof siteSyncLog.$inferSelect;
export type InsertSiteSyncLog = typeof siteSyncLog.$inferInsert;
