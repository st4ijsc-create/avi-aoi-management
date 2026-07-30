/**
 * MQTT NG Rate Threshold Router
 * 
 * API endpoints cho quản lý ngưỡng cảnh báo NG rate theo điểm đo.
 * Khi tỉ lệ NG trong ngày vượt ngưỡng → tự động gửi MQTT alert.
 * 
 * Endpoints:
 * - list: Danh sách threshold configs (filter by station)
 * - getById: Chi tiết 1 threshold
 * - create: Tạo mới threshold
 * - update: Cập nhật threshold
 * - delete: Xóa threshold
 * - toggle: Bật/tắt threshold
 * - alertHistory: Lịch sử alert đã gửi
 * - resolveAlert: Đánh dấu alert đã xử lý
 * - currentNgRates: NG rate hiện tại của station (realtime)
 * - testCheck: Test kiểm tra NG rate (dev/debug)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, adminProcedure, qualityProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  mqttNgRateThresholds,
  mqttNgRateAlertHistory,
  stations,
  machines,
  measurementPointDefs,
  productModels,
  factories,
  workshops,
  productionLines,
} from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte, asc, isNull, or } from "drizzle-orm";
import { getNgRateStatsForStation, checkNgRateAfterInspection } from "../services/ngRateAlertService";

export const ngRateThresholdRouter = router({
  /**
   * List all thresholds (optionally filter by station)
   */
  list: protectedProcedure
    .input(
      z.object({
        stationId: z.number().optional(),
        machineId: z.number().optional(),
        isEnabled: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      const conditions = [];
      if (input?.stationId) conditions.push(eq(mqttNgRateThresholds.stationId, input.stationId));
      if (input?.machineId) conditions.push(eq(mqttNgRateThresholds.machineId, input.machineId));
      if (input?.isEnabled !== undefined) conditions.push(eq(mqttNgRateThresholds.isEnabled, input.isEnabled));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await db
        .select({
          threshold: mqttNgRateThresholds,
          stationName: stations.name,
          machineName: machines.name,
          pointCode: measurementPointDefs.code,
          pointName: measurementPointDefs.name,
          productModelName: productModels.name,
        })
        .from(mqttNgRateThresholds)
        .leftJoin(stations, eq(mqttNgRateThresholds.stationId, stations.id))
        .leftJoin(machines, eq(mqttNgRateThresholds.machineId, machines.id))
        .leftJoin(measurementPointDefs, eq(mqttNgRateThresholds.measurementPointId, measurementPointDefs.id))
        .leftJoin(productModels, eq(mqttNgRateThresholds.productModelId, productModels.id))
        .where(whereClause)
        .orderBy(desc(mqttNgRateThresholds.createdAt));

      return results.map((r) => ({
        ...r.threshold,
        stationName: r.stationName,
        machineName: r.machineName,
        pointCode: r.pointCode,
        pointName: r.pointName,
        productModelName: r.productModelName,
      }));
    }),

  /**
   * Get threshold by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      const result = await db
        .select({
          threshold: mqttNgRateThresholds,
          stationName: stations.name,
          machineName: machines.name,
          pointCode: measurementPointDefs.code,
          pointName: measurementPointDefs.name,
          productModelName: productModels.name,
        })
        .from(mqttNgRateThresholds)
        .leftJoin(stations, eq(mqttNgRateThresholds.stationId, stations.id))
        .leftJoin(machines, eq(mqttNgRateThresholds.machineId, machines.id))
        .leftJoin(measurementPointDefs, eq(mqttNgRateThresholds.measurementPointId, measurementPointDefs.id))
        .leftJoin(productModels, eq(mqttNgRateThresholds.productModelId, productModels.id))
        .where(eq(mqttNgRateThresholds.id, input.id))
        .limit(1);

      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Threshold not found" });
      }

      return {
        ...result[0].threshold,
        stationName: result[0].stationName,
        machineName: result[0].machineName,
        pointCode: result[0].pointCode,
        pointName: result[0].pointName,
        productModelName: result[0].productModelName,
      };
    }),

  /**
   * Create new threshold
   */
  create: qualityProcedure
    .input(
      z.object({
        stationId: z.number(),
        machineId: z.number().nullable().optional(),
        measurementPointId: z.number().nullable().optional(),
        productModelId: z.number().nullable().optional(),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        warningThreshold: z.number().min(0).max(100),
        criticalThreshold: z.number().min(0).max(100),
        minSampleSize: z.number().min(1).default(10),
        cooldownMinutes: z.number().min(1).default(30),
        sendMqttLocal: z.boolean().default(true),
        sendMqttExternal: z.boolean().default(true),
        sendFcm: z.boolean().default(true),
        isEnabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      // Validate: criticalThreshold phải >= warningThreshold
      if (input.criticalThreshold < input.warningThreshold) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ngưỡng nghiêm trọng phải lớn hơn hoặc bằng ngưỡng cảnh báo",
        });
      }

      const [result] = await db
        .insert(mqttNgRateThresholds)
        .values({
          stationId: input.stationId,
          machineId: input.machineId || null,
          measurementPointId: input.measurementPointId || null,
          productModelId: input.productModelId || null,
          name: input.name,
          description: input.description,
          warningThreshold: String(input.warningThreshold),
          criticalThreshold: String(input.criticalThreshold),
          minSampleSize: input.minSampleSize,
          cooldownMinutes: input.cooldownMinutes,
          sendMqttLocal: input.sendMqttLocal,
          sendMqttExternal: input.sendMqttExternal,
          sendFcm: input.sendFcm,
          isEnabled: input.isEnabled,
          createdBy: ctx.user?.id,
        })
        .returning({ id: mqttNgRateThresholds.id });

      return { success: true, id: result.id };
    }),

  /**
   * Update threshold
   */
  update: qualityProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        warningThreshold: z.number().min(0).max(100).optional(),
        criticalThreshold: z.number().min(0).max(100).optional(),
        minSampleSize: z.number().min(1).optional(),
        cooldownMinutes: z.number().min(1).optional(),
        sendMqttLocal: z.boolean().optional(),
        sendMqttExternal: z.boolean().optional(),
        sendFcm: z.boolean().optional(),
        isEnabled: z.boolean().optional(),
        machineId: z.number().nullable().optional(),
        measurementPointId: z.number().nullable().optional(),
        productModelId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      const { id, ...updateData } = input;
      const setData: any = { updatedAt: new Date() };

      if (updateData.name !== undefined) setData.name = updateData.name;
      if (updateData.description !== undefined) setData.description = updateData.description;
      if (updateData.warningThreshold !== undefined) setData.warningThreshold = String(updateData.warningThreshold);
      if (updateData.criticalThreshold !== undefined) setData.criticalThreshold = String(updateData.criticalThreshold);
      if (updateData.minSampleSize !== undefined) setData.minSampleSize = updateData.minSampleSize;
      if (updateData.cooldownMinutes !== undefined) setData.cooldownMinutes = updateData.cooldownMinutes;
      if (updateData.sendMqttLocal !== undefined) setData.sendMqttLocal = updateData.sendMqttLocal;
      if (updateData.sendMqttExternal !== undefined) setData.sendMqttExternal = updateData.sendMqttExternal;
      if (updateData.sendFcm !== undefined) setData.sendFcm = updateData.sendFcm;
      if (updateData.isEnabled !== undefined) setData.isEnabled = updateData.isEnabled;
      if (updateData.machineId !== undefined) setData.machineId = updateData.machineId;
      if (updateData.measurementPointId !== undefined) setData.measurementPointId = updateData.measurementPointId;
      if (updateData.productModelId !== undefined) setData.productModelId = updateData.productModelId;

      // Cross-validate thresholds
      if (updateData.warningThreshold !== undefined || updateData.criticalThreshold !== undefined) {
        const existing = await db
          .select()
          .from(mqttNgRateThresholds)
          .where(eq(mqttNgRateThresholds.id, id))
          .limit(1);
        if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        
        const warning = updateData.warningThreshold ?? Number(existing[0].warningThreshold);
        const critical = updateData.criticalThreshold ?? Number(existing[0].criticalThreshold);
        if (critical < warning) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ngưỡng nghiêm trọng phải lớn hơn hoặc bằng ngưỡng cảnh báo",
          });
        }
      }

      await db
        .update(mqttNgRateThresholds)
        .set(setData)
        .where(eq(mqttNgRateThresholds.id, id));

      return { success: true };
    }),

  /**
   * Delete threshold
   */
  delete: qualityProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      await db.delete(mqttNgRateThresholds).where(eq(mqttNgRateThresholds.id, input.id));
      return { success: true };
    }),

  /**
   * Toggle enabled/disabled
   */
  toggle: qualityProcedure
    .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      await db
        .update(mqttNgRateThresholds)
        .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
        .where(eq(mqttNgRateThresholds.id, input.id));

      return { success: true };
    }),

  /**
   * Get alert history
   */
  alertHistory: protectedProcedure
    .input(
      z.object({
        stationId: z.number().optional(),
        thresholdId: z.number().optional(),
        severity: z.string().optional(),
        isResolved: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      const conditions = [];
      if (input?.stationId) conditions.push(eq(mqttNgRateAlertHistory.stationId, input.stationId));
      if (input?.thresholdId) conditions.push(eq(mqttNgRateAlertHistory.thresholdId, input.thresholdId));
      if (input?.severity) conditions.push(eq(mqttNgRateAlertHistory.severity, input.severity));
      if (input?.isResolved !== undefined) conditions.push(eq(mqttNgRateAlertHistory.isResolved, input.isResolved));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [data, countResult] = await Promise.all([
        db
          .select()
          .from(mqttNgRateAlertHistory)
          .where(whereClause)
          .orderBy(desc(mqttNgRateAlertHistory.triggeredAt))
          .limit(input?.limit || 50)
          .offset(input?.offset || 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(mqttNgRateAlertHistory)
          .where(whereClause),
      ]);

      return {
        data,
        total: Number(countResult[0]?.count || 0),
      };
    }),

  /**
   * Resolve an alert
   */
  resolveAlert: qualityProcedure
    .input(
      z.object({
        id: z.number(),
        resolutionNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      await db
        .update(mqttNgRateAlertHistory)
        .set({
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy: ctx.user?.id,
          resolutionNote: input.resolutionNote,
        })
        .where(eq(mqttNgRateAlertHistory.id, input.id));

      return { success: true };
    }),

  /**
   * Get current NG rate stats for a station (realtime view)
   */
  currentNgRates: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .query(async ({ input }) => {
      return await getNgRateStatsForStation(input.stationId);
    }),

  /**
   * Test: manually trigger NG rate check for a station (for debugging)
   */
  testCheck: adminProcedure
    .input(
      z.object({
        stationId: z.number(),
        machineId: z.number(),
        inspectionId: z.number().default(0),
        productModelId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await checkNgRateAfterInspection({
        stationId: input.stationId,
        machineId: input.machineId,
        inspectionId: input.inspectionId,
        productModelId: input.productModelId,
      });
      return { success: true, message: "NG rate check triggered" };
    }),

  /**
   * Send a test NG Rate Alert with random data - for connectivity testing
   */
  sendTestAlert: adminProcedure
    .input(
      z.object({
        stationId: z.number(),
        severity: z.enum(["warning", "critical"]).default("warning"),
        sendToExternal: z.boolean().default(true),
        sendFcm: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB not available");

      // Get station info with hierarchy
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
        throw new TRPCError({ code: "NOT_FOUND", message: `Station ${input.stationId} không tồn tại` });
      }

      const { station, line, workshop, factory } = stationInfo[0];

      // Get a random machine for this station
      const stationMachines = await db.select()
        .from(machines)
        .where(eq(machines.stationId, input.stationId))
        .limit(5);

      const machine = stationMachines.length > 0
        ? stationMachines[Math.floor(Math.random() * stationMachines.length)]
        : null;

      // Get a random measurement point for this station's product models
      const pointDefs = await db.select()
        .from(measurementPointDefs)
        .limit(20);

      const randomPoint = pointDefs.length > 0
        ? pointDefs[Math.floor(Math.random() * pointDefs.length)]
        : null;

      // Random helpers
      const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
      const randFloat = (min: number, max: number) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const totalInspections = rand(100, 800);
      const warningThreshold = randFloat(3, 8);
      const criticalThreshold = warningThreshold + randFloat(3, 7);
      const triggeredThreshold = input.severity === "critical" ? criticalThreshold : warningThreshold;
      const ngRate = triggeredThreshold + randFloat(0.5, 5);
      const ngCount = Math.round((ngRate / 100) * totalInspections);

      const alertId = `NGRATE-TEST-${dateStr.replace(/-/g, "")}-${Date.now()}`;

      const pointLabel = randomPoint
        ? `điểm đo ${randomPoint.code} (${randomPoint.name})`
        : "tổng thể";

      const message =
        `[${input.severity === "critical" ? "🔴 CRITICAL" : "🟡 WARNING"}] [TEST] ` +
        `Tỉ lệ NG ${pointLabel} đạt ${ngRate.toFixed(2)}% ` +
        `(ngưỡng: ${triggeredThreshold.toFixed(2)}%) - ` +
        `${ngCount}/${totalInspections} sản phẩm NG trong ngày ${dateStr} - ` +
        `Trạm: ${station.name}, Máy: ${machine?.name || "N/A"}`;

      // Build payload matching NgRateAlertPayload interface
      const payload = {
        alertType: "NG_RATE_THRESHOLD" as const,
        alertId,
        timestamp: now.toISOString(),
        severity: input.severity,
        station: {
          id: station.id,
          name: station.name,
          line: line.name,
          workshop: workshop.name,
          factory: factory.name,
        },
        machine: machine ? {
          id: machine.id,
          name: machine.name,
          code: machine.code,
        } : undefined,
        measurementPoint: randomPoint ? {
          id: randomPoint.id,
          code: randomPoint.code,
          name: randomPoint.name,
          referenceImageUrl: randomPoint.referenceImageUrl || undefined,
        } : undefined,
        productModel: randomPoint?.productModelId ? {
          id: randomPoint.productModelId,
          code: `PM-${randomPoint.productModelId}`,
          name: `Product Model ${randomPoint.productModelId}`,
        } : undefined,
        ngRate: {
          current: ngRate,
          threshold: triggeredThreshold,
          totalInspections,
          ngCount,
        },
        thresholdConfig: {
          id: 0,
          name: `[TEST] NG rate ${randomPoint?.code || "overall"} > ${triggeredThreshold.toFixed(1)}%`,
          warningThreshold,
          criticalThreshold,
          minSampleSize: 10,
        },
        message,
        period: {
          date: dateStr,
          from: todayStart.toISOString(),
          to: now.toISOString(),
        },
      };

      // Publish to local MQTT
      const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${input.stationId}/ng-rate-alert`;
      const payloadStr = JSON.stringify(payload);
      let sentLocal = false;
      let sentExternal = false;
      let sentFcm = false;

      try {
        const { isMqttRunning, aedes: localAedes } = await import("../services/mqttService");
        if (isMqttRunning() && localAedes) {
          localAedes.publish({
            topic,
            payload: Buffer.from(payloadStr),
            qos: 1,
            retain: false,
            cmd: "publish",
            dup: false,
          }, (error) => {
            if (error) console.error("[NgRateAlert TEST] MQTT local publish error:", error);
          });
          sentLocal = true;
        }
      } catch (err) {
        console.error("[NgRateAlert TEST] Failed to publish to local MQTT:", err);
      }

      // Publish to external MQTT
      if (input.sendToExternal) {
        try {
          const { publishToExternalMqtt, isExternalMqttConnected } = await import("../services/mqttService");
          if (isExternalMqttConnected()) {
            const externalTopic = `avi-aoi/factory/${factory.id}/workshop/${workshop.id}/station/${input.stationId}/ng-rate-alert`;
            sentExternal = publishToExternalMqtt(externalTopic, payloadStr);
          }
        } catch (err) {
          console.error("[NgRateAlert TEST] Failed to publish to external MQTT:", err);
        }
      }

      // FCM
      if (input.sendFcm) {
        try {
          const { sendNGAlertPushNotification } = await import("../services/fcmService");
          await sendNGAlertPushNotification({
            stationId: input.stationId,
            stationName: station.name,
            machineId: machine?.id || 0,
            machineName: machine?.name || "N/A",
            productCode: randomPoint?.code || "TEST",
            ngCount,
            measurementResults: randomPoint ? [{
              pointName: randomPoint.name || randomPoint.code,
              result: "NG",
              measuredValue: parseFloat(ngRate.toFixed(2)),
            }] : [],
            inspectionId: 0,
          });
          sentFcm = true;
        } catch (err) {
          console.error("[NgRateAlert TEST] Failed to send FCM:", err);
        }
      }

      // Save to alert history with TEST marker
      try {
        await db.insert(mqttNgRateAlertHistory).values({
          thresholdId: 0,
          stationId: input.stationId,
          machineId: machine?.id || null,
          measurementPointId: randomPoint?.id || null,
          pointName: randomPoint?.name || null,
          pointCode: randomPoint?.code || null,
          productModelName: randomPoint?.productModelId ? `Product Model ${randomPoint.productModelId}` : null,
          severity: input.severity,
          currentNgRate: ngRate.toFixed(2),
          thresholdValue: triggeredThreshold.toFixed(2),
          totalInspections,
          ngCount,
          message,
          mqttTopic: topic,
          sentMqttLocal: sentLocal,
          sentMqttExternal: sentExternal,
          sentFcm,
          payload: payload as any,
        });
      } catch (err) {
        console.error("[NgRateAlert TEST] Failed to save history:", err);
      }

      return {
        success: sentLocal || sentExternal,
        alertId,
        payload,
        sentLocal,
        sentExternal,
        sentFcm,
        message: sentLocal || sentExternal
          ? `Đã gửi bản tin NG Rate Alert test cho ${station.name} (NG rate: ${ngRate.toFixed(2)}%, Severity: ${input.severity})`
          : "Gửi bản tin test thất bại - kiểm tra kết nối MQTT",
      };
    }),
});
