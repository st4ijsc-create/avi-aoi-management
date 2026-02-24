/**
 * Schema domain: License tables
 * Hệ thống quản lý bản quyền hybrid (online + offline)
 */
import { pgTable, serial, integer, text, timestamp, varchar, boolean, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";

// ─── License Enums ───────────────────────────────────────────
export const licenseStatusEnum = pgEnum("license_status_enum", [
  "active",
  "expired", 
  "revoked",
  "suspended",
  "pending",
]);

export const licenseTypeEnum = pgEnum("license_type_enum", [
  "trial",
  "standard",
  "professional",
  "enterprise",
  "lifetime",
]);

// ─── Licenses ────────────────────────────────────────────────
export const licenses = pgTable("licenses", {
  id: serial("id").primaryKey(),
  licenseKey: varchar("license_key", { length: 50 }).notNull().unique(),
  productCode: varchar("product_code", { length: 50 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  companyName: varchar("company_name", { length: 255 }),
  status: licenseStatusEnum("status").default("active").notNull(),
  licenseType: licenseTypeEnum("license_type").default("standard").notNull(),
  
  // Module permissions
  allowedModules: json("allowed_modules").$type<string[]>().default([]).notNull(),
  maxUsers: integer("max_users"),
  maxMachines: integer("max_machines"),

  // Activation
  maxActivations: integer("max_activations").default(1).notNull(),
  currentActivations: integer("current_activations").default(0).notNull(),
  
  // Dates
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  lastActivatedAt: timestamp("last_activated_at"),
  
  // Offline policy
  maxOfflineDays: integer("max_offline_days").default(30).notNull(),
  gracePeriodDays: integer("grace_period_days").default(7).notNull(),
  requireHardwareBinding: boolean("require_hardware_binding").default(true).notNull(),

  // Metadata
  notes: text("notes"),
  customData: json("custom_data").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_licenses_key").on(table.licenseKey),
  index("idx_licenses_status").on(table.status),
  index("idx_licenses_product").on(table.productCode),
  index("idx_licenses_customer_email").on(table.customerEmail),
]);

export type License = typeof licenses.$inferSelect;
export type InsertLicense = typeof licenses.$inferInsert;

// ─── License Activations ─────────────────────────────────────
export const licenseActivations = pgTable("license_activations", {
  id: serial("id").primaryKey(),
  licenseId: integer("license_id").notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  licenseKey: varchar("license_key", { length: 50 }).notNull(),
  
  // Machine info
  machineName: varchar("machine_name", { length: 255 }),
  hardwareFingerprint: varchar("hardware_fingerprint", { length: 128 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  
  // Client info
  clientVersion: varchar("client_version", { length: 50 }),
  osInfo: varchar("os_info", { length: 255 }),
  
  // Status
  isActive: boolean("is_active").default(true).notNull(),
  activatedAt: timestamp("activated_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  deactivatedAt: timestamp("deactivated_at"),
  
  // Offline token
  offlineToken: text("offline_token"), // Base64 encoded license file
}, (table) => [
  index("idx_activations_license").on(table.licenseId),
  index("idx_activations_key").on(table.licenseKey),
  index("idx_activations_fingerprint").on(table.hardwareFingerprint),
  uniqueIndex("idx_activations_key_fingerprint").on(table.licenseKey, table.hardwareFingerprint),
]);

export type LicenseActivation = typeof licenseActivations.$inferSelect;
export type InsertLicenseActivation = typeof licenseActivations.$inferInsert;

// ─── License Sync Logs ───────────────────────────────────────
export const licenseSyncLogs = pgTable("license_sync_logs", {
  id: serial("id").primaryKey(),
  licenseId: integer("license_id").notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  licenseKey: varchar("license_key", { length: 50 }).notNull(),
  hardwareFingerprint: varchar("hardware_fingerprint", { length: 128 }),
  
  syncType: varchar("sync_type", { length: 20 }).default("heartbeat").notNull(), // heartbeat, validate, crl
  syncResult: varchar("sync_result", { length: 20 }).default("success").notNull(), // success, failed, revoked
  
  clientVersion: varchar("client_version", { length: 50 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  details: text("details"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_sync_logs_license").on(table.licenseId),
  index("idx_sync_logs_key").on(table.licenseKey),
  index("idx_sync_logs_created").on(table.createdAt),
]);

export type LicenseSyncLog = typeof licenseSyncLogs.$inferSelect;
export type InsertLicenseSyncLog = typeof licenseSyncLogs.$inferInsert;

// ─── Revoked Licenses (CRL) ─────────────────────────────────
export const licenseRevocations = pgTable("license_revocations", {
  id: serial("id").primaryKey(),
  licenseKey: varchar("license_key", { length: 50 }).notNull().unique(),
  reason: text("reason"),
  revokedBy: varchar("revoked_by", { length: 255 }),
  revokedAt: timestamp("revoked_at").defaultNow().notNull(),
}, (table) => [
  index("idx_revocations_key").on(table.licenseKey),
]);

export type LicenseRevocation = typeof licenseRevocations.$inferSelect;
export type InsertLicenseRevocation = typeof licenseRevocations.$inferInsert;

// ─── License Modules (dịnh nghĩa modules) ──────────────────
export const licenseModules = pgTable("license_modules", {
  id: serial("id").primaryKey(),
  moduleCode: varchar("module_code", { length: 50 }).notNull().unique(),
  moduleName: varchar("module_name", { length: 255 }).notNull(),
  description: text("description"),
  version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
  isCore: boolean("is_core").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_modules_code").on(table.moduleCode),
]);

export type LicenseModule = typeof licenseModules.$inferSelect;
export type InsertLicenseModule = typeof licenseModules.$inferInsert;
