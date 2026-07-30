/**
 * MQTT Client, OEE Target, and MQTT Alert Routers
 * Extracted from server/routers.ts lines 3859-4597
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
// doc 54 Wave B — write-floor + module-permission gate for OEE/downtime/health/target
// mutations that were bare protectedProcedure (P1-3/P1-5: any authenticated user, incl.
// viewer, could write business data). writeProcedure blocks read-only roles; the
// requirePermission bit adds a machine_monitoring module check. testNGAlert (MQTT+FCM
// publish) is gated to qualityProcedure (admin/supervisor/quality_inspector + 2FA).
import { protectedProcedure, writeProcedure, qualityProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { adminProcedure } from "./_shared";
import * as db from "../db";

/**
 * doc 54 P2.5 — resolve a downtime/reliability analytics scope (machineId | lineId |
 * factoryId) to a concrete machineId[] . Returns undefined = "all machines" (no scope
 * filter). An empty array = "scope resolved to nothing" (caller returns empty result).
 */
async function resolveAnalyticsMachineIds(scope: {
  machineId?: number; lineId?: number; factoryId?: number;
}): Promise<number[] | undefined> {
  if (scope.machineId) return [scope.machineId];
  if (!scope.lineId && !scope.factoryId) return undefined;
  const { getDb } = await import("../db/connection");
  const database = await getDb();
  if (!database) return [];
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../utils/kpi");
  const rows = executeRows(await database.execute(sql`
    SELECT m."id" AS id
    FROM machines m
    JOIN stations s ON s."id" = m."stationId"
    JOIN production_lines l ON l."id" = s."lineId"
    JOIN workshops w ON w."id" = l."workshopId"
    WHERE m."isActive" = true
      ${scope.lineId ? sql`AND l."id" = ${scope.lineId}` : sql``}
      ${scope.factoryId ? sql`AND w."factoryId" = ${scope.factoryId}` : sql``}
  `)) as Array<{ id: number }>;
  return rows.map((r) => Number(r.id));
}

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

  // Test NG Alert - Send test NG alert with full hierarchy and product measurement points
  // doc 54 Wave B — publishes to MQTT + FCM → gate to quality-floor (admin/supervisor/
  // quality_inspector + 2FA) instead of any authenticated user.
  testNGAlert: qualityProcedure
    .input(z.object({
      factoryId: z.number(),
      workshopId: z.number(),
      stationId: z.number(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      serialNumber: z.string().optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      measurementResults: z.array(z.object({
        pointDefId: z.number(),
        pointCode: z.string(),
        result: z.enum(['OK', 'NG']),
        value: z.number().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { publishNGAlert, isMqttRunning } = await import('../services/mqttService');
      const { getDb } = await import('../db');
      const drizzleDb = (await getDb())!;
      const schema = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      // Fetch station info
      const stationRows = await drizzleDb.select({
        id: schema.stations.id,
        name: schema.stations.name,
      })
      .from(schema.stations)
      .where(eq(schema.stations.id, input.stationId))
      .limit(1);
      
      const stationName = stationRows.length > 0 ? stationRows[0].name : `Station ${input.stationId}`;
      
      // Resolve machine
      let machineId = input.machineId;
      let machineName = 'Test Machine';
      let machineCode = 'TEST';
      
      if (machineId) {
        const machineRows = await drizzleDb.select({
          id: schema.machines.id,
          name: schema.machines.name,
          code: schema.machines.code,
        })
        .from(schema.machines)
        .where(eq(schema.machines.id, machineId))
        .limit(1);
        
        if (machineRows.length > 0) {
          machineName = machineRows[0].name;
          machineCode = machineRows[0].code || 'TEST';
        }
      } else {
        // Get first machine from this station
        const machineRows = await drizzleDb.select({
          id: schema.machines.id,
          name: schema.machines.name,
          code: schema.machines.code,
        })
        .from(schema.machines)
        .where(eq(schema.machines.stationId, input.stationId))
        .limit(1);
        
        if (machineRows.length > 0) {
          machineId = machineRows[0].id;
          machineName = machineRows[0].name;
          machineCode = machineRows[0].code || 'TEST';
        }
      }

      // Resolve product model info
      let productModelName: string | undefined;
      let productModelCode: string | undefined;
      if (input.productModelId) {
        const pmRows = await drizzleDb.select({
          id: schema.productModels.id,
          name: schema.productModels.name,
          code: schema.productModels.code,
        })
        .from(schema.productModels)
        .where(eq(schema.productModels.id, input.productModelId))
        .limit(1);
        if (pmRows.length > 0) {
          productModelName = pmRows[0].name;
          productModelCode = pmRows[0].code;
        }
      }

      // Build measurement results
      let measurementResults: Array<{ pointId?: number; pointCode: string; result: string; value?: number }>;
      if (input.measurementResults && input.measurementResults.length > 0) {
        measurementResults = input.measurementResults.map(mr => ({
          pointId: mr.pointDefId,
          pointCode: mr.pointCode,
          result: mr.result,
          value: mr.value,
        }));
      } else {
        measurementResults = [{
          pointCode: 'Test Point',
          result: 'NG' as const,
          value: 0.5,
        }];
      }
      
      const testData = {
        machineId: machineId || 1,
        machineName,
        machineCode,
        stationId: input.stationId,
        stationName,
        serialNumber: input.serialNumber || `SN-TEST-${Date.now()}`,
        inspectionId: Date.now() % 2147483647,
        timestamp: new Date(),
        productModelId: input.productModelId,
        productModelName,
        productModelCode,
        severity: input.severity,
        measurementResults,
      };
      
      // Publish (respects per-station config from mqttNgAlertSettings)
      const localResult = await publishNGAlert(testData);
      
      const topic = `avi/factory/${input.factoryId}/workshop/${input.workshopId}/station/${input.stationId}/errors`;
      
      return { 
        success: true, 
        message: `NG Alert published to ${topic} - ${machineName} (${localResult ? 'OK' : 'Disabled/Failed'})`,
        data: testData,
        topic,
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
  // All OEE procedures delegate to the canonical oeeService (SEMI E10 / ISO
  // 22400). OEE is defined in exactly one place; this router only adapts inputs.
  //
  // `calculateOEE` is kept for backward-compat with manual/explicit inputs
  // (planned/run time + counts) — it persists a SEMI-E10 breakdown via the
  // canonical computeOEE rather than the old socket in-memory formula.
  calculateOEE: writeProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      plannedTime: z.number(), // minutes (window length, planned production time)
      runTime: z.number(), // minutes (productive/online time)
      idealCycleTime: z.number(), // seconds per unit
      totalCount: z.number(),
      goodCount: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { computeOEE, persistOEEMetric } = await import('../services/oeeService');
      // Map explicit planned/run minutes onto a synthetic [from,to] window so
      // the canonical SEMI-E10 calculator sees PT=runTime, UD=plannedTime-runTime.
      const to = new Date();
      const from = new Date(to.getTime() - input.plannedTime * 60 * 1000);
      const breakdown = await computeOEE({
        machineId: input.machineId,
        from,
        to,
        totalCount: input.totalCount,
        goodCount: input.goodCount,
        idealCycleTimeSec: input.idealCycleTime,
      });
      await persistOEEMetric({ breakdown, machineCode: input.machineCode }).catch(() => null);
      // Preserve the legacy response shape (percentages 0..100 + details).
      return {
        machineId: breakdown.machineId,
        machineCode: input.machineCode,
        timestamp: breakdown.windowEnd,
        availability: Math.round(breakdown.availability * 10000) / 100,
        performance: Math.round(breakdown.performance * 10000) / 100,
        quality: Math.round(breakdown.quality * 10000) / 100,
        oee: Math.round(breakdown.oee * 10000) / 100,
        details: {
          plannedTime: input.plannedTime,
          runTime: input.runTime,
          downtime: input.plannedTime - input.runTime,
          idealCycleTime: input.idealCycleTime,
          totalCount: breakdown.totalCount,
          goodCount: breakdown.goodCount,
          rejectCount: breakdown.rejectCount,
        },
      };
    }),

  getMachineOEE: protectedProcedure
    .input(z.object({ machineId: z.number(), windowHours: z.number().int().positive().max(720).optional() }))
    .query(async ({ input }) => {
      const { getMachineOEELive, resolveIdealCycleTimeSec } = await import('../services/oeeService');
      const idealCycleTimeSec = await resolveIdealCycleTimeSec(input.machineId);
      const live = await getMachineOEELive({
        machineId: input.machineId,
        windowHours: input.windowHours,
        idealCycleTimeSec,
      });
      // Adapt the canonical LiveOEEMetrics to the legacy OEEMetrics shape the
      // OEEDashboard consumes (numeric factors 0..100; details with plain
      // planned/run/downtime minutes). Null factors → 0 (empty gauge / honest
      // "no data") rather than a fabricated value.
      const onlineMin = Math.round(live.details.onlineSeconds / 60);
      const offlineMin = Math.round(live.details.offlineSeconds / 60);
      return {
        machineId: live.machineId,
        machineCode: live.machineCode,
        timestamp: live.timestamp,
        availability: live.availability ?? 0,
        performance: live.performance ?? 0,
        quality: live.quality ?? 0,
        oee: live.oee ?? 0,
        // doc 54 P2.2 §3 — live availability is UPTIME% (online/(online+offline)),
        // NOT the SEMI-E10 six-state availability. Surfaced so the UI can label it.
        availabilityBasis: live.availabilityBasis,
        details: {
          plannedTime: onlineMin + offlineMin,
          runTime: onlineMin,
          downtime: offlineMin,
          idealCycleTime: live.details.idealCycleTimeSec ?? 0,
          totalCount: live.details.totalCount,
          goodCount: live.details.goodCount,
          rejectCount: live.details.rejectCount,
        },
      };
    }),

  // doc 64 IA-10 S2 (DEP-S2) — nhận scope trục (optional): machineId lọc trực tiếp;
  // lineId tra machines→stations của chuyền (1 query indexed) rồi lọc theo set.
  getAllOEE: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      lineId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
    const { getAllMachinesOEELive } = await import('../services/oeeService');
    let all = await getAllMachinesOEELive();
    if (input?.machineId !== undefined) {
      all = all.filter((m) => m.machineId === input.machineId);
    } else if (input?.lineId !== undefined) {
      const { getDb } = await import('../db/connection');
      const { machines, stations } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const dbc = await getDb();
      if (dbc) {
        const rows = await dbc
          .select({ id: machines.id })
          .from(machines)
          .innerJoin(stations, eq(machines.stationId, stations.id))
          .where(eq(stations.lineId, input.lineId));
        const allowed = new Set(rows.map((r) => r.id));
        all = all.filter((m) => allowed.has(m.machineId));
      }
    }
    // Frontend (CorporateDashboard avg, MachineHealthMonitoring comparison)
    // expects numeric factors. Machines lacking real inputs for any factor
    // are omitted honestly (rendered as "no data") rather than emitted with a
    // fabricated/NaN value. Each returned row has all four factors as numbers.
    return all
      .filter(m => m.oee !== null && m.availability !== null && m.performance !== null && m.quality !== null)
      .map(m => {
        const onlineMin = Math.round(m.details.onlineSeconds / 60);
        const offlineMin = Math.round(m.details.offlineSeconds / 60);
        return {
          machineId: m.machineId,
          machineCode: m.machineCode,
          timestamp: m.timestamp,
          availability: m.availability as number,
          performance: m.performance as number,
          quality: m.quality as number,
          oee: m.oee as number,
          // doc 54 P2.2 §3 — UPTIME%-based availability (not SEMI-E10). Labelled for the UI.
          availabilityBasis: m.availabilityBasis,
          // Legacy OEEMetrics.details shape consumed by OEEDashboard CSV/Excel export.
          details: {
            plannedTime: onlineMin + offlineMin,
            runTime: onlineMin,
            downtime: offlineMin,
            idealCycleTime: m.details.idealCycleTimeSec ?? 0,
            totalCount: m.details.totalCount,
            goodCount: m.details.goodCount,
            rejectCount: m.details.rejectCount,
          },
        };
      });
  }),

  // ============ SEMI E10 / ISO 22400 BREAKDOWN ============
  semiE10Breakdown: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      totalCount: z.number().int().nonnegative(),
      goodCount: z.number().int().nonnegative(),
      idealCycleTimeSec: z.number().positive(),
    }))
    .query(async ({ input }) => {
      const { computeOEE, getActiveOEETarget, evaluateOEEAlert } = await import('../services/oeeService');
      const breakdown = await computeOEE(input);
      const target = await getActiveOEETarget({ machineId: input.machineId, at: input.to });
      const alert = evaluateOEEAlert(breakdown.oee, target ? {
        alertThreshold: (target as any).alertThreshold,
        criticalThreshold: (target as any).criticalThreshold,
      } : null);
      return { breakdown, target, alert };
    }),

  // ============ DOWNTIME TRACKING ============
  startDowntime: writeProcedure
    .use(requirePermission("machine_monitoring", "canCreate"))
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

  endDowntime: writeProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
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

  // ============ DOWNTIME PARETO (doc 54 P2.5) ============
  // Pareto of downtime by category (default) or reason from downtime_events over a
  // window. Minutes are clipped to the window; overflow groups fold into "Other".
  // Honest: hasData=false + empty rows when there is no downtime in the window.
  downtimePareto: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      lineId: z.number().optional(),
      factoryId: z.number().optional(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      groupBy: z.enum(['category', 'reason']).default('category'),
      limit: z.number().int().positive().max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { getDowntimePareto } = await import('../services/oeeService');
      const machineIds = await resolveAnalyticsMachineIds(input);
      return getDowntimePareto({
        machineIds,
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        limit: input.limit,
      });
    }),

  // ============ RELIABILITY: MTBF / MTTR (doc 54 P2.5) ============
  // MTBF (mean operating time between failures) + MTTR (mean repair time) from
  // downtime_events. "Failures" default to unplanned/breakdown categories. Both are
  // null (honest N/A) for a machine with no failures in the window.
  reliabilityMetrics: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      lineId: z.number().optional(),
      factoryId: z.number().optional(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      failureCategories: z.array(z.enum(['planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other'])).optional(),
    }))
    .query(async ({ input }) => {
      const { getReliabilityMetrics } = await import('../services/oeeService');
      const machineIds = await resolveAnalyticsMachineIds(input);
      return getReliabilityMetrics({
        machineIds,
        from: input.from,
        to: input.to,
        failureCategories: input.failureCategories,
      });
    }),

  // ============ PREDICTIVE MAINTENANCE ============
  calculateMachineHealth: writeProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
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
      const score = calculateMachineHealth(input.machineId, input.machineCode, {
        oee: input.oee,
        uptime: input.uptime,
        errorRate: input.errorRate,
        cycleTimeVariance: input.cycleTimeVariance,
        downtimeFrequency: input.downtimeFrequency,
      });

      // Persist snapshot to machine_health_history (best-effort; ignore failures)
      try {
        const oeeScore = Math.round(input.oee ?? 0);
        const uptimeScore = Math.round(input.uptime ?? 0);
        const errorRateScore = Math.round(Math.max(0, 100 - (input.errorRate ?? 0) * 10));
        const cycleTimeScore = Math.round(Math.max(0, 100 - (input.cycleTimeVariance ?? 0)));

        // WS-4: prefer the statistical predictive-maintenance risk (time-aware).
        // Falls back to the legacy heuristic (100 - healthScore) on sparse data
        // or any failure, preserving prior behaviour.
        let failureRisk = Math.max(0, Math.min(100, Math.round(100 - score)));
        let recommendedMaintenanceDate: Date | null = null;
        let urgency: string = failureRisk >= 70 ? 'critical' : failureRisk >= 50 ? 'high' : failureRisk >= 30 ? 'medium' : 'low';
        let pmNotes: string | null = null;
        try {
          const { computeFailureRisk } = await import('../services/predictiveMaintenanceService');
          const pm = await computeFailureRisk(input.machineId);
          // Only adopt the predictive value when it has measurable confidence.
          if (pm.confidenceScore >= 30 && pm.dataPoints >= 5) {
            failureRisk = pm.failureRisk;
            recommendedMaintenanceDate = pm.recommendedMaintenanceDate;
            urgency = pm.maintenanceUrgency.toLowerCase();
            pmNotes = pm.predictedTimeframe;
          }
        } catch (pmErr) {
          console.error('[calculateMachineHealth] Predictive risk skipped:', (pmErr as Error)?.message);
        }

        await db.recordMachineHealthSnapshot({
          machineId: input.machineId,
          machineCode: input.machineCode,
          timestamp: new Date(),
          healthScore: Math.round(score),
          oeeScore,
          uptimeScore,
          errorRateScore,
          cycleTimeScore,
          currentOEE: input.oee !== undefined ? Math.round(input.oee) : null,
          uptimePercentage: input.uptime !== undefined ? Math.round(input.uptime) : null,
          errorCount: null,
          cycleTimeVariance: input.cycleTimeVariance !== undefined ? String(input.cycleTimeVariance) : null,
          predictedFailureRisk: failureRisk,
          recommendedMaintenanceDate,
          maintenanceUrgency: urgency as any,
          calculationMethod: 'WEIGHTED',
          notes: pmNotes,
        } as any);
      } catch (err) {
        console.error('[calculateMachineHealth] Failed to persist snapshot:', err);
      }

      return score;
    }),

  getMachineHealth: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getMachineHealthScore } = await import('../_core/socket');
      return getMachineHealthScore(input.machineId);
    }),

  // Batched counterpart of getMachineHealth: returns the SAME real, in-memory
  // health scores the Details tab reads (getMachineHealthScore is a synchronous
  // Map lookup, so mapping it over the machine list is cheap). Machines with no
  // calculated score yet are returned with healthScore: null so the fleet view
  // can render an honest "—" instead of fabricating a value from OEE.
  getAllMachineHealth: protectedProcedure.query(async () => {
    const { getMachineHealthScore } = await import('../_core/socket');
    const machines = await db.getMachines();
    return machines.map((m) => {
      const health = getMachineHealthScore(m.id);
      return {
        machineId: m.id,
        machineCode: m.code,
        healthScore: health ? health.score : null,
        factors: health ? health.factors : null,
        lastUpdated: health ? health.lastUpdated : null,
      };
    });
  }),

  getMachineHealthHistory: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      range: z.enum(['day', 'week', 'month']).default('week'),
      limit: z.number().int().positive().max(2000).default(500),
    }))
    .query(async ({ input }) => {
      return db.getMachineHealthHistory(input.machineId, input.range, input.limit);
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

  // Send CONFIGURE command to a device via MQTT
  sendConfigure: adminProcedure
    .input(z.object({
      deviceId: z.string().min(1),
      stationId: z.number().optional(),
      processId: z.number().optional(),
      topics: z.array(z.string()).optional(),
      settings: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { sendConfigureCommand } = await import('../services/mqttService');
      const { deviceId, ...command } = input;
      const result = await sendConfigureCommand(deviceId, command);
      return result;
    }),

  // Send full configuration profile to one or more devices via MQTT
  sendBulkConfigure: adminProcedure
    .input(z.object({
      deviceIds: z.array(z.string().min(1)).min(1),
      profile: z.object({
        // MQTT settings
        mqtt: z.object({
          brokerAddress: z.string().optional(),
          port: z.number().optional(),
          protocol: z.enum(['tcp', 'websocket']).optional(),
          useSSL: z.boolean().optional(),
          topics: z.array(z.string()).optional(),
          keepAlive: z.number().optional(),
          reconnectPeriod: z.number().optional(),
          connectTimeout: z.number().optional(),
        }).optional(),
        // Notification settings
        notification: z.object({
          enabled: z.boolean().optional(),
          sound: z.boolean().optional(),
          vibration: z.boolean().optional(),
          severityFilter: z.array(z.string()).optional(),
          quietHoursEnabled: z.boolean().optional(),
          quietHoursStart: z.string().optional(),
          quietHoursEnd: z.string().optional(),
          stationFilterEnabled: z.boolean().optional(),
          stationFilters: z.array(z.string()).optional(),
          floatingBubbleEnabled: z.boolean().optional(),
        }).optional(),
        // App settings
        app: z.object({
          language: z.enum(['vi', 'en', 'zh']).optional(),
          theme: z.enum(['light', 'dark', 'system']).optional(),
          autoReconnect: z.boolean().optional(),
          keepScreenOn: z.boolean().optional(),
          maxQueueSize: z.number().optional(),
          alertRetentionDays: z.number().optional(),
          apiBaseUrl: z.string().optional(),
          subscriptionMode: z.enum(['manual', 'hierarchy']).optional(),
          ngFlashDurationMs: z.number().optional(),
          ngBubbleDismissSec: z.number().optional(),
          ngExplosionDismissSec: z.number().optional(),
          alertAnimationEnabled: z.boolean().optional(),
          alertAnimationType: z.enum(['bomb', 'alarm', 'triangle']).optional(),
          alertAnimationDurationSec: z.number().optional(),
          proactivePollingEnabled: z.boolean().optional(),
          proactivePollingIntervalSec: z.number().optional(),
          workstationId: z.number().nullable().optional(),
          filterPointsByWorkstation: z.boolean().optional(),
          ngAutoClearColor: z.boolean().optional(),
          ngMarkerScale: z.number().optional(),
          canvasImageMode: z.enum(['fit', 'fill', 'cover']).optional(),
          autoCheckUpdate: z.boolean().optional(),
          debugMode: z.boolean().optional(),
          mqttHealthCheckInterval: z.number().optional(),
          mqttRetryMaxAttempts: z.number().optional(),
          mqttRetryInterval: z.number().optional(),
        }).optional(),
        // Station/process assignment
        stationId: z.number().optional(),
        processId: z.number().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const { sendConfigureCommand } = await import('../services/mqttService');
      const results: { deviceId: string; success: boolean; commandId?: string; error?: string }[] = [];

      for (const deviceId of input.deviceIds) {
        try {
          const result = await sendConfigureCommand(deviceId, {
            stationId: input.profile.stationId,
            processId: input.profile.processId,
            topics: input.profile.mqtt?.topics,
            settings: {
              mqtt: input.profile.mqtt,
              notification: input.profile.notification,
              app: input.profile.app,
            },
          });
          results.push({ deviceId, success: true, commandId: result.commandId });
        } catch (err) {
          results.push({ deviceId, success: false, error: (err as Error).message });
        }
      }

      return {
        total: input.deviceIds.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      };
    }),

  // Send a command to a specific device via MQTT (e.g., RESTART_APP)
  sendCommand: adminProcedure
    .input(z.object({
      deviceId: z.string().min(1),
      command: z.enum(['RESTART_APP', 'CHECK_UPDATE', 'FORCE_UPDATE']),
      data: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ input }) => {
      // SOFTWARE_UPDATE commands use dedicated message type
      if (input.command === 'CHECK_UPDATE' || input.command === 'FORCE_UPDATE') {
        const { sendSoftwareUpdateCommand } = await import('../services/mqttService');
        return sendSoftwareUpdateCommand(input.deviceId, input.command, input.data);
      }
      // Other commands (RESTART_APP) use CONFIGURE channel
      const { sendConfigureCommand } = await import('../services/mqttService');
      const result = await sendConfigureCommand(input.deviceId, {
        settings: {
          _command: input.command,
          ...(input.data || {}),
        },
      });
      return result;
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
  createTarget: writeProcedure
    .use(requirePermission("machine_monitoring", "canCreate"))
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
      const { oeeTargets } = await import('../../drizzle/schema');
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Hương-P0: dùng Drizzle thay raw SQL — identifier camelCase không quote bị
      // Postgres fold về lowercase (machineId → machineid) gây "column does not exist".
      await db.insert(oeeTargets).values({
        machineId: input.machineId ?? null,
        lineId: input.lineId ?? null,
        targetOEE: input.targetOEE,
        targetAvailability: input.targetAvailability,
        targetPerformance: input.targetPerformance,
        targetQuality: input.targetQuality,
        alertThreshold: input.alertThreshold,
        criticalThreshold: input.criticalThreshold,
        setBy: ctx.user?.id || 0,
        notes: input.notes ?? null,
      });

      return { success: true };
    }),

  // Update OEE target
  updateTarget: writeProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
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
      const { oeeTargets } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Hương-P0: dùng Drizzle thay raw SQL không quote (camelCase bị fold lowercase).
      await db.update(oeeTargets)
        .set({
          machineId: input.machineId ?? null,
          lineId: input.lineId ?? null,
          targetOEE: input.targetOEE,
          targetAvailability: input.targetAvailability,
          targetPerformance: input.targetPerformance,
          targetQuality: input.targetQuality,
          alertThreshold: input.alertThreshold,
          criticalThreshold: input.criticalThreshold,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(oeeTargets.id, input.id));

      return { success: true };
    }),

  // Delete OEE target (soft-delete via isActive=false → canEdit floor)
  deleteTarget: writeProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('../db');
      const { oeeTargets } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Hương-P0: soft-delete qua Drizzle thay raw SQL.
      await db.update(oeeTargets)
        .set({ isActive: false })
        .where(eq(oeeTargets.id, input.id));

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
      if (!ctx.user) throw appError('UNAUTHORIZED', 'AUTH_REQUIRED', undefined, 'Authentication required to resolve alert');
      await db.resolveMqttAlert(input.id, ctx.user.id, input.note);
      return { success: true };
    }),
});
