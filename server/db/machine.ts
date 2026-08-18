import { eq, and, desc, gte, lte, sql, inArray, or, isNull } from "drizzle-orm";
import { getDb } from "./connection";
import { idsTrongPhamVi, trongPhamVi, type PhamViNguoiXem } from "./hierarchy";
import { executeRows } from "../utils/kpi";
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

export async function getMachineStatusLogs(machineId: number, limit: number = 100, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  if (!(await trongPhamVi("machine", machineId, scope))) return [];

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

export async function getAllMachinesWithStatus(scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  // ⚠ Đây là BẢNG KIỂM KÊ TOÀN NHÀ XƯỞNG: mỗi hàng mang máy + trạm + tuyến + xưởng + NHÀ MÁY.
  // Trước bản vá, mọi tài khoản qua được `machine_monitoring/canView` đọc được cả đội của mọi
  // tenant. Bộ lọc theo `input.lineId/factoryId` ở router là bộ lọc GIAO DIỆN, không phải cổng.
  const idsMay = await idsTrongPhamVi("machine", scope);
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
    .where(and(
      eq(machines.isActive, true),
      ...(idsMay === null ? [] : [inArray(machines.id, idsMay.length ? idsMay : [-1])]),
    ));

  if (allMachines.length === 0) return [];

  // doc 54 Wave C — SET-BASED fleet status. The old path fanned out one
  // getLatestMachineStatus + getLatestMachineHeartbeat + getMachineUptimeStats PER
  // machine inside .map() → 1 + 3N queries, uncapped, re-run every 60s (won't scale).
  // This computes the whole fleet with a FIXED handful of grouped queries (latest
  // status + latest heartbeat via DISTINCT ON, and windowed uptime via a LEAD window),
  // regardless of fleet size. Mirrors getAllMachinesOEELive in oeeService. The return
  // shape is IDENTICAL to the per-machine path.
  const machineIds = allMachines.map((m) => m.machine.id);
  const idList = sql.join(machineIds.map((id) => sql`${id}`), sql`, `);

  // Latest status per machine (DISTINCT ON → newest row per machineId).
  const latestStatusRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status, "timestamp" AS ts
    FROM machine_status_logs
    WHERE "machineId" IN (${idList})
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; status: string | null; ts: Date | null }>;
  const latestStatusByMachine = new Map<number, { status: string | null; ts: Date | null }>();
  for (const r of latestStatusRows) latestStatusByMachine.set(Number(r.machine_id), { status: r.status, ts: r.ts });

  // Latest heartbeat per machine (DISTINCT ON → newest heartbeat per machineId).
  const latestHeartbeatRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status, "timestamp" AS ts
    FROM machine_heartbeats
    WHERE "machineId" IN (${idList})
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; status: string | null; ts: Date | null }>;
  const latestHeartbeatByMachine = new Map<number, { status: string | null; ts: Date | null }>();
  for (const r of latestHeartbeatRows) latestHeartbeatByMachine.set(Number(r.machine_id), { status: r.status, ts: r.ts });

  // Uptime over the last 24h, set-based — mirrors getMachineUptimeStats exactly: only
  // rows inside the window count, each row's interval runs to the next row (LEAD) and
  // the last row's interval extends to NOW(). 'online' → online seconds, else offline.
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${startTime.toISOString()} AND "machineId" IN (${idList})
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), { online: Number(r.online_sec) || 0, offline: Number(r.offline_sec) || 0 });
  }

  // Assemble in JS — SAME output shape/type as the per-machine path.
  return allMachines.map((m) => {
    const latestStatus = latestStatusByMachine.get(m.machine.id);
    const latestHeartbeat = latestHeartbeatByMachine.get(m.machine.id);
    const up = uptimeByMachine.get(m.machine.id) ?? { online: 0, offline: 0 };
    const totalTime = up.online + up.offline;
    // Percent from UNROUNDED seconds (round only for output), exactly as getMachineUptimeStats.
    const uptimePercent = totalTime > 0 ? Math.round((up.online / totalTime) * 1000) / 10 : 0;

    return {
      ...m.machine,
      station: m.station,
      line: m.line,
      workshop: m.workshop,
      factory: m.factory,
      latestStatus: latestStatus?.status || 'offline',
      lastStatusChange: latestStatus?.ts || null,
      latestHeartbeat: latestHeartbeat?.ts || m.machine.lastHeartbeat || null,
      heartbeatStatus: latestHeartbeat?.status || 'stopped',
      uptimePercent,
      totalOnlineTime: Math.round(up.online),
      totalOfflineTime: Math.round(up.offline),
    };
  });
}

export async function getMachineUptimeStats(machineId: number, hours: number = 24, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };
  if (!(await trongPhamVi("machine", machineId, scope))) return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };

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

export async function getUnnotifiedOfflineMachines(thresholdMinutes: number = 5, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const idsMay = await idsTrongPhamVi("machine", scope);
  
  const offlineLogs = await db.select({
    log: machineStatusLogs,
    machine: machines
  })
    .from(machineStatusLogs)
    .innerJoin(machines, eq(machineStatusLogs.machineId, machines.id))
    .where(and(
      eq(machineStatusLogs.status, 'offline'),
      eq(machineStatusLogs.notificationSent, false),
      lte(machineStatusLogs.timestamp, thresholdTime),
      ...(idsMay === null ? [] : [inArray(machines.id, idsMay.length ? idsMay : [-1])]),
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

  // Doc 38 T-1 (P0 #3) — feed the downtime auto-detector's activity map from the
  // canonical heartbeat/telemetry ingest choke-point. Fire-and-forget + dynamic
  // import (breaks the db⇄service require cycle); recordMachineActivity is a cheap
  // in-memory Map.set that never touches the hot path and is inert unless
  // DOWNTIME_DETECTION_ENABLED arms the sweep in backgroundJobs.
  if (typeof data.machineId === "number") {
    const mid = data.machineId;
    void import("../services/downtimeDetectionService")
      .then((m) => m.recordMachineActivity(mid))
      .catch(() => {});
  }

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

export async function getHeartbeatHistory(machineId: number, hours: number = 24, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  if (!(await trongPhamVi("machine", machineId, scope))) return [];

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
export async function getUptimeTimeline(machineId: number, hours: number = 24, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  if (!(await trongPhamVi("machine", machineId, scope))) return [];

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

export async function getAllMachinesUptimeTimeline(hours: number = 24, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  // Lọc tập máy MỘT lần ở đây là đủ: hai lời gọi con bên dưới nhận id đã nằm trong phạm vi.
  const idsMay = await idsTrongPhamVi("machine", scope);
  const allMachines = await db.select({
    id: machines.id,
    code: machines.code,
    name: machines.name,
  })
    .from(machines)
    .where(and(
      eq(machines.isActive, true),
      ...(idsMay === null ? [] : [inArray(machines.id, idsMay.length ? idsMay : [-1])]),
    ));

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
/**
 * ⚠ Cấu hình ngưỡng "máy mất kết nối" — một hàng CẤU HÌNH, không phải số đo. Hàng không gắn
 * máy/nhà máy là mặc định TOÀN CỤC ⇒ giữ (cùng luật với `oee_targets`). Nơi gọi duy nhất là
 * `adminProcedure`, nên trên thực tế cổng này không bao giờ phát biểu — nó tồn tại để không có
 * ĐƯỜNG NÀO đọc hàng gắn nhà máy khác nếu mai này sàn được nới.
 */
export async function getAlertConfiguration(scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;

  const [idsMay, idsNhaMay] = await Promise.all([
    idsTrongPhamVi("machine", scope),
    idsTrongPhamVi("factory", scope),
  ]);
  const cong = idsMay === null || idsNhaMay === null ? undefined : or(
    and(isNull(alertSettings.machineId), isNull(alertSettings.factoryId)),
    inArray(alertSettings.machineId, idsMay.length ? idsMay : [-1]),
    inArray(alertSettings.factoryId, idsNhaMay.length ? idsNhaMay : [-1]),
  );
  // Get from alertSettings table with type 'machine_offline'
  const result = await db.select()
    .from(alertSettings)
    .where(and(eq(alertSettings.alertType, 'machine_offline'), ...(cong ? [cong] : [])))
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
export async function getMachineStatusReport(machineId: number, startDate: Date, endDate: Date, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  if (!(await trongPhamVi("machine", machineId, scope))) return null;

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

export async function listManualConnections(scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  // ⚠ Bảng này mang ĐỊA CHỈ IP + CỔNG của từng máy — một bản đồ mạng nội bộ của tenant.
  const idsMay = await idsTrongPhamVi("machine", scope);
  return db.select().from(manualMachineConnections)
    .where(idsMay === null ? undefined : inArray(manualMachineConnections.machineId, idsMay.length ? idsMay : [-1]))
    .orderBy(desc(manualMachineConnections.createdAt));
}

export async function getManualConnectionById(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(manualMachineConnections).where(eq(manualMachineConnections.id, id));
  const hang = results[0];
  if (!hang) return null;
  if (!(await trongPhamVi("machine", hang.machineId, scope))) return null;
  return hang;
}

export async function getManualConnectionByMachineId(machineId: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  if (!(await trongPhamVi("machine", machineId, scope))) return null;
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
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  // Get NG inspections as "errors"
  conditions.push(eq(productInspections.overallResult, 'NG'));
  // ⚠ Cổng phạm vi chiếu xuống `machineId` và được AND vào SAU bộ lọc `stationId`/`machineId` của
  // người gọi: một `stationId` TỰ KHAI của nhà máy khác vì thế cho giao 0 hàng, chứ không mở cửa.
  {
    const idsMay = await idsTrongPhamVi("machine", scope);
    if (idsMay !== null) conditions.push(inArray(productInspections.machineId, idsMay.length > 0 ? idsMay : [-1]));
  }
  
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
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return { total: 0, byMachine: [], byHour: [], byDefectType: [] };
  
  const conditions = [eq(productInspections.overallResult, 'NG')];
  {
    const idsMay = await idsTrongPhamVi("machine", scope);
    if (idsMay !== null) conditions.push(inArray(productInspections.machineId, idsMay.length > 0 ? idsMay : [-1]));
  }
  
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
  limit: number = 500,
  scope?: PhamViNguoiXem,
) {
  const db = await getDb();
  if (!db) return [];
  if (!(await trongPhamVi("machine", machineId, scope))) return [];
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
