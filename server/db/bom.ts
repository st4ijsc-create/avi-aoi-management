/**
 * Sprint G2.4 — DB access for BOM / Feeder material / Component installations.
 *
 * SAFETY: pure data access. NO machine-write path (no commandDispatcher /
 * driver.writeTags). Stock decrements (consumeFeederMaterial / consumeSupplierLot)
 * clamp at ≥0 and are plain UPDATEs of telemetry quantities.
 *
 * Mirrors the getDb()-guarded style of product.ts: read helpers degrade to []/null
 * when the DB is not connected; writers throw "Database not available".
 */
import { getDb } from "./connection";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  bomDefinitions, InsertBomDefinition,
  bomLineItems, InsertBomLineItem,
  feederMaterials, InsertFeederMaterial,
  componentInstallations, InsertComponentInstallation,
  supplierLots,
} from "../../drizzle/schema";

// ============================================================
// BOM definitions
// ============================================================
export async function createBomDefinition(data: InsertBomDefinition): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(bomDefinitions).values(data).returning({ id: bomDefinitions.id });
  return row.id;
}

export async function getBomDefinitionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(bomDefinitions).where(eq(bomDefinitions.id, id)).limit(1);
  return row ?? null;
}

export async function listBomDefinitionsByProduct(productModelId: number, includeDeleted = false) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(bomDefinitions.productModelId, productModelId)];
  if (!includeDeleted) conds.push(isNull(bomDefinitions.deletedAt));
  return db.select().from(bomDefinitions).where(and(...conds)).orderBy(desc(bomDefinitions.version));
}

/** Newest active (status='active', not deleted) BOM for a product model. */
export async function getActiveBomForProduct(productModelId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(bomDefinitions)
    .where(and(
      eq(bomDefinitions.productModelId, productModelId),
      eq(bomDefinitions.status, "active"),
      isNull(bomDefinitions.deletedAt),
    ))
    .orderBy(desc(bomDefinitions.version))
    .limit(1);
  return row ?? null;
}

export async function updateBomDefinition(id: number, patch: Partial<InsertBomDefinition>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(bomDefinitions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bomDefinitions.id, id))
    .returning();
  return row ?? null;
}

/** Soft delete: set deletedAt + isActive=false. */
export async function softDeleteBomDefinition(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(bomDefinitions)
    .set({ deletedAt: new Date(), isActive: false, status: "archived", updatedAt: new Date() })
    .where(eq(bomDefinitions.id, id))
    .returning();
  return row ?? null;
}

// ============================================================
// BOM line items
// ============================================================
export async function createBomLineItem(data: InsertBomLineItem): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(bomLineItems).values(data).returning({ id: bomLineItems.id });
  return row.id;
}

export async function bulkCreateBomLineItems(rows: InsertBomLineItem[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) return [];
  return db.insert(bomLineItems).values(rows).returning({ id: bomLineItems.id });
}

export async function listBomLineItemsByBom(bomId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bomLineItems).where(eq(bomLineItems.bomId, bomId)).orderBy(asc(bomLineItems.id));
}

export async function updateBomLineItem(id: number, patch: Partial<InsertBomLineItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(bomLineItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bomLineItems.id, id))
    .returning();
  return row ?? null;
}

export async function deleteBomLineItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(bomLineItems).where(eq(bomLineItems.id, id));
  return { success: true };
}

// ============================================================
// Feeder materials
// ============================================================
export async function createFeederMaterial(data: InsertFeederMaterial): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(feederMaterials).values(data).returning({ id: feederMaterials.id });
  return row.id;
}

export async function listFeederMaterialsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(feederMaterials).where(eq(feederMaterials.machineId, machineId)).orderBy(asc(feederMaterials.id));
}

export async function getFeederMaterialById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(feederMaterials).where(eq(feederMaterials.id, id)).limit(1);
  return row ?? null;
}

export async function updateFeederMaterial(id: number, patch: Partial<InsertFeederMaterial>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(feederMaterials)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(feederMaterials.id, id))
    .returning();
  return row ?? null;
}

export interface ConsumeFeederResult {
  found: boolean;
  remaining: number;
  reorderFlag: boolean;
  status: string | null;
}

/**
 * Decrement qtyOnFeeder by `qty`, clamped at ≥0. Returns the new remaining
 * quantity and a reorderFlag (remaining ≤ reorderLevel). Marks status 'depleted'
 * when it reaches 0. Pure quantity telemetry — no machine write.
 */
export async function consumeFeederMaterial(id: number, qty: number): Promise<ConsumeFeederResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [feeder] = await db.select().from(feederMaterials).where(eq(feederMaterials.id, id)).limit(1);
  if (!feeder) return { found: false, remaining: 0, reorderFlag: false, status: null };

  const current = Number(feeder.qtyOnFeeder ?? 0);
  const dec = Math.max(0, Number(qty) || 0);
  const remaining = Math.max(0, current - dec);
  const reorderLevel = Number(feeder.reorderLevel ?? 0);
  const reorderFlag = remaining <= reorderLevel;
  const nextStatus = remaining <= 0 ? "depleted" : feeder.status;

  await db
    .update(feederMaterials)
    .set({ qtyOnFeeder: String(remaining), status: nextStatus, updatedAt: new Date() })
    .where(eq(feederMaterials.id, id));

  return { found: true, remaining, reorderFlag, status: nextStatus };
}

/** Feeders at/below their reorder level (active only). */
export async function listFeedersBelowReorder(machineId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conds = [lte(feederMaterials.qtyOnFeeder, feederMaterials.reorderLevel)];
  if (machineId != null) conds.push(eq(feederMaterials.machineId, machineId));
  return db.select().from(feederMaterials).where(and(...conds)).orderBy(asc(feederMaterials.qtyOnFeeder));
}

// ============================================================
// Supplier lots — stock decrement (genealogy upstream)
// ============================================================
export async function getSupplierLotById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(supplierLots).where(eq(supplierLots.id, id)).limit(1);
  return row ?? null;
}

export interface ConsumeSupplierLotResult {
  found: boolean;
  remaining: number;
  status: string | null;
}

/**
 * Decrement supplierLots.remainingQuantity by `qty`, clamped at ≥0. When it
 * reaches 0 the lot status flips to 'consumed' (a valid supplierLotStatusEnum
 * value). If remainingQuantity is NULL it is seeded from `quantity` first.
 */
export async function consumeSupplierLot(id: number, qty: number): Promise<ConsumeSupplierLotResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [lot] = await db.select().from(supplierLots).where(eq(supplierLots.id, id)).limit(1);
  if (!lot) return { found: false, remaining: 0, status: null };

  const base = lot.remainingQuantity != null ? Number(lot.remainingQuantity) : Number(lot.quantity ?? 0);
  const dec = Math.max(0, Number(qty) || 0);
  const remaining = Math.max(0, base - dec);
  const nextStatus = remaining <= 0 ? "consumed" : lot.status;

  await db
    .update(supplierLots)
    .set({ remainingQuantity: String(remaining), status: nextStatus as any, updatedAt: new Date() })
    .where(eq(supplierLots.id, id));

  return { found: true, remaining, status: nextStatus };
}

// ============================================================
// Component installations (genealogy component → serial)
// ============================================================
export async function insertComponentInstallation(data: InsertComponentInstallation): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(componentInstallations).values(data).returning({ id: componentInstallations.id });
  return row.id;
}

export async function updateComponentInstallationGenealogyHash(id: number, genealogyHash: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(componentInstallations).set({ genealogyHash }).where(eq(componentInstallations.id, id));
}

/** Forward trace: all components installed onto a board serial, oldest first. */
export async function listInstallationsBySerial(serialNumber: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(componentInstallations)
    .where(eq(componentInstallations.serialNumber, serialNumber))
    .orderBy(asc(componentInstallations.id))
    .limit(limit);
}

/** Reverse trace: all serials that consumed a given supplier lot. */
export async function listInstallationsBySupplierLot(supplierLotId: number, limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(componentInstallations)
    .where(eq(componentInstallations.supplierLotId, supplierLotId))
    .orderBy(asc(componentInstallations.id))
    .limit(limit);
}

/** Reverse trace: all serials that consumed a given component code. */
export async function listInstallationsByComponentCode(componentCode: string, limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(componentInstallations)
    .where(eq(componentInstallations.componentCode, componentCode))
    .orderBy(asc(componentInstallations.id))
    .limit(limit);
}
