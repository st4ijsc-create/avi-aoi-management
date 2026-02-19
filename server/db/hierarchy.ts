import { eq, and, desc, like, or } from "drizzle-orm";
import { getDb } from "./connection";
import {
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  workstations, InsertWorkstation,
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
  return db.select().from(factories).orderBy(factories.name);
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
    .where(eq(workshops.factoryId, factoryId))
    .orderBy(workshops.name);
}

export async function getWorkshops() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops).orderBy(workshops.name);
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
    .where(eq(productionLines.workshopId, workshopId))
    .orderBy(productionLines.name);
}

export async function getProductionLines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines).orderBy(productionLines.name);
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
    .where(eq(machines.stationId, stationId))
    .orderBy(machines.name);
}

export async function getMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines).orderBy(machines.name);
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
