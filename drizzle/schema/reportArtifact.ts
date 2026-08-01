// Schema domain: Report artifact store (doc 32 Wave R2 · decision #4).
// ============================================================================
// Persist every RENDERED report file (on-demand / scheduled / external /
// mobile) on the storage layer (server/storage.ts storagePut) with a
// re-download handle + a retention window (default now()+365 days per decision
// #4). Replaces the volatile in-memory Map (TTL 30' — _core/index.ts external
// reports stub) and the ad-hoc base64 / S3 report storage scattered across the
// codebase. The single persistence path is server/services/reportArtifactService.
import { pgTable, serial, integer, text, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: serial("id").primaryKey(),
    /** Normalised report type (daily_summary / shift_report / defect_analysis / oee / …). */
    reportType: varchar("reportType", { length: 64 }).notNull(),
    /** Rendered file format — pdf | xlsx | csv | html | pptx. */
    format: varchar("format", { length: 12 }).notNull(),
    /** Human-facing title for the history UI. */
    title: varchar("title", { length: 500 }),
    /** Filters / scope the report was generated with (factory/line/product/shift/date…). */
    params: jsonb("params").$type<Record<string, unknown> | null>(),
    /** Storage key returned by storagePut (relative object path). */
    storageKey: text("storageKey").notNull(),
    /** Storage URL returned by storagePut at persist time (may be re-signed on download). */
    storageUrl: text("storageUrl").notNull(),
    /** sha256 hex of the file bytes — dedupe key + integrity handle. */
    fileHash: varchar("fileHash", { length: 64 }).notNull(),
    /** File size in bytes. */
    fileSize: integer("fileSize").notNull().default(0),
    /** MIME content type of the stored file. */
    contentType: varchar("contentType", { length: 128 }).notNull().default("application/octet-stream"),
    /** Creating user id — NULL for system / scheduled artifacts. No FK (mirrors report_deliveries). */
    createdBy: integer("createdBy"),
    /** Origin — on_demand | scheduled | external | mobile. */
    source: varchar("source", { length: 20 }).notNull().default("on_demand"),
    /** Retention deadline — cleanup job deletes storage object + row past this. Default now()+365d. */
    expiresAt: timestamp("expiresAt")
      .notNull()
      .default(sql`now() + interval '365 days'`),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_report_artifacts_creator").on(t.createdBy, t.createdAt),
    index("idx_report_artifacts_type").on(t.reportType),
    index("idx_report_artifacts_expires").on(t.expiresAt),
    index("idx_report_artifacts_hash").on(t.fileHash),
  ],
);

export type ReportArtifact = typeof reportArtifacts.$inferSelect;
export type InsertReportArtifact = typeof reportArtifacts.$inferInsert;
