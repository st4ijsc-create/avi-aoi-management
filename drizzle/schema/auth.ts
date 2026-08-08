// Schema domain: Auth tables
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, boolean, json, index, uniqueIndex, customType, primaryKey } from "drizzle-orm/pg-core";
import { roleEnum } from "./enums";
// ⚠ `import type` — bị XOÁ SẠCH lúc biên dịch, nên schema **không** kéo `bcryptjs` vào bất kỳ bao
//   đóng nào (kể cả drizzle-kit hay bundle client). Chỉ cái NHÃN đi vào kiểu của cột.
import type { MaDuPhongDaBam } from "../../server/_core/backupCodeSecret";

/**
 * `bytea` — drizzle-orm không có builder sẵn cho kiểu này.
 * ⚠ `fromDriver`/`toDriver` KHÔNG khai: gói `postgres` (v3) đã trả `Uint8Array`/nhận `Buffer`
 *   đúng chiều rồi. Một phép chuyển thứ hai ở đây là một bản sao vị từ sẽ trôi.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

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
  "annotations",
  "machine_control", // Sprint F4a — OT machine control (HITL write-action: start/stop/recipe/param/ack)
  "andon",      // Sprint F5a — Andon signal/notification (ALERT-ONLY)
  "interlock",  // Sprint F5a — Interlock rule management (ALERT-ONLY; engine has no command path)
  "mes_bom",    // Sprint G2.4 — BOM/Feeder/component genealogy (master data + telemetry; NO machine write)
  "energy"      // Sprint G2.6a — advanced energy analytics (read + energy telemetry; NO machine write)
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
  // ★★★ Pha 7 Task 8a — nhãn danh nghĩa: ô này CHỈ nhận giá trị do `bamMaDuPhong()` trả về.
  // Ghi một chuỗi thô vào đây là LỖI BIÊN DỊCH, ở bất kỳ file nào, kể cả file chưa tồn tại.
  // Chủ duy nhất: `server/_core/backupCodeSecret.ts`.
  code: varchar("code", { length: 20 }).$type<MaDuPhongDaBam>().notNull(),
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

/**
 * ★★★ Pha 7 Task 5 (A) — **SỔ MÃ OTP ĐÃ TIÊU, XUYÊN TIẾN TRÌNH.** Migration `0313`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO BẢNG NÀY TỒN TẠI — HAI CA ĐỎ ĐO ĐƯỢC, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 6 Task 6 dựng sổ trong **bộ nhớ tiến trình**. Bước 1 của Pha 7 đo được hai lỗ:
 *   • **A2** — sau một lượt **restart**, sổ về rỗng và **CÙNG một mã** verify lại được
 *     (`hopLe = true`) trong khi nó **vẫn trong cửa sổ ~90 s** của `speakeasy`. Tức mọi lượt
 *     redeploy mở lại cửa phát lại trong **120 s**.
 *   • **A3** — hai bản sao `ROLE=api` có **HAI cuốn sổ** ⇒ mã tiêu ở A vẫn dùng được ở B.
 * ⇒ Sổ phải sống ở chỗ **DUY NHẤT mà mọi tiến trình cùng thấy**, và sống lâu hơn tiến trình.
 *
 * ⚠⚠ `tokenHash` là **sha-256**, KHÔNG phải mã 6 số nguyên văn — và lý do thứ nhất là một **tính
 * chất CẤU TRÚC**, không phải khẩu vị: bề rộng của nó là **32 byte cố định theo cấu tạo**, nên
 * `22001` ("value too long") là điều **KHÔNG THỂ XẢY RA**. So với `varchar(N)`, nơi ta luôn phải
 * *"chọn đủ rộng"* rồi một ngày phát hiện là chưa đủ — đúng bài học migration 0311 và của
 * `vram_leases.owner`. Lý do thứ hai: không đưa một mã OTP **còn hiệu lực** vào bảng và vào log
 * truy vấn.
 * ⚠ Đây **KHÔNG** phải phép chống một kẻ **đã đọc được DB** — secret 2FA nằm ngay
 *   `users.two_factor_secret` cùng DB. Nó chỉ bỏ plaintext ở nơi không cần plaintext.
 *
 * ⚠ **KHOÁ CHÍNH GỒM `userId`**: hai người dùng khác secret có thể tình cờ sinh **cùng 6 số**, và
 *   chặn nhầm người thứ hai là một lỗi **có thật**, không phải giả thuyết.
 *
 * ⚠⚠ `luot` — **DẤU CỦA LƯỢT GỌI**, và nó là thứ giữ cho sổ **không tự chặn mình**: chuỗi thật của
 *   `vram.preempt` chạy `verifyTotpOnce` **2-3 lần cho MỘT lượt bấm nút** (`_core/trpc.ts` khối
 *   I-4). Cùng `luot` ⇒ vẫn là lượt gọi ấy ⇒ cho qua. Khác `luot` ⇒ **PHÁT LẠI**.
 *
 * ⚠ **KHÔNG có khoá ngoại tới `users`** — cố ý: một lượt xoá người dùng không được phép làm hỏng
 *   đường xác minh, và hàng ở đây **tự chết sau ≤120 s** nên không có rác tồn đọng để tham chiếu.
 *
 * ⚠ **TỰ DỌN: chính lượt xác minh chạy, KHÔNG cron.** Xem `server/_core/totpOnce.ts`. Đặt phép dọn
 *   vào một cron ở `ROLE=worker` là làm sức khoẻ của sổ thành **hệ quả của một tiến trình KHÁC còn
 *   sống** — đúng lăng kính *"an toàn là HỆ QUẢ của một thứ khác đang hỏng"* (đã sáu lần).
 */
export const totpConsumed = pgTable("totp_consumed", {
  /** Chủ của mã. `users.id` là `integer` (đã kiểm `information_schema`). */
  userId: integer("userId").notNull(),
  /** `sha256(\`${userId}:${token}\`)` — 32 byte, bề rộng CỐ ĐỊNH theo cấu tạo. */
  tokenHash: bytea("tokenHash").notNull(),
  /** Dấu của LƯỢT GỌI (`randomUUID()` = 36 ký tự). ⚠ KHÔNG dùng kiểu `uuid`: API nhận
   *  `luot?: string` từ người gọi ⇒ một chuỗi lạ sẽ là `22P02` LÚC CHẠY, không phải lỗi kiểu. */
  luot: varchar("luot", { length: 64 }).notNull(),
  /** `nowMs + TOTP_HAN_SO_MS` (120 s). Giá trị do **ứng dụng** cấp ⇒ giữ được đường tiêm `nowMs`. */
  expiresAt: timestamp("expiresAt").notNull(),
}, (table) => [
  primaryKey({ name: "totp_consumed_pkey", columns: [table.userId, table.tokenHash] }),
  index("totp_consumed_expires_idx").on(table.expiresAt),
]);

export type TotpConsumedRow = typeof totpConsumed.$inferSelect;
export type InsertTotpConsumedRow = typeof totpConsumed.$inferInsert;
