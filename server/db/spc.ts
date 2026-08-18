import { getDb } from "./connection";
import { eq, and, desc, asc, gte, lte, sql, or, inArray, isNotNull, isNull, SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { idsTrongPhamVi, type PhamViNguoiXem } from "./hierarchy";
import {
  spcConfigurations,
  InsertSpcConfiguration,
  spcRuleViolations,
  InsertSpcRuleViolation,
  cpkHistory,
  InsertCpkHistory,
  correlationAnalyses,
  InsertCorrelationAnalysis,
  qualityGates,
  InsertQualityGate,
  qualityGateEvents,
  InsertQualityGateEvent,
  measurementResults,
  measurementPointDefs,
  productInspections,
  workstations,
} from "../../drizzle/schema";

/**
 * ★★★ 2026-08-18 (trả nợ nhóm A) — **TRỤC PHẠM VI CỦA HỌ BẢNG SPC, ĐO TRƯỚC KHI VÁ.**
 *
 * Khảo sát trên `aoi_management` ngày 2026-08-18 (hàng · có `workstationId` · có `machineId`):
 *
 *   measurement_point_defs  110 ·   0 ·  25      workstations             0 hàng
 *   spc_configurations        0            spc_rule_violations       0
 *   quality_gates             0            quality_gate_events       0
 *   cpk_history               0            correlation_analyses      0
 *
 * ⇒ **Trục THẬT ở đây là `machineId`.** `workstations` chưa có hàng nào và `workstationId` chưa
 * từng được ghi, nên một bản vá chỉ dựa vào công trạm sẽ là một cổng **không bao giờ phát biểu**
 * — đúng lớp lỗi "lượng từ tự thoả" đã ghi ở PHA 7. Cổng dưới đây hỏi CẢ HAI, nhưng máy là cột
 * đang mang dữ liệu.
 *
 * ⚠ Bảy bảng SPC hiện RỖNG. Điều đó KHÔNG làm bản vá vô nghĩa (đường đọc số đo thật —
 * `measurement_results` ⋈ `product_inspections` — có 110 điểm đo và đầy dữ liệu), nhưng nó có
 * nghĩa là **ca âm-đối-xứng không dựng được trên bảy bảng ấy bằng dữ liệu có sẵn**; phần được
 * nghiệm thu bằng CSDL thật là đường đọc số đo.
 *
 * `giuMacDinh`: hàng KHÔNG gắn máy lẫn công trạm là **cấu hình MẶC ĐỊNH của hệ thống** (ngưỡng,
 * kiểu biểu đồ) — nó không mang số đo của ai nên được giữ (`spc_configurations`, `quality_gates`).
 * Với bảng mang SỐ ĐO (`spc_rule_violations`, `cpk_history`, `correlation_analyses`,
 * `quality_gate_events`) thì KHÔNG: hàng không phân giải được là hàng mồ côi ⇒ loại.
 */
async function congSpc(
  cot: { machineId?: AnyPgColumn; workstationId?: AnyPgColumn; giuMacDinh?: boolean },
  scope?: PhamViNguoiXem,
): Promise<SQL | undefined> {
  const [idsMay, idsTram] = await Promise.all([
    idsTrongPhamVi("machine", scope),
    idsTrongPhamVi("workstation", scope),
  ]);
  if (idsMay === null || idsTram === null) return undefined;
  const nhanh: SQL[] = [];
  if (cot.machineId !== undefined) nhanh.push(inArray(cot.machineId, idsMay.length ? idsMay : [-1]));
  if (cot.workstationId !== undefined) nhanh.push(inArray(cot.workstationId, idsTram.length ? idsTram : [-1]));
  if (cot.giuMacDinh === true) {
    const rong = [cot.machineId, cot.workstationId].filter((c): c is AnyPgColumn => c !== undefined).map((c) => isNull(c));
    if (rong.length > 0) nhanh.push(rong.length === 1 ? rong[0] : (and(...rong) as SQL));
  }
  if (nhanh.length === 0) return sql`1 = 0`;
  return nhanh.length === 1 ? nhanh[0] : or(...nhanh);
}

/**
 * Cổng cho đường đọc **SỐ ĐO THẬT** (`measurement_results` ⋈ `product_inspections`). Trục là
 * `product_inspections."machineId"` — cột NOT NULL, đầy dữ liệu, và là cùng trục mà
 * `machineIdsTrongPhamVi` phân giải.
 */
async function congSoDo(scope?: PhamViNguoiXem): Promise<SQL | undefined> {
  const idsMay = await idsTrongPhamVi("machine", scope);
  if (idsMay === null) return undefined;
  return inArray(productInspections.machineId, idsMay.length ? idsMay : [-1]);
}

// ============ SPC CONFIGURATION CRUD ============

export async function listSpcConfigurations(filters: {
  workstationId?: number;
  productModelId?: number;
  measurementPointDefId?: number;
  isActive?: boolean;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  {
    const cong = await congSpc({ machineId: spcConfigurations.machineId, workstationId: spcConfigurations.workstationId, giuMacDinh: true }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.workstationId) conditions.push(eq(spcConfigurations.workstationId, filters.workstationId));
  if (filters.productModelId) conditions.push(eq(spcConfigurations.productModelId, filters.productModelId));
  if (filters.measurementPointDefId) conditions.push(eq(spcConfigurations.measurementPointDefId, filters.measurementPointDefId));
  if (filters.isActive !== undefined) conditions.push(eq(spcConfigurations.isActive, filters.isActive));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select().from(spcConfigurations)
    .where(whereClause)
    .orderBy(desc(spcConfigurations.createdAt));
}

export async function getSpcConfiguration(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cong = await congSpc({ machineId: spcConfigurations.machineId, workstationId: spcConfigurations.workstationId, giuMacDinh: true }, scope);
  const result = await db.select().from(spcConfigurations)
    .where(and(eq(spcConfigurations.id, id), ...(cong ? [cong] : [])))
    .limit(1);

  return result[0] || null;
}

export async function createSpcConfiguration(data: InsertSpcConfiguration) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(spcConfigurations).values(data).returning();
  return result[0];
}

export async function updateSpcConfiguration(id: number, data: Partial<InsertSpcConfiguration>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(spcConfigurations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(spcConfigurations.id, id))
    .returning();

  return result[0] || null;
}

export async function deleteSpcConfiguration(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(spcConfigurations).where(eq(spcConfigurations.id, id));
}

// ============ MEASUREMENT DATA FOR SPC ANALYSIS ============

export async function getMeasurementValuesForSPC(filters: {
  measurementPointDefId: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  limit?: number;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    eq(measurementResults.pointDefId, filters.measurementPointDefId),
    isNotNull(measurementResults.measuredValue),
  ];
  {
    // ⚠ Cổng AND vào SAU `filters.machineId` (lời TỰ KHAI của người gọi) ⇒ một `machineId` gõ tay
    // của nhà máy khác cho giao RỖNG, không mở được cửa.
    const cong = await congSoDo(scope);
    if (cong) conditions.push(cong);
  }
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  const query = db.select({
    value: measurementResults.measuredValue,
    inspectionTime: productInspections.inspectionTime,
    inspectionId: measurementResults.inspectionId,
    result: measurementResults.result,
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(...conditions))
    .orderBy(asc(productInspections.inspectionTime));

  if (filters.limit) {
    return query.limit(filters.limit);
  }

  return query;
}

/**
 * Fetch ordered measurement values + spec limits for one measurement point,
 * supporting productModelId filtering (used by spc.fullAnalysis). Also returns
 * the per-result OK/NG flag so DPMO/yield can be computed.
 */
export async function getFullAnalysisData(filters: {
  measurementPointDefId: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  productModelId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return { values: [] as { value: number; inspectionTime: Date | null; result: string | null }[], pointDef: null as any };

  const pointDefRows = await db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    upperLimit: measurementPointDefs.upperLimit,
    lowerLimit: measurementPointDefs.lowerLimit,
    nominalValue: measurementPointDefs.nominalValue,
    unit: measurementPointDefs.unit,
  })
    .from(measurementPointDefs)
    .where(eq(measurementPointDefs.id, filters.measurementPointDefId))
    .limit(1);
  const pointDef = pointDefRows[0] || null;

  const conditions: SQL[] = [
    eq(measurementResults.pointDefId, filters.measurementPointDefId),
    isNotNull(measurementResults.measuredValue),
  ];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));
  if (filters.productModelId) conditions.push(eq(productInspections.productModelId, filters.productModelId));

  const query = db.select({
    value: measurementResults.measuredValue,
    inspectionTime: productInspections.inspectionTime,
    result: measurementResults.result,
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(...conditions))
    .orderBy(asc(productInspections.inspectionTime));

  const rows = filters.limit ? await query.limit(filters.limit) : await query;
  return {
    values: rows.map(r => ({
      value: Number(r.value),
      inspectionTime: r.inspectionTime ?? null,
      result: r.result ?? null,
    })),
    pointDef,
  };
}

export async function getWorkstationMeasurementComparison(filters: {
  productModelId: number;
  startDate?: Date;
  endDate?: Date;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    eq(measurementPointDefs.productModelId, filters.productModelId),
    isNotNull(measurementResults.measuredValue),
  ];
  {
    const cong = await congSoDo(scope);
    if (cong) conditions.push(cong);
  }
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  return db.select({
    workstationId: measurementPointDefs.workstationId,
    workstationCode: workstations.code,
    workstationName: workstations.name,
    count: sql<number>`count(*)`.as("count"),
    avgValue: sql<string>`avg(${measurementResults.measuredValue})`.as("avg_value"),
    ngCount: sql<number>`sum(case when ${measurementResults.result} = 'NG' then 1 else 0 end)`.as("ng_count"),
  })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .where(and(...conditions))
    .groupBy(measurementPointDefs.workstationId, workstations.code, workstations.name);
}

// ============ CORRELATION ANALYSIS ============

export async function getMeasurementPairsForCorrelation(filters: {
  pointIds: number[];
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    inArray(measurementResults.pointDefId, filters.pointIds),
    isNotNull(measurementResults.measuredValue),
  ];
  {
    const cong = await congSoDo(scope);
    if (cong) conditions.push(cong);
  }
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  return db.select({
    inspectionId: measurementResults.inspectionId,
    pointDefId: measurementResults.pointDefId,
    value: measurementResults.measuredValue,
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(...conditions))
    .orderBy(asc(measurementResults.inspectionId), asc(measurementResults.pointDefId));
}

export async function saveCorrelationAnalysis(data: InsertCorrelationAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(correlationAnalyses).values(data).returning();
  return result[0];
}

export async function listCorrelationAnalyses(filters: {
  productModelId?: number;
  workstationId?: number;
  limit?: number;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  {
    // Bảng mang SỐ ĐO (ma trận tương quan dựng từ giá trị đo thật) ⇒ KHÔNG có `giuMacDinh`.
    const cong = await congSpc({ machineId: correlationAnalyses.machineId, workstationId: correlationAnalyses.workstationId }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.productModelId) conditions.push(eq(correlationAnalyses.productModelId, filters.productModelId));
  if (filters.workstationId) conditions.push(eq(correlationAnalyses.workstationId, filters.workstationId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db.select().from(correlationAnalyses)
    .where(whereClause)
    .orderBy(desc(correlationAnalyses.analysisDate));

  if (filters.limit) {
    return query.limit(filters.limit);
  }

  return query;
}

// ============ SPC RULE VIOLATIONS CRUD ============

export async function createSpcRuleViolation(data: InsertSpcRuleViolation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(spcRuleViolations).values(data).returning();
  return result[0];
}

export async function listSpcRuleViolations(filters: {
  workstationId?: number;
  productModelId?: number;
  machineId?: number;
  ruleType?: string;
  severity?: string;
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  {
    const cong = await congSpc({ machineId: spcRuleViolations.machineId, workstationId: spcRuleViolations.workstationId }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.workstationId) conditions.push(eq(spcRuleViolations.workstationId, filters.workstationId));
  if (filters.productModelId) conditions.push(eq(spcRuleViolations.productModelId, filters.productModelId));
  if (filters.machineId) conditions.push(eq(spcRuleViolations.machineId, filters.machineId));
  if (filters.ruleType) conditions.push(eq(spcRuleViolations.ruleType, filters.ruleType as any));
  if (filters.severity) conditions.push(eq(spcRuleViolations.severity, filters.severity as any));
  if (filters.isActive !== undefined) conditions.push(eq(spcRuleViolations.isActive, filters.isActive));
  if (filters.startDate) conditions.push(gte(spcRuleViolations.detectedAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(spcRuleViolations.detectedAt, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db.select().from(spcRuleViolations)
    .where(whereClause)
    .orderBy(desc(spcRuleViolations.detectedAt));

  if (filters.limit) {
    return query.limit(filters.limit);
  }

  return query;
}

export async function acknowledgeSpcViolation(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(spcRuleViolations)
    .set({
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    })
    .where(eq(spcRuleViolations.id, id))
    .returning();

  return result[0] || null;
}

export async function resolveSpcViolation(id: number, userId: number, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(spcRuleViolations)
    .set({
      resolvedBy: userId,
      resolvedAt: new Date(),
      resolutionNotes: notes,
      isActive: false,
    })
    .where(eq(spcRuleViolations.id, id))
    .returning();

  return result[0] || null;
}

export async function getActiveViolationCount(filters: {
  workstationId?: number;
  productModelId?: number;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return 0;

  const conditions: SQL[] = [eq(spcRuleViolations.isActive, true)];
  {
    const cong = await congSpc({ machineId: spcRuleViolations.machineId, workstationId: spcRuleViolations.workstationId }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.workstationId) conditions.push(eq(spcRuleViolations.workstationId, filters.workstationId));
  if (filters.productModelId) conditions.push(eq(spcRuleViolations.productModelId, filters.productModelId));

  const result = await db.select({
    count: sql<number>`count(*)`,
  }).from(spcRuleViolations)
    .where(and(...conditions));

  return Number(result[0]?.count) || 0;
}

// ============ CPK HISTORY ============

/**
 * Doc 31 OP9 — enumerate measurement points that can have a capability index
 * computed: active, not soft-deleted, with BOTH a lower and upper spec limit.
 * Used by the periodic cpkSnapshotScheduler. Returns the minimal columns needed
 * to compute + attribute a snapshot.
 */
export async function listPointDefsWithSpecLimits(): Promise<Array<{
  id: number;
  productModelId: number;
  workstationId: number | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  nominalValue: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: measurementPointDefs.id,
      productModelId: measurementPointDefs.productModelId,
      workstationId: measurementPointDefs.workstationId,
      lowerLimit: measurementPointDefs.lowerLimit,
      upperLimit: measurementPointDefs.upperLimit,
      nominalValue: measurementPointDefs.nominalValue,
    })
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
      isNotNull(measurementPointDefs.lowerLimit),
      isNotNull(measurementPointDefs.upperLimit),
    ));
  return rows as any;
}

export async function saveCpkHistory(data: InsertCpkHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(cpkHistory).values(data).returning();
  return result[0];
}

export async function getCpkTrend(filters: {
  measurementPointDefId: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    eq(cpkHistory.measurementPointDefId, filters.measurementPointDefId),
  ];
  {
    const cong = await congSpc({ machineId: cpkHistory.machineId, workstationId: cpkHistory.workstationId }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.startDate) conditions.push(gte(cpkHistory.periodEnd, filters.startDate));
  if (filters.endDate) conditions.push(lte(cpkHistory.periodEnd, filters.endDate));

  const query = db.select().from(cpkHistory)
    .where(and(...conditions))
    .orderBy(desc(cpkHistory.periodEnd));

  if (filters.limit) {
    return query.limit(filters.limit);
  }

  return query;
}

export async function getCpkSummaryByWorkstation(filters: {
  productModelId?: number;
  startDate?: Date;
  endDate?: Date;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  // Subquery: latest cpk_history entry per measurement point
  const latestCpkSubquery = db.select({
    measurementPointDefId: cpkHistory.measurementPointDefId,
    maxPeriodEnd: sql<Date>`max(${cpkHistory.periodEnd})`.as("max_period_end"),
  })
    .from(cpkHistory)
    .groupBy(cpkHistory.measurementPointDefId)
    .as("latest_cpk");

  const conditions: SQL[] = [];
  {
    const cong = await congSpc({ machineId: cpkHistory.machineId, workstationId: cpkHistory.workstationId }, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.productModelId) conditions.push(eq(measurementPointDefs.productModelId, filters.productModelId));
  if (filters.startDate) conditions.push(gte(cpkHistory.periodEnd, filters.startDate));
  if (filters.endDate) conditions.push(lte(cpkHistory.periodEnd, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select({
    workstationId: measurementPointDefs.workstationId,
    workstationCode: workstations.code,
    workstationName: workstations.name,
    measurementPointDefId: cpkHistory.measurementPointDefId,
    cpk: cpkHistory.cpk,
    ppk: cpkHistory.ppk,
    cp: cpkHistory.cp,
    pp: cpkHistory.pp,
    sampleSize: cpkHistory.sampleSize,
    periodEnd: cpkHistory.periodEnd,
    mean: cpkHistory.mean,
    stdDev: cpkHistory.stdDev,
  })
    .from(cpkHistory)
    .innerJoin(
      latestCpkSubquery,
      and(
        eq(cpkHistory.measurementPointDefId, latestCpkSubquery.measurementPointDefId),
        eq(cpkHistory.periodEnd, latestCpkSubquery.maxPeriodEnd),
      ),
    )
    .innerJoin(measurementPointDefs, eq(cpkHistory.measurementPointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .where(whereClause)
    .orderBy(workstations.name, measurementPointDefs.code);
}

// ============ QUALITY GATE CRUD ============

export async function listQualityGates(filters: {
  lineId?: number;
  workstationId?: number;
  productModelId?: number;
  isActive?: boolean;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  {
    // `quality_gates` là CẤU HÌNH (ngưỡng + hành động), không mang số đo ⇒ hàng mặc định
    // (không gắn máy/công trạm) được giữ, cùng luật với `oee_targets` và mẫu lệnh sản xuất.
    const cong = await congCongChatLuong(qualityGates.lineId, scope);
    if (cong) conditions.push(cong);
  }
  if (filters.lineId) conditions.push(eq(qualityGates.lineId, filters.lineId));
  if (filters.workstationId) conditions.push(eq(qualityGates.workstationId, filters.workstationId));
  if (filters.productModelId) conditions.push(eq(qualityGates.productModelId, filters.productModelId));
  if (filters.isActive !== undefined) conditions.push(eq(qualityGates.isActive, filters.isActive));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select().from(qualityGates)
    .where(whereClause)
    .orderBy(desc(qualityGates.createdAt));
}

export async function getQualityGate(id: number, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cong = await congCongChatLuong(qualityGates.lineId, scope);
  const result = await db.select().from(qualityGates)
    .where(and(eq(qualityGates.id, id), ...(cong ? [cong] : [])))
    .limit(1);

  return result[0] || null;
}

/**
 * Cổng riêng của `quality_gates`: nó có thêm cột `lineId` so với họ SPC còn lại, nên trục là
 * MÁY ∪ CÔNG TRẠM ∪ TUYẾN, và hàng không gắn gì cả là ngưỡng MẶC ĐỊNH ⇒ giữ.
 */
async function congCongChatLuong(lineCol: AnyPgColumn, scope?: PhamViNguoiXem): Promise<SQL | undefined> {
  const [idsMay, idsTram, idsTuyen] = await Promise.all([
    idsTrongPhamVi("machine", scope),
    idsTrongPhamVi("workstation", scope),
    idsTrongPhamVi("line", scope),
  ]);
  if (idsMay === null || idsTram === null || idsTuyen === null) return undefined;
  return or(
    inArray(qualityGates.machineId, idsMay.length ? idsMay : [-1]),
    inArray(qualityGates.workstationId, idsTram.length ? idsTram : [-1]),
    inArray(lineCol, idsTuyen.length ? idsTuyen : [-1]),
    and(isNull(qualityGates.machineId), isNull(qualityGates.workstationId), isNull(lineCol)),
  );
}

export async function createQualityGate(data: InsertQualityGate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(qualityGates).values(data).returning();
  return result[0];
}

export async function updateQualityGate(id: number, data: Partial<InsertQualityGate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(qualityGates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(qualityGates.id, id))
    .returning();

  return result[0] || null;
}

export async function deleteQualityGate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(qualityGates).where(eq(qualityGates.id, id));
}

export async function getActiveQualityGatesForLine(lineId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(qualityGates)
    .where(and(
      eq(qualityGates.lineId, lineId),
      eq(qualityGates.isActive, true),
    ))
    .orderBy(qualityGates.name);
}

// ============ QUALITY GATE EVENTS ============

export async function createQualityGateEvent(data: InsertQualityGateEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(qualityGateEvents).values(data).returning();
  return result[0];
}

export async function listQualityGateEvents(filters: {
  qualityGateId?: number;
  status?: string;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
} = {}, scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  {
    const cong = await congSuKienCong(scope);
    if (cong) conditions.push(cong);
  }
  if (filters.qualityGateId) conditions.push(eq(qualityGateEvents.qualityGateId, filters.qualityGateId));
  if (filters.status) conditions.push(eq(qualityGateEvents.status, filters.status as any));
  if (filters.machineId) conditions.push(eq(qualityGateEvents.machineId, filters.machineId));
  if (filters.startDate) conditions.push(gte(qualityGateEvents.triggeredAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(qualityGateEvents.triggeredAt, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db.select().from(qualityGateEvents)
    .where(whereClause)
    .orderBy(desc(qualityGateEvents.triggeredAt));

  if (filters.limit) {
    return query.limit(filters.limit);
  }

  return query;
}

export async function acknowledgeQualityGateEvent(id: number, userId: number, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(qualityGateEvents)
    .set({
      status: "acknowledged" as any,
      notes: notes,
    })
    .where(eq(qualityGateEvents.id, id))
    .returning();

  return result[0] || null;
}

export async function resolveQualityGateEvent(id: number, userId: number, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.update(qualityGateEvents)
    .set({
      status: "resolved" as any,
      resolvedAt: new Date(),
      resolvedBy: userId,
      notes: notes,
    })
    .where(eq(qualityGateEvents.id, id))
    .returning();

  return result[0] || null;
}

export async function getActiveGateEvents(scope?: PhamViNguoiXem) {
  const db = await getDb();
  if (!db) return [];

  const cong = await congSuKienCong(scope);
  return db.select().from(qualityGateEvents)
    .where(and(eq(qualityGateEvents.status, "active" as any), ...(cong ? [cong] : [])))
    .orderBy(desc(qualityGateEvents.triggeredAt));
}

/**
 * Cổng cho `quality_gate_events` — bảng mang SỐ ĐO (giá trị kích hoạt, số hàng bị ảnh hưởng).
 * Nó chỉ có `machineId` (nullable) + `qualityGateId` (NOT NULL), nên hàng không gắn máy được
 * phán quyết qua CỔNG mẹ. KHÔNG có lối "mặc định": một sự kiện luôn xảy ra ở đâu đó thật.
 */
async function congSuKienCong(scope?: PhamViNguoiXem): Promise<SQL | undefined> {
  const idsMay = await idsTrongPhamVi("machine", scope);
  if (idsMay === null) return undefined;
  const db = await getDb();
  if (!db) return sql`1 = 0`;
  const congMe = await congCongChatLuong(qualityGates.lineId, scope);
  return or(
    inArray(qualityGateEvents.machineId, idsMay.length ? idsMay : [-1]),
    and(
      isNull(qualityGateEvents.machineId),
      inArray(
        qualityGateEvents.qualityGateId,
        db.select({ id: qualityGates.id }).from(qualityGates).where(congMe),
      ),
    ),
  );
}
