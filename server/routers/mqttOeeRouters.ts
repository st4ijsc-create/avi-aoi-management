/**
 * MQTT Client, OEE Target, and MQTT Alert Routers
 * Extracted from server/routers.ts lines 3859-4597
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import * as db from "../db";

// ============================================================
// MQTT Client Router (lines 3859-4379)
// ============================================================
export const mqttClientRouter = router({
  // List all MQTT clients with optional filters
  list: protectedProcedure
    .input(z.object({
      approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      connectionStatus: z.enum(['ONLINE', 'OFFLINE', 'DISCONNECTED']).optional(),
      stationId: z.number().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttClients(input);
    }),

  // Get single client by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMqttClientById(input.id);
    }),

  // Get pending approval count
  pendingCount: protectedProcedure.query(async () => {
    const clients = await db.getMqttClients({ approvalStatus: 'PENDING' });
    return { count: clients.length };
  }),

  // Approve client registration
  approve: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.approveMqttClient(input.id, ctx.user.id, input.stationId, input.mappingType);
      return { success: true };
    }),

  // Reject client registration
  reject: adminProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.rejectMqttClient(input.id, input.reason);
      return { success: true };
    }),

  // Update client mapping (station assignment)
  updateMapping: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().nullable(),
      processId: z.number().nullable().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
      autoReconnect: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMqttClientMapping(id, data);
      return { success: true };
    }),

  // Update client settings
  updateSettings: adminProcedure
    .input(z.object({
      id: z.number(),
      deviceName: z.string().optional(),
      receiveNGAlerts: z.boolean().optional(),
      receiveDailySummary: z.boolean().optional(),
      receiveWeeklySummary: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMqttClientSettings(id, data);
      return { success: true };
    }),

  // Delete client
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMqttClient(input.id);
      return { success: true };
    }),

  // Disconnect and reset mapping
  disconnectAndReset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.disconnectAndResetMqttClient(input.id);
      return { success: true };
    }),

  // Get MQTT status
  status: protectedProcedure.query(async () => {
    const { isMqttRunning, getConnectedClientsCount, getExternalMqttInfo } = await import('../services/mqttService');
    return {
      enabled: isMqttRunning(),
      connectedClients: getConnectedClientsCount(),
      external: getExternalMqttInfo(),
    };
  }),

  // Get error summaries
  errorSummaries: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      summaryType: z.enum(['DAILY', 'WEEKLY']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttErrorSummaries(input);
    }),

  // Get message logs
  messageLogs: protectedProcedure
    .input(z.object({
      clientId: z.number().optional(),
      stationId: z.number().optional(),
      messageType: z.enum(['NG_ALERT', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'CUSTOM']).optional(),
      limit: z.number().default(100),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttMessageLogs(input);
    }),

  // Manually trigger summary (for testing)
  triggerSummary: adminProcedure
    .input(z.object({
      type: z.enum(['DAILY', 'WEEKLY']),
    }))
    .mutation(async ({ input }) => {
      const { triggerDailySummary, triggerWeeklySummary } = await import('../services/mqttSummaryScheduler');
      if (input.type === 'DAILY') {
        await triggerDailySummary();
      } else {
        await triggerWeeklySummary();
      }
      return { success: true };
    }),

  // Dashboard statistics
  dashboardStats: protectedProcedure.query(async () => {
    return db.getMqttDashboardStats();
  }),

  // Message trend for charts
  messageTrend: protectedProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ input }) => {
      return db.getMqttMessageTrend(input?.days || 7);
    }),

  // Recent messages for activity feed
  recentMessages: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      return db.getRecentMqttMessages(input?.limit || 20);
    }),

  // Update FCM token for push notifications
  updateFcmToken: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      fcmToken: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateMqttClientFcmToken(input.clientId, input.fcmToken);
      return { success: true };
    }),

  // Test NG Alert - Simulate NG inspection for testing MQTT publish
  testNGAlert: protectedProcedure
    .input(z.object({
      machineName: z.string().optional(),
      machineId: z.number().optional(),
      stationId: z.number().optional(),
      serialNumber: z.string().optional(),
      ngPointName: z.string().optional(),
      ngValue: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { publishNGAlert, publishToExternalMqtt, isMqttRunning } = await import('../services/mqttService');
      
      // Get a real station from database if not provided
      let stationId = input.stationId;
      if (!stationId) {
        const stationList = await db.getStations();
        if (stationList.length > 0) {
          stationId = stationList[0].id;
        } else {
          stationId = 1; // Fallback
        }
      }
      
      const testData = {
        machineId: input.machineId || 1,
        machineName: input.machineName || 'Test Machine',
        machineCode: 'TEST',
        stationId,
        stationName: 'Test Station',
        serialNumber: input.serialNumber || `SN-${Date.now()}`,
        // Use a clamped inspectionId so it always fits
        // into a 32-bit integer column in PostgreSQL
        inspectionId: Date.now() % 2147483647,
        timestamp: new Date(),
        measurementResults: [{
          pointCode: input.ngPointName || 'Test Point',
          result: 'NG' as const,
          value: input.ngValue || 0.5,
        }],
      };
      
      // Publish to local broker
      const localResult = await publishNGAlert(testData);
      
      // Also publish to external broker
      const externalTopic = `avi-aoi/factory/1/station/${stationId}/ng-alert`;
      const externalPayload = JSON.stringify({
        type: 'NG_ALERT_TEST',
        ...testData,
        timestamp: testData.timestamp.toISOString(),
      });
      publishToExternalMqtt(externalTopic, externalPayload);
      
      return { 
        success: true, 
        message: `NG Alert published (Local: ${localResult ? 'OK' : 'Failed'}, External: sent)`,
        data: testData,
        mqttEnabled: isMqttRunning(),
      };
    }),

  // Realtime MQTT statistics for monitoring dashboard
  realtimeStats: protectedProcedure.query(async () => {
    const { getExternalMqttInfo, isMqttRunning } = await import('../services/mqttService');
    
    // Get message stats from last hour for throughput calculation
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    
    // Get message counts
    const [hourlyStats, fiveMinStats, oneMinStats] = await Promise.all([
      db.getMqttMessageCountSince(oneHourAgo),
      db.getMqttMessageCountSince(fiveMinAgo),
      db.getMqttMessageCountSince(oneMinAgo),
    ]);
    
    // Calculate throughput (messages per minute)
    const throughputPerHour = hourlyStats.total / 60;
    const throughputPer5Min = fiveMinStats.total / 5;
    const throughputPerMin = oneMinStats.total;
    
    // Get latency stats
    const latencyStats = await db.getMqttLatencyStats();
    
    // Get external MQTT info
    const externalInfo = getExternalMqttInfo();
    
    return {
      localBroker: {
        enabled: isMqttRunning(),
        port: 1883,
      },
      externalBroker: {
        enabled: externalInfo.enabled,
        broker: externalInfo.broker,
        port: externalInfo.port,
        connected: externalInfo.connected,
        useTLS: externalInfo.useTLS,
        hasCredentials: externalInfo.hasCredentials,
      },
      throughput: {
        lastMinute: throughputPerMin,
        last5Minutes: Math.round(throughputPer5Min * 100) / 100,
        lastHour: Math.round(throughputPerHour * 100) / 100,
      },
      latency: {
        avgMs: latencyStats.avgMs || 0,
        minMs: latencyStats.minMs || 0,
        maxMs: latencyStats.maxMs || 0,
        p95Ms: latencyStats.p95Ms || 0,
      },
      messages: {
        lastMinute: oneMinStats,
        last5Minutes: fiveMinStats,
        lastHour: hourlyStats,
      },
      timestamp: new Date(),
    };
  }),

  // Throughput history for line chart (last 60 minutes by default)
  throughputHistory: protectedProcedure
    .input(z.object({ minutes: z.number().default(60) }).optional())
    .query(async ({ input }) => {
      return db.getMqttThroughputHistory(input?.minutes || 60);
    }),

  // ============ MQTT MESSAGE REPLAY ============
  messageHistory: protectedProcedure
    .input(z.object({
      topic: z.string().optional(),
      machineCode: z.string().optional(),
      startTime: z.date().optional(),
      endTime: z.date().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ input }) => {
      const { getMqttMessageHistory } = await import('../_core/socket');
      return getMqttMessageHistory(input);
    }),

  // ============ MACHINE AUTO-DISCOVERY ============
  discoveredMachines: protectedProcedure.query(async () => {
    const { getDiscoveredMachines } = await import('../_core/socket');
    return getDiscoveredMachines();
  }),

  // ============ OEE CALCULATION ============
  calculateOEE: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      plannedTime: z.number(), // minutes
      runTime: z.number(), // minutes
      idealCycleTime: z.number(), // seconds per unit
      totalCount: z.number(),
      goodCount: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { calculateOEE } = await import('../_core/socket');
      return calculateOEE(input.machineId, input.machineCode, {
        plannedTime: input.plannedTime,
        runTime: input.runTime,
        idealCycleTime: input.idealCycleTime,
        totalCount: input.totalCount,
        goodCount: input.goodCount,
      });
    }),

  getMachineOEE: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getMachineOEE } = await import('../_core/socket');
      return getMachineOEE(input.machineId);
    }),

  getAllOEE: protectedProcedure.query(async () => {
    const { getAllMachinesOEE } = await import('../_core/socket');
    return getAllMachinesOEE();
  }),

  // ============ DOWNTIME TRACKING ============
  startDowntime: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      category: z.enum(['planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other']),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { startDowntime } = await import('../_core/socket');
      return startDowntime(input.machineId, input.machineCode, input.category, input.reason, ctx.user?.name ?? undefined);
    }),

  endDowntime: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { endDowntime } = await import('../_core/socket');
      return endDowntime(input.machineId, input.notes);
    }),

  getActiveDowntime: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getActiveDowntime } = await import('../_core/socket');
      return getActiveDowntime(input.machineId);
    }),

  getDowntimeHistory: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      category: z.enum(['planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { getDowntimeHistory } = await import('../_core/socket');
      return getDowntimeHistory(input);
    }),

  // ============ PREDICTIVE MAINTENANCE ============
  calculateMachineHealth: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      oee: z.number().optional(),
      uptime: z.number().optional(),
      errorRate: z.number().optional(),
      cycleTimeVariance: z.number().optional(),
      downtimeFrequency: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { calculateMachineHealth } = await import('../_core/socket');
      return calculateMachineHealth(input.machineId, input.machineCode, {
        oee: input.oee,
        uptime: input.uptime,
        errorRate: input.errorRate,
        cycleTimeVariance: input.cycleTimeVariance,
        downtimeFrequency: input.downtimeFrequency,
      });
    }),

  getMachineHealth: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getMachineHealthScore } = await import('../_core/socket');
      return getMachineHealthScore(input.machineId);
    }),

  // ============ MQTT CLIENT MANUAL CREATE ============
  create: adminProcedure
    .input(z.object({
      deviceId: z.string(),
      deviceName: z.string(),
      deviceType: z.string().optional(),
      stationId: z.number().optional(),
      processId: z.number().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).default('MANUAL'),
      receiveNGAlerts: z.boolean().default(true),
      receiveDailySummary: z.boolean().default(true),
      receiveWeeklySummary: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.createMqttClient({
        ...input,
        approvalStatus: 'APPROVED',
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
        connectionStatus: 'OFFLINE',
        isActive: true,
      });
    }),

  // ============ CLIENT CONNECTION HISTORY ============
  connectionHistory: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      return db.getMqttClientConnectionHistory(input.clientId, input.limit);
    }),

  // ============ CLIENT HEALTH DASHBOARD ============
  clientHealth: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      return db.getMqttClientHealth(input.clientId);
    }),

  allClientsHealth: protectedProcedure.query(async () => {
    return db.getAllMqttClientsHealth();
  }),

  // ============ WORKSTATION ERROR DISPLAY ============
  workstationErrors: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      machineId: z.number().optional(),
      limit: z.number().default(50),
      includeResolved: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      return db.getWorkstationErrors(input);
    }),

  workstationErrorSummary: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getWorkstationErrorSummary(input);
    }),

  // ============ MACHINE BENCHMARKING ============
  calculateBenchmarks: protectedProcedure
    .input(z.object({
      machines: z.array(z.object({
        machineId: z.number(),
        machineCode: z.string(),
        lineId: z.number(),
        oee: z.number(),
        yield: z.number(),
        cycleTime: z.number(),
        output: z.number(),
        downtime: z.number(),
        errors: z.number(),
      })),
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ input }) => {
      const { calculateLineBenchmarks } = await import('../_core/socket');
      return calculateLineBenchmarks(input.machines, { start: input.startDate, end: input.endDate });
    }),
});

// ============================================================
// OEE Target Router (lines 4380-4493)
// ============================================================
export const oeeRouter = router({
  // List all OEE targets
  listTargets: protectedProcedure.query(async () => {
    const { getDb } = await import('../db');
    const { oeeTargets } = await import('../../drizzle/schema');
    const { desc, eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return [];
    
    const result = await db.select()
      .from(oeeTargets)
      .where(eq(oeeTargets.isActive, true))
      .orderBy(desc(oeeTargets.createdAt));
    return result || [];
  }),

  // Create OEE target
  createTarget: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      lineId: z.number().optional(),
      targetOEE: z.number(),
      targetAvailability: z.number(),
      targetPerformance: z.number(),
      targetQuality: z.number(),
      alertThreshold: z.number(),
      criticalThreshold: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(sql`
        INSERT INTO oee_targets 
         (machineId, lineId, targetOEE, targetAvailability, targetPerformance, targetQuality,
          alertThreshold, criticalThreshold, setBy, notes)
         VALUES (
          ${input.machineId || null},
          ${input.lineId || null},
          ${input.targetOEE},
          ${input.targetAvailability},
          ${input.targetPerformance},
          ${input.targetQuality},
          ${input.alertThreshold},
          ${input.criticalThreshold},
          ${ctx.user?.id || 0},
          ${input.notes || null}
         )
      `);
      
      return { success: true };
    }),

  // Update OEE target
  updateTarget: protectedProcedure
    .input(z.object({
      id: z.number(),
      machineId: z.number().optional(),
      lineId: z.number().optional(),
      targetOEE: z.number(),
      targetAvailability: z.number(),
      targetPerformance: z.number(),
      targetQuality: z.number(),
      alertThreshold: z.number(),
      criticalThreshold: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(sql`
        UPDATE oee_targets
        SET machineId = ${input.machineId || null},
            lineId = ${input.lineId || null},
            targetOEE = ${input.targetOEE},
            targetAvailability = ${input.targetAvailability},
            targetPerformance = ${input.targetPerformance},
            targetQuality = ${input.targetQuality},
            alertThreshold = ${input.alertThreshold},
            criticalThreshold = ${input.criticalThreshold},
            notes = ${input.notes || null},
            updatedAt = NOW()
        WHERE id = ${input.id}
      `);
      
      return { success: true };
    }),

  // Delete OEE target
  deleteTarget: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(sql`
        UPDATE oee_targets
        SET isActive = false
        WHERE id = ${input.id}
      `);
      
      return { success: true };
    }),
});

// ============================================================
// MQTT Alert Rules Router (lines 4494-4597)
// ============================================================
export const mqttAlertRouter = router({
  // List all alert rules
  list: protectedProcedure.query(async () => {
    return db.getMqttAlertRules();
  }),

  // Get single rule by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMqttAlertRuleById(input.id);
    }),

  // Create new alert rule
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      ruleType: z.enum(['LATENCY_THRESHOLD', 'BROKER_DISCONNECT', 'MESSAGE_FAILURE_RATE', 'THROUGHPUT_LOW', 'THROUGHPUT_HIGH', 'CLIENT_OFFLINE']),
      thresholdValue: z.number(),
      thresholdUnit: z.string().default('ms'),
      comparisonOperator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ']).default('GT'),
      timeWindowMinutes: z.number().default(5),
      notifyOwner: z.boolean().default(true),
      notifyEmail: z.boolean().default(false),
      notifyMqtt: z.boolean().default(false),
      cooldownMinutes: z.number().default(15),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createMqttAlertRule({
        ...input,
        thresholdValue: String(input.thresholdValue),
        createdBy: ctx.user?.id,
      });
      return result;
    }),

  // Update alert rule
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      thresholdValue: z.number().optional(),
      thresholdUnit: z.string().optional(),
      comparisonOperator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ']).optional(),
      timeWindowMinutes: z.number().optional(),
      notifyOwner: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifyMqtt: z.boolean().optional(),
      cooldownMinutes: z.number().optional(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, thresholdValue, ...rest } = input;
      await db.updateMqttAlertRule(id, {
        ...rest,
        ...(thresholdValue !== undefined ? { thresholdValue: String(thresholdValue) } : {}),
      });
      return { success: true };
    }),

  // Delete alert rule
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMqttAlertRule(input.id);
      return { success: true };
    }),

  // Toggle enable/disable
  toggle: protectedProcedure
    .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.updateMqttAlertRule(input.id, { isEnabled: input.isEnabled });
      return { success: true };
    }),

  // Get alert history
  history: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      return db.getMqttAlertHistory(input?.limit || 50);
    }),

  // Get unresolved alerts
  unresolved: protectedProcedure.query(async () => {
    return db.getUnresolvedMqttAlerts();
  }),

  // Resolve an alert
  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.resolveMqttAlert(input.id, ctx.user.id, input.note);
      return { success: true };
    }),
});
