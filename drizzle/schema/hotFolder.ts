// Schema domain: HOT-FOLDER INGESTION (doc 27 §3 gap C1 — P0 · Đợt 2 / W2-A).
//
// ════════════════════════════════════════════════════════════════════════════
// Real AOI/AVI machines (I.C.T, Saki, Mirtec, custom …) export per-board result
// files (CSV/XML/JSON) into a local/SMB folder — the dominant integration mode
// of commercial AOI. These tables persist the WATCH CONFIGURATION per machine
// and a processed-file LEDGER used for idempotent ingest (dedup by
// machine + filename + content-hash) across restarts.
//
//   • hot_folder_configs — one watched folder per machine+adapter (glob filter,
//     archive/error folders, stability window for partial-write safety, optional
//     poll fallback for SMB shares that emit no FS events, archive retention).
//   • hot_folder_files   — append-only ledger of every file the service touched
//     (processed / duplicate / error) with a UNIQUE idempotency key so a re-drop
//     of the SAME content can never double-insert an inspection.
//
// Additive only — no ALTER of existing tables, no new pg enums (statuses are
// varchar validated at the app layer, mirroring edge_nodes / factory_zones).
// ════════════════════════════════════════════════════════════════════════════
import {
  pgTable, serial, integer, varchar, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

/** Watch configuration: one hot folder per machine + vendor adapter. */
export const hotFolderConfigs = pgTable("hot_folder_configs", {
  id: serial("id").primaryKey(),
  /** Machine the folder belongs to (soft-ref machines.id, repo convention). */
  machineId: integer("machineId").notNull(),
  /** Vision adapter registry key ("generic-json", "saki", …) — resolved at runtime, never hardcoded. */
  adapterKey: varchar("adapterKey", { length: 64 }).notNull(),
  /** Absolute folder to watch (local path or UNC/SMB share). */
  watchPath: text("watchPath").notNull(),
  /** Glob filter for result files (supports * ? and {a,b}); matched case-insensitively. */
  filePattern: varchar("filePattern", { length: 255 }).default("*.{csv,xml,json}").notNull(),
  /** Where processed files are moved (default: <watchPath>/archive). */
  archivePath: text("archivePath"),
  /** Where failed files are moved with a .reason.txt sidecar (default: <watchPath>/error). */
  errorPath: text("errorPath"),
  /** Only enabled configs get a watcher. */
  enabled: boolean("enabled").default(true).notNull(),
  /** >0 → chokidar polling interval in ms (SMB/NFS shares without FS events); 0 = native events. */
  pollFallbackMs: integer("pollFallbackMs").default(0).notNull(),
  /** Partial-write safety: file size must be stable for this long before processing. */
  stabilityWindowMs: integer("stabilityWindowMs").default(2000).notNull(),
  /** Archived files older than N days are deleted (0 = keep forever). */
  deleteAfterDays: integer("deleteAfterDays").default(30).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_hot_folder_configs_machine").on(table.machineId),
  index("idx_hot_folder_configs_enabled").on(table.enabled),
]);

/**
 * Processed-file ledger. `idempotencyKey` = `${machineId}:${sha256(content)}:${fileName}`
 * is UNIQUE — the DB itself rejects a second insert for identical content, so a
 * re-dropped duplicate can never create a second inspection even across process
 * restarts or concurrent watchers.
 */
export const hotFolderFiles = pgTable("hot_folder_files", {
  id: serial("id").primaryKey(),
  configId: integer("configId").notNull(),
  machineId: integer("machineId").notNull(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  /** sha256 hex of the raw file content. */
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  /** machineId + contentHash + fileName (unique — the dedup anchor). */
  idempotencyKey: varchar("idempotencyKey", { length: 700 }).notNull(),
  /** processed | duplicate | error */
  status: varchar("status", { length: 24 }).notNull(),
  /** product_inspections.id created by the ingest (when status = processed). */
  inspectionId: integer("inspectionId"),
  /** Failure reason (when status = error) — also written to the .reason.txt sidecar. */
  errorReason: text("errorReason"),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_hot_folder_files_idem").on(table.idempotencyKey),
  index("idx_hot_folder_files_config").on(table.configId),
  index("idx_hot_folder_files_processed_at").on(table.processedAt),
]);

export type HotFolderConfig = typeof hotFolderConfigs.$inferSelect;
export type InsertHotFolderConfig = typeof hotFolderConfigs.$inferInsert;
export type HotFolderFile = typeof hotFolderFiles.$inferSelect;
export type InsertHotFolderFile = typeof hotFolderFiles.$inferInsert;
