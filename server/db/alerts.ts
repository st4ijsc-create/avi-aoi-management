import { getDb } from "./connection";
import { eq, desc, and, gte, isNull, type SQL } from "drizzle-orm";
import {
  alertSettings,
  type InsertAlertSetting,
  alertHistory,
  type InsertAlertHistory,
  yieldAlertThresholds,
  type InsertYieldAlertThreshold,
  yieldThresholdHistory,
  type InsertYieldThresholdHistory,
} from "../../drizzle/schema";

// ============ ALERT SETTINGS FUNCTIONS ============
export async function getAlertSettings(userId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (userId) {
    return db.select().from(alertSettings)
      .where(eq(alertSettings.userId, userId))
      .orderBy(desc(alertSettings.createdAt));
  }
  return db.select().from(alertSettings)
    .orderBy(desc(alertSettings.createdAt));
}

export async function getAlertSettingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(alertSettings)
    .where(eq(alertSettings.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createAlertSetting(data: InsertAlertSetting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(alertSettings).values(data).returning({ id: alertSettings.id });
  return { id: result.id };
}

export async function updateAlertSetting(id: number, data: Partial<InsertAlertSetting>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertSettings).set(data).where(eq(alertSettings.id, id));
}

export async function deleteAlertSetting(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(alertSettings).where(eq(alertSettings.id, id));
}

/**
 * doc 67 W3 (việc 6): `onlyOpen` lọc acknowledged_at IS NULL Ở SERVER.
 * Trước đây console lấy 50 bản MỚI NHẤT rồi client lọc đã-ack → nếu 50 bản gần
 * nhất đều đã ack thì breach mở CŨ hơn biến mất khỏi console (mất cảnh báo).
 * Với onlyOpen=true, limit áp lên đúng tập "đang mở" nên breach mở cũ vẫn hiện.
 */
export async function getAlertHistory(alertSettingId?: number, limit: number = 50, onlyOpen?: boolean) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  if (alertSettingId) conditions.push(eq(alertHistory.alertSettingId, alertSettingId));
  if (onlyOpen) conditions.push(isNull(alertHistory.acknowledgedAt));

  const base = db.select().from(alertHistory);
  const query = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return query.orderBy(desc(alertHistory.createdAt)).limit(limit);
}

export async function createAlertHistory(data: InsertAlertHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(alertHistory).values(data).returning({ id: alertHistory.id });
  return { id: result.id };
}

// Read-only getter for a single alert-history row. Used by the AI Copilot
// acknowledge_alert write-tool preview (dry-run, no mutation).
export async function getAlertHistoryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(alertHistory).where(eq(alertHistory.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function acknowledgeAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertHistory).set({
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  }).where(eq(alertHistory.id, id));
}

// ============ Yield Alert Thresholds ============

export async function getYieldAlertThresholds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).orderBy(yieldAlertThresholds.metricType);
}

export async function getYieldAlertThresholdById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
  return results[0] || null;
}

export async function getYieldAlertThresholdByType(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH') {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.metricType, metricType));
  return results[0] || null;
}

export async function createYieldAlertThreshold(data: InsertYieldAlertThreshold) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(yieldAlertThresholds).values(data).returning({ id: yieldAlertThresholds.id });
  return result.id;
}

export async function updateYieldAlertThreshold(id: number, data: Partial<InsertYieldAlertThreshold>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(yieldAlertThresholds).set(data).where(eq(yieldAlertThresholds.id, id));
}

export async function deleteYieldAlertThreshold(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
}

export async function getEnabledYieldAlertThresholds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.isEnabled, true));
}


// ==================== Yield Threshold History ====================

export async function createYieldThresholdHistory(data: InsertYieldThresholdHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(yieldThresholdHistory).values(data).returning({ id: yieldThresholdHistory.id });
  return { id: Number(result.id), ...data };
}

export async function getYieldThresholdHistoryByThreshold(thresholdId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(eq(yieldThresholdHistory.thresholdId, thresholdId))
    .orderBy(desc(yieldThresholdHistory.createdAt));
}

export async function getYieldThresholdHistoryByType(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH') {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(eq(yieldThresholdHistory.metricType, metricType))
    .orderBy(desc(yieldThresholdHistory.createdAt));
}

export async function getAllYieldThresholdHistory(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .orderBy(desc(yieldThresholdHistory.createdAt))
    .limit(limit);
}

export async function getYieldThresholdHistoryWithComparison(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH', days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return db.select()
    .from(yieldThresholdHistory)
    .where(
      and(
        eq(yieldThresholdHistory.metricType, metricType),
        gte(yieldThresholdHistory.createdAt, startDate)
      )
    )
    .orderBy(desc(yieldThresholdHistory.createdAt));
}
