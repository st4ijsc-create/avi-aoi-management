import { getDb } from "./connection";
import { eq, and, desc, gte, lte, or, isNull, sql, SQL } from "drizzle-orm";
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
  
  const [result] = await db.insert(auditLogs).values({
    userId: data.userId ?? null,
    userName: data.userName ?? null,
    action: data.action,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    entityName: data.entityName ?? null,
    details: data.details ? JSON.stringify(data.details) : null,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    status: data.status ?? 'success',
  }).returning({ id: auditLogs.id });
  
  return { id: Number(result.id) };
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
  
  const conditions: string[] = [];
  const values: any[] = [];
  
  if (params.userId) {
    conditions.push("userId = ?");
    values.push(params.userId);
  }
  if (params.action) {
    conditions.push("action = ?");
    values.push(params.action);
  }
  if (params.entityType) {
    conditions.push("entityType = ?");
    values.push(params.entityType);
  }
  if (params.entityId) {
    conditions.push("entityId = ?");
    values.push(params.entityId);
  }
  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }
  if (params.startDate) {
    // Quote "createdAt" for PostgreSQL since the column name is mixed-case
    conditions.push('"createdAt" >= ?');
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push('"createdAt" <= ?');
    values.push(params.endDate);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  
  // Build query with parameters (PostgreSQL with quoted column names)
  let countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
  let selectQuery = `SELECT * FROM audit_logs ${whereClause} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`;
  
  // Get total count
  const countResult = await db.execute(sql`${sql.raw(countQuery)}`);
  const total = (countResult as any)[0]?.[0]?.total || 0;
  
  // Get logs
  const logsResult = await db.execute(sql`${sql.raw(selectQuery)}`);
  
  return {
    logs: ((logsResult as any)[0] || []).map((row: any) => ({
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityName: row.entityName,
      details: row.details,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      status: row.status,
      createdAt: new Date(row.createdAt),
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

export async function getScheduledReports(filters?: {
  isActive?: boolean;
  reportType?: string;
  schedule?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(scheduledReports);
  
  const conditions = [];
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

export async function getScheduledReportById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(scheduledReports)
    .where(eq(scheduledReports.id, id))
    .limit(1);
  
  return results[0] || null;
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
