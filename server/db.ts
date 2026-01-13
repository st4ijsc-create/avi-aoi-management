import { eq, and, desc, gte, lte, like, sql, or, isNull } from "drizzle-orm";
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
  dailyStatistics, InsertDailyStatistics,
  productModels, InsertProductModel,
  workshopPositions, InsertWorkshopPosition,
  factoryPositions, InsertFactoryPosition,
  alertSettings, InsertAlertSetting,
  alertHistory, InsertAlertHistory,
  productMachineMappings, InsertProductMachineMapping,
  shiftConfigs, InsertShiftConfig
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

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: 'user' | 'admin') {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.delete(users).where(eq(users.id, userId));
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

export async function deleteFactory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set({ isActive: false }).where(eq(factories.id, id));
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

export async function getWorkshopById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1);
  return result[0];
}

export async function updateWorkshop(id: number, data: Partial<InsertWorkshop>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set(data).where(eq(workshops.id, id));
}

export async function deleteWorkshop(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set({ isActive: false }).where(eq(workshops.id, id));
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

export async function getLineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productionLines).where(eq(productionLines.id, id)).limit(1);
  return result[0];
}

export async function updateProductionLine(id: number, data: Partial<InsertProductionLine>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set(data).where(eq(productionLines.id, id));
}

export async function deleteProductionLine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set({ isActive: false }).where(eq(productionLines.id, id));
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

export async function getStationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return result[0];
}

export async function updateStation(id: number, data: Partial<InsertStation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set(data).where(eq(stations.id, id));
}

export async function deleteStation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set({ isActive: false }).where(eq(stations.id, id));
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

// Get machines with full hierarchy info (line, workshop, factory)
export async function getMachinesWithHierarchy() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select({
      machine: machines,
      station: stations,
      line: productionLines,
      workshop: workshops,
      factory: factories,
    })
    .from(machines)
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.isActive, true))
    .orderBy(factories.name, workshops.name, productionLines.name, stations.orderIndex, machines.name);
  
  return result;
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

export async function updateMachine(id: number, data: Partial<InsertMachine>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set(data).where(eq(machines.id, id));
}

export async function deleteMachine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ isActive: false }).where(eq(machines.id, id));
}

// ============ PRODUCT MODEL FUNCTIONS ============
export async function createProductModel(data: InsertProductModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productModels).values(data);
  return result[0].insertId;
}

export async function getProductModels() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productModels).where(eq(productModels.isActive, true)).orderBy(productModels.name);
}

export async function getProductModelById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.id, id)).limit(1);
  return result[0];
}

export async function getProductModelByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.code, code)).limit(1);
  return result[0];
}

export async function updateProductModel(id: number, data: Partial<InsertProductModel>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productModels).set(data).where(eq(productModels.id, id));
}

export async function deleteProductModel(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // First delete related measurement point definitions
  await db.delete(measurementPointDefs).where(eq(measurementPointDefs.productModelId, id));
  // Then delete the product model
  await db.delete(productModels).where(eq(productModels.id, id));
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

export async function getMeasurementPointDefsByProductModel(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.productModelId, productModelId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.machineId, machineId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, id)).limit(1);
  return result[0];
}

export async function getMeasurementPointDefByCode(productModelId: number, code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      eq(measurementPointDefs.code, code)
    ))
    .limit(1);
  return result[0];
}

export async function updateMeasurementPointDef(id: number, data: Partial<InsertMeasurementPointDef>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementPointDefs).set(data).where(eq(measurementPointDefs.id, id));
}

export async function deleteMeasurementPointDef(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementPointDefs).set({ isActive: false }).where(eq(measurementPointDefs.id, id));
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

export async function getFactoryLayoutsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.factoryId, factoryId), eq(factoryLayouts.isActive, true)))
    .orderBy(factoryLayouts.name);
}

export async function getCorporationLayouts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.layoutLevel, "CORPORATION"), eq(factoryLayouts.isActive, true)))
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
  return db.select().from(machinePositions).where(eq(machinePositions.layoutId, layoutId));
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

// ============ WORKSHOP POSITION FUNCTIONS ============
export async function createWorkshopPosition(data: InsertWorkshopPosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(workshopPositions).values(data);
  return result[0].insertId;
}

export async function getWorkshopPositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshopPositions).where(eq(workshopPositions.layoutId, layoutId));
}

// ============ FACTORY POSITION FUNCTIONS ============
export async function createFactoryPosition(data: InsertFactoryPosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factoryPositions).values(data);
  return result[0].insertId;
}

export async function getFactoryPositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryPositions).where(eq(factoryPositions.layoutId, layoutId));
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
}) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  // Build conditions for inspections
  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters?.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

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
          .where(sql`${productionLines.workshopId} IN (${workshopIds.join(',')})`);
        const lineIds = linesInWorkshops.map(l => l.id);
        
        if (lineIds.length > 0) {
          const stationsInLines = await db.select({ id: stations.id }).from(stations)
            .where(sql`${stations.lineId} IN (${lineIds.join(',')})`);
          const stationIds = stationsInLines.map(s => s.id);
          
          if (stationIds.length > 0) {
            const machinesInStations = await db.select({ id: machines.id }).from(machines)
              .where(sql`${machines.stationId} IN (${stationIds.join(',')})`);
            const machineIds = machinesInStations.map(m => m.id);
            
            if (machineIds.length > 0) {
              conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
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
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Define shifts: Morning (6-14), Afternoon (14-22), Night (22-6)
  // Use alias for TiDB compatibility in GROUP BY
  const shiftExpr = sql<string>`CASE 
    WHEN HOUR(${productInspections.inspectionTime}) >= 6 AND HOUR(${productInspections.inspectionTime}) < 14 THEN 'morning'
    WHEN HOUR(${productInspections.inspectionTime}) >= 14 AND HOUR(${productInspections.inspectionTime}) < 22 THEN 'afternoon'
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
}) {
  const db = await getDb();
  if (!db) return { top: [], bottom: [] };

  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

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

  // Get daily aggregated stats using DATE_FORMAT for TiDB compatibility
  const dateFormat = sql<string>`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d')`;
  
  const result = await db.select({
    date: dateFormat.as('date'),
    totalProducts: sql<number>`count(*)`.as('totalProducts'),
    okCount: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`.as('okCount'),
    ngCount: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`.as('ngCount'),
    ntfCount: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`.as('ntfCount'),
  })
  .from(productInspections)
  .where(gte(productInspections.inspectionTime, startDate))
  .groupBy(dateFormat)
  .orderBy(sql`date DESC`);

  return result.map(r => ({
    date: String(r.date),
    totalProducts: Number(r.totalProducts) || 0,
    okCount: Number(r.okCount) || 0,
    ngCount: Number(r.ngCount) || 0,
    ntfCount: Number(r.ntfCount) || 0,
  }));
}

// ============ SEARCH INSPECTIONS ============
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
          .where(sql`${workshops.factoryId} IN (${factoryResult.map(f => f.id).join(',')})`);
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
        .where(sql`${productionLines.workshopId} IN (${workshopIds.join(',')})`);
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
        .where(sql`${stations.lineId} IN (${lineIds.join(',')})`);
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
        .where(sql`${machines.stationId} IN (${stationIds.join(',')})`);
      machineIds = machineResult.map(m => m.id);
    }
  }

  // Build inspection query
  const conditions = [];
  if (machineIds && machineIds.length > 0) {
    conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
  } else if (params.factoryCode || params.workshopCode || params.lineCode || params.stationCode || params.machineCode) {
    // No machines found matching filters
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

// ============ TOP NG MEASUREMENT POINTS ============
export async function getTopNGMeasurementPoints(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(measurementResults.result, 'NG')];
  
  if (params.machineId) {
    // Get inspections for this machine first
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(eq(productInspections.machineId, params.machineId));
    if (inspectionIds.length > 0) {
      conditions.push(sql`${measurementResults.inspectionId} IN (${inspectionIds.map(i => i.id).join(',')})`);
    } else {
      return [];
    }
  }

  if (params.startDate || params.endDate) {
    // Filter by inspection time
    const inspectionConditions = [];
    if (params.startDate) inspectionConditions.push(gte(productInspections.inspectionTime, params.startDate));
    if (params.endDate) inspectionConditions.push(lte(productInspections.inspectionTime, params.endDate));
    
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(and(...inspectionConditions));
    
    if (inspectionIds.length > 0) {
      conditions.push(sql`${measurementResults.inspectionId} IN (${inspectionIds.map(i => i.id).join(',')})`);
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

  const pointDefs = await db.select()
    .from(measurementPointDefs)
    .where(sql`${measurementPointDefs.id} IN (${pointDefIds.join(',')})`);

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
    const result = await db.insert(factories).values(factory);
    factoryIds.push(result[0].insertId);
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
    const result = await db.insert(workshops).values(workshop);
    workshopIds.push(result[0].insertId);
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
    const result = await db.insert(productionLines).values(line);
    lineIds.push(result[0].insertId);
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
    const result = await db.insert(stations).values(station);
    stationIds.push(result[0].insertId);
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
  const productModelResult = await db.insert(productModels).values({
    code: "PCB-001",
    name: "PCB Main Board v1.0",
    description: "Main circuit board for electronic device",
    imageWidth: 1920,
    imageHeight: 1080,
  });
  const productModelId = productModelResult[0].insertId;

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

// ============ ALERT SETTINGS FUNCTIONS ============
export async function getAlertSettings(userId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (userId) {
    return db.select().from(alertSettings)
      .where(eq(alertSettings.userId, userId))
      .orderBy(desc(alertSettings.createdAt));
  }
  return db.select().from(alertSettings)
    .orderBy(desc(alertSettings.createdAt));
}

export async function getAlertSettingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(alertSettings)
    .where(eq(alertSettings.id, id))
    .limit(1);
  return result[0];
}

export async function createAlertSetting(data: InsertAlertSetting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(alertSettings).values(data);
  return { id: result[0].insertId };
}

export async function updateAlertSetting(id: number, data: Partial<InsertAlertSetting>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertSettings).set(data).where(eq(alertSettings.id, id));
}

export async function deleteAlertSetting(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(alertSettings).where(eq(alertSettings.id, id));
}

export async function getAlertHistory(alertSettingId?: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  if (alertSettingId) {
    return db.select().from(alertHistory)
      .where(eq(alertHistory.alertSettingId, alertSettingId))
      .orderBy(desc(alertHistory.createdAt))
      .limit(limit);
  }
  return db.select().from(alertHistory)
    .orderBy(desc(alertHistory.createdAt))
    .limit(limit);
}

export async function createAlertHistory(data: InsertAlertHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(alertHistory).values(data);
  return { id: result[0].insertId };
}

export async function acknowledgeAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertHistory).set({
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  }).where(eq(alertHistory.id, id));
}

// Generate sample inspection data for testing
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
    const inspectionResult = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)), // 1-6 seconds
    });
    const inspectionId = inspectionResult[0].insertId;

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


// ============ PRODUCT-MACHINE MAPPING FUNCTIONS ============
export async function getProductMachineMappings(machineId?: number, productModelId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productMachineMappings);
  
  if (machineId) {
    query = query.where(eq(productMachineMappings.machineId, machineId)) as typeof query;
  }
  if (productModelId) {
    query = query.where(eq(productMachineMappings.productModelId, productModelId)) as typeof query;
  }
  
  return query.orderBy(desc(productMachineMappings.priority));
}

export async function createProductMachineMapping(data: InsertProductMachineMapping) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productMachineMappings).values(data);
  return { id: result[0].insertId };
}

export async function updateProductMachineMapping(id: number, data: Partial<InsertProductMachineMapping>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productMachineMappings).set(data).where(eq(productMachineMappings.id, id));
}

export async function deleteProductMachineMapping(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(productMachineMappings).where(eq(productMachineMappings.id, id));
}

export async function getMappingsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    mapping: productMachineMappings,
    product: productModels,
  })
  .from(productMachineMappings)
  .innerJoin(productModels, eq(productMachineMappings.productModelId, productModels.id))
  .where(eq(productMachineMappings.machineId, machineId))
  .orderBy(desc(productMachineMappings.priority));
}

export async function getMappingsByProduct(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    mapping: productMachineMappings,
    machine: machines,
  })
  .from(productMachineMappings)
  .innerJoin(machines, eq(productMachineMappings.machineId, machines.id))
  .where(eq(productMachineMappings.productModelId, productModelId))
  .orderBy(desc(productMachineMappings.priority));
}

// ============ SHIFT CONFIG FUNCTIONS ============
export async function getShiftConfigs(factoryId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (factoryId) {
    return db.select().from(shiftConfigs)
      .where(or(eq(shiftConfigs.factoryId, factoryId), isNull(shiftConfigs.factoryId)))
      .orderBy(shiftConfigs.orderIndex);
  }
  
  return db.select().from(shiftConfigs).orderBy(shiftConfigs.orderIndex);
}

export async function createShiftConfig(data: InsertShiftConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(shiftConfigs).values(data);
  return { id: result[0].insertId };
}

export async function updateShiftConfig(id: number, data: Partial<InsertShiftConfig>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(shiftConfigs).set(data).where(eq(shiftConfigs.id, id));
}

export async function deleteShiftConfig(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(shiftConfigs).where(eq(shiftConfigs.id, id));
}

export async function getDefaultShiftConfigs() {
  const db = await getDb();
  if (!db) return [];
  
  // Get global shifts (factoryId is null)
  return db.select().from(shiftConfigs)
    .where(isNull(shiftConfigs.factoryId))
    .orderBy(shiftConfigs.orderIndex);
}
