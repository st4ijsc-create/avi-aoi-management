import { getDb } from "./connection";
import { eq, and, desc, gte, lte, or, isNull, inArray, sql, SQL } from "drizzle-orm";
import type { PhamViNguoiXem } from "./hierarchy";
import {
  auditLogs,
  type InsertAuditLog,
  systemSettings,
  type InsertSystemSetting,
  scheduledReports,
  type InsertScheduledReport,
  scheduledReportLogs,
  type InsertScheduledReportLog,
  smtpConfig,
  type InsertSmtpConfig,
  systemConfig,
  type InsertSystemConfig,
  emailTemplateConfig,
  type InsertEmailTemplateConfig,
  notifications,
  type InsertNotification,
  userNotificationPreferences,
  type InsertUserNotificationPreference,
  reportTemplates,
  type InsertReportTemplate,
} from "../../drizzle/schema";
import { catTheoTranCot } from "./catTheoTranCot";

// =====================================================
// Audit Functions
// =====================================================

export type AuditAction = 
  | 'login' | 'login_failed' | 'logout'
  | 'create' | 'update' | 'delete'
  | 'password_change' | 'role_change'
  | 'export' | 'import';

export type AuditEntityType = 
  | 'user' | 'machine' | 'product' | 'inspection'
  | 'factory' | 'workshop' | 'line' | 'station'
  | 'alert' | 'threshold' | 'mapping' | 'order';

/**
 * ★★★ NGƯỜI GHI SỔ KIỂM TOÁN — điểm ghi DUY NHẤT vào `audit_logs`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO HÀM NÀY PHẢI CHỊU ĐƯỢC DỮ LIỆU THIẾU/XẤU (đo 2026-08-18)
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Nó được gọi ở ĐÚNG lúc có sự cố — nơi mọi thứ quanh nó đang hỏng: phản hồi vừa bị
 * `res.destroy()`, `req.ip` đã thành `undefined`, CSDL vừa ném `statement_timeout`. Một
 * hàm ghi-sổ mà **giả định đầu vào đầy đủ** sẽ hỏng ĐÚNG lúc nó cần thiết nhất, và khi
 * ấy sự cố **không để lại dấu vết nào** — lớp lỗi tệ nhất trong nhóm ghi-nhận.
 *
 * Ba điều được ghim ở đây:
 *
 *   1. **`[result]` KHÔNG BAO GIỜ được đọc thẳng `.id`.** Dòng cũ là
 *      `return { id: Number(result.id) }` — nếu `RETURNING` trả 0 hàng thì `result` là
 *      `undefined` và câu ấy ném **`Cannot read properties of undefined (reading 'id')`**.
 *      Đó là **BIỂU THỨC DUY NHẤT** trong toàn bộ chuỗi ghi audit có thể đúc ra câu lỗi ấy
 *      (đã soát cả mã nguồn lẫn bundle `dist`). Và nó ném vì một lý do **vô hại**: chỉ
 *      *tiếng vọng id* vắng, còn `INSERT` thì **không ném** ⇒ hàng ĐÃ nằm trong bảng.
 *      Ném ở đây = báo "mất dấu vết" trong khi dấu vết vẫn còn — vừa sai vừa che mất
 *      nguyên nhân thật. Nay: cảnh báo, trả `id: 0`, KHÔNG ném.
 *
 *   2. **Trần `varchar` được tôn trọng theo SCHEMA** (`catTheoTranCot`). `userAgent` là
 *      `varchar(500)` và nạp thẳng từ header của KẺ GỌI; `ipAddress` là `varchar(45)` và
 *      sẽ thành dữ liệu kẻ gọi ngay khi ai đó bật `trust proxy`. Một giá trị quá dài
 *      trước đây = `22001` = **mất trọn hàng audit**. Nay nó chỉ bị **cắt**.
 *      ⇒ *Thiếu một trường không được làm mất cả bản ghi.*
 *
 *   3. `details` là `text` (không trần) và được `JSON.stringify` phòng thủ: một đối tượng
 *      vòng lặp/`BigInt` ở đường lỗi không được phép giết bản ghi — mất `details` còn hơn
 *      mất cả hàng.
 * ══════════════════════════════════════════════════════════════════════════════════════
 */
export async function createAuditLog(data: {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  entityName?: string | null;
  details?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: 'success' | 'failure';
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const values = catTheoTranCot(auditLogs, {
    userId: data.userId ?? null,
    userName: data.userName ?? null,
    action: data.action,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    entityName: data.entityName ?? null,
    details: serializeAuditDetails(data.details),
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    status: data.status ?? 'success',
  } satisfies InsertAuditLog);

  const inserted = await db.insert(auditLogs).values(values).returning({ id: auditLogs.id });
  const row = inserted[0];
  if (!row) {
    // `INSERT` không ném ⇒ hàng ĐÃ được ghi; chỉ `RETURNING` không trả về gì.
    // Ném ở đây sẽ báo "mất dấu vết" cho một dấu vết vẫn tồn tại. Xem khối §1 ở trên.
    console.warn(
      `[audit] INSERT ... RETURNING trả 0 hàng cho action="${data.action}" — hàng audit ĐÃ ghi, ` +
        `chỉ không đọc lại được id.`,
    );
    return { id: 0 };
  }
  return { id: Number(row.id) };
}

/**
 * `details` → chuỗi JSON, KHÔNG BAO GIỜ ném. Một đối tượng có vòng lặp (hay `BigInt`) lọt
 * vào đây ở đường lỗi sẽ làm `JSON.stringify` ném, và cả hàng audit biến mất vì một ô phụ.
 * Mất `details` là thiệt hại chấp nhận được; mất cả hàng thì không.
 */
function serializeAuditDetails(details: Record<string, any> | null | undefined): string | null {
  if (!details) return null;
  try {
    return JSON.stringify(details);
  } catch (err) {
    console.warn("[audit] không tuần tự hoá được `details` — giữ hàng, bỏ ô:", (err as Error)?.message ?? err);
    return JSON.stringify({ _detailsUnserializable: String((err as Error)?.message ?? err) });
  }
}

export async function getAuditLogs(params: {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  status?: 'success' | 'failure';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{
  logs: Array<{
    id: number;
    userId: number | null;
    userName: string | null;
    action: string;
    entityType: string | null;
    entityId: number | null;
    entityName: string | null;
    details: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    status: 'success' | 'failure';
    createdAt: Date;
  }>;
  total: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");
  
  const conditions: SQL[] = [];
  
  if (params.userId) {
    conditions.push(eq(auditLogs.userId, params.userId));
  }
  if (params.action) {
    conditions.push(eq(auditLogs.action, params.action));
  }
  if (params.entityType) {
    conditions.push(eq(auditLogs.entityType, params.entityType));
  }
  if (params.entityId) {
    conditions.push(eq(auditLogs.entityId, params.entityId));
  }
  if (params.status) {
    conditions.push(eq(auditLogs.status, params.status));
  }
  if (params.startDate) {
    conditions.push(gte(auditLogs.createdAt, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(auditLogs.createdAt, params.endDate));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  
  // Get total count
  const countResult = await db.select({
    total: sql<number>`COUNT(*)`,
  })
    .from(auditLogs)
    .where(whereClause);
  const total = Number(countResult[0]?.total) || 0;
  
  // Get logs
  const logs = await db.select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  
  return {
    logs: logs.map((row) => ({
      id: Number(row.id),
      userId: row.userId,
      userName: row.userName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityName: row.entityName,
      details: row.details,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      status: row.status as 'success' | 'failure',
      createdAt: new Date(row.createdAt!),
    })),
    total,
  };
}

export async function getAuditLogStats(days: number = 7): Promise<{
  totalActions: number;
  loginCount: number;
  failedLogins: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  topUsers: Array<{ userName: string; count: number }>;
  actionsByDay: Array<{ date: string; count: number }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  
  // Total actions
  // Note: "createdAt" must be quoted for PostgreSQL because the column
  // was created with a mixed-case identifier.
  const totalResult = await db.execute(
    sql`SELECT COUNT(*) as total FROM audit_logs WHERE "createdAt" >= ${startDateStr}`,
  );
  const totalActions = (totalResult as any)[0]?.[0]?.total || 0;
  
  // Login counts
  const loginResult = await db.execute(sql`SELECT 
    SUM(CASE WHEN action = 'login' AND status = 'success' THEN 1 ELSE 0 END) as loginCount,
    SUM(CASE WHEN action = 'login_failed' OR (action = 'login' AND status = 'failure') THEN 1 ELSE 0 END) as failedLogins
  FROM audit_logs WHERE "createdAt" >= ${startDateStr}`);
  const loginCount = (loginResult as any)[0]?.[0]?.loginCount || 0;
  const failedLogins = (loginResult as any)[0]?.[0]?.failedLogins || 0;
  
  // CRUD counts
  const crudResult = await db.execute(sql`SELECT 
    SUM(CASE WHEN action = 'create' THEN 1 ELSE 0 END) as createCount,
    SUM(CASE WHEN action = 'update' THEN 1 ELSE 0 END) as updateCount,
    SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as deleteCount
  FROM audit_logs WHERE "createdAt" >= ${startDateStr}`);
  const createCount = (crudResult as any)[0]?.[0]?.createCount || 0;
  const updateCount = (crudResult as any)[0]?.[0]?.updateCount || 0;
  const deleteCount = (crudResult as any)[0]?.[0]?.deleteCount || 0;
  
  // Top users
  // "userName" is mixed-case in the schema, so it must be quoted.
  const topUsersResult = await db.execute(sql`SELECT "userName", COUNT(*) as count FROM audit_logs 
    WHERE "createdAt" >= ${startDateStr} AND "userName" IS NOT NULL
    GROUP BY "userName" ORDER BY count DESC LIMIT 10`);
  const topUsers = ((topUsersResult as any)[0] || []).map((row: any) => ({
    userName: row.userName,
    count: row.count,
  }));
  
  // Actions by day
  const byDayResult = await db.execute(sql`SELECT CAST("createdAt" AS DATE) as date, COUNT(*) as count FROM audit_logs 
    WHERE "createdAt" >= ${startDateStr}
    GROUP BY CAST("createdAt" AS DATE) ORDER BY date DESC`);
  const actionsByDay = ((byDayResult as any)[0] || []).map((row: any) => ({
    date: row.date,
    count: row.count,
  }));
  
  return {
    totalActions,
    loginCount,
    failedLogins,
    createCount,
    updateCount,
    deleteCount,
    topUsers,
    actionsByDay,
  };
}


// =====================================================
// System Settings Functions
// =====================================================

export async function getSystemSetting(key: string) {
  const db = await getDb();
  if (!db) return null;
  
  const [setting] = await db.select()
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, key))
    .limit(1);
  return setting;
}

export async function getSystemSettings(category?: string) {
  const db = await getDb();
  if (!db) return [];
  
  if (category) {
    return db.select()
      .from(systemSettings)
      .where(eq(systemSettings.category, category))
      .orderBy(systemSettings.settingKey);
  }
  return db.select()
    .from(systemSettings)
    .orderBy(systemSettings.category, systemSettings.settingKey);
}

export async function updateSystemSetting(key: string, value: string, updatedBy?: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(systemSettings)
    .set({ 
      settingValue: value,
      updatedBy: updatedBy || null,
      updatedAt: new Date()
    })
    .where(eq(systemSettings.settingKey, key));
}

export async function createSystemSetting(data: InsertSystemSetting) {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.insert(systemSettings).values(data).returning({ id: systemSettings.id });
  return result.id;
}


// ==================== Scheduled Reports ====================

/**
 * ★ 2026-08-18 (trả nợ nhóm A) — báo cáo hẹn giờ mang `factoryId`/`workshopId`/`lineId` (đều
 * nullable) và một danh sách NGƯỜI NHẬN. Hàng KHÔNG khai phạm vi nào là báo cáo TOÀN HỆ THỐNG:
 * nó tổng hợp số liệu của mọi nhà máy, nên nó **bị loại** cho người bị thu hẹp — khác với ngưỡng
 * cấu hình (`oee_targets`, mẫu lệnh) vốn không mang số đo của ai.
 */
export async function getScheduledReports(filters?: {
  isActive?: boolean;
  reportType?: string;
  schedule?: string;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(scheduledReports);
  
  const conditions = [];
  {
    const cong = await congBaoCaoHenGio(scope);
    if (cong) conditions.push(cong);
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(scheduledReports.isActive, filters.isActive));
  }
  if (filters?.reportType) {
    conditions.push(eq(scheduledReports.reportType, filters.reportType as any));
  }
  if (filters?.schedule) {
    conditions.push(eq(scheduledReports.schedule, filters.schedule as any));
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  
  return query.orderBy(desc(scheduledReports.createdAt));
}

export async function getScheduledReportById(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  
  const cong = await congBaoCaoHenGio(scope);
  const results = await db.select().from(scheduledReports)
    .where(cong ? and(eq(scheduledReports.id, id), cong) : eq(scheduledReports.id, id))
    .limit(1);
  
  return results[0] || null;
}

/** Cổng phạm vi cho `scheduled_reports` — xem docblock `getScheduledReports`. */
async function congBaoCaoHenGio(scope?: PhamViNguoiXem) {
  const { idsTrongPhamVi } = await import("./hierarchy");
  const [idsNhaMay, idsXuong, idsTuyen] = await Promise.all([
    idsTrongPhamVi("factory", scope),
    idsTrongPhamVi("workshop", scope),
    idsTrongPhamVi("line", scope),
  ]);
  if (idsNhaMay === null || idsXuong === null || idsTuyen === null) return undefined;
  return or(
    inArray(scheduledReports.factoryId, idsNhaMay.length ? idsNhaMay : [-1]),
    inArray(scheduledReports.workshopId, idsXuong.length ? idsXuong : [-1]),
    inArray(scheduledReports.lineId, idsTuyen.length ? idsTuyen : [-1]),
  );
}

export async function createScheduledReport(data: InsertScheduledReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(scheduledReports).values(data).returning({ id: scheduledReports.id });
  return result.id;
}

export async function updateScheduledReport(id: number, data: Partial<InsertScheduledReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(scheduledReports)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(scheduledReports.id, id));
}

export async function deleteScheduledReport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete logs first
  await db.delete(scheduledReportLogs).where(eq(scheduledReportLogs.reportId, id));
  // Delete report
  await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
}

export async function getScheduledReportLogs(reportId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(scheduledReportLogs)
    .where(eq(scheduledReportLogs.reportId, reportId))
    .orderBy(desc(scheduledReportLogs.sentAt))
    .limit(limit);
}

export async function createScheduledReportLog(data: InsertScheduledReportLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(scheduledReportLogs).values(data).returning({ id: scheduledReportLogs.id });
  return result.id;
}

export async function getReportsDueForSending() {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  
  return db.select().from(scheduledReports)
    .where(and(
      eq(scheduledReports.isActive, true),
      or(
        isNull(scheduledReports.nextScheduledAt),
        lte(scheduledReports.nextScheduledAt, now)
      )
    ))
    .orderBy(scheduledReports.nextScheduledAt);
}

export async function updateReportNextSchedule(id: number, nextScheduledAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(scheduledReports)
    .set({ 
      nextScheduledAt,
      lastSentAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(scheduledReports.id, id));
}

// ============= SMTP Configuration =============

export async function getSmtpConfig() {
  const db = await getDb();
  if (!db) return null;
  
  const configs = await db.select().from(smtpConfig).limit(1);
  return configs[0] || null;
}

export async function createOrUpdateSmtpConfig(data: Omit<InsertSmtpConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getSmtpConfig();
  
  if (existing) {
    await db.update(smtpConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(smtpConfig.id, existing.id));
    return existing.id;
  } else {
    const [result] = await db.insert(smtpConfig).values(data as any).returning({ id: smtpConfig.id });
    return result.id;
  }
}


// ============ SYSTEM CONFIG FUNCTIONS ============
export async function getAllSystemConfig() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(systemConfig).orderBy(systemConfig.configKey);
}

export async function getSystemConfigByKey(key: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.configKey, key))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateSystemConfig(key: string, value: string, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(systemConfig)
    .set({
      configValue: value,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(systemConfig.configKey, key));
}

export async function createSystemConfig(data: {
  configKey: string;
  configValue: string;
  description?: string;
  dataType?: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
  isEditable?: boolean;
  requiresRestart?: boolean;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(systemConfig).values(data).returning({ id: systemConfig.id });
  return { id: Number(result.id) };
}


// ============ EMAIL TEMPLATE CONFIG FUNCTIONS ============

export async function getEmailTemplateConfigs() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailTemplateConfig).orderBy(desc(emailTemplateConfig.isDefault));
}

export async function getEmailTemplateConfigById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(emailTemplateConfig).where(eq(emailTemplateConfig.id, id)).limit(1);
  return results[0] || null;
}

export async function getDefaultEmailTemplateConfig() {
  const db = await getDb();
  if (!db) return null;
  
  // First try to get the default template
  const defaultResults = await db.select()
    .from(emailTemplateConfig)
    .where(eq(emailTemplateConfig.isDefault, true))
    .limit(1);
  
  if (defaultResults[0]) return defaultResults[0];
  
  // If no default, get the first active one
  const activeResults = await db.select()
    .from(emailTemplateConfig)
    .where(eq(emailTemplateConfig.isActive, true))
    .limit(1);
  
  return activeResults[0] || null;
}

export async function createEmailTemplateConfig(data: InsertEmailTemplateConfig) {
  const db = await getDb();
  if (!db) return null;
  
  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db.update(emailTemplateConfig).set({ isDefault: false });
  }
  
  const [result] = await db.insert(emailTemplateConfig).values(data).returning({ id: emailTemplateConfig.id });
  return { id: Number(result.id) };
}

export async function updateEmailTemplateConfig(id: number, data: Partial<InsertEmailTemplateConfig>) {
  const db = await getDb();
  if (!db) return;
  
  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db.update(emailTemplateConfig).set({ isDefault: false });
  }
  
  await db.update(emailTemplateConfig).set(data).where(eq(emailTemplateConfig.id, id));
}

export async function deleteEmailTemplateConfig(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(emailTemplateConfig).where(eq(emailTemplateConfig.id, id));
}

export async function setDefaultEmailTemplateConfig(id: number) {
  const db = await getDb();
  if (!db) return;
  
  // Unset all defaults
  await db.update(emailTemplateConfig).set({ isDefault: false });
  
  // Set new default
  await db.update(emailTemplateConfig).set({ isDefault: true }).where(eq(emailTemplateConfig.id, id));
}


// ============ NOTIFICATIONS FUNCTIONS ============

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(notifications).values(data).returning({ id: notifications.id });
  return { id: Number(result.id) };
}

export async function getNotifications(userId: number, filters?: {
  type?: 'ALERT' | 'REPORT' | 'SYSTEM' | 'INFO' | 'WARNING' | 'SUCCESS';
  isRead?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(notifications.userId, userId)];
  
  if (filters?.type) {
    conditions.push(eq(notifications.type, filters.type));
  }
  if (filters?.isRead !== undefined) {
    conditions.push(eq(notifications.isRead, filters.isRead));
  }
  
  return db.select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(filters?.limit || 50)
    .offset(filters?.offset || 0);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
  
  return result[0]?.count || 0;
}

export async function markNotificationAsRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(notifications.id, id),
      eq(notifications.userId, userId)
    ));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
}

export async function deleteNotification(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(notifications)
    .where(and(
      eq(notifications.id, id),
      eq(notifications.userId, userId)
    ));
}

export async function deleteOldNotifications(userId: number, daysOld: number = 30) {
  const db = await getDb();
  if (!db) return;
  
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  await db.delete(notifications)
    .where(and(
      eq(notifications.userId, userId),
      lte(notifications.createdAt, cutoffDate)
    ));
}

// Broadcast notification to multiple users
export async function broadcastNotification(userIds: number[], data: Omit<InsertNotification, 'userId'>) {
  const db = await getDb();
  if (!db) return [];
  
  const results: number[] = [];
  for (const userId of userIds) {
    const [result] = await db.insert(notifications).values({ ...data, userId }).returning({ id: notifications.id });
    results.push(Number(result.id));
  }
  return results;
}

// ============ USER NOTIFICATION PREFERENCES ============

export async function getUserNotificationPreferences(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1);
  
  return results[0] || null;
}

export async function upsertUserNotificationPreferences(userId: number, data: Partial<InsertUserNotificationPreference>) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getUserNotificationPreferences(userId);
  
  if (existing) {
    await db.update(userNotificationPreferences)
      .set(data)
      .where(eq(userNotificationPreferences.userId, userId));
  } else {
    await db.insert(userNotificationPreferences).values({ userId, ...data });
  }
}

// =====================================================
// Report Template CRUD Functions
// =====================================================

/**
 * Helper to generate a unique code from a template name
 */
function generateTemplateCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 45) + '_' + Date.now().toString(36).toUpperCase();
}

/**
 * Get all report templates (optionally filter by active only)
 */
export async function getReportTemplates() {
  const db = await getDb();
  if (!db) return [];

  const results = await db.select().from(reportTemplates)
    .where(eq(reportTemplates.isActive, true))
    .orderBy(desc(reportTemplates.createdAt));

  return results;
}

/**
 * Create a report template
 * Maps router fields (type, customization, isDefault) to schema fields (templateType, sections, isSystem)
 */
export async function createReportTemplate(data: {
  name: string;
  type: string;
  sections: Record<string, any>;
  customization?: Record<string, any>;
  isDefault?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const code = generateTemplateCode(data.name);

  // Merge customization into sections if provided
  const sectionsData = {
    includeYieldStats: false,
    includeNGAnalysis: false,
    includeMachineComparison: false,
    includeOEEMetrics: false,
    includeDowntimeAnalysis: false,
    includeTrendCharts: false,
    includeTopNGPoints: false,
    ...data.sections,
    ...(data.customization ? { customization: data.customization } : {}),
  };

  const templateType = (['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'].includes(data.type) ? data.type : 'CUSTOM') as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

  const [result] = await db.insert(reportTemplates).values({
    name: data.name,
    code,
    templateType,
    sections: sectionsData,
    isSystem: data.isDefault ?? false,
    isActive: true,
  }).returning();

  return result;
}

/**
 * Update a report template by ID
 */
export async function updateReportTemplate(id: number, data: {
  name?: string;
  sections?: Record<string, any>;
  customization?: Record<string, any>;
  isDefault?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.isDefault !== undefined) updateData.isSystem = data.isDefault;

  if (data.sections !== undefined) {
    const sectionsData = {
      includeYieldStats: false,
      includeNGAnalysis: false,
      includeMachineComparison: false,
      includeOEEMetrics: false,
      includeDowntimeAnalysis: false,
      includeTrendCharts: false,
      includeTopNGPoints: false,
      ...data.sections,
      ...(data.customization ? { customization: data.customization } : {}),
    };
    updateData.sections = sectionsData;
  }

  await db.update(reportTemplates)
    .set(updateData)
    .where(eq(reportTemplates.id, id));

  return { success: true, id };
}

/**
 * Delete a report template by ID (soft delete - set isActive to false)
 */
export async function deleteReportTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(reportTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(reportTemplates.id, id));

  return { success: true };
}
