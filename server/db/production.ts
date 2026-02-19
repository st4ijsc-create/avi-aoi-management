import { eq, and, desc, asc, or, isNull, SQL } from "drizzle-orm";
import { getDb } from "./connection";
import {
  shiftConfigs, InsertShiftConfig,
  productionOrders, InsertProductionOrder,
  lineStages, InsertLineStage,
  lineProductAssignments, InsertLineProductAssignment,
  processes, InsertProcess,
  lineProcessAssignments, InsertLineProcessAssignment,
  productionOrderTemplates, InsertProductionOrderTemplate,
  productionLines,
} from "../../drizzle/schema";

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
  const [result] = await db.insert(shiftConfigs).values(data).returning({ id: shiftConfigs.id });
  return { id: result.id };
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


// ============ PRODUCTION ORDER FUNCTIONS ============
export async function getProductionOrders(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  status?: string;
  companyCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  if (filters?.factoryId) conditions.push(eq(productionOrders.factoryId, filters.factoryId));
  if (filters?.workshopId) conditions.push(eq(productionOrders.workshopId, filters.workshopId));
  if (filters?.lineId) conditions.push(eq(productionOrders.lineId, filters.lineId));
  if (filters?.status) conditions.push(eq(productionOrders.status, filters.status as any));
  if (filters?.companyCode) conditions.push(eq(productionOrders.companyCode, filters.companyCode));
  
  return db.select().from(productionOrders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrders.createdAt));
}

export async function getProductionOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getProductionOrderByCode(orderCode: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.orderCode, orderCode)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createProductionOrder(data: InsertProductionOrder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(productionOrders).values(data).returning({ id: productionOrders.id });
  return result;
}

export async function updateProductionOrder(id: number, data: Partial<InsertProductionOrder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(productionOrders).set(data).where(eq(productionOrders.id, id));
}

export async function deleteProductionOrder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(productionOrders).where(eq(productionOrders.id, id));
}

export async function updateProductionOrderQuantities(id: number, result: 'OK' | 'NG' | 'NTF') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const order = await getProductionOrderById(id);
  if (!order) throw new Error("Production order not found");
  
  const updates: Partial<InsertProductionOrder> = {
    completedQuantity: order.completedQuantity + 1,
  };
  
  if (result === 'OK') updates.okQuantity = order.okQuantity + 1;
  else if (result === 'NG') updates.ngQuantity = order.ngQuantity + 1;
  else if (result === 'NTF') updates.ntfQuantity = order.ntfQuantity + 1;
  
  // Auto update status
  if (updates.completedQuantity! >= order.targetQuantity) {
    updates.status = 'completed';
    updates.actualEndDate = new Date();
  } else if (order.status === 'pending') {
    updates.status = 'in_progress';
    updates.actualStartDate = new Date();
  }
  
  return db.update(productionOrders).set(updates).where(eq(productionOrders.id, id));
}

// ============ LINE STAGE FUNCTIONS ============
export async function getLineStages(lineId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (lineId) {
    return db.select().from(lineStages)
      .where(eq(lineStages.lineId, lineId))
      .orderBy(lineStages.orderIndex);
  }
  
  return db.select().from(lineStages).orderBy(lineStages.orderIndex);
}

export async function getLineStageById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(lineStages).where(eq(lineStages.id, id));
  return result || null;
}

export async function createLineStage(data: InsertLineStage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(lineStages).values(data).returning({ id: lineStages.id });
  return result;
}

export async function updateLineStage(id: number, data: Partial<InsertLineStage>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(lineStages).set(data).where(eq(lineStages.id, id));
}

export async function deleteLineStage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(lineStages).where(eq(lineStages.id, id));
}

export async function reorderLineStages(lineId: number, stageIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Update orderIndex for each stage based on position in array
  for (let i = 0; i < stageIds.length; i++) {
    await db.update(lineStages)
      .set({ orderIndex: i })
      .where(and(eq(lineStages.id, stageIds[i]), eq(lineStages.lineId, lineId)));
  }
}

// ============ LINE PRODUCT ASSIGNMENT FUNCTIONS ============
export async function getLineProductAssignments(filters?: {
  lineId?: number;
  productModelId?: number;
  productionOrderId?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  if (filters?.lineId) conditions.push(eq(lineProductAssignments.lineId, filters.lineId));
  if (filters?.productModelId) conditions.push(eq(lineProductAssignments.productModelId, filters.productModelId));
  if (filters?.productionOrderId) conditions.push(eq(lineProductAssignments.productionOrderId, filters.productionOrderId));
  if (filters?.isActive !== undefined) conditions.push(eq(lineProductAssignments.isActive, filters.isActive));
  
  return db.select().from(lineProductAssignments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(lineProductAssignments.createdAt));
}

export async function createLineProductAssignment(data: InsertLineProductAssignment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(lineProductAssignments).values(data).returning({ id: lineProductAssignments.id });
  return result;
}

export async function updateLineProductAssignment(id: number, data: Partial<InsertLineProductAssignment>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(lineProductAssignments).set(data).where(eq(lineProductAssignments.id, id));
}

export async function deleteLineProductAssignment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(lineProductAssignments).where(eq(lineProductAssignments.id, id));
}

// ============ PROCESSES FUNCTIONS ============

export async function getProcesses(filters?: {
  processType?: 'SMT' | 'DIP' | 'ASSEMBLY' | 'TESTING' | 'PACKAGING' | 'INSPECTION' | 'OTHER';
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters?.processType) {
    conditions.push(eq(processes.processType, filters.processType));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(processes.isActive, filters.isActive));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  return db.select()
    .from(processes)
    .where(whereClause)
    .orderBy(asc(processes.orderIndex));
}

export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(processes)
    .where(eq(processes.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function getProcessByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(processes)
    .where(eq(processes.code, code))
    .limit(1);
  
  return results[0] || null;
}

export async function createProcess(data: InsertProcess) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(processes).values(data).returning({ id: processes.id });
  return { id: Number(result.id) };
}

export async function updateProcess(id: number, data: Partial<InsertProcess>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(processes)
    .set(data)
    .where(eq(processes.id, id));
}

export async function deleteProcess(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // First delete all line process assignments
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.processId, id));
  
  // Then delete the process
  await db.delete(processes)
    .where(eq(processes.id, id));
}

export async function reorderProcesses(orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(processes)
      .set({ orderIndex: i })
      .where(eq(processes.id, orderedIds[i]));
  }
}

// ============ LINE PROCESS ASSIGNMENTS FUNCTIONS ============

export async function getLineProcessAssignments(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    assignment: lineProcessAssignments,
    process: processes,
  })
    .from(lineProcessAssignments)
    .leftJoin(processes, eq(lineProcessAssignments.processId, processes.id))
    .where(eq(lineProcessAssignments.lineId, lineId))
    .orderBy(asc(lineProcessAssignments.orderIndex));
}

export async function getLineProcessAssignmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(lineProcessAssignments)
    .where(eq(lineProcessAssignments.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function createLineProcessAssignment(data: InsertLineProcessAssignment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(lineProcessAssignments).values(data).returning({ id: lineProcessAssignments.id });
  return { id: Number(result.id) };
}

export async function updateLineProcessAssignment(id: number, data: Partial<InsertLineProcessAssignment>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(lineProcessAssignments)
    .set(data)
    .where(eq(lineProcessAssignments.id, id));
}

export async function deleteLineProcessAssignment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.id, id));
}

export async function reorderLineProcessAssignments(lineId: number, orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(lineProcessAssignments)
      .set({ orderIndex: i })
      .where(and(
        eq(lineProcessAssignments.id, orderedIds[i]),
        eq(lineProcessAssignments.lineId, lineId)
      ));
  }
}

export async function deleteLineProcessAssignmentsByLine(lineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.lineId, lineId));
}

// ============ PRODUCTION ORDER TEMPLATES ============
export async function listOrderTemplates(factoryId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productionOrderTemplates).where(eq(productionOrderTemplates.isActive, true));
  if (factoryId) {
    query = db.select().from(productionOrderTemplates).where(
      and(
        eq(productionOrderTemplates.isActive, true),
        or(
          eq(productionOrderTemplates.factoryId, factoryId),
          isNull(productionOrderTemplates.factoryId)
        )
      )
    );
  }
  return await query;
}

export async function getOrderTemplate(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(productionOrderTemplates).where(eq(productionOrderTemplates.id, id));
  return results[0] || null;
}

export async function createOrderTemplate(data: InsertProductionOrderTemplate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(productionOrderTemplates).values(data).returning({ id: productionOrderTemplates.id });
  return { id: result.id };
}

export async function updateOrderTemplate(id: number, data: Partial<InsertProductionOrderTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrderTemplates).set(data).where(eq(productionOrderTemplates.id, id));
}

export async function deleteOrderTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrderTemplates).set({ isActive: false }).where(eq(productionOrderTemplates.id, id));
}

// ============ WIP TRACKING ============
export async function getWIPStatus(factoryId?: number) {
  const db = await getDb();
  if (!db) return { orders: [], summary: { total: 0, inProgress: 0, completed: 0, pending: 0 } };
  
  // Get all in-progress orders with their current status
  let query = db.select({
    id: productionOrders.id,
    orderCode: productionOrders.orderCode,
    productModelId: productionOrders.productModelId,
    lineId: productionOrders.lineId,
    targetQuantity: productionOrders.targetQuantity,
    completedQuantity: productionOrders.completedQuantity,
    okQuantity: productionOrders.okQuantity,
    ngQuantity: productionOrders.ngQuantity,
    status: productionOrders.status,
    plannedStartDate: productionOrders.plannedStartDate,
    plannedEndDate: productionOrders.plannedEndDate,
    updatedAt: productionOrders.updatedAt,
  }).from(productionOrders);
  
  const orders = factoryId 
    ? await query.where(eq(productionOrders.factoryId, factoryId))
    : await query;
  
  const summary = {
    total: orders.length,
    inProgress: orders.filter(o => o.status === 'in_progress').length,
    completed: orders.filter(o => o.status === 'completed').length,
    pending: orders.filter(o => o.status === 'pending').length,
  };
  
  return { orders, summary };
}

export async function getWIPByLine(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.lineId, lineId),
      eq(productionOrders.status, 'in_progress')
    ))
    .orderBy(productionOrders.priority);
}

// ============ SCHEDULING OPTIMIZATION ============
export interface ScheduleOptimizationResult {
  orderId: number;
  suggestedLineId: number;
  suggestedStartDate: Date;
  suggestedEndDate: Date;
  reason: string;
  score: number;
}

export async function optimizeSchedule(factoryId: number): Promise<ScheduleOptimizationResult[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get pending orders
  const pendingOrders = await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.factoryId, factoryId),
      eq(productionOrders.status, 'pending')
    ))
    .orderBy(desc(productionOrders.priority));
  
  // Get available lines with capacity
  const lines = await db.select().from(productionLines)
    .where(eq(productionLines.isActive, true));
  
  // Get current line utilization
  const inProgressOrders = await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.factoryId, factoryId),
      eq(productionOrders.status, 'in_progress')
    ));
  
  const lineUtilization = new Map<number, number>();
  for (const order of inProgressOrders) {
    const current = lineUtilization.get(order.lineId) || 0;
    lineUtilization.set(order.lineId, current + 1);
  }
  
  const suggestions: ScheduleOptimizationResult[] = [];
  
  for (const order of pendingOrders) {
    // Find best line based on utilization and capacity
    let bestLine = lines[0];
    let bestScore = 0;
    
    for (const line of lines) {
      const utilization = lineUtilization.get(line.id) || 0;
      const maxCapacity = line.maxConcurrentOrders || 5;
      const availableCapacity = maxCapacity - utilization;
      
      if (availableCapacity > 0) {
        const score = availableCapacity / maxCapacity * 100;
        if (score > bestScore) {
          bestScore = score;
          bestLine = line;
        }
      }
    }
    
    if (bestLine && bestScore > 0) {
      // Calculate suggested dates based on capacity
      const capacityPerHour = bestLine.capacityPerHour || 100;
      const hoursNeeded = Math.ceil(order.targetQuantity / capacityPerHour);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + hoursNeeded * 60 * 60 * 1000);
      
      suggestions.push({
        orderId: order.id,
        suggestedLineId: bestLine.id,
        suggestedStartDate: startDate,
        suggestedEndDate: endDate,
        reason: `Line ${bestLine.name} has ${Math.round(bestScore)}% available capacity`,
        score: bestScore,
      });
      
      // Update utilization for next iteration
      const current = lineUtilization.get(bestLine.id) || 0;
      lineUtilization.set(bestLine.id, current + 1);
    }
  }
  
  return suggestions.sort((a, b) => b.score - a.score);
}

export async function applyScheduleSuggestion(suggestion: ScheduleOptimizationResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrders)
    .set({
      lineId: suggestion.suggestedLineId,
      plannedStartDate: suggestion.suggestedStartDate,
      plannedEndDate: suggestion.suggestedEndDate,
      status: 'pending',
    })
    .where(eq(productionOrders.id, suggestion.orderId));
}
