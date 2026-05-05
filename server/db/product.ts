import { getDb } from "./connection";
import { eq, and, desc, asc, like, or, sql, isNull, gte, SQL } from "drizzle-orm";
import {
  productModels, InsertProductModel,
  measurementPointDefs, InsertMeasurementPointDef,
  productMachineMappings, InsertProductMachineMapping,
  productCategories, InsertProductCategory,
  syncLogs, InsertSyncLog,
  machines,
} from "../../drizzle/schema";

// ============ PRODUCT MODEL FUNCTIONS ============
export async function createProductModel(data: InsertProductModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(productModels).values(data).returning({ id: productModels.id });
  return result.id;
}

export async function getProductModels(options?: {
  search?: string;
  lifecycleStatus?: "development" | "active" | "eol" | "archived";
  sortBy?: "code" | "name" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  // Build WHERE conditions
  const conditions: any[] = [];
  
  // Only filter by isActive if explicitly specified
  if (options?.isActive !== undefined) {
    conditions.push(eq(productModels.isActive, options.isActive));
  }
  
  // Apply search filter
  if (options?.search) {
    const searchTerm = `%${options.search}%`;
    conditions.push(
      or(
        like(productModels.code, searchTerm),
        like(productModels.name, searchTerm),
        like(productModels.description, searchTerm)
      )!
    );
  }
  
  // Apply lifecycle status filter
  if (options?.lifecycleStatus) {
    conditions.push(eq(productModels.lifecycleStatus, options.lifecycleStatus));
  }
  
  // Determine sorting
  const sortOrder = options?.sortOrder === "desc" ? desc : asc;
  let orderByClause;
  switch (options?.sortBy) {
    case "code":
      orderByClause = sortOrder(productModels.code);
      break;
    case "name":
      orderByClause = sortOrder(productModels.name);
      break;
    case "createdAt":
      orderByClause = sortOrder(productModels.createdAt);
      break;
    case "updatedAt":
      orderByClause = sortOrder(productModels.updatedAt);
      break;
    default:
      orderByClause = desc(productModels.createdAt);
  }
  
  // Build final query with optional WHERE + pagination
  let query = db.select().from(productModels).$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  query = query.orderBy(orderByClause);
  
  if (options?.limit && options?.offset) {
    return query.limit(options.limit).offset(options.offset);
  } else if (options?.limit) {
    return query.limit(options.limit);
  } else if (options?.offset) {
    return query.offset(options.offset);
  }
  
  return query;
}

export async function getProductModelById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProductModelByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.code, code)).limit(1);
  return result.length > 0 ? result[0] : undefined;
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

// ============ MEASUREMENT POINT DEFINITION FUNCTIONS ============
export async function createMeasurementPointDef(data: InsertMeasurementPointDef) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(measurementPointDefs).values(data).returning({ id: measurementPointDefs.id });
  return result.id;
}

export async function listAllMeasurementPointDefs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.isActive, true))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getAllMeasurementPoints() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .orderBy(measurementPointDefs.orderIndex);
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

export async function getMeasurementPointDefsByWorkstation(workstationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.workstationId, workstationId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
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
  return result.length > 0 ? result[0] : undefined;
}

export async function getMeasurementPointDefByMachineAndCode(machineId: number, code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.machineId, machineId),
      eq(measurementPointDefs.code, code)
    ))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
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

// ============ BULK MEASUREMENT POINT FUNCTIONS ============
export async function bulkCreateMeasurementPoints(points: InsertMeasurementPointDef[]) {
  const db = await getDb();
  if (!db) return { success: 0, failed: 0, errors: [] as string[] };

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const point of points) {
    try {
      await db.insert(measurementPointDefs).values(point);
      success++;
    } catch (error: any) {
      failed++;
      errors.push(`${point.code}: ${error.message}`);
    }
  }

  return { success, failed, errors };
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
  const [result] = await db.insert(productMachineMappings).values(data).returning({ id: productMachineMappings.id });
  return { id: result.id };
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

// ============ PRODUCT CATEGORY FUNCTIONS ============

export async function getProductCategories(filters?: { parentId?: number | null; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productCategories);
  
  const conditions: SQL[] = [];
  
  if (filters?.parentId !== undefined) {
    if (filters.parentId === null) {
      conditions.push(isNull(productCategories.parentId));
    } else {
      conditions.push(eq(productCategories.parentId, filters.parentId));
    }
  }
  
  if (filters?.isActive !== undefined) {
    conditions.push(eq(productCategories.isActive, filters.isActive));
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }
  
  return query.orderBy(asc(productCategories.orderIndex), asc(productCategories.name));
}

export async function getProductCategoryById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(productCategories).where(eq(productCategories.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getProductCategoryByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(productCategories).where(eq(productCategories.code, code)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createProductCategory(data: InsertProductCategory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(productCategories).values(data).returning({ id: productCategories.id });
  return { id: result.id };
}

export async function updateProductCategory(id: number, data: Partial<InsertProductCategory>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productCategories).set(data).where(eq(productCategories.id, id));
}

export async function deleteProductCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if category has children
  const children = await db.select().from(productCategories).where(eq(productCategories.parentId, id)).limit(1);
  if (children.length > 0) {
    throw new Error("Cannot delete category with children");
  }
  
  await db.delete(productCategories).where(eq(productCategories.id, id));
}

export async function getProductCategoryTree() {
  const db = await getDb();
  if (!db) return [];
  
  const allCategories = await db.select().from(productCategories)
    .where(eq(productCategories.isActive, true))
    .orderBy(asc(productCategories.orderIndex), asc(productCategories.name));
  
  // Build tree structure
  const categoryMap = new Map<number, typeof allCategories[0] & { children: typeof allCategories }>();
  const rootCategories: (typeof allCategories[0] & { children: typeof allCategories })[] = [];
  
  // First pass: create map
  for (const cat of allCategories) {
    categoryMap.set(cat.id, { ...cat, children: [] });
  }
  
  // Second pass: build tree
  for (const cat of allCategories) {
    const catWithChildren = categoryMap.get(cat.id)!;
    if (cat.parentId === null) {
      rootCategories.push(catWithChildren);
    } else {
      const parent = categoryMap.get(cat.parentId);
      if (parent) {
        parent.children.push(catWithChildren);
      }
    }
  }
  
  return rootCategories;
}

export async function updateProductCategoryCount(categoryId: number) {
  const db = await getDb();
  if (!db) return;
  
  // Count products in this category
  const category = await getProductCategoryById(categoryId);
  if (!category) return;
  
  const products = await db.select({ count: sql<number>`COUNT(*)` })
    .from(productModels)
    .where(eq(productModels.category, category.code));
  
  const count = products[0]?.count || 0;
  
  await db.update(productCategories)
    .set({ productCount: count })
    .where(eq(productCategories.id, categoryId));
}

export async function reorderProductCategories(categoryIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < categoryIds.length; i++) {
    await db.update(productCategories)
      .set({ orderIndex: i })
      .where(eq(productCategories.id, categoryIds[i]));
  }
}

// ============ SYNC LOG FUNCTIONS ============

export async function createProductSyncLog(data: InsertSyncLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(syncLogs).values(data).returning();
  return result;
}

export async function getProductSyncLogs(options?: {
  machineId?: number;
  machineCode?: string;
  productModelId?: number;
  syncOperation?: string;
  syncStatus?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  if (options?.machineId) conditions.push(eq(syncLogs.machineId, options.machineId));
  if (options?.machineCode) conditions.push(eq(syncLogs.machineCode, options.machineCode));
  if (options?.productModelId) conditions.push(eq(syncLogs.productModelId, options.productModelId));
  if (options?.syncOperation) conditions.push(eq(syncLogs.syncOperation, options.syncOperation as any));
  if (options?.syncStatus) conditions.push(eq(syncLogs.syncStatus, options.syncStatus as any));

  let query = db.select().from(syncLogs);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query
    .orderBy(desc(syncLogs.createdAt))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);
}

export async function getPointsModifiedSince(productModelId: number, sinceDate: Date) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      gte(measurementPointDefs.lastModifiedAt, sinceDate),
    ))
    .orderBy(asc(measurementPointDefs.orderIndex));
}

export async function getPointsChangedSinceVersion(productModelId: number, sinceVersion: number) {
  const db = await getDb();
  if (!db) return { points: [], currentVersion: 0 };

  const product = await db.select({ pointsConfigVersion: productModels.pointsConfigVersion })
    .from(productModels)
    .where(eq(productModels.id, productModelId))
    .limit(1);

  if (product.length === 0) return { points: [], currentVersion: 0 };

  const currentVersion = product[0].pointsConfigVersion;
  if (currentVersion <= sinceVersion) {
    return { points: [], currentVersion };
  }

  // Return all active points (version-based diff = get all if version differs)
  const points = await db.select()
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      eq(measurementPointDefs.isActive, true),
    ))
    .orderBy(asc(measurementPointDefs.orderIndex));

  return { points, currentVersion };
}

export async function updatePointLastModified(pointId: number) {
  const db = await getDb();
  if (!db) return;

  await db.update(measurementPointDefs)
    .set({ lastModifiedAt: new Date() })
    .where(eq(measurementPointDefs.id, pointId));
}

export async function updateProductImageHash(productModelId: number, hash: string) {
  const db = await getDb();
  if (!db) return;

  await db.update(productModels)
    .set({ imageHash: hash })
    .where(eq(productModels.id, productModelId));
}

export async function getProductImageHash(productModelId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select({ imageHash: productModels.imageHash })
    .from(productModels)
    .where(eq(productModels.id, productModelId))
    .limit(1);

  return result.length > 0 ? result[0].imageHash : null;
}
