import { eq, and, desc, like, or, sql, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import {
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  workstations, InsertWorkstation,
  factoryZones, InsertFactoryZone,
} from "../../drizzle/schema";

// ============ FACTORY FUNCTIONS ============
export async function createFactory(data: InsertFactory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(factories).values(data).returning({ id: factories.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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

// ============ FACTORY ZONE FUNCTIONS (W6-25) ============
// Vùng polygon vẽ trên mặt bằng — CRUD gated ở tầng router bằng machine_control/canEdit.
export async function getFactoryZones(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryZones)
    .where(eq(factoryZones.factoryId, factoryId))
    .orderBy(factoryZones.id);
}

export async function createFactoryZone(data: InsertFactoryZone) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(factoryZones).values(data).returning({ id: factoryZones.id });
  return result.id;
}

export async function updateFactoryZone(id: number, data: Partial<InsertFactoryZone>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factoryZones).set({ ...data, updatedAt: new Date() }).where(eq(factoryZones.id, id));
}

export async function deleteFactoryZone(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(factoryZones).where(eq(factoryZones.id, id));
}

// ============ WORKSHOP FUNCTIONS ============
export async function createWorkshop(data: InsertWorkshop) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(workshops).values(data).returning({ id: workshops.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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
  const [result] = await db.insert(productionLines).values(data).returning({ id: productionLines.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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
  const [result] = await db.insert(stations).values(data).returning({ id: stations.id });
  return result.id;
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

// Get default station (first available station for auto-registration)
export async function getDefaultStation() {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.isActive, true)).orderBy(stations.id).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getStationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
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
  const [result] = await db.insert(machines).values(data).returning({ id: machines.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
}

export async function getMachineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMachineByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.code, code), eq(machines.isActive, true)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
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

// Lấy máy theo serialNumber
export async function getMachineBySerialNumber(serialNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  // Tìm theo field serialNumber trước, sau đó fallback tìm theo code
  const bySerial = await db.select().from(machines)
    .where(eq(machines.serialNumber, serialNumber))
    .limit(1);
  if (bySerial.length > 0) return bySerial[0];

  // Fallback: tìm theo code dạng SN-xxx
  const byCode = await db.select().from(machines)
    .where(eq(machines.code, `SN-${serialNumber}`))
    .limit(1);
  return byCode.length > 0 ? byCode[0] : undefined;
}

// Lấy danh sách máy chờ duyệt (pending)
export async function getPendingMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines)
    .where(eq(machines.registrationStatus, "pending"))
    .orderBy(desc(machines.createdAt));
}

// Duyệt máy: cập nhật trạng thái, gán APIKey nếu chưa có
export async function approveMachine(id: number, data: {
  stationId?: number;
  code?: string;
  name?: string;
  apiKey?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({
    ...data,
    registrationStatus: "approved",
    lastSyncAt: new Date(),
  }).where(eq(machines.id, id));
}

// Từ chối máy
export async function rejectMachine(id: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({
    registrationStatus: "rejected",
    pendingConfig: reason || null,
  }).where(eq(machines.id, id));
}

// Lấy line theo stationId (thông qua station → line)
export async function getLineByStationId(stationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const station = await db.select().from(stations).where(eq(stations.id, stationId)).limit(1);
  if (station.length === 0) return undefined;
  const line = await db.select().from(productionLines).where(eq(productionLines.id, station[0].lineId)).limit(1);
  return line.length > 0 ? line[0] : undefined;
}

// ==============================
// Workstations Functions
// ==============================

export async function getWorkstations(filters?: { lineId?: number; workshopId?: number; factoryId?: number; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: any[] = [];
  if (filters?.isActive !== undefined) conditions.push(eq(workstations.isActive, filters.isActive));
  if (filters?.lineId) conditions.push(eq(workstations.lineId, filters.lineId));
  if (filters?.workshopId) conditions.push(eq(workstations.workshopId, filters.workshopId));
  if (filters?.factoryId) conditions.push(eq(workstations.factoryId, filters.factoryId));
  
  if (conditions.length === 0) {
    return db.select().from(workstations).orderBy(workstations.orderIndex);
  }
  return db.select().from(workstations).where(and(...conditions)).orderBy(workstations.orderIndex);
}

export async function getWorkstationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(workstations).where(eq(workstations.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getWorkstationByCode(code: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(workstations).where(eq(workstations.code, code)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createWorkstation(data: Omit<InsertWorkstation, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(workstations).values(data).returning({ id: workstations.id });
  return result.id;
}

export async function updateWorkstation(id: number, data: Partial<Omit<InsertWorkstation, 'id' | 'createdAt' | 'updatedAt'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(workstations).set(data).where(eq(workstations.id, id));
}

export async function deleteWorkstation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(workstations).where(eq(workstations.id, id));
}

// Helper functions for Bulk Import
export async function getFactoryByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(factories).where(eq(factories.code, code)).limit(1);
  return results[0] || null;
}

export async function getWorkshopByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(workshops).where(eq(workshops.code, code)).limit(1);
  return results[0] || null;
}

export async function getStationByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(stations).where(eq(stations.code, code)).limit(1);
  return results[0] || null;
}

export async function getProductionLineByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(productionLines).where(eq(productionLines.code, code)).limit(1);
  return results[0] || null;
}

// ============ HIERARCHY TREE FUNCTIONS (for MQTT subscription setup) ============

/**
 * Get full hierarchy tree: Factory → Workshop → Line → Station → Machine
 * Returns flat joined rows for tree assembly on the router layer.
 */
export async function getFullHierarchyFlat() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      factoryId: factories.id,
      factoryCode: factories.code,
      factoryName: factories.name,
      factoryIsActive: factories.isActive,
      workshopId: workshops.id,
      workshopCode: workshops.code,
      workshopName: workshops.name,
      workshopIsActive: workshops.isActive,
      lineId: productionLines.id,
      lineCode: productionLines.code,
      lineName: productionLines.name,
      lineIsActive: productionLines.isActive,
      stationId: stations.id,
      stationCode: stations.code,
      stationName: stations.name,
      stationOrderIndex: stations.orderIndex,
      stationIsActive: stations.isActive,
      machineId: machines.id,
      machineCode: machines.code,
      machineName: machines.name,
      machineType: machines.machineType,
      machineOperationStatus: machines.operationStatus,
      machineIsActive: machines.isActive,
    })
    .from(factories)
    .leftJoin(workshops, eq(workshops.factoryId, factories.id))
    .leftJoin(productionLines, eq(productionLines.workshopId, workshops.id))
    .leftJoin(stations, eq(stations.lineId, productionLines.id))
    .leftJoin(machines, eq(machines.stationId, stations.id))
    .where(eq(factories.isActive, true))
    .orderBy(
      factories.name,
      workshops.name,
      productionLines.name,
      stations.orderIndex,
      machines.name,
    );
}

/**
 * Get hierarchy tree for a specific factory
 */
export async function getFactoryHierarchyFlat(factoryId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      factoryId: factories.id,
      factoryCode: factories.code,
      factoryName: factories.name,
      workshopId: workshops.id,
      workshopCode: workshops.code,
      workshopName: workshops.name,
      lineId: productionLines.id,
      lineCode: productionLines.code,
      lineName: productionLines.name,
      stationId: stations.id,
      stationCode: stations.code,
      stationName: stations.name,
      stationOrderIndex: stations.orderIndex,
      machineId: machines.id,
      machineCode: machines.code,
      machineName: machines.name,
      machineType: machines.machineType,
      machineOperationStatus: machines.operationStatus,
    })
    .from(factories)
    .leftJoin(workshops, and(eq(workshops.factoryId, factories.id), eq(workshops.isActive, true)))
    .leftJoin(productionLines, and(eq(productionLines.workshopId, workshops.id), eq(productionLines.isActive, true)))
    .leftJoin(stations, and(eq(stations.lineId, productionLines.id), eq(stations.isActive, true)))
    .leftJoin(machines, and(eq(machines.stationId, stations.id), eq(machines.isActive, true)))
    .where(and(eq(factories.id, factoryId), eq(factories.isActive, true)))
    .orderBy(
      workshops.name,
      productionLines.name,
      stations.orderIndex,
      machines.name,
    );
}

// ============ CASCADE DELETE FUNCTIONS ============

// Get counts of children under a factory
export async function getFactoryCascadeInfo(factoryId: number) {
  const db = await getDb();
  if (!db) return { workshops: 0, lines: 0, stations: 0, machines: 0 };
  const ws = await db.select({ id: workshops.id }).from(workshops)
    .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)));
  const wsIds = ws.map(w => w.id);
  if (wsIds.length === 0) return { workshops: 0, lines: 0, stations: 0, machines: 0 };
  const ln = await db.select({ id: productionLines.id }).from(productionLines)
    .where(and(inArray(productionLines.workshopId, wsIds), eq(productionLines.isActive, true)));
  const lnIds = ln.map(l => l.id);
  let stCount = 0, mcCount = 0;
  if (lnIds.length > 0) {
    const st = await db.select({ id: stations.id }).from(stations)
      .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
    stCount = st.length;
    const stIds = st.map(s => s.id);
    if (stIds.length > 0) {
      const mc = await db.select({ id: machines.id }).from(machines)
        .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
      mcCount = mc.length;
    }
  }
  return { workshops: wsIds.length, lines: lnIds.length, stations: stCount, machines: mcCount };
}

// Get counts of children under a workshop
export async function getWorkshopCascadeInfo(workshopId: number) {
  const db = await getDb();
  if (!db) return { lines: 0, stations: 0, machines: 0 };
  const ln = await db.select({ id: productionLines.id }).from(productionLines)
    .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)));
  const lnIds = ln.map(l => l.id);
  if (lnIds.length === 0) return { lines: 0, stations: 0, machines: 0 };
  const st = await db.select({ id: stations.id }).from(stations)
    .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
  const stIds = st.map(s => s.id);
  let mcCount = 0;
  if (stIds.length > 0) {
    const mc = await db.select({ id: machines.id }).from(machines)
      .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
    mcCount = mc.length;
  }
  return { lines: lnIds.length, stations: stIds.length, machines: mcCount };
}

// Get counts of children under a line
export async function getLineCascadeInfo(lineId: number) {
  const db = await getDb();
  if (!db) return { stations: 0, machines: 0 };
  const st = await db.select({ id: stations.id }).from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)));
  const stIds = st.map(s => s.id);
  let mcCount = 0;
  if (stIds.length > 0) {
    const mc = await db.select({ id: machines.id }).from(machines)
      .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
    mcCount = mc.length;
  }
  return { stations: stIds.length, machines: mcCount };
}

// Get counts of children under a station
export async function getStationCascadeInfo(stationId: number) {
  const db = await getDb();
  if (!db) return { machines: 0 };
  const mc = await db.select({ id: machines.id }).from(machines)
    .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)));
  return { machines: mc.length };
}

// Cascade soft-delete factory and all children
export async function cascadeDeleteFactory(factoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ws = await db.select({ id: workshops.id }).from(workshops)
    .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)));
  const wsIds = ws.map(w => w.id);
  if (wsIds.length > 0) {
    const ln = await db.select({ id: productionLines.id }).from(productionLines)
      .where(and(inArray(productionLines.workshopId, wsIds), eq(productionLines.isActive, true)));
    const lnIds = ln.map(l => l.id);
    if (lnIds.length > 0) {
      const st = await db.select({ id: stations.id }).from(stations)
        .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
      const stIds = st.map(s => s.id);
      if (stIds.length > 0) {
        await db.update(machines).set({ isActive: false }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
        await db.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
      }
      await db.update(productionLines).set({ isActive: false }).where(inArray(productionLines.id, lnIds));
    }
    await db.update(workshops).set({ isActive: false }).where(inArray(workshops.id, wsIds));
  }
  await db.update(factories).set({ isActive: false }).where(eq(factories.id, factoryId));
}

// Cascade soft-delete workshop and all children
export async function cascadeDeleteWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ln = await db.select({ id: productionLines.id }).from(productionLines)
    .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)));
  const lnIds = ln.map(l => l.id);
  if (lnIds.length > 0) {
    const st = await db.select({ id: stations.id }).from(stations)
      .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
    const stIds = st.map(s => s.id);
    if (stIds.length > 0) {
      await db.update(machines).set({ isActive: false }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
      await db.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
    }
    await db.update(productionLines).set({ isActive: false }).where(inArray(productionLines.id, lnIds));
  }
  await db.update(workshops).set({ isActive: false }).where(eq(workshops.id, workshopId));
}

// Cascade soft-delete line and all children
export async function cascadeDeleteLine(lineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const st = await db.select({ id: stations.id }).from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)));
  const stIds = st.map(s => s.id);
  if (stIds.length > 0) {
    await db.update(machines).set({ isActive: false }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
    await db.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
  }
  await db.update(productionLines).set({ isActive: false }).where(eq(productionLines.id, lineId));
}

// Cascade soft-delete station and all children
export async function cascadeDeleteStation(stationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ isActive: false }).where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)));
  await db.update(stations).set({ isActive: false }).where(eq(stations.id, stationId));
}

// ============ LIST DELETED (INACTIVE) FUNCTIONS ============

export async function getDeletedFactories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factories).where(eq(factories.isActive, false)).orderBy(factories.name);
}

export async function getDeletedWorkshops() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops).where(eq(workshops.isActive, false)).orderBy(workshops.name);
}

export async function getDeletedLines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines).where(eq(productionLines.isActive, false)).orderBy(productionLines.name);
}

export async function getDeletedStations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations).where(eq(stations.isActive, false)).orderBy(stations.orderIndex);
}

export async function getDeletedMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines).where(eq(machines.isActive, false)).orderBy(machines.name);
}

export async function getDeletedWorkstations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workstations).where(eq(workstations.isActive, false)).orderBy(workstations.orderIndex);
}

// ============ RESTORE FUNCTIONS ============

export async function restoreFactory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set({ isActive: true }).where(eq(factories.id, id));
}

export async function restoreWorkshop(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set({ isActive: true }).where(eq(workshops.id, id));
}

export async function restoreLine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set({ isActive: true }).where(eq(productionLines.id, id));
}

export async function restoreStation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set({ isActive: true }).where(eq(stations.id, id));
}

export async function restoreMachine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ isActive: true }).where(eq(machines.id, id));
}

export async function restoreWorkstation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workstations).set({ isActive: true }).where(eq(workstations.id, id));
}
