import { getDb } from "./connection";
import { eq, and, desc, gte, lte, like, sql, or, inArray, SQL } from "drizzle-orm";
import {
  factories,
  workshops,
  productionLines,
  stations,
  machines,
  productInspections,
  measurementPointDefs,
  measurementResults,
  dailyStatistics, InsertDailyStatistics,
  productModels,
  alertHistory,
  workstations,
} from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "./auth";

// ============ DAILY STATISTICS FUNCTIONS ============

export async function upsertDailyStatistics(data: InsertDailyStatistics) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(dailyStatistics).values(data).onConflictDoUpdate({
    target: [dailyStatistics.machineId, dailyStatistics.date],
    set: {
      totalCount: data.totalCount,
      okCount: data.okCount,
      ngCount: data.ngCount,
      ntfCount: data.ntfCount,
      yieldRate: data.yieldRate,
    }
  });
}

export async function getDailyStatistics(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
} | number, startDateArg?: Date, endDateArg?: Date) {
  const db = await getDb();
  if (!db) return [];

  // Support both old and new API
  let machineId: number | undefined;
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof params === 'number') {
    // Old API: getDailyStatistics(machineId, startDate, endDate)
    machineId = params;
    startDate = startDateArg;
    endDate = endDateArg;
  } else {
    // New API: getDailyStatistics({ machineId?, startDate?, endDate? })
    machineId = params.machineId;
    startDate = params.startDate;
    endDate = params.endDate;
  }

  const conditions = [];
  if (machineId) conditions.push(eq(dailyStatistics.machineId, machineId));
  if (startDate) conditions.push(gte(dailyStatistics.date, startDate));
  if (endDate) conditions.push(lte(dailyStatistics.date, endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // If no machineId, aggregate across all machines
  if (!machineId) {
    const result = await db.select({
      date: dailyStatistics.date,
      okCount: sql<number>`SUM(${dailyStatistics.okCount})`.as('ok_count'),
      ngCount: sql<number>`SUM(${dailyStatistics.ngCount})`.as('ng_count'),
      ntfCount: sql<number>`SUM(${dailyStatistics.ntfCount})`.as('ntf_count'),
    })
      .from(dailyStatistics)
      .where(whereClause)
      .groupBy(dailyStatistics.date)
      .orderBy(dailyStatistics.date);
    
    return result.map(r => ({
      date: r.date,
      okCount: Number(r.okCount) || 0,
      ngCount: Number(r.ngCount) || 0,
      ntfCount: Number(r.ntfCount) || 0,
    }));
  }

  return db.select().from(dailyStatistics)
    .where(whereClause)
    .orderBy(dailyStatistics.date);
}

// ============ DASHBOARD STATS FUNCTIONS ============
export async function getDashboardStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  // Build conditions for inspections
  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters?.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  // Access filter by user assignments
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(filters.userId, filters.userRole || 'user');
    if (accessFilter) conditions.push(accessFilter);
  }

  // If factory or workshop filter, need to join with machines
  if (filters?.factoryId || filters?.workshopId) {
    // Get machine IDs first
    const machineConditions = [];
    if (filters?.factoryId) {
      const workshopsInFactory = await db.select({ id: workshops.id }).from(workshops)
        .where(eq(workshops.factoryId, filters.factoryId));
      const workshopIds = workshopsInFactory.map(w => w.id);
      
      if (workshopIds.length > 0) {
        const linesInWorkshops = await db.select({ id: productionLines.id }).from(productionLines)
          .where(inArray(productionLines.workshopId, workshopIds));
        const lineIds = linesInWorkshops.map(l => l.id);
        
        if (lineIds.length > 0) {
          const stationsInLines = await db.select({ id: stations.id }).from(stations)
            .where(inArray(stations.lineId, lineIds));
          const stationIds = stationsInLines.map(s => s.id);
          
          if (stationIds.length > 0) {
            const machinesInStations = await db.select({ id: machines.id }).from(machines)
              .where(inArray(machines.stationId, stationIds));
            const machineIds = machinesInStations.map(m => m.id);
            
            if (machineIds.length > 0) {
              conditions.push(inArray(productInspections.machineId, machineIds));
            } else {
              return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };
            }
          }
        }
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  }).from(productInspections).where(whereClause);

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate: Math.round(yieldRate * 100) / 100 };
}

export async function getMachineStats(machineId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  const conditions = [eq(productInspections.machineId, machineId)];
  if (startDate) conditions.push(gte(productInspections.inspectionTime, startDate));
  if (endDate) conditions.push(lte(productInspections.inspectionTime, endDate));

  const result = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  }).from(productInspections).where(and(...conditions));

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate: Math.round(yieldRate * 100) / 100 };
}

// ============ STATS WITH COMPARISON ============
export async function getStatsWithComparison(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}) {
  // Get current period stats
  const currentStats = await getDashboardStats(filters);
  
  // Calculate previous period (same duration)
  if (filters?.startDate && filters?.endDate) {
    const duration = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEndDate = new Date(filters.startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - duration);
    
    const prevStats = await getDashboardStats({
      ...filters,
      startDate: prevStartDate,
      endDate: prevEndDate,
    });
    
    // Calculate trends
    const outputTrend = prevStats.total > 0 
      ? ((currentStats.total - prevStats.total) / prevStats.total) * 100 
      : 0;
    const fpyTrend = prevStats.yieldRate > 0 
      ? currentStats.yieldRate - prevStats.yieldRate 
      : 0;
    
    return {
      current: currentStats,
      previous: prevStats,
      trends: {
        output: Math.round(outputTrend * 10) / 10,
        fpy: Math.round(fpyTrend * 10) / 10,
        ok: prevStats.ok > 0 ? Math.round(((currentStats.ok - prevStats.ok) / prevStats.ok) * 1000) / 10 : 0,
        ng: prevStats.ng > 0 ? Math.round(((currentStats.ng - prevStats.ng) / prevStats.ng) * 1000) / 10 : 0,
        ntf: prevStats.ntf > 0 ? Math.round(((currentStats.ntf - prevStats.ntf) / prevStats.ntf) * 1000) / 10 : 0,
      }
    };
  }
  
  return {
    current: currentStats,
    previous: null,
    trends: null,
  };
}

// ============ SHIFT STATS ============
export async function getShiftStats(filters?: {
  factoryId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Access filter by user assignments
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(filters.userId, filters.userRole || 'user');
    if (accessFilter) conditions.push(accessFilter);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Define shifts: Morning (6-14), Afternoon (14-22), Night (22-6)
  // PostgreSQL uses EXTRACT(HOUR FROM timestamp)
  const shiftExpr = sql<string>`CASE 
    WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) >= 6 AND EXTRACT(HOUR FROM ${productInspections.inspectionTime}) < 14 THEN 'morning'
    WHEN EXTRACT(HOUR FROM ${productInspections.inspectionTime}) >= 14 AND EXTRACT(HOUR FROM ${productInspections.inspectionTime}) < 22 THEN 'afternoon'
    ELSE 'night'
  END`;
  
  const result = await db.select({
    shift: shiftExpr.as('shift'),
    total: sql<number>`count(*)`.as('total'),
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`.as('ok'),
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`.as('ng'),
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`.as('ntf'),
  })
  .from(productInspections)
  .where(whereClause)
  .groupBy(sql`shift`);

  return result.map(r => ({
    shift: String(r.shift),
    shiftName: r.shift === 'morning' ? 'Ca sáng (6h-14h)' : r.shift === 'afternoon' ? 'Ca chiều (14h-22h)' : 'Ca đêm (22h-6h)',
    total: Number(r.total) || 0,
    ok: Number(r.ok) || 0,
    ng: Number(r.ng) || 0,
    ntf: Number(r.ntf) || 0,
    fpy: Number(r.total) > 0 ? Math.round(((Number(r.ok) + Number(r.ntf)) / Number(r.total)) * 1000) / 10 : 0,
  }));
}

// ============ TOP/BOTTOM MACHINES ============
export async function getTopBottomMachines(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { top: [], bottom: [] };

  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Access filter by user assignments
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(filters.userId, filters.userRole || 'user');
    if (accessFilter) conditions.push(accessFilter);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filters?.limit || 5;

  const result = await db.select({
    machineId: productInspections.machineId,
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  })
  .from(productInspections)
  .where(whereClause)
  .groupBy(productInspections.machineId)
  .having(sql`count(*) > 0`);

  // Get machine details
  const machineDetails = await db.select().from(machines);
  const machineMap = new Map(machineDetails.map(m => [m.id, m]));

  const machinesWithStats = result.map(r => {
    const machine = machineMap.get(r.machineId!);
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ntf = Number(r.ntf) || 0;
    const fpy = total > 0 ? ((ok + ntf) / total) * 100 : 0;
    return {
      id: r.machineId,
      name: machine?.name || 'Unknown',
      code: machine?.code || '',
      total,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf,
      fpy: Math.round(fpy * 10) / 10,
    };
  });

  // Sort by FPY for top/bottom
  const sorted = [...machinesWithStats].sort((a, b) => b.fpy - a.fpy);
  
  return {
    top: sorted.slice(0, limit),
    bottom: sorted.slice(-limit).reverse(),
  };
}

// ============ ACTIVE ALERTS COUNT ============
export async function getActiveAlertsCount() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select({
    count: sql<number>`count(*)`,
  })
  .from(alertHistory)
  .where(sql`${alertHistory.acknowledgedAt} IS NULL`);

  return Number(result[0]?.count) || 0;
}

// ============ DAILY STATS ============
export async function getDailyStats(factoryId?: number, workshopId?: number, days: number = 30) {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Use parameterized Drizzle query (safe from SQL injection)
  const result = await db.execute(sql`
    SELECT 
      TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD') as date,
      COUNT(*) as "totalProducts",
      SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) as "okCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) as "ngCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END) as "ntfCount"
    FROM ${productInspections}
    WHERE ${productInspections.inspectionTime} >= ${startDate.toISOString()}
    GROUP BY TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD')
    ORDER BY date DESC
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return rows.map((r: any) => ({
    date: String(r.date),
    totalProducts: Number(r.totalProducts) || 0,
    okCount: Number(r.okCount) || 0,
    ngCount: Number(r.ngCount) || 0,
    ntfCount: Number(r.ntfCount) || 0,
  }));
}

// ============ HOURLY STATS ============
export async function getHourlyStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  hours?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const hoursBack = filters?.hours || 24;
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hoursBack);

  // Build conditions array (parameterized, safe from SQL injection)
  const conditions: SQL[] = [sql`${productInspections.inspectionTime} >= ${startDate.toISOString()}`];
  if (filters?.machineId) {
    conditions.push(sql`${productInspections.machineId} = ${filters.machineId}`);
  }
  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute(sql`
    SELECT 
      TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD HH24:00') as hour,
      COUNT(*) as "totalProducts",
      SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) as "okCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) as "ngCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END) as "ntfCount"
    FROM ${productInspections}
    WHERE ${whereClause}
    GROUP BY TO_CHAR(${productInspections.inspectionTime}, 'YYYY-MM-DD HH24:00')
    ORDER BY hour ASC
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return rows.map((r: any) => {
    const total = Number(r.totalProducts) || 1;
    const ok = Number(r.okCount) || 0;
    const ng = Number(r.ngCount) || 0;
    const ntf = Number(r.ntfCount) || 0;
    return {
      hour: String(r.hour),
      total,
      ok,
      ng,
      ntf,
      fpy: ((ok / total) * 100).toFixed(1),
      fy: ((ng / total) * 100).toFixed(1),
      ntfy: ((ntf / total) * 100).toFixed(1),
    };
  });
}

// ============ SEARCH INSPECTIONS ============
export async function searchInspections(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  // Build machine IDs from hierarchy filters
  let machineIds: number[] | undefined;

  if (params.machineCode) {
    const machineResult = await db.select({ id: machines.id }).from(machines)
      .where(like(machines.code, `%${params.machineCode}%`));
    machineIds = machineResult.map(m => m.id);
  } else if (params.stationCode || params.lineCode || params.workshopCode || params.factoryCode) {
    // Build hierarchy filter
    let stationIds: number[] | undefined;
    let lineIds: number[] | undefined;
    let workshopIds: number[] | undefined;

    if (params.factoryCode) {
      const factoryResult = await db.select({ id: factories.id }).from(factories)
        .where(like(factories.code, `%${params.factoryCode}%`));
      if (factoryResult.length > 0) {
        const workshopResult = await db.select({ id: workshops.id }).from(workshops)
          .where(inArray(workshops.factoryId, factoryResult.map(f => f.id)));
        workshopIds = workshopResult.map(w => w.id);
      }
    }

    if (params.workshopCode) {
      const workshopResult = await db.select({ id: workshops.id }).from(workshops)
        .where(like(workshops.code, `%${params.workshopCode}%`));
      workshopIds = workshopIds 
        ? workshopIds.filter(id => workshopResult.some(w => w.id === id))
        : workshopResult.map(w => w.id);
    }

    if (workshopIds && workshopIds.length > 0) {
      const lineResult = await db.select({ id: productionLines.id }).from(productionLines)
        .where(inArray(productionLines.workshopId, workshopIds));
      lineIds = lineResult.map(l => l.id);
    }

    if (params.lineCode) {
      const lineResult = await db.select({ id: productionLines.id }).from(productionLines)
        .where(like(productionLines.code, `%${params.lineCode}%`));
      lineIds = lineIds
        ? lineIds.filter(id => lineResult.some(l => l.id === id))
        : lineResult.map(l => l.id);
    }

    if (lineIds && lineIds.length > 0) {
      const stationResult = await db.select({ id: stations.id }).from(stations)
        .where(inArray(stations.lineId, lineIds));
      stationIds = stationResult.map(s => s.id);
    }

    if (params.stationCode) {
      const stationResult = await db.select({ id: stations.id }).from(stations)
        .where(like(stations.code, `%${params.stationCode}%`));
      stationIds = stationIds
        ? stationIds.filter(id => stationResult.some(s => s.id === id))
        : stationResult.map(s => s.id);
    }

    if (stationIds && stationIds.length > 0) {
      const machineResult = await db.select({ id: machines.id }).from(machines)
        .where(inArray(machines.stationId, stationIds));
      machineIds = machineResult.map(m => m.id);
    }
  }

  // Build inspection query
  const conditions = [];
  if (machineIds && machineIds.length > 0) {
    conditions.push(inArray(productInspections.machineId, machineIds));
  } else if (params.factoryCode || params.workshopCode || params.lineCode || params.stationCode || params.machineCode) {
    // No machines found matching filters
    return { data: [], total: 0 };
  }

  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));

  // Apply access control for non-admin users
  if (params.userId && params.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(params.userId, params.userRole || 'user');
    if (accessFilter) {
      conditions.push(accessFilter);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db.select().from(productInspections)
      .where(whereClause)
      .orderBy(desc(productInspections.inspectionTime))
      .limit(params.limit || 50)
      .offset(params.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  return { data, total: countResult[0]?.count || 0 };
}

// ============ TOP NG MEASUREMENT POINTS ============
export async function getTopNGMeasurementPoints(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(measurementResults.result, 'NG')];

  // Build inspection-level access filter for non-admin users
  const inspectionFilterConditions: SQL[] = [];

  if (params.userId && params.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(params.userId, params.userRole || 'user');
    if (accessFilter) {
      inspectionFilterConditions.push(accessFilter);
    }
  }
  
  if (params.machineId) {
    inspectionFilterConditions.push(eq(productInspections.machineId, params.machineId));
  }

  if (params.startDate) inspectionFilterConditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) inspectionFilterConditions.push(lte(productInspections.inspectionTime, params.endDate));

  // If we have any inspection-level filters, pre-fetch matching IDs
  if (inspectionFilterConditions.length > 0) {
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(and(...inspectionFilterConditions));
    if (inspectionIds.length > 0) {
      conditions.push(inArray(measurementResults.inspectionId, inspectionIds.map(i => i.id)));
    } else {
      return [];
    }
  }

  const result = await db.select({
    pointDefId: measurementResults.pointDefId,
    ngCount: sql<number>`count(*)`.as('ng_count'),
  })
    .from(measurementResults)
    .where(and(...conditions))
    .groupBy(measurementResults.pointDefId)
    .orderBy(desc(sql`ng_count`))
    .limit(params.limit || 10);

  // Get point definition details
  const pointDefIds = result.map(r => r.pointDefId);
  if (pointDefIds.length === 0) return [];

  const pointDefs = await db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    productModelId: measurementPointDefs.productModelId,
    productCode: productModels.code,
    productName: productModels.name,
  })
    .from(measurementPointDefs)
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .where(inArray(measurementPointDefs.id, pointDefIds));

  const pointDefMap = new Map(pointDefs.map(p => [p.id, p]));

  // Get total NG count for percentage calculation
  const totalNGResult = await db.select({
    total: sql<number>`count(*)`.as('total'),
  })
    .from(measurementResults)
    .where(and(...conditions));
  const totalNG = totalNGResult[0]?.total || 0;

  return result.map(r => {
    const pointDef = pointDefMap.get(r.pointDefId);
    return {
      pointDefId: r.pointDefId,
      code: pointDef?.code || 'Unknown',
      name: pointDef?.name || 'Unknown',
      productModelId: pointDef?.productModelId || null,
      productCode: pointDef?.productCode || null,
      productName: pointDef?.productName || null,
      ngCount: Number(r.ngCount),
      percentage: totalNG > 0 ? (Number(r.ngCount) / totalNG * 100) : 0,
    };
  });
}

// ============ SEED DATA FUNCTIONS ============
export async function seedSampleData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if data already exists
  const existingFactories = await db.select().from(factories).limit(1);
  if (existingFactories.length > 0) {
    return { message: "Sample data already exists" };
  }

  // Create 3 factories
  const factoryData = [
    { code: "FAC-HN", name: "Nhà máy Hà Nội", address: "Khu CN Thăng Long, Hà Nội", region: "Miền Bắc", country: "Vietnam" },
    { code: "FAC-DN", name: "Nhà máy Đà Nẵng", address: "Khu CN Hòa Khánh, Đà Nẵng", region: "Miền Trung", country: "Vietnam" },
    { code: "FAC-HCM", name: "Nhà máy TP.HCM", address: "Khu CN Tân Bình, TP.HCM", region: "Miền Nam", country: "Vietnam" },
  ];

  const factoryIds: number[] = [];
  for (const factory of factoryData) {
    const [result] = await db.insert(factories).values(factory).returning({ id: factories.id });
    factoryIds.push(result.id);
  }

  // Create 2-4 workshops per factory
  const workshopData = [
    // Hà Nội - 3 workshops
    { factoryId: factoryIds[0], code: "WS-HN-01", name: "Xưởng lắp ráp A", floorArea: "2500" },
    { factoryId: factoryIds[0], code: "WS-HN-02", name: "Xưởng lắp ráp B", floorArea: "2000" },
    { factoryId: factoryIds[0], code: "WS-HN-03", name: "Xưởng kiểm tra", floorArea: "1500" },
    // Đà Nẵng - 2 workshops
    { factoryId: factoryIds[1], code: "WS-DN-01", name: "Xưởng sản xuất 1", floorArea: "3000" },
    { factoryId: factoryIds[1], code: "WS-DN-02", name: "Xưởng sản xuất 2", floorArea: "2500" },
    // HCM - 4 workshops
    { factoryId: factoryIds[2], code: "WS-HCM-01", name: "Xưởng SMT", floorArea: "4000" },
    { factoryId: factoryIds[2], code: "WS-HCM-02", name: "Xưởng Assembly", floorArea: "3500" },
    { factoryId: factoryIds[2], code: "WS-HCM-03", name: "Xưởng Testing", floorArea: "2000" },
    { factoryId: factoryIds[2], code: "WS-HCM-04", name: "Xưởng Packing", floorArea: "1500" },
  ];

  const workshopIds: number[] = [];
  for (const workshop of workshopData) {
    const [result] = await db.insert(workshops).values(workshop).returning({ id: workshops.id });
    workshopIds.push(result.id);
  }

  // Create production lines
  const lineData = [
    { workshopId: workshopIds[0], code: "LINE-HN-A1", name: "Dây chuyền A1" },
    { workshopId: workshopIds[0], code: "LINE-HN-A2", name: "Dây chuyền A2" },
    { workshopId: workshopIds[1], code: "LINE-HN-B1", name: "Dây chuyền B1" },
    { workshopId: workshopIds[3], code: "LINE-DN-01", name: "Dây chuyền 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT1", name: "SMT Line 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT2", name: "SMT Line 2" },
    { workshopId: workshopIds[6], code: "LINE-HCM-ASM1", name: "Assembly Line 1" },
  ];

  const lineIds: number[] = [];
  for (const line of lineData) {
    const [result] = await db.insert(productionLines).values(line).returning({ id: productionLines.id });
    lineIds.push(result.id);
  }

  // Create stations
  const stationData = [
    { lineId: lineIds[0], code: "ST-HN-A1-01", name: "Trạm kiểm tra 1", orderIndex: 1 },
    { lineId: lineIds[0], code: "ST-HN-A1-02", name: "Trạm kiểm tra 2", orderIndex: 2 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-01", name: "AOI Station 1", orderIndex: 1 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-02", name: "AOI Station 2", orderIndex: 2 },
    { lineId: lineIds[6], code: "ST-HCM-ASM1-01", name: "AVI Station 1", orderIndex: 1 },
  ];

  const stationIds: number[] = [];
  for (const station of stationData) {
    const [result] = await db.insert(stations).values(station).returning({ id: stations.id });
    stationIds.push(result.id);
  }

  // Create machines with API keys
  const { nanoid } = await import("nanoid");
  const machineData = [
    { stationId: stationIds[0], code: "AVI-HN-001", name: "AVI Machine 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[0], code: "AVI-HN-002", name: "AVI Machine 2", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[1], code: "AOI-HN-001", name: "AOI Machine 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[2], code: "AOI-HCM-001", name: "AOI SMT 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[3], code: "AOI-HCM-002", name: "AOI SMT 2", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[4], code: "AVI-HCM-001", name: "AVI Assembly 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
  ];

  for (const machine of machineData) {
    await db.insert(machines).values(machine);
  }

  // Create sample product model
  const [productModelResult] = await db.insert(productModels).values({
    code: "PCB-001",
    name: "PCB Main Board v1.0",
    description: "Main circuit board for electronic device",
    imageWidth: 1920,
    imageHeight: 1080,
  }).returning({ id: productModels.id });
  const productModelId = productModelResult.id;

  // Create sample measurement points (30 points)
  const measurementTypes = ["DIMENSION", "VISUAL", "POSITION", "COLOR", "SURFACE"] as const;
  for (let i = 1; i <= 30; i++) {
    await db.insert(measurementPointDefs).values({
      productModelId,
      code: `MP-${String(i).padStart(3, '0')}`,
      name: `Measurement Point ${i}`,
      measurementType: measurementTypes[i % measurementTypes.length],
      positionX: 50 + (i % 10) * 180,
      positionY: 50 + Math.floor(i / 10) * 300,
      radius: 15 + (i % 3) * 5,
      orderIndex: i,
    });
  }

  return { 
    message: "Sample data created successfully",
    factories: factoryIds.length,
    workshops: workshopIds.length,
    lines: lineIds.length,
    stations: stationIds.length,
    machines: machineData.length,
    productModels: 1,
    measurementPoints: 30
  };
}

// ============ SEED INSPECTION DATA ============
export async function seedInspectionData(count: number = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  const measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NTF']; // 80% OK, 10% NG, 10% NTF
  const ngReasons = ['Scratch detected', 'Dimension out of spec', 'Position shifted', 'Color mismatch', 'Surface defect'];
  
  let createdCount = 0;
  const now = new Date();

  for (let i = 0; i < count; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last 30 days
    const inspectionDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)), // 1-6 seconds
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG, make 1-3 points NG
      let pointResult: 'OK' | 'NG' = 'OK';
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // 10-20% chance each point is NG when overall is NG
        if (Math.random() < 0.15) {
          pointResult = 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' ? (Math.random() * 0.1 + 0.95).toFixed(3) : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' ? ngReasons[Math.floor(Math.random() * ngReasons.length)] : null,
      });
    }

    createdCount++;
  }

  return {
    message: `Created ${createdCount} inspection records with measurement results`,
    inspections: createdCount,
    measurementResultsPerInspection: measurementPoints.length,
  };
}

// ============ WORKSTATION ANALYTICS ============

// Get defect statistics by workstation
export async function getDefectsByWorkstation(filters?: { 
  startDate?: Date; 
  endDate?: Date; 
  productModelId?: number;
  machineId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    // Simplified query: Use LEFT JOIN to handle cases with no measurement results
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        w."processType",
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount"
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE w."isActive" = true
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      ${filters?.productModelId ? sql`AND (mpd."productModelId" IS NULL OR mpd."productModelId" = ${filters.productModelId})` : sql``}
      ${filters?.machineId ? sql`AND (pi."machineId" IS NULL OR pi."machineId" = ${filters.machineId})` : sql``}
      GROUP BY w.id, w.code, w.name, w."processType", mpd.id, mpd.code, mpd.name
      HAVING mpd.id IS NOT NULL
      ORDER BY "ngCount" DESC
    `;
    
    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      workstationId: number | null;
      workstationCode: string | null;
      workstationName: string | null;
      processType: string | null;
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
    }>;
  } catch (error) {
    console.error('getDefectsByWorkstation error:', error);
    return [];
  }
}

// Get top NG measurement points by workstation
export async function getTopNGMeasurementPointsByWorkstation(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const limitVal = filters?.limit || 10;
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount"
      FROM measurement_point_defs mpd
      LEFT JOIN workstations w ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id AND mr.result IN ('NG', 'NTF')
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE 1=1
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      GROUP BY w.id, w.code, w.name, mpd.id, mpd.code, mpd.name
      HAVING SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) > 0 OR SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END) > 0
      ORDER BY "ngCount" DESC
      LIMIT ${limitVal}
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      workstationId: number | null;
      workstationCode: string | null;
      workstationName: string | null;
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      totalCount: number;
      ngCount: number;
      ntfCount: number;
    }>;
  } catch (error) {
    console.error('getTopNGMeasurementPointsByWorkstation error:', error);
    return [];
  }
}

// Get workstation summary statistics
export async function getWorkstationSummary(filters?: { 
  startDate?: Date; 
  endDate?: Date; 
}) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        w."processType",
        COALESCE(COUNT(DISTINCT mpd.id), 0) as "measurementPointCount",
        COALESCE(COUNT(mr.id), 0) as "totalInspections",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "yieldRate"
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE w."isActive" = true
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      GROUP BY w.id, w.code, w.name, w."processType"
      ORDER BY "ngCount" DESC
    `;
    
    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      workstationId: number;
      workstationCode: string;
      workstationName: string;
      processType: string;
      measurementPointCount: number;
      totalInspections: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      yieldRate: number;
    }>;
  } catch (error) {
    console.error('getWorkstationSummary error:', error);
    return [];
  }
}


// Get measurement points by workstation with NG statistics
export async function getMeasurementPointsByWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters.startDate?.toISOString();
    const endDateStr = filters.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        mpd."measurementType" as "pointType",
        mpd."lowerLimit",
        mpd."upperLimit",
        mpd.unit,
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(AVG(mr."measuredValue"), 0) as "avgValue",
        COALESCE(MIN(mr."measuredValue"), 0) as "minValue",
        COALESCE(MAX(mr."measuredValue"), 0) as "maxValue"
      FROM measurement_point_defs mpd
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE mpd."workstationId" = ${filters.workstationId}
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."lowerLimit", mpd."upperLimit", mpd.unit
      ORDER BY "ngCount" DESC, mpd.code ASC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      pointType: string;
      lowerLimit: number | null;
      upperLimit: number | null;
      unit: string | null;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      avgValue: number;
      minValue: number;
      maxValue: number;
    }>;
  } catch (error) {
    console.error('getMeasurementPointsByWorkstation error:', error);
    return [];
  }
}

// ============ SEED WORKSTATION ANALYTICS DATA ============
export async function seedWorkstationAnalyticsData(options?: {
  inspectionCount?: number;
  daysBack?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const inspectionCount = options?.inspectionCount || 500;
  const daysBack = options?.daysBack || 7;

  // Step 1: Ensure workstations exist
  const existingWorkstations = await db.select().from(workstations);
  if (existingWorkstations.length === 0) {
    // Create default workstations
    const defaultWorkstations = [
      { code: 'WS-SMT', name: 'SMT Assembly', description: 'Surface Mount Technology', processType: 'SMT' as const, orderIndex: 1, isActive: true },
      { code: 'WS-DIP', name: 'DIP Soldering', description: 'Dual In-line Package Soldering', processType: 'DIP' as const, orderIndex: 2, isActive: true },
      { code: 'WS-AOI', name: 'AOI Inspection', description: 'Automated Optical Inspection', processType: 'TESTING' as const, orderIndex: 3, isActive: true },
      { code: 'WS-FCT', name: 'Functional Test', description: 'Functional Circuit Testing', processType: 'TESTING' as const, orderIndex: 4, isActive: true },
      { code: 'WS-PKG', name: 'Packaging', description: 'Final Packaging', processType: 'PACKAGING' as const, orderIndex: 5, isActive: true },
    ];

    for (const ws of defaultWorkstations) {
      await db.insert(workstations).values(ws);
    }
    console.log(`Created ${defaultWorkstations.length} default workstations`);
  }

  // Step 2: Get all workstations
  const allWorkstations = await db.select().from(workstations).where(eq(workstations.isActive, true));
  if (allWorkstations.length === 0) {
    throw new Error("No active workstations found");
  }

  // Step 3: Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Step 4: Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  // Step 5: Get measurement points and assign workstations if not assigned
  let measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  if (measurementPoints.length === 0) {
    throw new Error("No measurement points found. Please create measurement points first.");
  }

  // Assign workstations to measurement points if not already assigned
  let assignedCount = 0;
  for (let i = 0; i < measurementPoints.length; i++) {
    const point = measurementPoints[i];
    if (!point.workstationId) {
      const workstation = allWorkstations[i % allWorkstations.length];
      await db.update(measurementPointDefs)
        .set({ workstationId: workstation.id })
        .where(eq(measurementPointDefs.id, point.id));
      assignedCount++;
    }
  }
  if (assignedCount > 0) {
    console.log(`Assigned workstations to ${assignedCount} measurement points`);
    // Refresh measurement points
    measurementPoints = await db.select().from(measurementPointDefs)
      .where(eq(measurementPointDefs.productModelId, productModelId));
  }

  // Step 6: Generate inspection data
  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NG', 'NTF']; // 70% OK, 20% NG, 10% NTF
  const ngReasons = [
    'Scratch detected', 
    'Dimension out of spec', 
    'Position shifted', 
    'Color mismatch', 
    'Surface defect',
    'Solder bridge',
    'Missing component',
    'Wrong polarity',
    'Cold solder joint',
    'Tombstone effect'
  ];
  
  let createdInspections = 0;
  let createdResults = 0;
  const now = new Date();

  for (let i = 0; i < inspectionCount; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last N days
    const inspectionDate = new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-WS-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-WS-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)),
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;
    createdInspections++;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG/NTF, make some points NG based on workstation
      let pointResult: 'OK' | 'NG' | 'NTF' = 'OK';
      
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // Higher chance of NG for certain workstations (simulate real-world patterns)
        const workstation = allWorkstations.find(ws => ws.id === point.workstationId);
        let ngProbability = 0.15; // default 15%
        
        if (workstation) {
          // SMT and DIP have higher defect rates
          if (workstation.code === 'WS-SMT') ngProbability = 0.25;
          else if (workstation.code === 'WS-DIP') ngProbability = 0.20;
          else if (workstation.code === 'WS-AOI') ngProbability = 0.10;
        }
        
        if (Math.random() < ngProbability) {
          pointResult = overallResult === 'NTF' ? 'NTF' : 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' 
          ? (Math.random() * 0.1 + 0.95).toFixed(3) 
          : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' || pointResult === 'NTF' 
          ? ngReasons[Math.floor(Math.random() * ngReasons.length)] 
          : null,
      });
      createdResults++;
    }
  }

  return {
    message: `Created ${createdInspections} inspection records with ${createdResults} measurement results`,
    inspections: createdInspections,
    measurementResults: createdResults,
    workstationsUsed: allWorkstations.length,
    measurementPointsPerInspection: measurementPoints.length,
  };
}


// ============ NG TREND AND COMPARISON FUNCTIONS ============

// Get NG trend data by day
export async function getNGTrendByDay(filters?: {
  startDate?: Date;
  endDate?: Date;
  workstationId?: number;
  measurementPointDefId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        CAST(pi."inspectionTime" AS DATE) as date,
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
      WHERE pi."inspectionTime" IS NOT NULL
      ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
      ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
      ${filters?.workstationId ? sql`AND mpd."workstationId" = ${filters.workstationId}` : sql``}
      ${filters?.measurementPointDefId ? sql`AND mr."pointDefId" = ${filters.measurementPointDefId}` : sql``}
      GROUP BY CAST(pi."inspectionTime" AS DATE)
      ORDER BY date ASC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    // V3: postgres.js returns COUNT/SUM (bigint) and ROUND (numeric) as STRINGS. The API
    // contract (and every consumer: charts, PDF/PPT reports, report builder) expects numbers,
    // so coerce the numeric columns here at the source rather than in each caller.
    return ((rows as any[]) ?? []).map((r) => ({
      date: String(r.date),
      totalCount: Number(r.totalCount),
      okCount: Number(r.okCount),
      ngCount: Number(r.ngCount),
      ntfCount: Number(r.ntfCount),
      ngRate: Number(r.ngRate),
    })) as Array<{
      date: string;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      ngRate: number;
    }>;
  } catch (error) {
    console.error('getNGTrendByDay error:', error);
    return [];
  }
}

// Get NG comparison between two periods
export async function getNGComparison(filters: {
  currentStartDate: Date;
  currentEndDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
}) {
  const db = await getDb();
  if (!db) return null;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const currentStartStr = filters.currentStartDate.toISOString();
    const currentEndStr = filters.currentEndDate.toISOString();
    const previousStartStr = filters.previousStartDate.toISOString();
    const previousEndStr = filters.previousEndDate.toISOString();
    
    // Get current period stats
    const currentQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE pi."inspectionTime" >= ${currentStartStr}
        AND pi."inspectionTime" <= ${currentEndStr}
    `;

    // Get previous period stats
    const previousQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE pi."inspectionTime" >= ${previousStartStr}
        AND pi."inspectionTime" <= ${previousEndStr}
    `;

    const [currentResult, previousResult] = await Promise.all([
      db.execute(currentQuery),
      db.execute(previousQuery),
    ]);

    const current = ((currentResult as any).rows?.[0] || (currentResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };
    const previous = ((previousResult as any).rows?.[0] || (previousResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };

    // Calculate changes
    const ngRateChange = Number(current.ngRate) - Number(previous.ngRate);
    const totalCountChange = Number(current.totalCount) - Number(previous.totalCount);
    const ngCountChange = Number(current.ngCount) - Number(previous.ngCount);

    return {
      current: {
        totalCount: Number(current.totalCount),
        okCount: Number(current.okCount),
        ngCount: Number(current.ngCount),
        ntfCount: Number(current.ntfCount),
        ngRate: Number(current.ngRate),
      },
      previous: {
        totalCount: Number(previous.totalCount),
        okCount: Number(previous.okCount),
        ngCount: Number(previous.ngCount),
        ntfCount: Number(previous.ntfCount),
        ngRate: Number(previous.ngRate),
      },
      changes: {
        ngRateChange,
        ngRateChangePercent: previous.ngRate > 0 ? (ngRateChange / Number(previous.ngRate)) * 100 : 0,
        totalCountChange,
        totalCountChangePercent: previous.totalCount > 0 ? (totalCountChange / Number(previous.totalCount)) * 100 : 0,
        ngCountChange,
        ngCountChangePercent: previous.ngCount > 0 ? (ngCountChange / Number(previous.ngCount)) * 100 : 0,
        isImproved: ngRateChange < 0, // NG rate decreased = improved
      },
    };
  } catch (error) {
    console.error('getNGComparison error:', error);
    return null;
  }
}

// ============ FALLBACK NG FUNCTIONS (product_inspections-based) ============

// Get NG summary by machine (fallback when workstation data is unavailable)
export async function getNGSummaryByMachine(filters?: {
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();

    const query = sql`
      SELECT 
        m.id as "machineId",
        m.code as "machineCode",
        m.name as "machineName",
        COALESCE(COUNT(pi.id), 0) as "totalInspections",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "yieldRate"
      FROM machines m
      LEFT JOIN product_inspections pi ON pi."machineId" = m.id
        ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
        ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
      WHERE m."isActive" = true
      GROUP BY m.id, m.code, m.name
      ORDER BY "ngCount" DESC
    `;

    const result = await db.execute(query);
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      machineId: number;
      machineCode: string;
      machineName: string;
      totalInspections: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      yieldRate: number;
    }>;
  } catch (error) {
    console.error('getNGSummaryByMachine error:', error);
    return [];
  }
}

// Get NG trend by day from product_inspections directly (fallback)
export async function getNGTrendByDayDirect(filters?: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();

    const query = sql`
      SELECT 
        CAST(pi."inspectionTime" AS DATE) as date,
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" IS NOT NULL
      ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
      ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
      ${filters?.machineId ? sql`AND pi."machineId" = ${filters.machineId}` : sql``}
      GROUP BY CAST(pi."inspectionTime" AS DATE)
      ORDER BY date ASC
    `;

    const result = await db.execute(query);
    const rows = (result as any).rows || result;
    return (rows as unknown) as Array<{
      date: string;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      ngRate: number;
    }>;
  } catch (error) {
    console.error('getNGTrendByDayDirect error:', error);
    return [];
  }
}

// Get NG comparison from product_inspections directly (fallback)
export async function getNGComparisonDirect(filters: {
  currentStartDate: Date;
  currentEndDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
}) {
  const db = await getDb();
  if (!db) return null;

  try {
    const currentStartStr = filters.currentStartDate.toISOString();
    const currentEndStr = filters.currentEndDate.toISOString();
    const previousStartStr = filters.previousStartDate.toISOString();
    const previousEndStr = filters.previousEndDate.toISOString();

    const currentQuery = sql`
      SELECT 
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" >= ${currentStartStr}
        AND pi."inspectionTime" <= ${currentEndStr}
    `;

    const previousQuery = sql`
      SELECT 
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" >= ${previousStartStr}
        AND pi."inspectionTime" <= ${previousEndStr}
    `;

    const [currentResult, previousResult] = await Promise.all([
      db.execute(currentQuery),
      db.execute(previousQuery),
    ]);

    const current = ((currentResult as any).rows?.[0] || (currentResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };
    const previous = ((previousResult as any).rows?.[0] || (previousResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };

    const ngRateChange = Number(current.ngRate) - Number(previous.ngRate);
    const totalCountChange = Number(current.totalCount) - Number(previous.totalCount);
    const ngCountChange = Number(current.ngCount) - Number(previous.ngCount);

    return {
      current: {
        totalCount: Number(current.totalCount),
        okCount: Number(current.okCount),
        ngCount: Number(current.ngCount),
        ntfCount: Number(current.ntfCount),
        ngRate: Number(current.ngRate),
      },
      previous: {
        totalCount: Number(previous.totalCount),
        okCount: Number(previous.okCount),
        ngCount: Number(previous.ngCount),
        ntfCount: Number(previous.ntfCount),
        ngRate: Number(previous.ngRate),
      },
      changes: {
        ngRateChange,
        ngRateChangePercent: previous.ngRate > 0 ? (ngRateChange / Number(previous.ngRate)) * 100 : 0,
        totalCountChange,
        totalCountChangePercent: previous.totalCount > 0 ? (totalCountChange / Number(previous.totalCount)) * 100 : 0,
        ngCountChange,
        ngCountChangePercent: previous.ngCount > 0 ? (ngCountChange / Number(previous.ngCount)) * 100 : 0,
        isImproved: ngRateChange < 0,
      },
    };
  } catch (error) {
    console.error('getNGComparisonDirect error:', error);
    return null;
  }
}

// Get gallery images from measurement_results joined with product_inspections
export async function getGalleryImages(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  // Reuse searchInspections to get matching inspection IDs
  const inspectionResult = await searchInspections({
    ...params,
    limit: params.limit || 100,
    offset: params.offset || 0,
  });

  if (inspectionResult.data.length === 0) {
    return { data: [], total: 0 };
  }

  const inspectionIds = inspectionResult.data.map(i => i.id);

  // Fetch measurement results with images for these inspections
  const results = await db.select({
    id: measurementResults.id,
    inspectionId: measurementResults.inspectionId,
    pointDefId: measurementResults.pointDefId,
    measuredValue: measurementResults.measuredValue,
    measuredValueText: measurementResults.measuredValueText,
    result: measurementResults.result,
    imageUrl: measurementResults.imageUrl,
    imageKey: measurementResults.imageKey,
    remark: measurementResults.remark,
    createdAt: measurementResults.createdAt,
    // Point def info
    pointCode: measurementPointDefs.code,
    pointName: measurementPointDefs.name,
    // Inspection info
    serialNumber: productInspections.serialNumber,
    overallResult: productInspections.overallResult,
    inspectionTime: productInspections.inspectionTime,
    productModel: productInspections.productModel,
  }).from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .where(
      and(
        inArray(measurementResults.inspectionId, inspectionIds),
        sql`${measurementResults.imageUrl} IS NOT NULL AND ${measurementResults.imageUrl} != ''`
      )
    )
    .orderBy(desc(productInspections.inspectionTime), measurementResults.id);

  return {
    data: results,
    total: results.length,
    inspectionCount: inspectionResult.total,
  };
}


// ============ CORPORATE/FACTORY STATISTICS FUNCTIONS ============
export async function getYieldRateByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(inArray(productInspections.corporateCode, corporateCodes));
    } else {
      // User has no corporate assignments, return empty
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalInspections) > 0 
      ? (Number(r.okCount) / Number(r.totalInspections) * 100).toFixed(2)
      : '0.00',
  }));
}

export async function getYieldRateByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalInspections) > 0 
      ? (Number(r.okCount) / Number(r.totalInspections) * 100).toFixed(2)
      : '0.00',
  }));
}

export async function getThroughputByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(inArray(productInspections.corporateCode, corporateCodes));
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_TRUNC('hour', ${productInspections.inspectionTime})`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_TRUNC('week', ${productInspections.inspectionTime})`;
  } else {
    dateFormat = sql`CAST(${productInspections.inspectionTime} AS DATE)`;
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, dateFormat)
    .orderBy(dateFormat);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}

export async function getThroughputByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_TRUNC('hour', ${productInspections.inspectionTime})`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_TRUNC('week', ${productInspections.inspectionTime})`;
  } else {
    dateFormat = sql`CAST(${productInspections.inspectionTime} AS DATE)`;
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode, dateFormat)
    .orderBy(dateFormat);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}


// ============ TOP NG ANALYSIS FUNCTIONS (ENHANCED) ============

export async function getTopNGMeasurementPointsEnhanced(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
  productModelId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const limitCount = filters.limit || 10;
  const conditions: SQL[] = [];
  
  // Join with inspections to filter by date and factory
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  if (filters.productModelId) {
    conditions.push(eq(productInspections.productModelId, filters.productModelId));
  }
  
  // Filter for NG results only
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const results = await db
    .select({
      measurementPointId: measurementResults.pointDefId,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      measurementType: measurementPointDefs.measurementType,
      productModelId: measurementPointDefs.productModelId,
      productCode: productModels.code,
      productName: productModels.name,
      ngCount: sql<number>`COUNT(*)`,
      totalCount: sql<number>`(
        SELECT COUNT(*) FROM measurement_results mr2 
        WHERE mr2."pointDefId" = ${measurementResults.pointDefId}
      )`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementResults.pointDefId, measurementPointDefs.code, measurementPointDefs.name, measurementPointDefs.measurementType, measurementPointDefs.productModelId, productModels.code, productModels.name)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limitCount);
  
  return results.map((r, index) => ({
    rank: index + 1,
    measurementPointId: r.measurementPointId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    measurementType: r.measurementType || 'OTHER',
    productModelId: r.productModelId || null,
    productCode: r.productCode || null,
    productName: r.productName || null,
    ngCount: Number(r.ngCount),
    totalCount: Number(r.totalCount),
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2)
      : '0.00',
    // For Pareto chart - cumulative percentage
    cumulativePercent: 0, // Will be calculated in router
  }));
}

// ============ TREND ANALYSIS FUNCTIONS ============

export async function getYieldTrendData(filters: {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryCode?: string;
  interval?: 'hour' | 'day' | 'week' | 'month';
}) {
  const db = await getDb();
  if (!db) return [];
  
  const interval = filters.interval || 'day';
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, filters.startDate),
    lte(productInspections.inspectionTime, filters.endDate),
  ];
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_TRUNC('hour', ${productInspections.inspectionTime})`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_TRUNC('week', ${productInspections.inspectionTime})`;
  } else if (interval === 'month') {
    dateFormat = sql`DATE_TRUNC('month', ${productInspections.inspectionTime})`;
  } else {
    dateFormat = sql`CAST(${productInspections.inspectionTime} AS DATE)`;
  }
  
  const results = await db
    .select({
      timeInterval: dateFormat.as('timeInterval'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(dateFormat)
    .orderBy(dateFormat);
  
  return results.map(r => ({
    timeInterval: r.timeInterval,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalCount) > 0 
      ? ((Number(r.okCount) / Number(r.totalCount)) * 100)
      : 0,
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  }));
}

// ============ ANOMALY DETECTION FUNCTIONS ============

export async function getRecentYieldData(filters: {
  machineId?: number;
  factoryCode?: string;
  days?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const days = filters.days || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
  ];
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const results = await db
    .select({
      date: sql`CAST(${productInspections.inspectionTime} AS DATE)`.as('date'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`date`)
    .orderBy(sql`date`);
  
  return results.map(r => ({
    date: r.date,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    yieldRate: Number(r.totalCount) > 0 
      ? ((Number(r.okCount) / Number(r.totalCount)) * 100)
      : 0,
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  }));
}

// ============ WORKSTATION ANALYSIS FUNCTIONS ============

export async function getNGByWorkstation(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  // Filter for NG results
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  // First get NG counts
  const ngResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      workstationCode: workstations.code,
      workstationName: workstations.name,
      processType: workstations.processType,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.workstationId, workstations.code, workstations.name, workstations.processType)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per workstation (all results, not just NG)
  const totalConditions: SQL[] = [];
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = totalConditions.length > 0 ? and(...totalConditions) : undefined;
  
  const totalResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.workstationId);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.workstationId, Number(r.totalCount)]));
  
  return ngResults.map(r => ({
    workstationId: r.workstationId,
    workstationCode: r.workstationCode || 'N/A',
    workstationName: r.workstationName || 'Unknown',
    processType: r.processType || 'OTHER',
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.workstationId) || Number(r.ngCount),
  }));
}


// ============ WORKSTATION-MEASUREMENT POINT LINKED ANALYSIS ============

export async function getNGByMeasurementPointForWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
    eq(measurementResults.result, 'NG'),
  ];
  
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const whereClause = and(...conditions);
  
  // Get NG counts by measurement point
  const ngResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.id, measurementPointDefs.code, measurementPointDefs.name)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per measurement point (all results)
  const totalConditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
  ];
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = and(...totalConditions);
  
  const totalResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.id);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.pointDefId, Number(r.totalCount)]));
  
  return ngResults.map(r => ({
    pointDefId: r.pointDefId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.pointDefId) || Number(r.ngCount),
  }));
}

// Get linked measurement points for a workstation
export async function getLinkedMeasurementPointsForWorkstation(workstationId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    unit: measurementPointDefs.unit,
    lowerLimit: measurementPointDefs.lowerLimit,
    upperLimit: measurementPointDefs.upperLimit,
    nominalValue: measurementPointDefs.nominalValue,
    productModelId: measurementPointDefs.productModelId,
  })
  .from(measurementPointDefs)
  .where(eq(measurementPointDefs.workstationId, workstationId))
  .orderBy(measurementPointDefs.code);
}

// ============ MEASUREMENT POINT STATISTICS BY PRODUCT ============
export async function getMeasurementPointStatsByProduct(params: {
  productModelId: number;
  startDate: Date;
  endDate: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const startStr = params.startDate.toISOString();
  const endStr = params.endDate.toISOString();

  const result = await db.execute(sql`
    SELECT
      mpd.id AS "pointDefId",
      mpd.code AS "pointCode",
      mpd.name AS "pointName",
      mpd."measurementType",
      mpd.unit,
      mpd."lowerLimit",
      mpd."upperLimit",
      mpd."nominalValue",
      COALESCE(stats."totalCount", 0) AS "totalCount",
      COALESCE(stats."okCount", 0) AS "okCount",
      COALESCE(stats."ngCount", 0) AS "ngCount",
      COALESCE(stats."minValue", NULL) AS "minValue",
      COALESCE(stats."maxValue", NULL) AS "maxValue",
      COALESCE(stats."avgValue", NULL) AS "avgValue"
    FROM measurement_point_defs mpd
    LEFT JOIN LATERAL (
      SELECT
        COUNT(mr.id) AS "totalCount",
        SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
        SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
        MIN(mr."measuredValue"::numeric) AS "minValue",
        MAX(mr."measuredValue"::numeric) AS "maxValue",
        AVG(mr."measuredValue"::numeric) AS "avgValue"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE mr."pointDefId" = mpd.id
        AND pi."productModelId" = ${params.productModelId}
        AND pi."inspectionTime" >= ${startStr}::timestamp
        AND pi."inspectionTime" <= ${endStr}::timestamp
    ) stats ON true
    WHERE mpd."productModelId" = ${params.productModelId}
      AND mpd."isActive" = true
    ORDER BY mpd."orderIndex", mpd.code
  `);

  const rows = (result as any).rows || (result as any);
  return (rows as any[]).map((r: any) => ({
    pointDefId: Number(r.pointDefId),
    pointCode: r.pointCode || '',
    pointName: r.pointName || '',
    measurementType: r.measurementType || 'OTHER',
    unit: r.unit || '',
    lowerLimit: r.lowerLimit != null ? Number(r.lowerLimit) : null,
    upperLimit: r.upperLimit != null ? Number(r.upperLimit) : null,
    nominalValue: r.nominalValue != null ? Number(r.nominalValue) : null,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ngRate: Number(r.totalCount) > 0
      ? Number(((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2))
      : 0,
    minValue: r.minValue != null ? Number(Number(r.minValue).toFixed(6)) : null,
    maxValue: r.maxValue != null ? Number(Number(r.maxValue).toFixed(6)) : null,
    avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
  }));
}

/**
 * Lấy danh sách ảnh (OK/NG) cho từng điểm đo theo sản phẩm trong khoảng thời gian
 */
export async function getMeasurementPointImagesByProduct(params: {
  productModelId: number;
  startDate: Date;
  endDate: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const startStr = params.startDate.toISOString();
  const endStr = params.endDate.toISOString();

  const result = await db.execute(sql`
    SELECT
      mr."pointDefId",
      mr.result,
      mr."imageUrl",
      mr."measuredValue",
      pi."serialNumber",
      pi."inspectionTime"
    FROM measurement_results mr
    INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
    WHERE pi."productModelId" = ${params.productModelId}
      AND pi."inspectionTime" >= ${startStr}::timestamp
      AND pi."inspectionTime" <= ${endStr}::timestamp
      AND mr."imageUrl" IS NOT NULL
      AND mr."imageUrl" != ''
    ORDER BY mr."pointDefId", pi."inspectionTime" DESC
  `);

  const rows = (result as any).rows || (result as any);

  // Group by pointDefId
  const grouped: Record<number, { okImages: any[]; ngImages: any[] }> = {};
  for (const r of rows as any[]) {
    const pointDefId = Number(r.pointDefId);
    if (!grouped[pointDefId]) {
      grouped[pointDefId] = { okImages: [], ngImages: [] };
    }
    const img = {
      imageUrl: r.imageUrl,
      measuredValue: r.measuredValue != null ? Number(r.measuredValue) : null,
      serialNumber: r.serialNumber || '',
      inspectionTime: r.inspectionTime,
    };
    if (r.result === 'OK') {
      grouped[pointDefId].okImages.push(img);
    } else {
      grouped[pointDefId].ngImages.push(img);
    }
  }

  return grouped;
}
