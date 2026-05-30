import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import {
  machines,
  stations,
  productionLines,
  workshops,
  factories,
  machineStatusLogs, InsertMachineStatusLog,
  machineHeartbeats, InsertMachineHeartbeat,
  manualMachineConnections, InsertManualMachineConnection,
  machineHealthHistory, type InsertMachineHealthHistory,
  alertSettings,
  productInspections,
} from "../../drizzle/schema";


// ============ MACHINE STATUS/HEARTBEAT ============

export async function createMachineStatusLog(data: InsertMachineStatusLog) {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(machineStatusLogs).values(data).returning({ id: machineStatusLogs.id });
  return result.id;
}

export async function getMachineStatusLogs(machineId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(machineStatusLogs)
    .where(eq(machineStatusLogs.machineId, machineId))
    .orderBy(desc(machineStatusLogs.timestamp))
    .limit(limit);
}

export async function getLatestMachineStatus(machineId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(machineStatusLogs)
    .where(eq(machineStatusLogs.machineId, machineId))
    .orderBy(desc(machineStatusLogs.timestamp))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllMachinesWithStatus() {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select({
    machine: machines,
    station: stations,
    line: productionLines,
    workshop: workshops,
    factory: factories
  })
    .from(machines)
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .innerJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.isActive, true));

  const statusPromises = allMachines.map(async (m) => {
    const latestStatus = await getLatestMachineStatus(m.machine.id);
    const latestHeartbeat = await getLatestMachineHeartbeat(m.machine.id);
    const uptimeStats = await getMachineUptimeStats(m.machine.id, 24);
    
    return {
      ...m.machine,
      station: m.station,
      line: m.line,
      workshop: m.workshop,
      factory: m.factory,
      latestStatus: latestStatus?.status || 'offline',
      lastStatusChange: latestStatus?.timestamp || null,
      latestHeartbeat: latestHeartbeat?.timestamp || m.machine.lastHeartbeat || null,
      heartbeatStatus: latestHeartbeat?.status || 'stopped',
      uptimePercent: uptimeStats.uptimePercent,
      totalOnlineTime: uptimeStats.totalOnlineTime,
      totalOfflineTime: uptimeStats.totalOfflineTime,
    };
  });

  return Promise.all(statusPromises);
}

export async function getMachineUptimeStats(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startTime)
    ))
    .orderBy(machineStatusLogs.timestamp);

  if (logs.length === 0) {
    return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };
  }

  let totalOnlineTime = 0;
  let totalOfflineTime = 0;
  
  for (let i = 0; i < logs.length - 1; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;
    
    if (current.status === 'online') {
      totalOnlineTime += duration;
    } else {
      totalOfflineTime += duration;
    }
  }

  const lastLog = logs[logs.length - 1];
  const timeSinceLastLog = (Date.now() - new Date(lastLog.timestamp).getTime()) / 1000;
  if (lastLog.status === 'online') {
    totalOnlineTime += timeSinceLastLog;
  } else {
    totalOfflineTime += timeSinceLastLog;
  }

  const totalTime = totalOnlineTime + totalOfflineTime;
  const uptimePercent = totalTime > 0 ? Math.round((totalOnlineTime / totalTime) * 1000) / 10 : 0;

  return {
    uptimePercent,
    totalOnlineTime: Math.round(totalOnlineTime),
    totalOfflineTime: Math.round(totalOfflineTime),
  };
}

export async function markOfflineNotificationSent(logId: number) {
  const db = await getDb();
  if (!db) return;

  await db.update(machineStatusLogs)
    .set({ notificationSent: true })
    .where(eq(machineStatusLogs.id, logId));
}

export async function getUnnotifiedOfflineMachines(thresholdMinutes: number = 5) {
  const db = await getDb();
  if (!db) return [];

  const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  
  const offlineLogs = await db.select({
    log: machineStatusLogs,
    machine: machines
  })
    .from(machineStatusLogs)
    .innerJoin(machines, eq(machineStatusLogs.machineId, machines.id))
    .where(and(
      eq(machineStatusLogs.status, 'offline'),
      eq(machineStatusLogs.notificationSent, false),
      lte(machineStatusLogs.timestamp, thresholdTime)
    ));

  const machineLatestOffline = new Map<number, typeof offlineLogs[0]>();
  for (const log of offlineLogs) {
    const existing = machineLatestOffline.get(log.machine.id);
    if (!existing || new Date(log.log.timestamp) > new Date(existing.log.timestamp)) {
      machineLatestOffline.set(log.machine.id, log);
    }
  }

  return Array.from(machineLatestOffline.values());
}

// ============ MACHINE HEARTBEATS ============
export async function createMachineHeartbeat(data: InsertMachineHeartbeat) {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(machineHeartbeats).values(data).returning({ id: machineHeartbeats.id });
  return result.id;
}

export async function getMachineHeartbeats(machineId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(machineHeartbeats)
    .where(eq(machineHeartbeats.machineId, machineId))
    .orderBy(desc(machineHeartbeats.timestamp))
    .limit(limit);
}

export async function getLatestMachineHeartbeat(machineId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(machineHeartbeats)
    .where(eq(machineHeartbeats.machineId, machineId))
    .orderBy(desc(machineHeartbeats.timestamp))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getHeartbeatHistory(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return db.select()
    .from(machineHeartbeats)
    .where(and(
      eq(machineHeartbeats.machineId, machineId),
      gte(machineHeartbeats.timestamp, startTime)
    ))
    .orderBy(machineHeartbeats.timestamp);
}

// ============ UPTIME TIMELINE ============
export async function getUptimeTimeline(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startTime)
    ))
    .orderBy(machineStatusLogs.timestamp);

  // Build timeline segments
  const segments: Array<{
    start: Date;
    end: Date;
    status: string;
    duration: number;
  }> = [];

  if (logs.length === 0) {
    return segments;
  }

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const endTime = next ? new Date(next.timestamp) : new Date();
    const duration = (endTime.getTime() - new Date(current.timestamp).getTime()) / 1000;

    segments.push({
      start: new Date(current.timestamp),
      end: endTime,
      status: current.status,
      duration: Math.round(duration),
    });
  }

  return segments;
}

export async function getAllMachinesUptimeTimeline(hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select({
    id: machines.id,
    code: machines.code,
    name: machines.name,
  })
    .from(machines)
    .where(eq(machines.isActive, true));

  const timelinePromises = allMachines.map(async (machine) => {
    const timeline = await getUptimeTimeline(machine.id, hours);
    const stats = await getMachineUptimeStats(machine.id, hours);
    return {
      machineId: machine.id,
      machineCode: machine.code,
      machineName: machine.name,
      timeline,
      uptimePercent: stats.uptimePercent,
      totalOnlineTime: stats.totalOnlineTime,
      totalOfflineTime: stats.totalOfflineTime,
    };
  });

  return Promise.all(timelinePromises);
}

// ============ ALERT CONFIGURATION ============
export async function getAlertConfiguration() {
  const db = await getDb();
  if (!db) return null;

  // Get from alertSettings table with type 'machine_offline'
  const result = await db.select()
    .from(alertSettings)
    .where(eq(alertSettings.alertType, 'machine_offline'))
    .limit(1);

  if (result.length === 0) {
    // Return default config
    return {
      id: null,
      thresholdMinutes: 5,
      isActive: true,
      notifyEmail: true,
      notifyInApp: true,
    };
  }

  const setting = result[0];
  return {
    id: setting.id,
    thresholdMinutes: setting.threshold ? Number(setting.threshold) : 5,
    isActive: setting.isActive,
    notifyEmail: setting.notifyEmail,
    notifyInApp: setting.notifyInApp,
  };
}

export async function updateAlertConfiguration(config: {
  thresholdMinutes: number;
  isActive: boolean;
}) {
  const db = await getDb();
  if (!db) return null;

  // Check if exists
  const existing = await db.select()
    .from(alertSettings)
    .where(eq(alertSettings.alertType, 'machine_offline'))
    .limit(1);

  if (existing.length === 0) {
    // Create new - need userId, use 0 for system alert
    const [result] = await db.insert(alertSettings).values({
      userId: 0, // System alert
      name: 'Machine Offline Alert',
      alertType: 'machine_offline',
      threshold: config.thresholdMinutes.toString(),
      isActive: config.isActive,
    }).returning({ id: alertSettings.id });
    return result.id;
  } else {
    // Update existing
    await db.update(alertSettings)
      .set({
        threshold: config.thresholdMinutes.toString(),
        isActive: config.isActive,
        updatedAt: new Date(),
      })
      .where(eq(alertSettings.id, existing[0].id));
    return existing[0].id;
  }
}

// ============ MACHINE STATUS REPORT ============
export async function getMachineStatusReport(machineId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return null;

  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startDate),
      lte(machineStatusLogs.timestamp, endDate)
    ))
    .orderBy(machineStatusLogs.timestamp);

  const machine = await db.select()
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);

  if (!machine[0]) return null;

  // Calculate statistics
  let totalOnlineTime = 0;
  let totalOfflineTime = 0;
  let offlineCount = 0;
  let longestOffline = 0;
  let longestOnline = 0;

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const endTime = next ? new Date(next.timestamp) : endDate;
    const duration = (endTime.getTime() - new Date(current.timestamp).getTime()) / 1000;

    if (current.status === 'online') {
      totalOnlineTime += duration;
      if (duration > longestOnline) longestOnline = duration;
    } else {
      totalOfflineTime += duration;
      offlineCount++;
      if (duration > longestOffline) longestOffline = duration;
    }
  }

  const totalTime = totalOnlineTime + totalOfflineTime;
  const uptimePercent = totalTime > 0 ? Math.round((totalOnlineTime / totalTime) * 1000) / 10 : 0;
  const mtbf = offlineCount > 0 ? Math.round(totalOnlineTime / offlineCount) : totalOnlineTime; // Mean Time Between Failures
  const mttr = offlineCount > 0 ? Math.round(totalOfflineTime / offlineCount) : 0; // Mean Time To Repair

  return {
    machine: machine[0],
    period: {
      start: startDate,
      end: endDate,
      totalHours: Math.round(totalTime / 3600 * 10) / 10,
    },
    statistics: {
      uptimePercent,
      totalOnlineTime: Math.round(totalOnlineTime),
      totalOfflineTime: Math.round(totalOfflineTime),
      offlineCount,
      longestOffline: Math.round(longestOffline),
      longestOnline: Math.round(longestOnline),
      mtbf: Math.round(mtbf),
      mttr: Math.round(mttr),
    },
    logs: logs.map(log => ({
      timestamp: log.timestamp,
      status: log.status,
      ipAddress: log.ipAddress,
    })),
  };
}


// ============ MANUAL MACHINE CONNECTIONS FUNCTIONS ============

export async function listManualConnections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(manualMachineConnections).orderBy(desc(manualMachineConnections.createdAt));
}

export async function getManualConnectionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(manualMachineConnections).where(eq(manualMachineConnections.id, id));
  return results[0] || null;
}

export async function getManualConnectionByMachineId(machineId: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(manualMachineConnections).where(eq(manualMachineConnections.machineId, machineId));
  return results[0] || null;
}

export async function createManualConnection(data: InsertManualMachineConnection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(manualMachineConnections).values(data).returning({ id: manualMachineConnections.id });
  return { id: Number(result.id) };
}

export async function updateManualConnection(id: number, data: Partial<InsertManualMachineConnection>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(manualMachineConnections).set(data).where(eq(manualMachineConnections.id, id));
}

export async function deleteManualConnection(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(manualMachineConnections).where(eq(manualMachineConnections.id, id));
}

export async function updateManualConnectionStatus(
  id: number, 
  status: 'connected' | 'disconnected' | 'error' | 'pending',
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: any = {
    connectionStatus: status,
    lastConnectionAttempt: new Date(),
  };
  
  if (status === 'connected') {
    updateData.lastSuccessfulConnection = new Date();
    updateData.retryCount = 0;
    updateData.errorMessage = null;
  } else if (status === 'error' && errorMessage) {
    updateData.errorMessage = errorMessage;
  }
  
  await db.update(manualMachineConnections).set(updateData).where(eq(manualMachineConnections.id, id));
}

export async function incrementManualConnectionRetry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(manualMachineConnections)
    .set({ 
      retryCount: sql`${manualMachineConnections.retryCount} + 1`,
      lastConnectionAttempt: new Date()
    })
    .where(eq(manualMachineConnections.id, id));
}

export async function getEnabledManualConnections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(manualMachineConnections).where(eq(manualMachineConnections.isEnabled, true));
}


// ============ WORKSTATION ERRORS ============

export async function getWorkstationErrors(filters: {
  stationId?: number;
  machineId?: number;
  limit?: number;
  includeResolved?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  // Get NG inspections as "errors"
  conditions.push(eq(productInspections.overallResult, 'NG'));
  
  if (filters.stationId) {
    // Get machines for this station
    const stationMachines = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.stationId, filters.stationId));
    
    if (stationMachines.length > 0) {
      const machineIds = stationMachines.map(m => m.id);
      conditions.push(inArray(productInspections.machineId, machineIds));
    }
  }
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  
  if (!filters.includeResolved) {
    // Only show recent errors (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    conditions.push(gte(productInspections.inspectionTime, oneDayAgo));
  }
  
  const results = await db.select({
    id: productInspections.id,
    serialNumber: productInspections.serialNumber,
    machineId: productInspections.machineId,
    overallResult: productInspections.overallResult,
    inspectionTime: productInspections.inspectionTime,
    productModel: productInspections.productModel,
    factoryCode: productInspections.factoryCode,
  })
    .from(productInspections)
    .where(and(...conditions))
    .orderBy(desc(productInspections.inspectionTime))
    .limit(filters.limit || 50);
  
  return results;
}

export async function getWorkstationErrorSummary(filters: {
  stationId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return { total: 0, byMachine: [], byHour: [], byDefectType: [] };
  
  const conditions = [eq(productInspections.overallResult, 'NG')];
  
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  
  if (filters.stationId) {
    const stationMachines = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.stationId, filters.stationId));
    
    if (stationMachines.length > 0) {
      const machineIds = stationMachines.map(m => m.id);
      conditions.push(inArray(productInspections.machineId, machineIds));
    }
  }
  
  // Total count
  const totalResult = await db.select({
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions));
  
  // By machine
  const byMachine = await db.select({
    machineId: productInspections.machineId,
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(productInspections.machineId)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(10);
  
  // By hour (last 24 hours)
  const byHour = await db.select({
    hour: sql<string>`TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD HH24:00')`,
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD HH24:00')`)
    .orderBy(sql`TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD HH24:00')`);
  
  return {
    total: Number(totalResult[0]?.count || 0),
    byMachine: byMachine.map(m => ({ machineId: m.machineId, count: Number(m.count) })),
    byHour: byHour.map(h => ({ hour: h.hour, count: Number(h.count) })),
    byDefectType: [], // Would need measurement results join
  };
}

// ============ MACHINE HEALTH HISTORY ============

export async function recordMachineHealthSnapshot(data: InsertMachineHealthHistory) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .insert(machineHealthHistory)
    .values(data)
    .returning({ id: machineHealthHistory.id });
  return row?.id ?? null;
}

export async function getMachineHealthHistory(
  machineId: number,
  range: "day" | "week" | "month" = "week",
  limit: number = 500
) {
  const db = await getDb();
  if (!db) return [];
  const hours = range === "day" ? 24 : range === "week" ? 24 * 7 : 24 * 30;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return db
    .select({
      id: machineHealthHistory.id,
      timestamp: machineHealthHistory.timestamp,
      healthScore: machineHealthHistory.healthScore,
      oeeScore: machineHealthHistory.oeeScore,
      uptimeScore: machineHealthHistory.uptimeScore,
      errorRateScore: machineHealthHistory.errorRateScore,
      cycleTimeScore: machineHealthHistory.cycleTimeScore,
      currentOEE: machineHealthHistory.currentOEE,
      uptimePercentage: machineHealthHistory.uptimePercentage,
      errorCount: machineHealthHistory.errorCount,
      predictedFailureRisk: machineHealthHistory.predictedFailureRisk,
      recommendedMaintenanceDate: machineHealthHistory.recommendedMaintenanceDate,
      maintenanceUrgency: machineHealthHistory.maintenanceUrgency,
    })
    .from(machineHealthHistory)
    .where(and(
      eq(machineHealthHistory.machineId, machineId),
      gte(machineHealthHistory.timestamp, since),
    ))
    .orderBy(machineHealthHistory.timestamp)
    .limit(limit);
}
