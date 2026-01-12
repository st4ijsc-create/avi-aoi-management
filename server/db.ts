import { eq, and, desc, gte, lte, like, sql, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users,
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  productInspections, InsertProductInspection,
  measurementPointDefs, InsertMeasurementPointDef,
  measurementResults, InsertMeasurementResult,
  factoryLayouts, InsertFactoryLayout,
  machinePositions, InsertMachinePosition,
  dailyStatistics, InsertDailyStatistics
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER FUNCTIONS ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ FACTORY FUNCTIONS ============
export async function createFactory(data: InsertFactory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factories).values(data);
  return result[0].insertId;
}

export async function getFactories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factories).where(eq(factories.isActive, true)).orderBy(factories.name);
}

export async function getFactoryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factories).where(eq(factories.id, id)).limit(1);
  return result[0];
}

export async function updateFactory(id: number, data: Partial<InsertFactory>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set(data).where(eq(factories.id, id));
}

// ============ WORKSHOP FUNCTIONS ============
export async function createWorkshop(data: InsertWorkshop) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(workshops).values(data);
  return result[0].insertId;
}

export async function getWorkshopsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops)
    .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)))
    .orderBy(workshops.name);
}

export async function getWorkshops() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops).where(eq(workshops.isActive, true)).orderBy(workshops.name);
}

// ============ PRODUCTION LINE FUNCTIONS ============
export async function createProductionLine(data: InsertProductionLine) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productionLines).values(data);
  return result[0].insertId;
}

export async function getProductionLinesByWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines)
    .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)))
    .orderBy(productionLines.name);
}

export async function getProductionLines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines).where(eq(productionLines.isActive, true)).orderBy(productionLines.name);
}

// ============ STATION FUNCTIONS ============
export async function createStation(data: InsertStation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(stations).values(data);
  return result[0].insertId;
}

export async function getStationsByLine(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)))
    .orderBy(stations.orderIndex);
}

export async function getStations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations).where(eq(stations.isActive, true)).orderBy(stations.orderIndex);
}

// ============ MACHINE FUNCTIONS ============
export async function createMachine(data: InsertMachine) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(machines).values(data);
  return result[0].insertId;
}

export async function getMachinesByStation(stationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines)
    .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)))
    .orderBy(machines.name);
}

export async function getMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines).where(eq(machines.isActive, true)).orderBy(machines.name);
}

export async function getMachineByApiKey(apiKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.apiKey, apiKey), eq(machines.isActive, true)))
    .limit(1);
  return result[0];
}

export async function getMachineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  return result[0];
}

export async function updateMachineHeartbeat(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ lastHeartbeat: new Date() }).where(eq(machines.id, id));
}

// ============ PRODUCT INSPECTION FUNCTIONS ============
export async function createProductInspection(data: InsertProductInspection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productInspections).values(data);
  return result[0].insertId;
}

export async function getProductInspections(filters: {
  machineId?: number;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));
  if (filters.serialNumber) conditions.push(like(productInspections.serialNumber, `%${filters.serialNumber}%`));
  if (filters.result) conditions.push(eq(productInspections.overallResult, filters.result));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db.select().from(productInspections)
      .where(whereClause)
      .orderBy(desc(productInspections.inspectionTime))
      .limit(filters.limit || 50)
      .offset(filters.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  return { data, total: countResult[0]?.count || 0 };
}

export async function getProductInspectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productInspections).where(eq(productInspections.id, id)).limit(1);
  return result[0];
}

export async function updateProductInspectionNTF(id: number, userId: number, reason: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productInspections).set({
    overallResult: "NTF",
    ntfConfirmedBy: userId,
    ntfConfirmedAt: new Date(),
    ntfReason: reason
  }).where(eq(productInspections.id, id));
}

// ============ MEASUREMENT POINT DEFINITION FUNCTIONS ============
export async function createMeasurementPointDef(data: InsertMeasurementPointDef) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(measurementPointDefs).values(data);
  return result[0].insertId;
}

export async function getMeasurementPointDefsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.machineId, machineId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.name);
}

export async function getMeasurementPointDefByCode(machineId: number, code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.machineId, machineId),
      eq(measurementPointDefs.code, code)
    ))
    .limit(1);
  return result[0];
}

// ============ MEASUREMENT RESULT FUNCTIONS ============
export async function createMeasurementResult(data: InsertMeasurementResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(measurementResults).values(data);
  return result[0].insertId;
}

export async function createMeasurementResults(dataList: InsertMeasurementResult[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataList.length === 0) return;
  await db.insert(measurementResults).values(dataList);
}

export async function getMeasurementResultsByInspection(inspectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementResults)
    .where(eq(measurementResults.inspectionId, inspectionId))
    .orderBy(measurementResults.id);
}

export async function getMeasurementResultById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementResults).where(eq(measurementResults.id, id)).limit(1);
  return result[0];
}

export async function updateMeasurementResultRemark(id: number, remark: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementResults).set({ remark }).where(eq(measurementResults.id, id));
}

// ============ FACTORY LAYOUT FUNCTIONS ============
export async function createFactoryLayout(data: InsertFactoryLayout) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factoryLayouts).values(data);
  return result[0].insertId;
}

export async function getFactoryLayoutsByWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.workshopId, workshopId), eq(factoryLayouts.isActive, true)))
    .orderBy(factoryLayouts.name);
}

export async function getFactoryLayoutById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factoryLayouts).where(eq(factoryLayouts.id, id)).limit(1);
  return result[0];
}

export async function updateFactoryLayout(id: number, data: Partial<InsertFactoryLayout>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factoryLayouts).set(data).where(eq(factoryLayouts.id, id));
}

// ============ MACHINE POSITION FUNCTIONS ============
export async function createMachinePosition(data: InsertMachinePosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(machinePositions).values(data);
  return result[0].insertId;
}

export async function getMachinePositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machinePositions)
    .where(eq(machinePositions.layoutId, layoutId));
}

export async function updateMachinePosition(id: number, data: Partial<InsertMachinePosition>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machinePositions).set(data).where(eq(machinePositions.id, id));
}

export async function deleteMachinePosition(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(machinePositions).where(eq(machinePositions.id, id));
}

// ============ DAILY STATISTICS FUNCTIONS ============
export async function upsertDailyStatistics(data: InsertDailyStatistics) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(dailyStatistics).values(data).onDuplicateKeyUpdate({
    set: {
      totalCount: data.totalCount,
      okCount: data.okCount,
      ngCount: data.ngCount,
      ntfCount: data.ntfCount,
      yieldRate: data.yieldRate
    }
  });
}

export async function getDailyStatistics(machineId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyStatistics)
    .where(and(
      eq(dailyStatistics.machineId, machineId),
      gte(dailyStatistics.date, startDate),
      lte(dailyStatistics.date, endDate)
    ))
    .orderBy(dailyStatistics.date);
}

// ============ DASHBOARD STATISTICS ============
export async function getDashboardStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // If we have location filters, we need to join with machines -> stations -> lines -> workshops -> factories
  let query;
  if (filters?.factoryId || filters?.workshopId || filters?.lineId) {
    // Complex query with joins - simplified version
    const machineIds: number[] = [];
    
    if (filters.lineId) {
      const stationList = await db.select({ id: stations.id }).from(stations).where(eq(stations.lineId, filters.lineId));
      for (const station of stationList) {
        const machineList = await db.select({ id: machines.id }).from(machines).where(eq(machines.stationId, station.id));
        machineIds.push(...machineList.map(m => m.id));
      }
    } else if (filters.workshopId) {
      const lineList = await db.select({ id: productionLines.id }).from(productionLines).where(eq(productionLines.workshopId, filters.workshopId));
      for (const line of lineList) {
        const stationList = await db.select({ id: stations.id }).from(stations).where(eq(stations.lineId, line.id));
        for (const station of stationList) {
          const machineList = await db.select({ id: machines.id }).from(machines).where(eq(machines.stationId, station.id));
          machineIds.push(...machineList.map(m => m.id));
        }
      }
    } else if (filters.factoryId) {
      const workshopList = await db.select({ id: workshops.id }).from(workshops).where(eq(workshops.factoryId, filters.factoryId));
      for (const workshop of workshopList) {
        const lineList = await db.select({ id: productionLines.id }).from(productionLines).where(eq(productionLines.workshopId, workshop.id));
        for (const line of lineList) {
          const stationList = await db.select({ id: stations.id }).from(stations).where(eq(stations.lineId, line.id));
          for (const station of stationList) {
            const machineList = await db.select({ id: machines.id }).from(machines).where(eq(machines.stationId, station.id));
            machineIds.push(...machineList.map(m => m.id));
          }
        }
      }
    }

    if (machineIds.length > 0) {
      conditions.push(sql`${productInspections.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`
  }).from(productInspections).where(whereClause);

  const stats = result[0];
  const total = Number(stats?.total) || 0;
  const ok = Number(stats?.ok) || 0;
  const ng = Number(stats?.ng) || 0;
  const ntf = Number(stats?.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate };
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
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`
  }).from(productInspections).where(and(...conditions));

  const stats = result[0];
  const total = Number(stats?.total) || 0;
  const ok = Number(stats?.ok) || 0;
  const ng = Number(stats?.ng) || 0;
  const ntf = Number(stats?.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate };
}

// ============ SEARCH FUNCTIONS ============
export async function searchInspections(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  // Build machine IDs based on hierarchy filters
  let machineIds: number[] = [];
  let filterByMachine = false;

  if (params.machineCode) {
    filterByMachine = true;
    const machineList = await db.select({ id: machines.id }).from(machines)
      .where(like(machines.code, `%${params.machineCode}%`));
    machineIds = machineList.map(m => m.id);
  } else if (params.stationCode) {
    filterByMachine = true;
    const stationList = await db.select({ id: stations.id }).from(stations)
      .where(like(stations.code, `%${params.stationCode}%`));
    for (const station of stationList) {
      const machineList = await db.select({ id: machines.id }).from(machines)
        .where(eq(machines.stationId, station.id));
      machineIds.push(...machineList.map(m => m.id));
    }
  } else if (params.lineCode) {
    filterByMachine = true;
    const lineList = await db.select({ id: productionLines.id }).from(productionLines)
      .where(like(productionLines.code, `%${params.lineCode}%`));
    for (const line of lineList) {
      const stationList = await db.select({ id: stations.id }).from(stations)
        .where(eq(stations.lineId, line.id));
      for (const station of stationList) {
        const machineList = await db.select({ id: machines.id }).from(machines)
          .where(eq(machines.stationId, station.id));
        machineIds.push(...machineList.map(m => m.id));
      }
    }
  } else if (params.workshopCode) {
    filterByMachine = true;
    const workshopList = await db.select({ id: workshops.id }).from(workshops)
      .where(like(workshops.code, `%${params.workshopCode}%`));
    for (const workshop of workshopList) {
      const lineList = await db.select({ id: productionLines.id }).from(productionLines)
        .where(eq(productionLines.workshopId, workshop.id));
      for (const line of lineList) {
        const stationList = await db.select({ id: stations.id }).from(stations)
          .where(eq(stations.lineId, line.id));
        for (const station of stationList) {
          const machineList = await db.select({ id: machines.id }).from(machines)
            .where(eq(machines.stationId, station.id));
          machineIds.push(...machineList.map(m => m.id));
        }
      }
    }
  } else if (params.factoryCode) {
    filterByMachine = true;
    const factoryList = await db.select({ id: factories.id }).from(factories)
      .where(like(factories.code, `%${params.factoryCode}%`));
    for (const factory of factoryList) {
      const workshopList = await db.select({ id: workshops.id }).from(workshops)
        .where(eq(workshops.factoryId, factory.id));
      for (const workshop of workshopList) {
        const lineList = await db.select({ id: productionLines.id }).from(productionLines)
          .where(eq(productionLines.workshopId, workshop.id));
        for (const line of lineList) {
          const stationList = await db.select({ id: stations.id }).from(stations)
            .where(eq(stations.lineId, line.id));
          for (const station of stationList) {
            const machineList = await db.select({ id: machines.id }).from(machines)
              .where(eq(machines.stationId, station.id));
            machineIds.push(...machineList.map(m => m.id));
          }
        }
      }
    }
  }

  const conditions = [];
  if (filterByMachine && machineIds.length > 0) {
    conditions.push(sql`${productInspections.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`);
  } else if (filterByMachine && machineIds.length === 0) {
    return { data: [], total: 0 };
  }

  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));

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
