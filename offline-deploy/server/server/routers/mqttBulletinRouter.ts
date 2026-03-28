/**
 * MQTT Bulletin Router - API endpoints cho quản lý bản tin tổng hợp MQTT
 * 
 * Cung cấp:
 * - CRUD cấu hình bulletin cho từng station
 * - Xem lịch sử bulletin đã gửi
 * - Trigger gửi bulletin thủ công
 * - Xem trạng thái scheduler
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { mqttBulletinSettings, mqttBulletinHistory, stations, factories, workshops, productionLines } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte, asc } from "drizzle-orm";
import {
  initBulletinScheduler,
  reloadBulletinForStation,
  triggerBulletinForStation,
  getBulletinSchedulerStatus,
  stopBulletinForStation,
  type BulletinPayload,
} from "../services/mqttBulletinService";
import { publishBulletin } from "../services/mqttService";

export const mqttBulletinRouter = router({

  /**
   * Get all bulletin settings (with station info)
   */
  listSettings: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      enabledOnly: z.boolean().optional().default(false),
    }).optional())
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const filters = [];

      if (input?.stationId) {
        filters.push(eq(mqttBulletinSettings.stationId, input.stationId));
      }
      if (input?.enabledOnly) {
        filters.push(eq(mqttBulletinSettings.enabled, true));
      }

      const settings = await db.select({
        setting: mqttBulletinSettings,
        stationName: stations.name,
      })
      .from(mqttBulletinSettings)
      .leftJoin(stations, eq(mqttBulletinSettings.stationId, stations.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(mqttBulletinSettings.stationId));

      return settings.map(s => ({
        ...s.setting,
        stationName: s.stationName || `Station ${s.setting.stationId}`,
      }));
    }),

  /**
   * Get single bulletin setting for a station
   */
  getSetting: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const result = await db.select({
        setting: mqttBulletinSettings,
        stationName: stations.name,
      })
      .from(mqttBulletinSettings)
      .leftJoin(stations, eq(mqttBulletinSettings.stationId, stations.id))
      .where(eq(mqttBulletinSettings.stationId, input.stationId))
      .limit(1);

      if (result.length === 0) return null;
      return {
        ...result[0].setting,
        stationName: result[0].stationName || `Station ${input.stationId}`,
      };
    }),

  /**
   * Create or update bulletin setting for a station (upsert)
   */
  upsertSetting: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      enabled: z.boolean().default(true),
      intervalMinutes: z.number().min(5).max(1440).default(60),
      scheduleType: z.enum(['interval', 'cron']).default('interval'),
      cronExpression: z.string().nullable().optional(),
      startHour: z.number().min(0).max(23).default(6),
      endHour: z.number().min(1).max(24).default(22),
      includeImages: z.boolean().default(true),
      maxFailPoints: z.number().min(1).max(100).default(20),
      sendToExternal: z.boolean().default(true),
      sendFcm: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      // Check if setting exists
      const existing = await db.select()
        .from(mqttBulletinSettings)
        .where(eq(mqttBulletinSettings.stationId, input.stationId))
        .limit(1);

      let settingId: number;

      if (existing.length > 0) {
        // Update
        await db.update(mqttBulletinSettings)
          .set({
            enabled: input.enabled,
            intervalMinutes: input.intervalMinutes,
            scheduleType: input.scheduleType,
            cronExpression: input.cronExpression || null,
            startHour: input.startHour,
            endHour: input.endHour,
            includeImages: input.includeImages,
            maxFailPoints: input.maxFailPoints,
            sendToExternal: input.sendToExternal,
            sendFcm: input.sendFcm,
            updatedAt: new Date(),
          })
          .where(eq(mqttBulletinSettings.stationId, input.stationId));
        settingId = existing[0].id;
      } else {
        // Insert
        const result = await db.insert(mqttBulletinSettings)
          .values({
            stationId: input.stationId,
            enabled: input.enabled,
            intervalMinutes: input.intervalMinutes,
            scheduleType: input.scheduleType,
            cronExpression: input.cronExpression || null,
            startHour: input.startHour,
            endHour: input.endHour,
            includeImages: input.includeImages,
            maxFailPoints: input.maxFailPoints,
            sendToExternal: input.sendToExternal,
            sendFcm: input.sendFcm,
          })
          .returning({ id: mqttBulletinSettings.id });
        settingId = result[0].id;
      }

      // Reload the scheduler for this station
      await reloadBulletinForStation(input.stationId);

      return { success: true, id: settingId };
    }),

  /**
   * Delete bulletin setting for a station
   */
  deleteSetting: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      stopBulletinForStation(input.stationId);

      await db.delete(mqttBulletinSettings)
        .where(eq(mqttBulletinSettings.stationId, input.stationId));

      return { success: true };
    }),

  /**
   * Toggle bulletin enabled/disabled for a station
   */
  toggleEnabled: protectedProcedure
    .input(z.object({ stationId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      await db.update(mqttBulletinSettings)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(mqttBulletinSettings.stationId, input.stationId));

      await reloadBulletinForStation(input.stationId);

      return { success: true };
    }),

  /**
   * Bulk enable/disable bulletins for multiple stations
   */
  bulkToggle: protectedProcedure
    .input(z.object({
      stationIds: z.array(z.number()),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      for (const stationId of input.stationIds) {
        await db.update(mqttBulletinSettings)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(eq(mqttBulletinSettings.stationId, stationId));
        await reloadBulletinForStation(stationId);
      }

      return { success: true, count: input.stationIds.length };
    }),

  /**
   * Manually trigger bulletin for a station
   */
  triggerNow: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .mutation(async ({ input }) => {
      await triggerBulletinForStation(input.stationId);
      return { success: true, message: `Bulletin triggered for station ${input.stationId}` };
    }),

  /**
   * Get bulletin history for a station
   */
  getHistory: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const filters = [];

      if (input.stationId) {
        filters.push(eq(mqttBulletinHistory.stationId, input.stationId));
      }
      if (input.startDate) {
        filters.push(gte(mqttBulletinHistory.createdAt, new Date(input.startDate)));
      }
      if (input.endDate) {
        filters.push(lte(mqttBulletinHistory.createdAt, new Date(input.endDate)));
      }

      const [items, countResult] = await Promise.all([
        db.select({
          bulletin: mqttBulletinHistory,
          stationName: stations.name,
        })
        .from(mqttBulletinHistory)
        .leftJoin(stations, eq(mqttBulletinHistory.stationId, stations.id))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(mqttBulletinHistory.createdAt))
        .limit(input.limit)
        .offset(input.offset),

        db.select({ count: sql<number>`count(*)` })
        .from(mqttBulletinHistory)
        .where(filters.length > 0 ? and(...filters) : undefined),
      ]);

      return {
        items: items.map(i => ({
          ...i.bulletin,
          stationName: i.stationName || `Station ${i.bulletin.stationId}`,
        })),
        total: Number(countResult[0]?.count || 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get single bulletin detail
   */
  getHistoryDetail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const result = await db.select({
        bulletin: mqttBulletinHistory,
        stationName: stations.name,
      })
      .from(mqttBulletinHistory)
      .leftJoin(stations, eq(mqttBulletinHistory.stationId, stations.id))
      .where(eq(mqttBulletinHistory.id, input.id))
      .limit(1);

      if (result.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bulletin not found' });
      }

      return {
        ...result[0].bulletin,
        stationName: result[0].stationName || `Station ${result[0].bulletin.stationId}`,
      };
    }),

  /**
   * Get scheduler status
   */
  getSchedulerStatus: protectedProcedure
    .query(async () => {
      return getBulletinSchedulerStatus();
    }),

  /**
   * Get bulletin statistics dashboard
   */
  getDashboardStats: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      days: z.number().min(1).max(90).default(7),
    }).optional())
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const daysBack = input?.days || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);
      startDate.setHours(0, 0, 0, 0);

      const filters = [gte(mqttBulletinHistory.createdAt, startDate)];
      if (input?.stationId) {
        filters.push(eq(mqttBulletinHistory.stationId, input.stationId));
      }

      // Overall stats
      const stats = await db.select({
        totalBulletins: sql<number>`COUNT(*)`,
        totalInspections: sql<number>`SUM(${mqttBulletinHistory.totalCount})`,
        totalOK: sql<number>`SUM(${mqttBulletinHistory.okCount})`,
        totalNG: sql<number>`SUM(${mqttBulletinHistory.ngCount})`,
        totalNTF: sql<number>`SUM(${mqttBulletinHistory.ntfCount})`,
        avgYieldRate: sql<number>`AVG(CAST(${mqttBulletinHistory.yieldRate} AS NUMERIC))`,
        deliveredCount: sql<number>`SUM(CASE WHEN ${mqttBulletinHistory.deliveryStatus} = 'DELIVERED' THEN 1 ELSE 0 END)`,
        failedCount: sql<number>`SUM(CASE WHEN ${mqttBulletinHistory.deliveryStatus} = 'FAILED' THEN 1 ELSE 0 END)`,
      })
      .from(mqttBulletinHistory)
      .where(and(...filters));

      // Active settings count
      const activeSettings = await db.select({
        count: sql<number>`count(*)`,
      })
      .from(mqttBulletinSettings)
      .where(eq(mqttBulletinSettings.enabled, true));

      // Recent bulletins by station
      const byStation = await db.select({
        stationId: mqttBulletinHistory.stationId,
        stationName: stations.name,
        bulletinCount: sql<number>`COUNT(*)`,
        avgNG: sql<number>`AVG(${mqttBulletinHistory.ngCount})`,
        lastSent: sql<string>`MAX(${mqttBulletinHistory.createdAt})`,
      })
      .from(mqttBulletinHistory)
      .leftJoin(stations, eq(mqttBulletinHistory.stationId, stations.id))
      .where(and(...filters))
      .groupBy(mqttBulletinHistory.stationId, stations.name)
      .orderBy(desc(sql`COUNT(*)`));

      return {
        summary: {
          totalBulletins: Number(stats[0]?.totalBulletins || 0),
          totalInspections: Number(stats[0]?.totalInspections || 0),
          totalOK: Number(stats[0]?.totalOK || 0),
          totalNG: Number(stats[0]?.totalNG || 0),
          totalNTF: Number(stats[0]?.totalNTF || 0),
          avgYieldRate: stats[0]?.avgYieldRate ? Math.round(Number(stats[0].avgYieldRate) * 100) / 100 : 0,
          deliveredCount: Number(stats[0]?.deliveredCount || 0),
          failedCount: Number(stats[0]?.failedCount || 0),
          activeStations: Number(activeSettings[0]?.count || 0),
        },
        byStation: byStation.map(s => ({
          stationId: s.stationId,
          stationName: s.stationName || `Station ${s.stationId}`,
          bulletinCount: Number(s.bulletinCount),
          avgNG: s.avgNG ? Math.round(Number(s.avgNG) * 100) / 100 : 0,
          lastSent: s.lastSent,
        })),
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days: daysBack,
        },
      };
    }),

  /**
   * Quick setup: Enable bulletin for multiple stations at once
   */
  quickSetup: protectedProcedure
    .input(z.object({
      stationIds: z.array(z.number()).min(1),
      intervalMinutes: z.number().min(5).max(1440).default(60),
      scheduleType: z.enum(['interval', 'cron']).default('interval'),
      cronExpression: z.string().nullable().optional(),
      startHour: z.number().min(0).max(23).default(6),
      endHour: z.number().min(1).max(24).default(22),
      includeImages: z.boolean().default(true),
      maxFailPoints: z.number().min(1).max(100).default(20),
      sendToExternal: z.boolean().default(true),
      sendFcm: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      let created = 0;
      let updated = 0;

      for (const stationId of input.stationIds) {
        const existing = await db.select()
          .from(mqttBulletinSettings)
          .where(eq(mqttBulletinSettings.stationId, stationId))
          .limit(1);

        const configValues = {
          enabled: true,
          intervalMinutes: input.intervalMinutes,
          scheduleType: input.scheduleType,
          cronExpression: input.cronExpression || null,
          startHour: input.startHour,
          endHour: input.endHour,
          includeImages: input.includeImages,
          maxFailPoints: input.maxFailPoints,
          sendToExternal: input.sendToExternal,
          sendFcm: input.sendFcm,
        };

        if (existing.length > 0) {
          await db.update(mqttBulletinSettings)
            .set({ ...configValues, updatedAt: new Date() })
            .where(eq(mqttBulletinSettings.stationId, stationId));
          updated++;
        } else {
          await db.insert(mqttBulletinSettings).values({
            stationId,
            ...configValues,
          });
          created++;
        }

        await reloadBulletinForStation(stationId);
      }

      return { success: true, created, updated, total: input.stationIds.length };
    }),

  /**
   * Send a test bulletin with random data - for connectivity testing
   */
  sendTestBulletin: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      sendToExternal: z.boolean().default(true),
      sendFcm: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      // Get station info
      const stationInfo = await db.select({
        station: stations,
        line: productionLines,
        workshop: workshops,
        factory: factories,
      })
      .from(stations)
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .innerJoin(factories, eq(workshops.factoryId, factories.id))
      .where(eq(stations.id, input.stationId))
      .limit(1);

      if (stationInfo.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Station ${input.stationId} không tồn tại` });
      }

      const { station, line, workshop, factory } = stationInfo[0];
      const now = new Date();
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000); // 1h trước

      // Random helpers
      const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
      const randFloat = (min: number, max: number) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

      const totalCount = rand(200, 1500);
      const ngCount = rand(5, Math.floor(totalCount * 0.1));
      const ntfCount = rand(0, Math.floor(totalCount * 0.03));
      const okCount = totalCount - ngCount - ntfCount;
      const yieldRate = Math.round((okCount / totalCount) * 10000) / 100;

      // Random fail points
      const failPointNames = [
        ['IC U5', 'Thiếu thiếc'], ['R12', 'Lệch vị trí'], ['C45', 'Thiếu linh kiện'],
        ['Q3', 'Ngắn mạch'], ['D7', 'Tombstone'], ['L2', 'Hàn lạnh'],
        ['U8', 'Xoay linh kiện'], ['C22', 'Sai giá trị'], ['R6', 'Không hàn'],
        ['IC U12', 'Cầu thiếc'],
      ];
      const fpCount = rand(2, 6);
      const failPoints = failPointNames.slice(0, fpCount).map((fp, i) => {
        const fpNg = rand(1, Math.max(1, Math.floor(ngCount / fpCount)));
        return {
          pointId: rand(1, 500),
          pointName: `${fp[0]} - ${fp[1]}`,
          pointCode: `FP-${String(rand(1, 200)).padStart(3, '0')}`,
          ngCount: fpNg,
          percentage: Math.round((fpNg / ngCount) * 10000) / 100,
          imageUrl: `/uploads/inspections/test/fail_test_${i + 1}.jpg`,
          latestInspectionId: rand(10000, 99999),
          latestSerialNumber: `SN-TEST-${String(rand(1, 9999)).padStart(4, '0')}`,
        };
      });

      // Random machines
      const machineCount = rand(1, 3);
      const machines = Array.from({ length: machineCount }, (_, i) => {
        const mTotal = Math.floor(totalCount / machineCount) + (i === 0 ? totalCount % machineCount : 0);
        return {
          machineId: rand(1, 20),
          machineName: `AOI Machine ${String(i + 1).padStart(2, '0')}`,
          machineCode: `AOI-${String(i + 1).padStart(2, '0')}`,
          totalCount: mTotal,
          ngCount: rand(1, Math.max(1, Math.floor(mTotal * 0.08))),
        };
      });

      const bulletinId = `BLT-TEST-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}-ST${input.stationId}`;

      const payload: BulletinPayload = {
        bulletinId,
        type: 'PERIODIC_BULLETIN',
        stationId: input.stationId,
        stationName: station.name,
        factoryName: factory.name,
        workshopName: workshop.name,
        lineName: line.name,
        period: {
          start: periodStart.toISOString(),
          end: now.toISOString(),
          intervalMinutes: 60,
        },
        statistics: {
          totalCount,
          okCount,
          ngCount,
          ntfCount,
          yieldRate,
          avgCycleTime: randFloat(1.5, 5.0),
        },
        failPoints,
        machines,
        timestamp: now.toISOString(),
      };

      // Publish via MQTT
      const success = await publishBulletin(input.stationId, payload, {
        sendToExternal: input.sendToExternal,
        sendFcm: input.sendFcm,
      });

      // Save to history with TEST type
      await db.insert(mqttBulletinHistory).values({
        stationId: input.stationId,
        bulletinType: 'PERIODIC',
        periodStart,
        periodEnd: now,
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
        sentViaExternal: success && input.sendToExternal,
        sentViaFcm: success && input.sendFcm,
      });

      return {
        success,
        bulletinId,
        payload,
        message: success
          ? `Đã gửi bản tin test cho ${station.name} (Total: ${totalCount}, OK: ${okCount}, NG: ${ngCount}, NTF: ${ntfCount})`
          : 'Gửi bản tin test thất bại - kiểm tra kết nối MQTT',
      };
    }),
});

