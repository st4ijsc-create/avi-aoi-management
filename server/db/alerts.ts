import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { eq, desc, and, gte, isNull, or, inArray, sql, type SQL } from "drizzle-orm";
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
  if (!db) throw new DbUnavailableError();
  const [result] = await db.insert(alertSettings).values(data).returning({ id: alertSettings.id });
  return { id: result.id };
}

export async function updateAlertSetting(id: number, data: Partial<InsertAlertSetting>) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.update(alertSettings).set(data).where(eq(alertSettings.id, id));
}

export async function deleteAlertSetting(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
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
  if (!db) throw new DbUnavailableError();
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
  if (!db) throw new DbUnavailableError();
  await db.update(alertHistory).set({
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  }).where(eq(alertHistory.id, id));
}

// ============ Yield Alert Thresholds ============

/** W17b — điều kiện thấy hàng ngưỡng: `factoryIds` null/undefined = toàn quyền (không lọc); mảng = ngưỡng mặc định (NULL) + ngưỡng của các nhà máy đó. */
function thayDuocNguong(factoryIds: number[] | null | undefined): SQL | undefined {
  if (factoryIds == null) return undefined;
  return factoryIds.length === 0 ? isNull(yieldAlertThresholds.factoryId) : or(isNull(yieldAlertThresholds.factoryId), inArray(yieldAlertThresholds.factoryId, factoryIds));
}
/** Lịch sử chỉ của các ngưỡng thấy được (hàng ngưỡng đã xoá ⇒ chỉ toàn quyền thấy). */
function thayDuocLichSu(factoryIds: number[] | null | undefined): SQL | undefined {
  if (factoryIds == null) return undefined;
  const dk = factoryIds.length === 0 ? sql`"factoryId" IS NULL` : sql`("factoryId" IS NULL OR "factoryId" IN (${sql.join(factoryIds.map((n) => sql`${n}`), sql`, `)}))`;
  return sql`${yieldThresholdHistory.thresholdId} IN (SELECT id FROM yield_alert_thresholds WHERE ${dk})`;
}

export async function getYieldAlertThresholds(factoryIds?: number[] | null) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).where(thayDuocNguong(factoryIds)).orderBy(yieldAlertThresholds.metricType, yieldAlertThresholds.id);
}

export async function getYieldAlertThresholdById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
  return results[0] || null;
}

/**
 * Ngưỡng HIỆU LỰC của một metric (W17b): nêu `factoryId` ⇒ hàng riêng của nhà máy đó nếu có, không thì hàng mặc định (NULL); không nêu ⇒ chỉ hàng mặc định (NULL) —
 * KHÔNG bao giờ trả hàng của một nhà máy ngẫu nhiên.
 */
export async function getYieldAlertThresholdByType(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH', factoryId?: number | null) {
  const db = await getDb();
  if (!db) return null;
  if (factoryId != null) {
    const rieng = await db.select().from(yieldAlertThresholds).where(and(eq(yieldAlertThresholds.metricType, metricType), eq(yieldAlertThresholds.factoryId, factoryId))).limit(1);
    if (rieng[0]) return rieng[0];
  }
  const results = await db.select().from(yieldAlertThresholds).where(and(eq(yieldAlertThresholds.metricType, metricType), isNull(yieldAlertThresholds.factoryId))).orderBy(yieldAlertThresholds.id);
  return results[0] || null;
}

/** Đã có ngưỡng riêng của nhà máy này cho metric này chưa (kiểm trùng tầng ứng dụng, W17b). */
export async function coNguongNhaMay(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH', factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const r = await db.select({ id: yieldAlertThresholds.id }).from(yieldAlertThresholds).where(and(eq(yieldAlertThresholds.metricType, metricType), eq(yieldAlertThresholds.factoryId, factoryId))).limit(1);
  return r.length > 0;
}

export async function createYieldAlertThreshold(data: InsertYieldAlertThreshold) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [result] = await db.insert(yieldAlertThresholds).values(data).returning({ id: yieldAlertThresholds.id });
  return result.id;
}

export async function updateYieldAlertThreshold(id: number, data: Partial<InsertYieldAlertThreshold>) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.update(yieldAlertThresholds).set(data).where(eq(yieldAlertThresholds.id, id));
}

export async function deleteYieldAlertThreshold(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.delete(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
}

export async function getEnabledYieldAlertThresholds(factoryIds?: number[] | null) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).where(and(eq(yieldAlertThresholds.isEnabled, true), thayDuocNguong(factoryIds)));
}


// ==================== Yield Threshold History ====================

export async function createYieldThresholdHistory(data: InsertYieldThresholdHistory) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [result] = await db.insert(yieldThresholdHistory).values(data).returning({ id: yieldThresholdHistory.id });
  return { id: Number(result.id), ...data };
}

export async function getYieldThresholdHistoryByThreshold(thresholdId: number, factoryIds?: number[] | null) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(and(eq(yieldThresholdHistory.thresholdId, thresholdId), thayDuocLichSu(factoryIds)))
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

export async function getAllYieldThresholdHistory(limit: number = 100, factoryIds?: number[] | null) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(thayDuocLichSu(factoryIds))
    .orderBy(desc(yieldThresholdHistory.createdAt))
    .limit(limit);
}

export async function getYieldThresholdHistoryWithComparison(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH', days: number = 30, factoryIds?: number[] | null) {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return db.select()
    .from(yieldThresholdHistory)
    .where(
      and(
        eq(yieldThresholdHistory.metricType, metricType),
        gte(yieldThresholdHistory.createdAt, startDate),
        thayDuocLichSu(factoryIds)
      )
    )
    .orderBy(desc(yieldThresholdHistory.createdAt));
}
