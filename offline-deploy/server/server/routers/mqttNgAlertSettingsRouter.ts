/**
 * MQTT NG Alert Settings Router - API endpoints cho quản lý cấu hình NG Alert
 * 
 * Cung cấp:
 * - CRUD cấu hình NG alert cho từng station
 * - Bật/tắt NG alert per station
 * - Tùy chỉnh topic, kênh gửi, QoS
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { mqttNgAlertSettings, stations } from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";

export const mqttNgAlertSettingsRouter = router({

  /**
   * List all NG alert settings (with station info)
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
        filters.push(eq(mqttNgAlertSettings.stationId, input.stationId));
      }
      if (input?.enabledOnly) {
        filters.push(eq(mqttNgAlertSettings.enabled, true));
      }

      const settings = await db.select({
        setting: mqttNgAlertSettings,
        stationName: stations.name,
      })
      .from(mqttNgAlertSettings)
      .leftJoin(stations, eq(mqttNgAlertSettings.stationId, stations.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(mqttNgAlertSettings.stationId));

      return settings.map(s => ({
        ...s.setting,
        stationName: s.stationName || `Station ${s.setting.stationId}`,
      }));
    }),

  /**
   * Get single NG alert setting for a station
   */
  getSetting: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const result = await db.select({
        setting: mqttNgAlertSettings,
        stationName: stations.name,
      })
      .from(mqttNgAlertSettings)
      .leftJoin(stations, eq(mqttNgAlertSettings.stationId, stations.id))
      .where(eq(mqttNgAlertSettings.stationId, input.stationId))
      .limit(1);

      if (result.length === 0) return null;
      return {
        ...result[0].setting,
        stationName: result[0].stationName || `Station ${input.stationId}`,
      };
    }),

  /**
   * Create or update NG alert setting for a station (upsert)
   */
  upsertSetting: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      enabled: z.boolean().default(true),
      topicPattern: z.string().max(500).default("avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors"),
      externalTopicPattern: z.string().max(500).nullable().optional(),
      sendToLocal: z.boolean().default(true),
      sendToExternal: z.boolean().default(true),
      sendFcm: z.boolean().default(true),
      includeImages: z.boolean().default(true),
      includeReferenceImages: z.boolean().default(true),
      includePointImages: z.boolean().default(true),
      includeOverallResult: z.boolean().default(true),
      qos: z.number().min(0).max(2).default(1),
      retain: z.boolean().default(false),
      cooldownSeconds: z.number().min(0).max(86400).default(0),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      const existing = await db.select()
        .from(mqttNgAlertSettings)
        .where(eq(mqttNgAlertSettings.stationId, input.stationId))
        .limit(1);

      let settingId: number;

      if (existing.length > 0) {
        await db.update(mqttNgAlertSettings)
          .set({
            enabled: input.enabled,
            topicPattern: input.topicPattern,
            externalTopicPattern: input.externalTopicPattern || null,
            sendToLocal: input.sendToLocal,
            sendToExternal: input.sendToExternal,
            sendFcm: input.sendFcm,
            includeImages: input.includeImages,
            includeReferenceImages: input.includeReferenceImages,
            includePointImages: input.includePointImages,
            includeOverallResult: input.includeOverallResult,
            qos: input.qos,
            retain: input.retain,
            cooldownSeconds: input.cooldownSeconds,
            updatedAt: new Date(),
          })
          .where(eq(mqttNgAlertSettings.stationId, input.stationId));
        settingId = existing[0].id;
      } else {
        const result = await db.insert(mqttNgAlertSettings)
          .values({
            stationId: input.stationId,
            enabled: input.enabled,
            topicPattern: input.topicPattern,
            externalTopicPattern: input.externalTopicPattern || null,
            sendToLocal: input.sendToLocal,
            sendToExternal: input.sendToExternal,
            sendFcm: input.sendFcm,
            includeImages: input.includeImages,
            includeReferenceImages: input.includeReferenceImages,
            includePointImages: input.includePointImages,
            includeOverallResult: input.includeOverallResult,
            qos: input.qos,
            retain: input.retain,
            cooldownSeconds: input.cooldownSeconds,
          })
          .returning({ id: mqttNgAlertSettings.id });
        settingId = result[0].id;
      }

      return { success: true, id: settingId };
    }),

  /**
   * Delete NG alert setting for a station
   */
  deleteSetting: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      await db.delete(mqttNgAlertSettings)
        .where(eq(mqttNgAlertSettings.stationId, input.stationId));

      return { success: true };
    }),

  /**
   * Toggle NG alert enabled/disabled for a station
   */
  toggleEnabled: protectedProcedure
    .input(z.object({ stationId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      await db.update(mqttNgAlertSettings)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(mqttNgAlertSettings.stationId, input.stationId));

      return { success: true };
    }),

  /**
   * Bulk enable/disable NG alerts for multiple stations
   */
  bulkToggle: protectedProcedure
    .input(z.object({
      stationIds: z.array(z.number()),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;

      for (const stationId of input.stationIds) {
        await db.update(mqttNgAlertSettings)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(eq(mqttNgAlertSettings.stationId, stationId));
      }

      return { success: true, count: input.stationIds.length };
    }),
});
