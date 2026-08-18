import { eq, and, desc, asc, or, isNull, ilike, inArray, SQL } from "drizzle-orm";
import { getDb } from "./connection";
import { idsTrongPhamVi, trongPhamVi, type PhamViNguoiXem } from "./hierarchy";
import {
  shiftConfigs, InsertShiftConfig,
  productionOrders, InsertProductionOrder,
  lineStages, InsertLineStage,
  lineProductAssignments, InsertLineProductAssignment,
  processes, InsertProcess,
  lineProcessAssignments, InsertLineProcessAssignment,
  productionOrderTemplates, InsertProductionOrderTemplate,
  productionLines,
  scheduleRuns, InsertScheduleRun,
  scheduleRunItems, InsertScheduleRunItem,
  machineCapacity,
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
/**
 * ★★★ 2026-08-18 (trả nợ nhóm A) — **TRỤC PHẠM VI CỦA LỆNH SẢN XUẤT LÀ `lineId`, KHÔNG PHẢI
 * `factoryId`.**
 *
 * `production_orders` mang CẢ HAI cột và chúng có thể BẤT ĐỒNG — không ràng buộc nào bắt
 * `factoryId` phải khớp nhà máy của `lineId`. Chọn cột ghi rời là mở lại đúng lớp lỗi "hàng mang
 * `factoryId` của nhà máy KHÁC" đã cắn tuần này (`daily_statistics`). Luật đã ghi ở
 * `services/ecosystem/commandCenterScope.scopedWorkOrderIds` — đây là cùng luật, cùng cột.
 *
 * ⚠ Cổng được AND vào **SAU** bộ lọc `factoryId`/`lineId` của người gọi, nên một `factoryId` TỰ
 * KHAI chỉ THU HẸP thêm; nó không bao giờ mở được cửa sang nhà máy khác.
 */
export async function getProductionOrders(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  status?: string;
  companyCode?: string;
  search?: string;
  limit?: number;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  {
    const idsTuyen = await idsTrongPhamVi("line", scope);
    if (idsTuyen !== null) conditions.push(inArray(productionOrders.lineId, idsTuyen.length ? idsTuyen : [-1]));
  }
  if (filters?.factoryId) conditions.push(eq(productionOrders.factoryId, filters.factoryId));
  if (filters?.workshopId) conditions.push(eq(productionOrders.workshopId, filters.workshopId));
  if (filters?.lineId) conditions.push(eq(productionOrders.lineId, filters.lineId));
  if (filters?.status) conditions.push(eq(productionOrders.status, filters.status as any));
  if (filters?.companyCode) conditions.push(eq(productionOrders.companyCode, filters.companyCode));
  if (filters?.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    const searchCond = or(
      ilike(productionOrders.orderCode, term),
      ilike(productionOrders.companyCode, term),
    );
    if (searchCond) conditions.push(searchCond);
  }
  
  const limit = Math.min(Math.max(filters?.limit ?? 500, 1), 1000);
  return db.select().from(productionOrders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrders.createdAt))
    .limit(limit);
}

export async function getProductionOrderById(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.id, id)).limit(1);
  if (result.length === 0) return null;
  if (!(await trongPhamVi("line", result[0].lineId, scope))) return null;
  return result[0];
}

export async function getProductionOrderByCode(orderCode: string, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.orderCode, orderCode)).limit(1);
  if (result.length === 0) return null;
  if (!(await trongPhamVi("line", result[0].lineId, scope))) return null;
  return result[0];
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
export async function getLineStages(lineId?: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  const idsTuyen = await idsTrongPhamVi("line", scope);
  const dieuKien = [
    ...(idsTuyen === null ? [] : [inArray(lineStages.lineId, idsTuyen.length ? idsTuyen : [-1])]),
    ...(lineId ? [eq(lineStages.lineId, lineId)] : []),
  ];
  return db.select().from(lineStages)
    .where(dieuKien.length ? and(...dieuKien) : undefined)
    .orderBy(lineStages.orderIndex);
}

export async function getLineStageById(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(lineStages).where(eq(lineStages.id, id));
  // ⚠ Hàm này trả về MẢNG (hợp đồng cũ, không sửa ở đây). Ngoài phạm vi ⇒ mảng RỖNG, đúng hình
  // dạng "không tìm thấy" mà nơi gọi đã xử lý được.
  if (result.length > 0 && !(await trongPhamVi("line", result[0].lineId, scope))) return [];
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
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  {
    const idsTuyen = await idsTrongPhamVi("line", scope);
    if (idsTuyen !== null) conditions.push(inArray(lineProductAssignments.lineId, idsTuyen.length ? idsTuyen : [-1]));
  }
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
export async function listOrderTemplates(factoryId?: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  
  // ⚠ `factoryId` NULL = mẫu DÙNG CHUNG cho mọi nhà máy (chú thích ở lược đồ). Nó không mang số
  // đo của ai cả nên KHÔNG bị loại — loại nó đi thì người bị thu hẹp mất luôn bộ mẫu mặc định và
  // màn hình đọc thành "chưa có mẫu nào". Đây là ngoại lệ CÓ LÝ DO, giống `oee_targets`.
  const idsNhaMay = await idsTrongPhamVi("factory", scope);
  const dieuKien = [eq(productionOrderTemplates.isActive, true)];
  if (idsNhaMay !== null) {
    const cong = or(
      isNull(productionOrderTemplates.factoryId),
      inArray(productionOrderTemplates.factoryId, idsNhaMay.length ? idsNhaMay : [-1]),
    );
    if (cong) dieuKien.push(cong);
  }
  if (factoryId) {
    const cong = or(
      eq(productionOrderTemplates.factoryId, factoryId),
      isNull(productionOrderTemplates.factoryId),
    );
    if (cong) dieuKien.push(cong);
  }
  return await db.select().from(productionOrderTemplates).where(and(...dieuKien));
}

export async function getOrderTemplate(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(productionOrderTemplates).where(eq(productionOrderTemplates.id, id));
  const mau = results[0];
  if (!mau) return null;
  // `factoryId` NULL = mẫu dùng chung ⇒ ai cũng đọc được (xem `listOrderTemplates`).
  if (mau.factoryId !== null && !(await trongPhamVi("factory", mau.factoryId, scope))) return null;
  return mau;
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
export async function getWIPStatus(factoryId?: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return { orders: [], summary: { total: 0, inProgress: 0, completed: 0, pending: 0 } };
  
  // Get all orders with line info
  const conditions: SQL[] = [];
  {
    const idsTuyen = await idsTrongPhamVi("line", scope);
    if (idsTuyen !== null) conditions.push(inArray(productionOrders.lineId, idsTuyen.length ? idsTuyen : [-1]));
  }
  if (factoryId) conditions.push(eq(productionOrders.factoryId, factoryId));
  
  const allOrders = await db.select({
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
    lineName: productionLines.name,
    lineCapacityPerHour: productionLines.capacityPerHour,
    lineMaxConcurrent: productionLines.maxConcurrentOrders,
  })
    .from(productionOrders)
    .leftJoin(productionLines, eq(productionOrders.lineId, productionLines.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  
  const summary = {
    total: allOrders.length,
    inProgress: allOrders.filter(o => o.status === 'in_progress').length,
    completed: allOrders.filter(o => o.status === 'completed').length,
    pending: allOrders.filter(o => o.status === 'pending').length,
  };
  
  // Aggregate per line for WIP tracking
  const lineMap = new Map<number, {
    lineId: number;
    lineName: string;
    inProgressOrders: number;
    totalTargetQuantity: number;
    totalActualQuantity: number;
    completionPercentage: number;
    utilizationRate: number;
    estimatedCompletionTime: string | null;
    maxConcurrent: number;
  }>();
  
  for (const order of allOrders) {
    if (!lineMap.has(order.lineId)) {
      lineMap.set(order.lineId, {
        lineId: order.lineId,
        lineName: order.lineName || `Line #${order.lineId}`,
        inProgressOrders: 0,
        totalTargetQuantity: 0,
        totalActualQuantity: 0,
        completionPercentage: 0,
        utilizationRate: 0,
        estimatedCompletionTime: null,
        maxConcurrent: order.lineMaxConcurrent || 1,
      });
    }
    const line = lineMap.get(order.lineId)!;
    
    if (order.status === 'in_progress') {
      line.inProgressOrders++;
      line.totalTargetQuantity += order.targetQuantity;
      line.totalActualQuantity += order.completedQuantity;
      
      // Estimate completion based on remaining quantity and capacity
      if (order.lineCapacityPerHour && order.targetQuantity > order.completedQuantity) {
        const remaining = order.targetQuantity - order.completedQuantity;
        const hoursRemaining = remaining / order.lineCapacityPerHour;
        const est = new Date(Date.now() + hoursRemaining * 3600 * 1000);
        if (!line.estimatedCompletionTime || est.toISOString() > line.estimatedCompletionTime) {
          line.estimatedCompletionTime = est.toISOString();
        }
      }
    }
  }
  
  // Compute rates
  for (const line of lineMap.values()) {
    line.completionPercentage = line.totalTargetQuantity > 0
      ? (line.totalActualQuantity / line.totalTargetQuantity) * 100
      : 0;
    line.utilizationRate = line.maxConcurrent > 0
      ? (line.inProgressOrders / line.maxConcurrent) * 100
      : 0;
  }
  
  // Only return lines that have in-progress orders
  const orders = Array.from(lineMap.values()).filter(l => l.inProgressOrders > 0);
  
  return { orders, summary };
}

export async function getWIPByLine(lineId: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  if (!(await trongPhamVi("line", lineId, scope))) return [];
  
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

// ============ G2.5a APS: machine capacity ============

/**
 * Read active machine-capacity rows (G2.5a APS resource model). Optional lineId
 * filter. Returns [] when the DB is unavailable so the solver degrades to
 * single-capacity-per-station.
 */
export async function getMachineCapacity(lineId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(machineCapacity.isActive, true)];
  if (lineId) conditions.push(eq(machineCapacity.lineId, lineId));
  return db.select().from(machineCapacity)
    .where(and(...conditions))
    .orderBy(machineCapacity.lineId, machineCapacity.stationId);
}

// ============ WS-4 SCHEDULE RUNS (audit + apply) ============

export async function createScheduleRun(
  run: InsertScheduleRun,
  items: Omit<InsertScheduleRunItem, "runId">[],
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(scheduleRuns).values(run).returning({ id: scheduleRuns.id });
  const runId = created.id;
  if (items.length > 0) {
    await db.insert(scheduleRunItems).values(items.map((it) => ({ ...it, runId })));
  }
  return { id: runId };
}

export async function listScheduleRuns(filters?: { factoryId?: number; lineId?: number; limit?: number }, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  {
    // `schedule_runs` có CẢ HAI cột và cả hai đều nullable (null/null = chạy TOÀN CỤC). Ưu tiên
    // liên kết tuyến; hàng toàn cục là kết quả lập lịch cho mọi nhà máy nên nó CHỨA dữ liệu của
    // tenant khác ⇒ bị LOẠI cho người bị thu hẹp (khác với `oee_targets`/mẫu lệnh, vốn chỉ là
    // ngưỡng cấu hình không mang số đo).
    const [idsTuyen, idsNhaMay] = await Promise.all([
      idsTrongPhamVi("line", scope),
      idsTrongPhamVi("factory", scope),
    ]);
    if (idsTuyen !== null && idsNhaMay !== null) {
      const cong = or(
        inArray(scheduleRuns.lineId, idsTuyen.length ? idsTuyen : [-1]),
        and(isNull(scheduleRuns.lineId), inArray(scheduleRuns.factoryId, idsNhaMay.length ? idsNhaMay : [-1])),
      );
      if (cong) conditions.push(cong);
    }
  }
  if (filters?.factoryId) conditions.push(eq(scheduleRuns.factoryId, filters.factoryId));
  if (filters?.lineId) conditions.push(eq(scheduleRuns.lineId, filters.lineId));
  const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 500);
  return db.select().from(scheduleRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(scheduleRuns.createdAt))
    .limit(limit);
}

export async function getScheduleRunById(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db.select().from(scheduleRuns).where(eq(scheduleRuns.id, id)).limit(1);
  if (!run) return null;
  {
    const capCanh: "line" | "factory" | null = run.lineId !== null ? "line" : run.factoryId !== null ? "factory" : null;
    const idCanh = run.lineId ?? run.factoryId;
    // Cả hai NULL = chạy TOÀN CỤC ⇒ chứa lịch của mọi nhà máy ⇒ fail-CLOSED cho người bị thu hẹp.
    if (capCanh === null || idCanh === null) {
      if ((await idsTrongPhamVi("line", scope)) !== null) return null;
    } else if (!(await trongPhamVi(capCanh, idCanh, scope))) {
      return null;
    }
  }
  const items = await db.select().from(scheduleRunItems).where(eq(scheduleRunItems.runId, id));
  return { ...run, items };
}

/**
 * Apply a DRAFT schedule run: write each item's suggested slot back to its
 * production order (reusing the same fields as applyScheduleSuggestion to keep
 * the existing audit/update path), then mark the run APPLIED.
 */
export async function applyScheduleRun(id: number): Promise<{ applied: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const items = await db.select().from(scheduleRunItems).where(eq(scheduleRunItems.runId, id));
  let applied = 0;
  for (const item of items) {
    await db.update(productionOrders)
      .set({
        lineId: item.lineId,
        plannedStartDate: item.suggestedStart,
        plannedEndDate: item.suggestedEnd,
      })
      .where(eq(productionOrders.id, item.productionOrderId));
    await db.update(scheduleRunItems).set({ applied: true }).where(eq(scheduleRunItems.id, item.id));
    applied++;
  }
  await db.update(scheduleRuns)
    .set({ status: "APPLIED", appliedAt: new Date() })
    .where(eq(scheduleRuns.id, id));
  return { applied };
}

export async function dismissScheduleRun(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleRuns).set({ status: "DISMISSED" }).where(eq(scheduleRuns.id, id));
}
