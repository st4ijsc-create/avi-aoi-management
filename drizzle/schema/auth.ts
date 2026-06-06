// Schema domain: Auth tables
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, boolean, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { roleEnum } from "./enums";

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 100 }).unique(), // For local auth
  passwordHash: varchar("passwordHash", { length: 255 }), // For local auth (bcrypt hash)
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }), // Số điện thoại
  department: varchar("department", { length: 100 }), // Phòng ban
  position: varchar("position", { length: 100 }), // Chức vụ
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(), // Trạng thái tài khoản
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }), // TOTP secret for 2FA
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(), // 2FA enabled flag
  loginAttempts: integer("loginAttempts").default(0).notNull(),  // failed login counter
  lockedUntil: timestamp("lockedUntil"),                         // null = not locked
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => [
  index("idx_users_username").on(table.username),
  index("idx_users_email").on(table.email),
  index("idx_users_active").on(table.isActive),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Permissions - Quyền hạn truy cập các module/chức năng
 */
export const permissionCategoryEnum = pgEnum("permissioncategoryenum", [
  "dashboard",
  "history",
  "analytics",
  "reports",
  "mqtt",
  "settings",
  "admin",
  "production",
  "machine_monitoring",
  "annotations"
]);

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  category: permissionCategoryEnum("category").notNull(),
  moduleName: varchar("moduleName", { length: 100 }).notNull(), // e.g., "history", "mqtt_monitor", "reports"
  canView: boolean("canView").default(false).notNull(),
  canCreate: boolean("canCreate").default(false).notNull(),
  canEdit: boolean("canEdit").default(false).notNull(),
  canDelete: boolean("canDelete").default(false).notNull(),
  canExport: boolean("canExport").default(false).notNull(),
  customPermissions: json("customPermissions"), // JSON cho permissions đặc biệt
  grantedBy: integer("grantedBy"), // User ID của người cấp quyền
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"), // Thời gian hết hạn (optional)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_permissions_user").on(table.userId),
  index("idx_permissions_category").on(table.category),
  index("idx_permissions_module").on(table.moduleName),
  // Unique constraint: mỗi user chỉ có 1 permission record cho 1 module
  uniqueIndex("idx_permissions_user_module").on(table.userId, table.moduleName),
]);

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = typeof permissions.$inferInsert;

/**
 * User Roles - Nhóm quyền template
 */
export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  isSystem: boolean("isSystem").default(false).notNull(), // System roles không thể xóa
  permissions: json("permissions").notNull(), // JSON array của permission templates
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = typeof userRoles.$inferInsert;

/**
 * Backup Codes - Mã dự phòng cho 2FA recovery
 */
export const backupCodes = pgTable("backup_codes", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  code: varchar("code", { length: 20 }).notNull(), // Hashed backup code
  isUsed: boolean("isUsed").default(false).notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_backup_codes_user").on(table.userId),
  index("idx_backup_codes_code").on(table.code),
]);
export type BackupCode = typeof backupCodes.$inferSelect;
export type InsertBackupCode = typeof backupCodes.$inferInsert;

/**
 * User Sessions - Quản lý phiên đăng nhập
 */
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  sessionToken: varchar("sessionToken", { length: 255 }).notNull().unique(),
  deviceName: varchar("deviceName", { length: 255 }), // Browser/Device name
  deviceType: varchar("deviceType", { length: 50 }), // desktop, mobile, tablet
  browser: varchar("browser", { length: 100 }), // Chrome, Firefox, Safari
  os: varchar("os", { length: 100 }), // Windows, macOS, Linux, iOS, Android
  ipAddress: varchar("ipAddress", { length: 45 }),
  location: varchar("location", { length: 255 }), // City, Country
  isActive: boolean("isActive").default(true).notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_sessions_user").on(table.userId),
  index("idx_user_sessions_token").on(table.sessionToken),
  index("idx_user_sessions_active").on(table.isActive),
  index("idx_user_sessions_expires").on(table.expiresAt),
]);
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof userSessions.$inferInsert;

/**
 * User Corporate Assignments - Phân quyền user theo công ty
 */
export const userCorporateAssignments = pgTable("user_corporate_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  corporateCode: varchar("corporateCode", { length: 50 }).notNull(),
  assignedBy: integer("assignedBy"), // FK to users (admin who assigned)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_corporate_user").on(table.userId),
  index("idx_user_corporate_code").on(table.corporateCode),
  uniqueIndex("idx_user_corporate_unique").on(table.userId, table.corporateCode),
]);

export type UserCorporateAssignment = typeof userCorporateAssignments.$inferSelect;
export type InsertUserCorporateAssignment = typeof userCorporateAssignments.$inferInsert;

/**
 * User Factory Assignments - Phân quyền user theo nhà máy
 */
export const userFactoryAssignments = pgTable("user_factory_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  factoryCode: varchar("factoryCode", { length: 50 }).notNull(),
  assignedBy: integer("assignedBy"), // FK to users (admin who assigned)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_factory_user").on(table.userId),
  index("idx_user_factory_code").on(table.factoryCode),
  // Unique constraint: một user không thể được assign vào cùng một factory 2 lần
  index("idx_user_factory_unique").on(table.userId, table.factoryCode),
]);

export type UserFactoryAssignment = typeof userFactoryAssignments.$inferSelect;
export type InsertUserFactoryAssignment = typeof userFactoryAssignments.$inferInsert;
