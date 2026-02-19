import { eq, and } from "drizzle-orm";
import { getDb } from "./connection";
import {
  factoryLayouts, InsertFactoryLayout,
  machinePositions, InsertMachinePosition,
  machines,
  workshopPositions, InsertWorkshopPosition,
  factoryPositions, InsertFactoryPosition,
  workshops,
} from "../../drizzle/schema";

// ============ LAYOUT/POSITION FUNCTIONS ============

export async function createFactoryLayout(data: InsertFactoryLayout) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(factoryLayouts).values(data).returning({ id: factoryLayouts.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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
  const [result] = await db.insert(machinePositions).values(data).returning({ id: machinePositions.id });
  return result.id;
}

export async function getMachinePositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  // Join with machines to get image URLs
  const result = await db
    .select({
      position: machinePositions,
      machine: machines,
    })
    .from(machinePositions)
    .leftJoin(machines, eq(machinePositions.machineId, machines.id))
    .where(eq(machinePositions.layoutId, layoutId));
  
  // Flatten the result to include machine data directly in position
  return result.map(r => ({
    ...r.position,
    code: r.machine?.code,
    name: r.machine?.name,
    machineType: r.machine?.machineType,
    image2DUrl: r.machine?.image2DUrl,
    image3DUrl: r.machine?.image3DUrl,
  }));
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
  const [result] = await db.insert(workshopPositions).values(data).returning({ id: workshopPositions.id });
  return result.id;
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
  const [result] = await db.insert(factoryPositions).values(data).returning({ id: factoryPositions.id });
  return result.id;
}

export async function getFactoryPositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryPositions).where(eq(factoryPositions.layoutId, layoutId));
}

// ============ LAYOUT WITH RELATIONS ============

export async function getWorkshopLayoutsWithMachines(workshopId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // Get workshop layout
  const layouts = await db.select().from(factoryLayouts)
    .where(and(
      eq(factoryLayouts.workshopId, workshopId),
      eq(factoryLayouts.layoutLevel, 'WORKSHOP')
    ));
  
  if (layouts.length === 0) return null;
  
  const layout = layouts[0];
  
  // Get machine positions for this layout
  const positions = await db.select({
    position: machinePositions,
    machine: machines
  })
    .from(machinePositions)
    .innerJoin(machines, eq(machinePositions.machineId, machines.id))
    .where(eq(machinePositions.layoutId, layout.id));
  
  return {
    layout,
    machinePositions: positions
  };
}

export async function getFactoryLayoutsWithWorkshops(factoryId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // Get factory layout
  const layouts = await db.select().from(factoryLayouts)
    .where(and(
      eq(factoryLayouts.factoryId, factoryId),
      eq(factoryLayouts.layoutLevel, 'FACTORY')
    ));
  
  if (layouts.length === 0) return null;
  
  const layout = layouts[0];
  
  // Get workshop positions for this layout
  const positions = await db.select({
    position: workshopPositions,
    workshop: workshops
  })
    .from(workshopPositions)
    .innerJoin(workshops, eq(workshopPositions.workshopId, workshops.id))
    .where(eq(workshopPositions.layoutId, layout.id));
  
  return {
    layout,
    workshopPositions: positions
  };
}
