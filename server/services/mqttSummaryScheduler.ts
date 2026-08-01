/**
 * MQTT Summary Scheduler - Tổng hợp lỗi theo ngày/tuần và gửi cho clients
 */

import * as cron from 'node-cron';
// NOTE: this Postgres project's DB handle comes from getDb() (initSummaryScheduler
// below assigns it via `import('../db').then(m => m.getDb())`). The daily/weekly
// summary jobs DO run when MQTT_ENABLED=true (registered in server/_core/index.ts).
// A stray `import { drizzle } from 'drizzle-orm/mysql2'` used to sit here — a
// wrong-driver smell (doc 32 §2 item 20): it was never used (nothing calls
// drizzle()), so it is removed rather than "fixed" to the pg driver.
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { publishSummary, isMqttRunning } from './mqttService';

let db: any = null;
let dailyJob: cron.ScheduledTask | null = null;
let weeklyJob: cron.ScheduledTask | null = null;

/**
 * MON-F14 (doc 40 §11) — RESOLVE the db handle FRESH on every run.
 *
 * Trước đây `db` được gán qua một promise KHÔNG await trong initSummaryScheduler;
 * nếu job cron chạy trước khi promise đó resolve thì `db` còn null → cả run bị bỏ
 * qua âm thầm. ensureDb() await getDb() mỗi lần gọi (getDb tự cache connection nội
 * bộ, nên không mở kết nối mới) → run không bao giờ chạy với handle null nữa.
 */
async function ensureDb(): Promise<any> {
  try {
    const module = await import('../db');
    db = await module.getDb();
  } catch (err) {
    console.error('[MQTT Scheduler] getDb() failed:', (err as any)?.message || err);
  }
  return db;
}

/**
 * MON-F14 — UPSERT idempotent cho một dòng summary.
 *
 * VẤN ĐỀ: insert summary không idempotent → trigger tay + cron trong cùng một ngày
 * ghi 2 bản trùng (cùng summaryType + summaryDate + stationId). FIX: tra dòng hiện có
 * theo bộ ba khoá tự nhiên (summaryType, summaryDate, stationId) → UPDATE nếu đã có,
 * INSERT nếu chưa. Idempotent vì summaryDate luôn được chuẩn hoá về nửa đêm (setHours
 * 0,0,0,0) nên hai run cùng ngày khớp đúng một dòng.
 *
 * LƯU Ý (race): đây là check-then-write ở tầng app — vẫn còn khe TOCTOU nếu trigger tay
 * và cron chạy ĐỒNG THỜI. Muốn race-safe tuyệt đối cần UNIQUE index
 * (summaryType, summaryDate, stationId) + ON CONFLICT DO UPDATE ở tầng DB — cần một
 * migration mới (KHÔNG tự thêm ở đây để tránh trùng số migration); xem mục "blocked".
 */
async function upsertSummary(
  values: typeof schema.mqttErrorSummary.$inferInsert,
): Promise<void> {
  const existing = await db
    .select({ id: schema.mqttErrorSummary.id })
    .from(schema.mqttErrorSummary)
    .where(
      and(
        eq(schema.mqttErrorSummary.summaryType, values.summaryType),
        eq(schema.mqttErrorSummary.summaryDate, values.summaryDate as Date),
        eq(schema.mqttErrorSummary.stationId, values.stationId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    // Recompute → cập nhật số liệu; reset sentToClients để publish lại (được set true
    // sau khi publishSummary thành công, giữ nguyên luồng gửi hiện có).
    await db
      .update(schema.mqttErrorSummary)
      .set({
        totalInspections: values.totalInspections,
        totalNG: values.totalNG,
        totalNTF: values.totalNTF,
        ngRate: values.ngRate,
        topNGPoints: values.topNGPoints,
        sentToClients: false,
      })
      .where(eq(schema.mqttErrorSummary.id, existing[0].id));
  } else {
    await db.insert(schema.mqttErrorSummary).values(values);
  }
}

/**
 * Initialize the summary scheduler
 */
export function initSummaryScheduler() {
  // Warm up the db handle (best-effort); ensureDb() re-resolves it on every run so a
  // run never depends on this fire-and-forget completing first.
  void ensureDb();

  // Daily summary - Run at 6:00 AM every day
  dailyJob = cron.schedule('0 6 * * *', async () => {
    console.log('[MQTT Scheduler] Running daily summary job...');
    await generateAndSendDailySummary();
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  });

  // Weekly summary - Run at 7:00 AM every Monday
  weeklyJob = cron.schedule('0 7 * * 1', async () => {
    console.log('[MQTT Scheduler] Running weekly summary job...');
    await generateAndSendWeeklySummary();
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  });

  console.log('[MQTT Scheduler] Summary scheduler initialized');
}

/**
 * Generate and send daily summary for all stations with NG
 */
export async function generateAndSendDailySummary(): Promise<void> {
  await ensureDb(); // MON-F14: resolve handle fresh mỗi run (không dựa promise init)
  if (!db || !isMqttRunning()) {
    console.log('[MQTT Scheduler] Database or MQTT not available');
    return;
  }

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all stations with inspections yesterday
    const stationsWithNG = await db.select({
      stationId: schema.machines.stationId,
      stationName: schema.stations.name,
      totalInspections: sql<number>`COUNT(DISTINCT ${schema.productInspections.id})`,
      totalNG: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      totalNTF: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(schema.productInspections)
    .innerJoin(schema.machines, eq(schema.productInspections.machineId, schema.machines.id))
    .innerJoin(schema.stations, eq(schema.machines.stationId, schema.stations.id))
    .where(
      and(
        gte(schema.productInspections.inspectionTime, yesterday),
        lte(schema.productInspections.inspectionTime, today)
      )
    )
    .groupBy(schema.machines.stationId, schema.stations.name)
    .having(sql`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) > 0`);

    console.log(`[MQTT Scheduler] Found ${stationsWithNG.length} stations with NG yesterday`);

    for (const station of stationsWithNG) {
      // Get top NG points for this station
      const topNGPoints = await getTopNGPointsForStation(
        station.stationId,
        yesterday,
        today,
        10
      );

      const ngRate = station.totalInspections > 0 
        ? (station.totalNG / station.totalInspections) * 100 
        : 0;

      // Save summary to database (MON-F14: idempotent upsert theo khoá tự nhiên).
      await upsertSummary({
        summaryType: 'DAILY',
        summaryDate: yesterday,
        stationId: station.stationId,
        totalInspections: station.totalInspections,
        totalNG: station.totalNG,
        totalNTF: station.totalNTF,
        ngRate: ngRate.toFixed(2),
        topNGPoints: topNGPoints as any,
        sentToClients: false,
      });

      // Publish to MQTT
      const payload = {
        type: 'DAILY_SUMMARY' as const,
        stationId: station.stationId,
        stationName: station.stationName,
        period: {
          start: yesterday.toISOString(),
          end: today.toISOString(),
        },
        statistics: {
          totalInspections: station.totalInspections,
          totalNG: station.totalNG,
          totalNTF: station.totalNTF,
          ngRate,
        },
        topNGPoints,
        timestamp: new Date().toISOString(),
      };

      const success = await publishSummary(station.stationId, 'DAILY', payload);
      
      if (success) {
        // Update sent status
        await db.update(schema.mqttErrorSummary)
          .set({ sentToClients: true, sentAt: new Date() })
          .where(
            and(
              eq(schema.mqttErrorSummary.stationId, station.stationId),
              eq(schema.mqttErrorSummary.summaryType, 'DAILY'),
              eq(schema.mqttErrorSummary.summaryDate, yesterday)
            )
          );
      }
    }

    console.log('[MQTT Scheduler] Daily summary completed');
  } catch (error) {
    console.error('[MQTT Scheduler] Error generating daily summary:', error);
  }
}

/**
 * Generate and send weekly summary for all stations with NG
 */
export async function generateAndSendWeeklySummary(): Promise<void> {
  await ensureDb(); // MON-F14: resolve handle fresh mỗi run (không dựa promise init)
  if (!db || !isMqttRunning()) {
    console.log('[MQTT Scheduler] Database or MQTT not available');
    return;
  }

  try {
    const lastWeekStart = new Date();
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    lastWeekStart.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all stations with inspections last week
    const stationsWithNG = await db.select({
      stationId: schema.machines.stationId,
      stationName: schema.stations.name,
      totalInspections: sql<number>`COUNT(DISTINCT ${schema.productInspections.id})`,
      totalNG: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      totalNTF: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(schema.productInspections)
    .innerJoin(schema.machines, eq(schema.productInspections.machineId, schema.machines.id))
    .innerJoin(schema.stations, eq(schema.machines.stationId, schema.stations.id))
    .where(
      and(
        gte(schema.productInspections.inspectionTime, lastWeekStart),
        lte(schema.productInspections.inspectionTime, today)
      )
    )
    .groupBy(schema.machines.stationId, schema.stations.name)
    .having(sql`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) > 0`);

    console.log(`[MQTT Scheduler] Found ${stationsWithNG.length} stations with NG last week`);

    for (const station of stationsWithNG) {
      // Get top NG points for this station
      const topNGPoints = await getTopNGPointsForStation(
        station.stationId,
        lastWeekStart,
        today,
        10
      );

      const ngRate = station.totalInspections > 0 
        ? (station.totalNG / station.totalInspections) * 100 
        : 0;

      // Save summary to database (MON-F14: idempotent upsert theo khoá tự nhiên).
      await upsertSummary({
        summaryType: 'WEEKLY',
        summaryDate: lastWeekStart,
        stationId: station.stationId,
        totalInspections: station.totalInspections,
        totalNG: station.totalNG,
        totalNTF: station.totalNTF,
        ngRate: ngRate.toFixed(2),
        topNGPoints: topNGPoints as any,
        sentToClients: false,
      });

      // Publish to MQTT
      const payload = {
        type: 'WEEKLY_SUMMARY' as const,
        stationId: station.stationId,
        stationName: station.stationName,
        period: {
          start: lastWeekStart.toISOString(),
          end: today.toISOString(),
        },
        statistics: {
          totalInspections: station.totalInspections,
          totalNG: station.totalNG,
          totalNTF: station.totalNTF,
          ngRate,
        },
        topNGPoints,
        timestamp: new Date().toISOString(),
      };

      const success = await publishSummary(station.stationId, 'WEEKLY', payload);
      
      if (success) {
        // Update sent status
        await db.update(schema.mqttErrorSummary)
          .set({ sentToClients: true, sentAt: new Date() })
          .where(
            and(
              eq(schema.mqttErrorSummary.stationId, station.stationId),
              eq(schema.mqttErrorSummary.summaryType, 'WEEKLY'),
              eq(schema.mqttErrorSummary.summaryDate, lastWeekStart)
            )
          );
      }
    }

    console.log('[MQTT Scheduler] Weekly summary completed');
  } catch (error) {
    console.error('[MQTT Scheduler] Error generating weekly summary:', error);
  }
}

/**
 * Get top NG measurement points for a station
 */
async function getTopNGPointsForStation(
  stationId: number,
  startDate: Date,
  endDate: Date,
  limit: number
): Promise<Array<{ pointId: number; pointName: string; ngCount: number; percentage: number }>> {
  if (!db) return [];

  try {
    const results = await db.select({
      pointId: schema.measurementResults.pointDefId,
      pointName: schema.measurementPointDefs.name,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(schema.measurementResults)
    .innerJoin(
      schema.productInspections,
      eq(schema.measurementResults.inspectionId, schema.productInspections.id)
    )
    .innerJoin(
      schema.machines,
      eq(schema.productInspections.machineId, schema.machines.id)
    )
    .innerJoin(
      schema.measurementPointDefs,
      eq(schema.measurementResults.pointDefId, schema.measurementPointDefs.id)
    )
    .where(
      and(
        eq(schema.machines.stationId, stationId),
        eq(schema.measurementResults.result, 'NG'),
        gte(schema.productInspections.inspectionTime, startDate),
        lte(schema.productInspections.inspectionTime, endDate)
      )
    )
    .groupBy(schema.measurementResults.pointDefId, schema.measurementPointDefs.name)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit);

    // Calculate percentages
    const totalNG = results.reduce((sum: number, r: any) => sum + r.ngCount, 0);
    
    return results.map((r: any) => ({
      pointId: r.pointId,
      pointName: r.pointName,
      ngCount: r.ngCount,
      percentage: totalNG > 0 ? (r.ngCount / totalNG) * 100 : 0,
    }));
  } catch (error) {
    console.error('[MQTT Scheduler] Error getting top NG points:', error);
    return [];
  }
}

/**
 * Stop the scheduler
 */
export function stopSummaryScheduler(): void {
  if (dailyJob) {
    dailyJob.stop();
    dailyJob = null;
  }
  if (weeklyJob) {
    weeklyJob.stop();
    weeklyJob = null;
  }
  console.log('[MQTT Scheduler] Scheduler stopped');
}

/**
 * Manually trigger daily summary (for testing)
 */
export async function triggerDailySummary(): Promise<void> {
  await generateAndSendDailySummary();
}

/**
 * Manually trigger weekly summary (for testing)
 */
export async function triggerWeeklySummary(): Promise<void> {
  await generateAndSendWeeklySummary();
}
