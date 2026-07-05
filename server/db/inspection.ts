import { getDb } from "./connection";
import { eq, and, desc, asc, gte, lte, gt, lt, like, sql, or, isNull, isNotNull, inArray, SQL } from "drizzle-orm";
import {
  productInspections, InsertProductInspection,
  measurementResults, InsertMeasurementResult,
  measurementPointDefs,
  productModels,
  defectCatalog,
  alertHistory,
  mqttAlertHistory,
  machines,
  stations,
  productionLines,
  workshops,
  factories,
} from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "./auth";

// ============ LIST PROJECTION (doc 27 gap B9) ============
/**
 * Columns actually consumed by the LIST consumers of product_inspections
 * (inspection.list / inspection.listCursor / inspection.search →
 * History, Dashboard widgets, HistoryInfiniteScroll, drill-down, exports,
 * cachedStatistics). Heavy/detail-only columns are deliberately NOT read on
 * these hot paths: notes, tags, ntfConfirmedBy/At, ntfReason, isArchived,
 * archivedAt/By, aiConfidence, aiModelId, aiProcessedAt, aiDetails (json),
 * inspectionType, variantPayload (jsonb), operatorId, productionOrderCode,
 * ingestMode, updatedAt. Detail views (inspection.getById) keep full rows.
 */
export const inspectionListProjection = {
  id: productInspections.id,
  machineId: productInspections.machineId,
  productModelId: productInspections.productModelId,
  corporateCode: productInspections.corporateCode,
  factoryCode: productInspections.factoryCode,
  workshopCode: productInspections.workshopCode,
  lineCode: productInspections.lineCode,
  stageCode: productInspections.stageCode,
  serialNumber: productInspections.serialNumber,
  productModel: productInspections.productModel,
  batchNumber: productInspections.batchNumber,
  overallResult: productInspections.overallResult,
  originalResult: productInspections.originalResult,
  inspectionTime: productInspections.inspectionTime,
  cycleTime: productInspections.cycleTime,
  acknowledgedBy: productInspections.acknowledgedBy,
  acknowledgedAt: productInspections.acknowledgedAt,
  aiDecision: productInspections.aiDecision,
  // W7-B (doc 27 V3): heuristic false-call likelihood — History queue sort +
  // "Nghi báo giả" badge read it from the list projection (advisory only).
  ntfScore: productInspections.ntfScore,
  createdAt: productInspections.createdAt,
} as const;

/** Row shape returned by the projected list reads. */
export type InspectionListRow = Pick<
  typeof productInspections.$inferSelect,
  keyof typeof inspectionListProjection
>;

// ============ PRODUCT INSPECTION FUNCTIONS ============
export async function createProductInspection(data: InsertProductInspection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(productInspections).values(data).returning({ id: productInspections.id });
  return result.id;
}

export async function getProductInspections(filters: {
  machineId?: number;
  corporateCode?: string;
  factoryCode?: string;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.factoryCode) conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  if (filters.serialNumber) conditions.push(like(productInspections.serialNumber, `%${filters.serialNumber}%`));
  if (filters.result) conditions.push(eq(productInspections.overallResult, filters.result));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      } else {
        // User has no assignments, return empty result
        return { data: [], total: 0 };
      }
    } else {
      // User has no assignments, return empty result
      return { data: [], total: 0 };
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    // Projected hot-path read (gap B9) — see inspectionListProjection.
    db.select(inspectionListProjection).from(productInspections)
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
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get inspection by ID with joined machine/line/station/workshop/factory names
 * Used by pdfReportRouter for rich inspection report data
 */
export async function getInspectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select({
      id: productInspections.id,
      machineId: productInspections.machineId,
      productModelId: productInspections.productModelId,
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      serialNumber: productInspections.serialNumber,
      overallResult: productInspections.overallResult,
      inspectionTime: productInspections.inspectionTime,
      cycleTime: productInspections.cycleTime,
      notes: productInspections.notes,
      acknowledgedBy: productInspections.acknowledgedBy,
      acknowledgedAt: productInspections.acknowledgedAt,
      createdAt: productInspections.createdAt,
      machineCode: machines.code,
      machineName: machines.name,
      stationName: stations.name,
      lineName: productionLines.name,
      workshopName: workshops.name,
      factoryName: factories.name,
    })
    .from(productInspections)
    .leftJoin(machines, eq(productInspections.machineId, machines.id))
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(productInspections.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
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

/**
 * Doc 31 MP6 — server spec-gate reconciliation. When the per-point evaluator
 * (pointResultEvaluator) downgraded at least one point to NG on an inspection
 * the machine reported OK, promote overallResult to NG so board yield/FPY stays
 * consistent with the per-point verdicts. Only touches rows STILL recorded OK
 * (never overrides a machine NG/NTF); leaves `originalResult` = the machine's
 * original verdict intact for audit. Best-effort — returns whether it changed a row.
 */
export async function reconcileInspectionOverallNG(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(productInspections)
    .set({ overallResult: "NG", updatedAt: new Date() })
    .where(and(eq(productInspections.id, id), eq(productInspections.overallResult, "OK")))
    .returning({ id: productInspections.id });
  return rows.length > 0;
}

/**
 * Bulk-acknowledge inspections (doc 27 gap F1).
 *
 * Stamps acknowledgedBy/acknowledgedAt on the requested rows. Idempotent:
 * rows that are already acknowledged are left untouched (first acknowledger
 * wins) and reported separately so callers can give an honest count. Ids that
 * match no row are simply not counted.
 */
export async function bulkAcknowledgeInspections(params: {
  ids: number[];
  userId: number;
}): Promise<{ updatedIds: number[]; alreadyAcknowledgedIds: number[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (params.ids.length === 0) return { updatedIds: [], alreadyAcknowledgedIds: [] };

  const now = new Date();
  const updated = await db
    .update(productInspections)
    .set({
      acknowledgedBy: params.userId,
      acknowledgedAt: now,
      updatedAt: now,
    })
    .where(and(
      inArray(productInspections.id, params.ids),
      isNull(productInspections.acknowledgedAt),
    ))
    .returning({ id: productInspections.id });

  const updatedIds = updated.map((r) => r.id);
  const updatedSet = new Set(updatedIds);
  // Whatever was requested but not updated is either already acknowledged or nonexistent.
  const remaining = params.ids.filter((id) => !updatedSet.has(id));
  let alreadyAcknowledgedIds: number[] = [];
  if (remaining.length > 0) {
    const rows = await db
      .select({ id: productInspections.id })
      .from(productInspections)
      .where(and(
        inArray(productInspections.id, remaining),
        isNotNull(productInspections.acknowledgedAt),
      ));
    alreadyAcknowledgedIds = rows.map((r) => r.id);
  }

  return { updatedIds, alreadyAcknowledgedIds };
}

// ============ MEASUREMENT RESULT FUNCTIONS ============
export async function createMeasurementResult(data: InsertMeasurementResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(measurementResults).values(data).returning({ id: measurementResults.id });
  return result.id;
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
  return db.select({
    id: measurementResults.id,
    inspectionId: measurementResults.inspectionId,
    pointDefId: measurementResults.pointDefId,
    measuredValue: measurementResults.measuredValue,
    measuredValueText: measurementResults.measuredValueText,
    result: measurementResults.result,
    imageUrl: measurementResults.imageUrl,
    imageKey: measurementResults.imageKey,
    remark: measurementResults.remark,
    aiAnalysisResult: measurementResults.aiAnalysisResult,
    aiConfidence: measurementResults.aiConfidence,
    aiComparisonScore: measurementResults.aiComparisonScore,
    createdAt: measurementResults.createdAt,
    // Defect classification (NG → defect-code link)
    defectCatalogId: measurementResults.defectCatalogId,
    defectSeverity: measurementResults.defectSeverity,
    // Doc 31 OP3 — raw code retained when it did NOT resolve to a catalog row.
    defectCodeRaw: measurementResults.defectCodeRaw,
    defectCode: defectCatalog.code,
    defectName: defectCatalog.name,
    defectNameVi: defectCatalog.nameVi,
    // Doc 31 OP4 — repair guidance surfaced at RepairStation / InspectionDetail.
    repairGuidance: defectCatalog.repairGuidance,
    repairGuidanceVi: defectCatalog.repairGuidanceVi,
    // Point def info
    pointCode: measurementPointDefs.code,
    pointName: measurementPointDefs.name,
    // Product info
    productModelId: measurementPointDefs.productModelId,
    productCode: productModels.code,
    productName: productModels.name,
  }).from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .where(eq(measurementResults.inspectionId, inspectionId))
    .orderBy(measurementResults.id);
}

export async function getMeasurementResultById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementResults).where(eq(measurementResults.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateMeasurementResultRemark(id: number, remark: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementResults).set({ remark }).where(eq(measurementResults.id, id));
}

// ============ CURSOR-BASED PAGINATION HELPERS ============

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
}

// Helper to encode cursor
export function encodeCursor(id: number, timestamp: Date): string {
  return Buffer.from(`${id}:${timestamp.getTime()}`).toString('base64');
}

// Helper to decode cursor
export function decodeCursor(cursor: string): { id: number; timestamp: Date } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [idStr, timestampStr] = decoded.split(':');
    const id = parseInt(idStr, 10);
    const timestamp = new Date(parseInt(timestampStr, 10));
    if (isNaN(id) || isNaN(timestamp.getTime())) return null;
    return { id, timestamp };
  } catch {
    return null;
  }
}

// Cursor-based pagination for product inspections
export async function getProductInspectionsCursor(params: CursorPaginationParams & {
  machineId?: number;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  corporateCode?: string;
  factoryCode?: string;
  userId?: number;
  userRole?: string;
}): Promise<CursorPaginationResult<InspectionListRow>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 500); // Max 500 per request
  const conditions: SQL[] = [];

  // Access filter by user assignments
  if (params.userId && params.userRole !== 'admin') {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(params.userId, params.userRole || 'user');
    if (accessFilter) conditions.push(accessFilter);
  }

  // Build filter conditions
  if (params.machineId) conditions.push(eq(productInspections.machineId, params.machineId));
  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));
  if (params.corporateCode) conditions.push(eq(productInspections.corporateCode, params.corporateCode));
  if (params.factoryCode) conditions.push(eq(productInspections.factoryCode, params.factoryCode));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              gt(productInspections.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              lt(productInspections.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch one extra to check if there are more.
  // Projected hot-path read (gap B9) — see inspectionListProjection.
  const results = await db.select(inspectionListProjection)
    .from(productInspections)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(productInspections.inspectionTime)
        : desc(productInspections.inspectionTime),
      params.direction === 'backward'
        ? asc(productInspections.id)
        : desc(productInspections.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  // Reverse if backward direction
  if (params.direction === 'backward') {
    data.reverse();
  }

  // Generate cursors
  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.inspectionTime) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.inspectionTime) : null,
    hasMore,
  };
}

// Cursor-based pagination for measurement results
export async function getMeasurementResultsCursor(params: CursorPaginationParams & {
  inspectionId?: number;
  pointDefId?: number;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof measurementResults.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 100, 1000); // Max 1000 per request
  const conditions: SQL[] = [];

  if (params.inspectionId) conditions.push(eq(measurementResults.inspectionId, params.inspectionId));
  if (params.pointDefId) conditions.push(eq(measurementResults.pointDefId, params.pointDefId));
  if (params.result) conditions.push(eq(measurementResults.result, params.result));

  // Cursor condition (using id only since measurementResults doesn't have timestamp)
  if (params.cursor) {
    const cursorId = parseInt(Buffer.from(params.cursor, 'base64').toString('utf-8'), 10);
    if (!isNaN(cursorId)) {
      if (params.direction === 'backward') {
        conditions.push(gt(measurementResults.id, cursorId));
      } else {
        conditions.push(lt(measurementResults.id, cursorId));
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(measurementResults)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(measurementResults.id)
        : desc(measurementResults.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? Buffer.from(lastItem.id.toString()).toString('base64') : null,
    prevCursor: firstItem ? Buffer.from(firstItem.id.toString()).toString('base64') : null,
    hasMore,
  };
}

// Cursor-based pagination for alert history
export async function getAlertHistoryCursor(params: CursorPaginationParams & {
  alertSettingId?: number;
  alertType?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof alertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200); // Max 200 per request
  const conditions: SQL[] = [];

  if (params.alertSettingId) conditions.push(eq(alertHistory.alertSettingId, params.alertSettingId));
  if (params.startDate) conditions.push(gte(alertHistory.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(alertHistory.createdAt, params.endDate));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              gt(alertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              lt(alertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(alertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(alertHistory.createdAt)
        : desc(alertHistory.createdAt),
      params.direction === 'backward'
        ? asc(alertHistory.id)
        : desc(alertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.createdAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.createdAt) : null,
    hasMore,
  };
}

// Cursor-based pagination for MQTT alert history
export async function getMqttAlertHistoryCursor(params: CursorPaginationParams & {
  ruleId?: number;
  resolved?: boolean;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof mqttAlertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200);
  const conditions: SQL[] = [];

  if (params.ruleId) conditions.push(eq(mqttAlertHistory.ruleId, params.ruleId));
  if (params.resolved !== undefined) {
    if (params.resolved) {
      conditions.push(isNotNull(mqttAlertHistory.resolvedAt));
    } else {
      conditions.push(isNull(mqttAlertHistory.resolvedAt));
    }
  }
  if (params.startDate) conditions.push(gte(mqttAlertHistory.triggeredAt, params.startDate));
  if (params.endDate) conditions.push(lte(mqttAlertHistory.triggeredAt, params.endDate));

  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              gt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              lt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(mqttAlertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(mqttAlertHistory.triggeredAt)
        : desc(mqttAlertHistory.triggeredAt),
      params.direction === 'backward'
        ? asc(mqttAlertHistory.id)
        : desc(mqttAlertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.triggeredAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.triggeredAt) : null,
    hasMore,
  };
}
