/**
 * MQTT Bulletin Service - Gửi bản tin tổng hợp OK/NG/NTF/TOTAL 
 * và danh sách điểm đo Fail (kèm ảnh) theo chu kỳ trong ngày cho từng station
 * 
 * Mục đích: Quản lý có thể nắm được tình hình sản xuất real-time qua MQTT
 * 
 * Topic: avi/factory/{fId}/workshop/{wId}/station/{sId}/bulletin/periodic
 */

import * as cron from 'node-cron';
import { eq, and, sql, gte, lte, desc, isNotNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { publishBulletin, isMqttRunning } from './mqttService';

// Types
export interface BulletinPayload {
  bulletinId: string;
  type: 'PERIODIC_BULLETIN';
  stationId: number;
  stationName: string;
  factoryName: string;
  workshopName: string;
  lineName: string;
  period: {
    start: string;
    end: string;
    intervalMinutes: number;
  };
  statistics: {
    totalCount: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    yieldRate: number;
    avgCycleTime?: number;
  };
  failPoints: Array<{
    pointId: number;
    pointName: string;
    pointCode: string;
    ngCount: number;
    percentage: number;
    imageUrl?: string;
    referenceImageUrl?: string;
    latestInspectionId?: number;
    latestSerialNumber?: string;
  }>;
  machines: Array<{
    machineId: number;
    machineName: string;
    machineCode: string;
    totalCount: number;
    ngCount: number;
  }>;
  timestamp: string;
}

interface BulletinSetting {
  id: number;
  stationId: number;
  enabled: boolean;
  intervalMinutes: number;
  scheduleType: string;
  cronExpression: string | null;
  startHour: number;
  endHour: number;
  includeImages: boolean;
  maxFailPoints: number;
  sendToExternal: boolean;
  sendFcm: boolean;
  lastSentAt: Date | null;
}

let db: any = null;
let bulletinIntervals: Map<number, NodeJS.Timeout> = new Map();
let cronJobs: Map<number, cron.ScheduledTask> = new Map();
let isRunning = false;

/**
 * Initialize the bulletin scheduler - called at server startup
 */
export async function initBulletinScheduler(): Promise<void> {
  try {
    const module = await import('../db');
    db = await module.getDb();
    isRunning = true;

    // Load all enabled bulletin settings and start their schedules
    await loadAndStartAllBulletins();

    console.log('[MQTT Bulletin] Bulletin scheduler initialized');
  } catch (error) {
    console.error('[MQTT Bulletin] Error initializing bulletin scheduler:', error);
  }
}

/**
 * Load all enabled bulletin settings from DB and start their scheduled tasks
 */
async function loadAndStartAllBulletins(): Promise<void> {
  if (!db) return;

  try {
    const settings = await db.select()
      .from(schema.mqttBulletinSettings)
      .where(eq(schema.mqttBulletinSettings.enabled, true));

    console.log(`[MQTT Bulletin] Loading ${settings.length} bulletin settings`);

    for (const setting of settings) {
      startBulletinForStation(setting);
    }
  } catch (error) {
    console.error('[MQTT Bulletin] Error loading bulletin settings:', error);
  }
}

/**
 * Start a bulletin schedule for a specific station
 */
export function startBulletinForStation(setting: BulletinSetting): void {
  // Clear existing schedule for this station
  stopBulletinForStation(setting.stationId);

  if (!setting.enabled) return;

  if (setting.scheduleType === 'cron' && setting.cronExpression) {
    // Cron-based schedule
    const job = cron.schedule(setting.cronExpression, async () => {
      await generateAndSendBulletin(setting);
    }, {
      timezone: 'Asia/Ho_Chi_Minh',
    });
    cronJobs.set(setting.stationId, job);
    console.log(`[MQTT Bulletin] Started cron schedule for station ${setting.stationId}: ${setting.cronExpression}`);
  } else {
    // Interval-based schedule
    const intervalMs = setting.intervalMinutes * 60 * 1000;
    const interval = setInterval(async () => {
      await generateAndSendBulletin(setting);
    }, intervalMs);
    bulletinIntervals.set(setting.stationId, interval);
    console.log(`[MQTT Bulletin] Started interval schedule for station ${setting.stationId}: every ${setting.intervalMinutes} minutes`);
  }
}

/**
 * Stop a bulletin schedule for a specific station
 */
export function stopBulletinForStation(stationId: number): void {
  const interval = bulletinIntervals.get(stationId);
  if (interval) {
    clearInterval(interval);
    bulletinIntervals.delete(stationId);
  }

  const job = cronJobs.get(stationId);
  if (job) {
    job.stop();
    cronJobs.delete(stationId);
  }
}

/**
 * Reload a specific station's bulletin schedule (after config changes)
 */
export async function reloadBulletinForStation(stationId: number): Promise<void> {
  if (!db) return;

  stopBulletinForStation(stationId);

  const settings = await db.select()
    .from(schema.mqttBulletinSettings)
    .where(
      and(
        eq(schema.mqttBulletinSettings.stationId, stationId),
        eq(schema.mqttBulletinSettings.enabled, true)
      )
    )
    .limit(1);

  if (settings.length > 0) {
    startBulletinForStation(settings[0]);
  }
}

/**
 * Check if current time is within the station's working hours
 */
function isWithinWorkingHours(startHour: number, endHour: number): boolean {
  const now = new Date();
  // Convert to Vietnam timezone
  const vietnamTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const currentHour = vietnamTime.getHours();
  
  if (startHour <= endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  // Handle overnight case (e.g., startHour=22, endHour=6)
  return currentHour >= startHour || currentHour < endHour;
}

/**
 * Generate and send periodic bulletin for a station
 */
export async function generateAndSendBulletin(setting: BulletinSetting): Promise<boolean> {
  if (!db || !isMqttRunning()) {
    console.log('[MQTT Bulletin] Database or MQTT not available');
    return false;
  }

  // Check working hours
  if (!isWithinWorkingHours(setting.startHour, setting.endHour)) {
    console.log(`[MQTT Bulletin] Station ${setting.stationId} outside working hours (${setting.startHour}:00 - ${setting.endHour}:00)`);
    return false;
  }

  try {
    const now = new Date();
    const periodStart = setting.lastSentAt || new Date(now.getTime() - setting.intervalMinutes * 60 * 1000);
    const periodEnd = now;

    // Get station hierarchy info
    const stationInfo = await db.select({
      station: schema.stations,
      line: schema.productionLines,
      workshop: schema.workshops,
      factory: schema.factories,
    })
    .from(schema.stations)
    .innerJoin(schema.productionLines, eq(schema.stations.lineId, schema.productionLines.id))
    .innerJoin(schema.workshops, eq(schema.productionLines.workshopId, schema.workshops.id))
    .innerJoin(schema.factories, eq(schema.workshops.factoryId, schema.factories.id))
    .where(eq(schema.stations.id, setting.stationId))
    .limit(1);

    if (stationInfo.length === 0) {
      console.log(`[MQTT Bulletin] Station ${setting.stationId} not found`);
      return false;
    }

    const { station, line, workshop, factory } = stationInfo[0];

    // Get inspection statistics for the period grouped by machine
    const machineStats = await db.select({
      machineId: schema.machines.id,
      machineName: schema.machines.name,
      machineCode: schema.machines.code,
      totalCount: sql<number>`COUNT(DISTINCT ${schema.productInspections.id})`,
      okCount: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(schema.productInspections)
    .innerJoin(schema.machines, eq(schema.productInspections.machineId, schema.machines.id))
    .where(
      and(
        eq(schema.machines.stationId, setting.stationId),
        gte(schema.productInspections.inspectionTime, periodStart),
        lte(schema.productInspections.inspectionTime, periodEnd)
      )
    )
    .groupBy(schema.machines.id, schema.machines.name, schema.machines.code);

    // Aggregate totals
    const totalCount = machineStats.reduce((sum: number, m: any) => sum + (Number(m.totalCount) || 0), 0);
    const okCount = machineStats.reduce((sum: number, m: any) => sum + (Number(m.okCount) || 0), 0);
    const ngCount = machineStats.reduce((sum: number, m: any) => sum + (Number(m.ngCount) || 0), 0);
    const ntfCount = machineStats.reduce((sum: number, m: any) => sum + (Number(m.ntfCount) || 0), 0);
    const yieldRate = totalCount > 0 ? (okCount / totalCount) * 100 : 100;

    // Get average cycle time
    const cycleTimeResult = await db.select({
      avgCycleTime: sql<number>`AVG(${schema.productInspections.cycleTime})`,
    })
    .from(schema.productInspections)
    .innerJoin(schema.machines, eq(schema.productInspections.machineId, schema.machines.id))
    .where(
      and(
        eq(schema.machines.stationId, setting.stationId),
        gte(schema.productInspections.inspectionTime, periodStart),
        lte(schema.productInspections.inspectionTime, periodEnd),
        isNotNull(schema.productInspections.cycleTime)
      )
    );

    const avgCycleTime = cycleTimeResult[0]?.avgCycleTime ? Number(cycleTimeResult[0].avgCycleTime) : undefined;

    // Get fail (NG) measurement points with images
    const failPointsQuery = await db.select({
      pointId: schema.measurementResults.pointDefId,
      pointName: schema.measurementPointDefs.name,
      pointCode: schema.measurementPointDefs.code,
      referenceImageUrl: schema.measurementPointDefs.referenceImageUrl,
      ngCount: sql<number>`COUNT(*)`,
      imageUrl: sql<string>`MAX(${schema.measurementResults.imageUrl})`,
      latestInspectionId: sql<number>`MAX(${schema.productInspections.id})`,
      latestSerialNumber: sql<string>`MAX(${schema.productInspections.serialNumber})`,
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
    .leftJoin(
      schema.measurementPointDefs,
      eq(schema.measurementResults.pointDefId, schema.measurementPointDefs.id)
    )
    .where(
      and(
        eq(schema.machines.stationId, setting.stationId),
        eq(schema.measurementResults.result, 'NG'),
        gte(schema.productInspections.inspectionTime, periodStart),
        lte(schema.productInspections.inspectionTime, periodEnd)
      )
    )
    .groupBy(
      schema.measurementResults.pointDefId,
      schema.measurementPointDefs.name,
      schema.measurementPointDefs.code,
      schema.measurementPointDefs.referenceImageUrl
    )
    .orderBy(desc(sql`COUNT(*)`))
    .limit(setting.maxFailPoints);

    // Calculate NG point percentages
    const totalNGPoints = failPointsQuery.reduce((sum: number, r: any) => sum + (Number(r.ngCount) || 0), 0);
    
    const failPoints = failPointsQuery.map((r: any) => ({
      pointId: r.pointId || 0,
      pointName: r.pointName || 'Unknown',
      pointCode: r.pointCode || 'Unknown',
      ngCount: Number(r.ngCount) || 0,
      percentage: totalNGPoints > 0 ? ((Number(r.ngCount) || 0) / totalNGPoints) * 100 : 0,
      imageUrl: setting.includeImages ? r.imageUrl : undefined,
      referenceImageUrl: r.referenceImageUrl || undefined,
      latestInspectionId: r.latestInspectionId ? Number(r.latestInspectionId) : undefined,
      latestSerialNumber: r.latestSerialNumber || undefined,
    }));

    // Build bulletin ID
    const bulletinId = `BLT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}-ST${setting.stationId}`;

    // Build payload
    const payload: BulletinPayload = {
      bulletinId,
      type: 'PERIODIC_BULLETIN',
      stationId: setting.stationId,
      stationName: station.name,
      factoryName: factory.name,
      workshopName: workshop.name,
      lineName: line.name,
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        intervalMinutes: setting.intervalMinutes,
      },
      statistics: {
        totalCount,
        okCount,
        ngCount,
        ntfCount,
        yieldRate: Math.round(yieldRate * 100) / 100,
        avgCycleTime: avgCycleTime ? Math.round(avgCycleTime * 100) / 100 : undefined,
      },
      failPoints,
      machines: machineStats.map((m: any) => ({
        machineId: m.machineId,
        machineName: m.machineName,
        machineCode: m.machineCode,
        totalCount: Number(m.totalCount) || 0,
        ngCount: Number(m.ngCount) || 0,
      })),
      timestamp: now.toISOString(),
    };

    // Publish via MQTT
    const success = await publishBulletin(setting.stationId, payload, {
      sendToExternal: setting.sendToExternal,
      sendFcm: setting.sendFcm,
    });

    // Save to bulletin history
    await db.insert(schema.mqttBulletinHistory).values({
      stationId: setting.stationId,
      bulletinType: 'PERIODIC',
      periodStart,
      periodEnd,
      totalCount,
      okCount,
      ngCount,
      ntfCount,
      yieldRate: yieldRate.toFixed(2),
      failPoints: failPoints as any,
      payload: payload as any,
      deliveryStatus: success ? 'DELIVERED' : 'FAILED',
      deliveredAt: success ? now : null,
      sentViaLocal: success,
      sentViaExternal: success && setting.sendToExternal,
      sentViaFcm: success && setting.sendFcm,
    });

    // Update lastSentAt
    await db.update(schema.mqttBulletinSettings)
      .set({ lastSentAt: now, updatedAt: now })
      .where(eq(schema.mqttBulletinSettings.id, setting.id));

    console.log(`[MQTT Bulletin] Sent bulletin for station ${setting.stationId}: TOTAL=${totalCount} OK=${okCount} NG=${ngCount} NTF=${ntfCount} FailPoints=${failPoints.length}`);
    return success;
  } catch (error) {
    console.error(`[MQTT Bulletin] Error generating bulletin for station ${setting.stationId}:`, error);
    return false;
  }
}

/**
 * Manually trigger bulletin for a station (for testing / on-demand)
 */
export async function triggerBulletinForStation(stationId: number): Promise<BulletinPayload | null> {
  if (!db) return null;

  const settings = await db.select()
    .from(schema.mqttBulletinSettings)
    .where(eq(schema.mqttBulletinSettings.stationId, stationId))
    .limit(1);

  if (settings.length === 0) {
    // Use default settings
    const defaultSetting: BulletinSetting = {
      id: 0,
      stationId,
      enabled: true,
      intervalMinutes: 60,
      scheduleType: 'interval',
      cronExpression: null,
      startHour: 0,
      endHour: 24,
      includeImages: true,
      maxFailPoints: 20,
      sendToExternal: true,
      sendFcm: true,
      lastSentAt: new Date(Date.now() - 60 * 60 * 1000), // Last hour
    };
    await generateAndSendBulletin(defaultSetting);
    return null;
  }

  // Temporarily override working hours for manual trigger
  const setting = { ...settings[0], startHour: 0, endHour: 24 };
  await generateAndSendBulletin(setting);
  return null;
}

/**
 * Get the status of all bulletin schedules
 */
export function getBulletinSchedulerStatus(): {
  isRunning: boolean;
  activeIntervals: number;
  activeCronJobs: number;
  stations: Array<{ stationId: number; type: 'interval' | 'cron' }>;
} {
  const stations: Array<{ stationId: number; type: 'interval' | 'cron' }> = [];
  
  bulletinIntervals.forEach((_, stationId) => {
    stations.push({ stationId, type: 'interval' });
  });
  cronJobs.forEach((_, stationId) => {
    stations.push({ stationId, type: 'cron' });
  });

  return {
    isRunning,
    activeIntervals: bulletinIntervals.size,
    activeCronJobs: cronJobs.size,
    stations,
  };
}

/**
 * Stop all bulletin schedules
 */
export function stopBulletinScheduler(): void {
  bulletinIntervals.forEach((_, stationId) => {
    stopBulletinForStation(stationId);
  });
  cronJobs.forEach((_, stationId) => {
    stopBulletinForStation(stationId);
  });
  isRunning = false;
  console.log('[MQTT Bulletin] Bulletin scheduler stopped');
}
