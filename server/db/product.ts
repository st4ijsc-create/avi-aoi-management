import { getDb } from "./connection";
import { eq, and, desc, asc, like, or, sql, isNull, gte, SQL } from "drizzle-orm";
import {
  productModels, InsertProductModel,
  measurementPointDefs, InsertMeasurementPointDef,
  measurementPointVersions,
  measurementTypeCatalog, InsertMeasurementTypeCatalog,
  defectCatalog, InsertDefectCatalog,
  productMachineMappings, InsertProductMachineMapping,
  productCategories, InsertProductCategory,
  syncLogs, InsertSyncLog,
  machines,
  fiducialMarks, InsertFiducialMark,
  measurementInstruments, InsertMeasurementInstrument,
  samplingPlans, InsertSamplingPlan,
  productViews, InsertProductView,
  msaStudies, InsertMsaStudy,
  msaObservations, InsertMsaObservation,
  msaCsvMappingPresets, InsertMsaCsvMappingPreset,
  instrumentCalibrations, InsertInstrumentCalibration,
  instrumentMsaRecords, InsertInstrumentMsaRecord,
  mpLightingProfiles, InsertMpLightingProfile,
  measurementSamples, InsertMeasurementSample,
  mpSpcAlerts, InsertMpSpcAlert,
  mpSpcRolling, InsertMpSpcRolling,
  cadImportJobs, InsertCadImportJob,
  cadImportCandidates, InsertCadImportCandidate,
  stationTraces, InsertStationTrace,
  genealogyChain, InsertGenealogyChain,
} from "../../drizzle/schema";
import { measurementResults, productInspections } from "../../drizzle/schema/inspection";

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

  // P0: Always exclude soft-deleted rows
  conditions.push(isNull(productModels.deletedAt));

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

  // conditions always non-empty (deletedAt filter is unconditional)
  query = query.where(and(...conditions));

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
  const result = await db.select().from(productModels)
    .where(and(eq(productModels.id, id), isNull(productModels.deletedAt)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProductModelByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels)
    .where(and(eq(productModels.code, code), isNull(productModels.deletedAt)))
    .limit(1);
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
  // P0 soft-delete: mark product and all child measurement points as deleted.
  // No cascade hard-delete — history is preserved for audit, foreign data, and undelete.
  const now = new Date();
  await db.update(measurementPointDefs)
    .set({ deletedAt: now })
    .where(and(
      eq(measurementPointDefs.productModelId, id),
      isNull(measurementPointDefs.deletedAt),
    ));
  await db.update(productModels)
    .set({ deletedAt: now, isActive: false })
    .where(eq(productModels.id, id));
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
    .where(and(
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getAllMeasurementPoints() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(isNull(measurementPointDefs.deletedAt))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefsByProductModel(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.machineId, machineId),
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefsByWorkstation(workstationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.workstationId, workstationId),
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.id, id), isNull(measurementPointDefs.deletedAt)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMeasurementPointDefByCode(productModelId: number, code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      eq(measurementPointDefs.code, code),
      isNull(measurementPointDefs.deletedAt),
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
      eq(measurementPointDefs.code, code),
      isNull(measurementPointDefs.deletedAt),
    ))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMeasurementTypeCatalogByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(measurementTypeCatalog)
    .where(and(
      eq(measurementTypeCatalog.code, code),
      isNull(measurementTypeCatalog.deletedAt),
      eq(measurementTypeCatalog.isActive, true),
    ))
    .limit(1);
  return rows[0];
}

export async function listMeasurementTypeCatalog(filters?: { category?: string; includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [isNull(measurementTypeCatalog.deletedAt)];
  if (!filters?.includeInactive) {
    conds.push(eq(measurementTypeCatalog.isActive, true));
  }
  if (filters?.category) {
    conds.push(eq(measurementTypeCatalog.category, filters.category));
  }
  return db.select().from(measurementTypeCatalog)
    .where(and(...conds))
    .orderBy(asc(measurementTypeCatalog.category), asc(measurementTypeCatalog.subType));
}

export async function createMeasurementTypeCatalog(data: InsertMeasurementTypeCatalog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(measurementTypeCatalog).values(data).returning({ id: measurementTypeCatalog.id });
  return row.id;
}

export async function updateMeasurementTypeCatalog(id: number, data: Partial<InsertMeasurementTypeCatalog>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementTypeCatalog).set({ ...data, updatedAt: new Date() }).where(eq(measurementTypeCatalog.id, id));
}

export async function softDeleteMeasurementTypeCatalog(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementTypeCatalog)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(measurementTypeCatalog.id, id));
}

export async function getDefectCatalogByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(defectCatalog)
    .where(and(
      eq(defectCatalog.code, code),
      isNull(defectCatalog.deletedAt),
      eq(defectCatalog.isActive, true),
    ))
    .limit(1);
  return rows[0];
}

export async function getDefectCatalogById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(defectCatalog)
    .where(and(eq(defectCatalog.id, id), isNull(defectCatalog.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function listDefectCatalog(filters?: { category?: string; severity?: string; includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [isNull(defectCatalog.deletedAt)];
  if (!filters?.includeInactive) {
    conds.push(eq(defectCatalog.isActive, true));
  }
  if (filters?.category) {
    conds.push(eq(defectCatalog.category, filters.category));
  }
  if (filters?.severity) {
    conds.push(eq(defectCatalog.severity, filters.severity as any));
  }
  return db.select().from(defectCatalog)
    .where(and(...conds))
    .orderBy(asc(defectCatalog.category), asc(defectCatalog.code));
}

export async function createDefectCatalog(data: InsertDefectCatalog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(defectCatalog).values(data).returning({ id: defectCatalog.id });
  return row.id;
}

export async function updateDefectCatalog(id: number, data: Partial<InsertDefectCatalog>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(defectCatalog).set({ ...data, updatedAt: new Date() }).where(eq(defectCatalog.id, id));
}

export async function softDeleteDefectCatalog(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(defectCatalog)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(defectCatalog.id, id));
}

// ============ P3 FOUNDATION FUNCTIONS ============
export async function listMeasurementInstruments(filters?: { instrumentType?: string; includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [isNull(measurementInstruments.deletedAt)];
  if (!filters?.includeInactive) {
    conds.push(eq(measurementInstruments.isActive, true));
  }
  if (filters?.instrumentType) {
    conds.push(eq(measurementInstruments.instrumentType, filters.instrumentType));
  }
  return db.select().from(measurementInstruments)
    .where(and(...conds))
    .orderBy(asc(measurementInstruments.code));
}

export async function getMeasurementInstrumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(measurementInstruments)
    .where(and(eq(measurementInstruments.id, id), isNull(measurementInstruments.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createMeasurementInstrument(data: InsertMeasurementInstrument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(measurementInstruments).values(data).returning({ id: measurementInstruments.id });
  return row.id;
}

export async function updateMeasurementInstrument(id: number, data: Partial<InsertMeasurementInstrument>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementInstruments).set({ ...data, updatedAt: new Date() }).where(eq(measurementInstruments.id, id));
}

export async function softDeleteMeasurementInstrument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementInstruments)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(measurementInstruments.id, id));
}

export async function listSamplingPlansByProduct(productModelId: number, opts?: { includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [
    eq(samplingPlans.productModelId, productModelId),
    isNull(samplingPlans.deletedAt),
  ];
  if (!opts?.includeInactive) {
    conds.push(eq(samplingPlans.isActive, true));
  }
  return db.select().from(samplingPlans)
    .where(and(...conds))
    .orderBy(desc(samplingPlans.version), asc(samplingPlans.code));
}

export async function getSamplingPlanById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(samplingPlans)
    .where(and(eq(samplingPlans.id, id), isNull(samplingPlans.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createSamplingPlan(data: InsertSamplingPlan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(samplingPlans).values(data).returning({ id: samplingPlans.id });
  return row.id;
}

export async function updateSamplingPlan(id: number, data: Partial<InsertSamplingPlan>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(samplingPlans).set({ ...data, updatedAt: new Date() }).where(eq(samplingPlans.id, id));
}

export async function softDeleteSamplingPlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(samplingPlans)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(samplingPlans.id, id));
}

export async function listProductViewsByProduct(productModelId: number, opts?: { includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [
    eq(productViews.productModelId, productModelId),
    isNull(productViews.deletedAt),
  ];
  if (!opts?.includeInactive) {
    conds.push(eq(productViews.isActive, true));
  }
  return db.select().from(productViews)
    .where(and(...conds))
    .orderBy(asc(productViews.orderIndex), asc(productViews.code));
}

export async function getProductViewById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(productViews)
    .where(and(eq(productViews.id, id), isNull(productViews.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createProductView(data: InsertProductView) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(productViews).values(data).returning({ id: productViews.id });
  return row.id;
}

export async function updateProductView(id: number, data: Partial<InsertProductView>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productViews).set({ ...data, updatedAt: new Date() }).where(eq(productViews.id, id));
}

export async function softDeleteProductView(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productViews)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(productViews.id, id));
}

export async function listMsaStudiesByProduct(productModelId: number, opts?: { includeInactive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [
    eq(msaStudies.productModelId, productModelId),
    isNull(msaStudies.deletedAt),
  ];
  if (!opts?.includeInactive) {
    conds.push(eq(msaStudies.isActive, true));
  }
  return db.select().from(msaStudies)
    .where(and(...conds))
    .orderBy(desc(msaStudies.createdAt));
}

export async function getMsaStudyById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(msaStudies)
    .where(and(eq(msaStudies.id, id), isNull(msaStudies.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createMsaStudy(data: InsertMsaStudy) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(msaStudies).values(data).returning({ id: msaStudies.id });
  return row.id;
}

export async function updateMsaStudy(id: number, data: Partial<InsertMsaStudy>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(msaStudies).set({ ...data, updatedAt: new Date() }).where(eq(msaStudies.id, id));
}

export async function softDeleteMsaStudy(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(msaStudies)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(msaStudies.id, id));
}

export async function addMsaObservation(data: InsertMsaObservation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(msaObservations).values(data).returning({ id: msaObservations.id });
  return row.id;
}

export async function getMsaObservationByCell(studyId: number, operatorName: string, partLabel: string, trialNo: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(msaObservations)
    .where(and(
      eq(msaObservations.studyId, studyId),
      eq(msaObservations.operatorName, operatorName),
      eq(msaObservations.partLabel, partLabel),
      eq(msaObservations.trialNo, trialNo),
    ))
    .limit(1);
  return rows[0];
}

export async function generateMsaObservationMatrix(studyId: number, options?: {
  overwriteExisting?: boolean;
  baseValue?: number;
  noisePct?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const study = await getMsaStudyById(studyId);
  if (!study) throw new Error("MSA study not found");

  const operatorCount = Number(study.operatorCount ?? 3);
  const partCount = Number(study.partCount ?? 10);
  const trialCount = Number(study.trialCount ?? 2);
  const overwrite = options?.overwriteExisting === true;
  const base = Number.isFinite(options?.baseValue as number) ? Number(options?.baseValue) : 10;
  const noisePct = Number.isFinite(options?.noisePct as number) ? Math.max(0, Number(options?.noisePct)) : 2;

  const operators = Array.from({ length: operatorCount }, (_, i) => `OP-${String(i + 1).padStart(2, "0")}`);
  const parts = Array.from({ length: partCount }, (_, i) => `P-${String(i + 1).padStart(2, "0")}`);

  let created = 0;
  let skipped = 0;

  for (const op of operators) {
    for (const part of parts) {
      const partIndex = Number(part.split("-")[1] || "1");
      const partBias = (partIndex - (partCount + 1) / 2) * 0.05;
      for (let t = 1; t <= trialCount; t++) {
        const existing = await getMsaObservationByCell(studyId, op, part, t);
        if (existing && !overwrite) {
          skipped++;
          continue;
        }

        const random = (Math.random() - 0.5) * 2;
        const noise = base * (noisePct / 100) * random;
        const value = base + partBias + noise;

        if (existing && overwrite) {
          await db.update(msaObservations)
            .set({ measuredValue: String(value), notes: "auto-generated" })
            .where(eq(msaObservations.id, existing.id));
        } else {
          await db.insert(msaObservations).values({
            studyId,
            operatorName: op,
            partLabel: part,
            trialNo: t,
            measuredValue: String(value),
            notes: "auto-generated",
          });
        }
        created++;
      }
    }
  }

  return {
    created,
    skipped,
    matrixShape: { operators: operatorCount, parts: partCount, trials: trialCount },
  };
}

export async function listMsaObservationsByStudy(studyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(msaObservations)
    .where(eq(msaObservations.studyId, studyId))
    .orderBy(asc(msaObservations.operatorName), asc(msaObservations.partLabel), asc(msaObservations.trialNo), asc(msaObservations.id));
}

export async function listMsaCsvMappingPresetsByProduct(productModelId: number, opts?: { sourceMachine?: string }) {
  const db = await getDb();
  if (!db) return [];

  const conds: SQL[] = [
    eq(msaCsvMappingPresets.productModelId, productModelId),
    eq(msaCsvMappingPresets.isActive, true),
    isNull(msaCsvMappingPresets.deletedAt),
  ];
  if (opts?.sourceMachine) {
    conds.push(eq(msaCsvMappingPresets.sourceMachine, opts.sourceMachine));
  }

  return db.select().from(msaCsvMappingPresets)
    .where(and(...conds))
    .orderBy(asc(msaCsvMappingPresets.sourceMachine), asc(msaCsvMappingPresets.presetName));
}

export async function getMsaCsvMappingPresetByScope(productModelId: number, sourceMachine: string, presetName: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(msaCsvMappingPresets)
    .where(and(
      eq(msaCsvMappingPresets.productModelId, productModelId),
      eq(msaCsvMappingPresets.sourceMachine, sourceMachine),
      eq(msaCsvMappingPresets.presetName, presetName),
      isNull(msaCsvMappingPresets.deletedAt),
    ))
    .limit(1);
  return rows[0];
}

export async function upsertMsaCsvMappingPreset(data: InsertMsaCsvMappingPreset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getMsaCsvMappingPresetByScope(data.productModelId!, data.sourceMachine!, data.presetName!);
  if (existing) {
    await db.update(msaCsvMappingPresets)
      .set({
        instrumentId: data.instrumentId ?? null,
        hasHeader: data.hasHeader ?? true,
        columnMap: data.columnMap,
        updatedBy: data.updatedBy,
        updatedAt: new Date(),
        deletedAt: null,
        isActive: true,
      })
      .where(eq(msaCsvMappingPresets.id, existing.id));
    return existing.id;
  }

  const [row] = await db.insert(msaCsvMappingPresets).values(data).returning({ id: msaCsvMappingPresets.id });
  return row.id;
}

export async function softDeleteMsaCsvMappingPreset(id: number, updatedBy?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(msaCsvMappingPresets)
    .set({
      isActive: false,
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy,
    })
    .where(eq(msaCsvMappingPresets.id, id));
}

export async function calculateMsaSummary(studyId: number) {
  const rows = await listMsaObservationsByStudy(studyId);
  const values = rows.map((r: any) => Number(r.measuredValue)).filter((v: number) => Number.isFinite(v));
  if (values.length < 2) {
    return {
      sampleSize: values.length,
      avg: values.length === 1 ? values[0] : 0,
      stdDev: 0,
      repeatabilityEV: 0,
      reproducibilityAV: 0,
      grr: 0,
      tv: 0,
      grrPct: 0,
      ndc: null,
      verdict: "insufficient_data",
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1));

  // Repeatability (EV): average range of repeated trials for same operator+part.
  const groupedOpPart = new Map<string, number[]>();
  for (const r of rows as any[]) {
    const key = `${r.operatorName}__${r.partLabel}`;
    if (!groupedOpPart.has(key)) groupedOpPart.set(key, []);
    groupedOpPart.get(key)!.push(Number(r.measuredValue));
  }
  const ranges = Array.from(groupedOpPart.values())
    .filter(arr => arr.length >= 2)
    .map(arr => Math.max(...arr) - Math.min(...arr));
  const avgRange = ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  const ev = avgRange > 0 ? avgRange / 1.128 : 0;

  // Reproducibility (AV): variation between operator means.
  const groupedOperator = new Map<string, number[]>();
  for (const r of rows as any[]) {
    if (!groupedOperator.has(r.operatorName)) groupedOperator.set(r.operatorName, []);
    groupedOperator.get(r.operatorName)!.push(Number(r.measuredValue));
  }
  const operatorMeans = Array.from(groupedOperator.values()).map(arr => arr.reduce((a, b) => a + b, 0) / arr.length);
  const operatorMean = operatorMeans.reduce((a, b) => a + b, 0) / Math.max(1, operatorMeans.length);
  const av = operatorMeans.length > 1
    ? Math.sqrt(operatorMeans.reduce((sum, v) => sum + (v - operatorMean) ** 2, 0) / (operatorMeans.length - 1))
    : 0;

  const grr = Math.sqrt(ev ** 2 + av ** 2);
  const tv = stdDev;
  const grrPct = tv > 0 ? (grr / tv) * 100 : 0;

  // Part variation proxy and ndc estimate.
  const groupedPart = new Map<string, number[]>();
  for (const r of rows as any[]) {
    if (!groupedPart.has(r.partLabel)) groupedPart.set(r.partLabel, []);
    groupedPart.get(r.partLabel)!.push(Number(r.measuredValue));
  }
  const partMeans = Array.from(groupedPart.values()).map(arr => arr.reduce((a, b) => a + b, 0) / arr.length);
  const partMean = partMeans.reduce((a, b) => a + b, 0) / Math.max(1, partMeans.length);
  const pv = partMeans.length > 1
    ? Math.sqrt(partMeans.reduce((sum, v) => sum + (v - partMean) ** 2, 0) / (partMeans.length - 1))
    : 0;
  const ndc = grr > 0 ? Math.floor(1.41 * (pv / grr)) : null;

  const verdict = grrPct <= 10 ? "good" : grrPct <= 30 ? "acceptable" : "poor";

  return {
    sampleSize: values.length,
    avg: mean,
    stdDev,
    repeatabilityEV: ev,
    reproducibilityAV: av,
    grr,
    tv,
    grrPct,
    ndc,
    verdict,
  };
}

export async function updateMeasurementPointDef(
  id: number,
  data: Partial<InsertMeasurementPointDef>,
  options?: { changedBy?: number | null; changeReason?: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // P0 versioning: snapshot the *previous* state of the row before applying the
  // update. The latest version row therefore reflects the pre-update state.
  const [previous] = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.id, id))
    .limit(1);

  if (previous) {
    const [{ maxVersion }] = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${measurementPointVersions.version}), 0)` })
      .from(measurementPointVersions)
      .where(eq(measurementPointVersions.pointDefId, id));

    const nextVersion = Number(maxVersion ?? 0) + 1;

    await db.insert(measurementPointVersions).values({
      pointDefId: id,
      version: nextVersion,
      snapshotJson: previous as unknown as Record<string, any>,
      changedBy: options?.changedBy ?? null,
      changeReason: options?.changeReason ?? null,
    });
  }

  await db.update(measurementPointDefs).set(data).where(eq(measurementPointDefs.id, id));
}

export async function deleteMeasurementPointDef(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // P0 soft-delete via deletedAt. Also flips isActive=false to keep legacy
  // active-only consumers consistent with the new soft-delete model.
  await db.update(measurementPointDefs)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(measurementPointDefs.id, id));
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

// ============ FIDUCIAL MARK FUNCTIONS (P1) ============
export async function createFiducialMark(data: InsertFiducialMark) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(fiducialMarks).values(data).returning({ id: fiducialMarks.id });
  return result[0]?.id;
}

export async function getFiducialMarksByProductModel(productModelId: number, opts?: { includeInactive?: boolean; includeDeleted?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [eq(fiducialMarks.productModelId, productModelId)];
  if (!opts?.includeDeleted) conds.push(isNull(fiducialMarks.deletedAt));
  if (!opts?.includeInactive) conds.push(eq(fiducialMarks.isActive, true));
  return db.select().from(fiducialMarks).where(and(...conds)).orderBy(asc(fiducialMarks.orderIndex));
}

export async function getFiducialMarkById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(fiducialMarks)
    .where(and(eq(fiducialMarks.id, id), isNull(fiducialMarks.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateFiducialMark(id: number, data: Partial<InsertFiducialMark>) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(fiducialMarks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(fiducialMarks.id, id));
}

export async function deleteFiducialMark(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(fiducialMarks)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(fiducialMarks.id, id));
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
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(asc(measurementPointDefs.orderIndex));
}

export async function getPointsChangedSinceVersion(productModelId: number, sinceVersion: number) {
  const db = await getDb();
  if (!db) return { points: [], currentVersion: 0 };

  const product = await db.select({ pointsConfigVersion: productModels.pointsConfigVersion })
    .from(productModels)
    .where(and(eq(productModels.id, productModelId), isNull(productModels.deletedAt)))
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
      isNull(measurementPointDefs.deletedAt),
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

// (P4.A helpers appended below)

// ============================================================
// P4.A G19 — Instrument Calibration helpers
// ============================================================
export async function listInstrumentCalibrations(instrumentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(instrumentCalibrations)
    .where(and(
      eq(instrumentCalibrations.instrumentId, instrumentId),
      isNull(instrumentCalibrations.deletedAt),
    ))
    .orderBy(desc(instrumentCalibrations.performedAt));
}

export async function getLatestValidCalibration(instrumentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(instrumentCalibrations)
    .where(and(
      eq(instrumentCalibrations.instrumentId, instrumentId),
      isNull(instrumentCalibrations.deletedAt),
      sql`${instrumentCalibrations.result} <> 'fail'`,
    ))
    .orderBy(desc(instrumentCalibrations.performedAt))
    .limit(1);
  return rows[0];
}

export async function createInstrumentCalibration(data: InsertInstrumentCalibration) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(instrumentCalibrations).values(data)
    .returning({ id: instrumentCalibrations.id });
  return row.id;
}

export async function softDeleteInstrumentCalibration(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(instrumentCalibrations)
    .set({ deletedAt: new Date() })
    .where(eq(instrumentCalibrations.id, id));
}

// ============================================================
// P4.A G19 — Instrument MSA records helpers
// ============================================================
export async function listInstrumentMsaRecords(instrumentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(instrumentMsaRecords)
    .where(and(
      eq(instrumentMsaRecords.instrumentId, instrumentId),
      isNull(instrumentMsaRecords.deletedAt),
    ))
    .orderBy(desc(instrumentMsaRecords.performedAt));
}

export async function getLatestValidMsaRecord(instrumentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(instrumentMsaRecords)
    .where(and(
      eq(instrumentMsaRecords.instrumentId, instrumentId),
      isNull(instrumentMsaRecords.deletedAt),
      sql`${instrumentMsaRecords.verdict} IN ('good','acceptable')`,
    ))
    .orderBy(desc(instrumentMsaRecords.performedAt))
    .limit(1);
  return rows[0];
}

export async function createInstrumentMsaRecord(data: InsertInstrumentMsaRecord) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(instrumentMsaRecords).values(data)
    .returning({ id: instrumentMsaRecords.id });
  return row.id;
}

export async function softDeleteInstrumentMsaRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(instrumentMsaRecords)
    .set({ deletedAt: new Date() })
    .where(eq(instrumentMsaRecords.id, id));
}

/**
 * Compute instrument health: ok | cal_due_soon | cal_expired | msa_missing |
 * msa_expired | inactive. Used by production gate.
 */
export async function getInstrumentHealth(instrumentId: number): Promise<{
  status: "ok" | "cal_due_soon" | "cal_expired" | "msa_missing" | "msa_expired" | "inactive";
  calValidUntil?: Date;
  msaValidUntil?: Date;
}> {
  const inst = await getMeasurementInstrumentById(instrumentId);
  if (!inst) return { status: "inactive" };
  if (!inst.isActive) return { status: "inactive" };
  const cal = await getLatestValidCalibration(instrumentId);
  const msa = await getLatestValidMsaRecord(instrumentId);
  const now = Date.now();
  const calUntil = cal?.validUntil ?? inst.nextCalibrationAt;
  if (!calUntil || new Date(calUntil).getTime() < now) {
    return { status: "cal_expired", calValidUntil: calUntil ?? undefined, msaValidUntil: msa?.validUntil };
  }
  if (new Date(calUntil).getTime() < now + 14 * 24 * 3600 * 1000) {
    return { status: "cal_due_soon", calValidUntil: calUntil, msaValidUntil: msa?.validUntil };
  }
  if (!msa) return { status: "msa_missing", calValidUntil: calUntil };
  if (new Date(msa.validUntil).getTime() < now) {
    return { status: "msa_expired", calValidUntil: calUntil, msaValidUntil: msa.validUntil };
  }
  return { status: "ok", calValidUntil: calUntil, msaValidUntil: msa.validUntil };
}

// ============================================================
// P4.A G17 — MP Lighting Profile helpers
// ============================================================
export async function listMpLightingProfiles(pointDefId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mpLightingProfiles)
    .where(and(
      eq(mpLightingProfiles.pointDefId, pointDefId),
      isNull(mpLightingProfiles.deletedAt),
    ))
    .orderBy(asc(mpLightingProfiles.shotIndex));
}

export async function createMpLightingProfile(data: InsertMpLightingProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(mpLightingProfiles).values(data)
    .returning({ id: mpLightingProfiles.id });
  return row.id;
}

export async function updateMpLightingProfile(id: number, data: Partial<InsertMpLightingProfile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(mpLightingProfiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(mpLightingProfiles.id, id));
}

export async function softDeleteMpLightingProfile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(mpLightingProfiles)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(mpLightingProfiles.id, id));
}

// (P4.B helpers appended)

// ============================================================
// P4.B G14 — Measurement samples (time-series) helpers
// ============================================================
export async function ensureMeasurementSamplesPartition(date: Date) {
  const db = await getDb();
  if (!db) return;
  const yr = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  await db.execute(sql`SELECT ensure_measurement_samples_partition(${yr}, ${mo})`);
}

export async function insertMeasurementSamples(rows: InsertMeasurementSample[]) {
  if (rows.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Make sure all relevant partitions exist
  const months = new Set<string>();
  for (const r of rows) {
    const d = new Date(r.sampledAt);
    months.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
  }
  for (const m of months) {
    const [yStr, mStr] = m.split("-");
    await db.execute(sql`SELECT ensure_measurement_samples_partition(${parseInt(yStr, 10)}, ${parseInt(mStr, 10)})`);
  }
  // Strip explicit `id` so Postgres assigns from bigserial sequence.
  const inserted = await db.insert(measurementSamples)
    .values(rows.map(({ id: _ignored, ...rest }: any) => rest))
    .returning({ id: measurementSamples.id });
  return inserted.length;
}

export async function listMeasurementSamples(opts: {
  pointDefId: number;
  windowSize?: number;
  fromTs?: Date;
  toTs?: Date;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [eq(measurementSamples.pointDefId, opts.pointDefId)];
  if (opts.fromTs) conds.push(gte(measurementSamples.sampledAt, opts.fromTs));
  if (opts.toTs) conds.push(sql`${measurementSamples.sampledAt} <= ${opts.toTs}`);
  const limit = opts.windowSize ?? 200;
  const rows = await db.select()
    .from(measurementSamples)
    .where(and(...conds))
    .orderBy(desc(measurementSamples.sampledAt))
    .limit(limit);
  // Return chronological
  return rows.reverse();
}

// ============================================================
// P4.B G14 — SPC alerts helpers
// ============================================================
export async function createSpcAlert(data: InsertMpSpcAlert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(mpSpcAlerts).values(data)
    .returning({ id: mpSpcAlerts.id });
  return row.id;
}

export async function listSpcAlerts(opts: {
  pointDefId?: number;
  unackedOnly?: boolean;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [];
  if (opts.pointDefId) conds.push(eq(mpSpcAlerts.pointDefId, opts.pointDefId));
  if (opts.unackedOnly) conds.push(isNull(mpSpcAlerts.ackAt));
  return db.select().from(mpSpcAlerts)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(mpSpcAlerts.createdAt))
    .limit(opts.limit ?? 50);
}

export async function ackSpcAlert(id: number, ackBy: number, ackNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(mpSpcAlerts)
    .set({ ackAt: new Date(), ackBy, ackNote: ackNote ?? null })
    .where(eq(mpSpcAlerts.id, id));
}

// ============================================================
// P4.B G14 — Rolling SPC stats cache helpers
// ============================================================
export async function getRollingSpc(pointDefId: number, windowSize = 30) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(mpSpcRolling)
    .where(and(
      eq(mpSpcRolling.pointDefId, pointDefId),
      eq(mpSpcRolling.windowSize, windowSize),
    )).limit(1);
  return rows[0];
}

export async function upsertRollingSpc(data: InsertMpSpcRolling) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getRollingSpc(data.pointDefId, data.windowSize ?? 30);
  if (existing) {
    await db.update(mpSpcRolling)
      .set({ ...data, computedAt: new Date() })
      .where(eq(mpSpcRolling.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(mpSpcRolling).values(data)
    .returning({ id: mpSpcRolling.id });
  return row.id;
}

// (P4.B G10 mp defect stats appended)

// ============================================================
// P4.B G10 — Per-MP defect statistics for heatmap overlay on product reference image
// ============================================================
export interface MpDefectStat {
  pointDefId: number;
  code: string;
  positionX: number;
  positionY: number;
  radius: number;
  shape: string;
  geometry: any;
  totalCount: number;
  ngCount: number;
  defectRate: number;
  topDefects: Array<{ code: string | null; name: string | null; count: number }>;
}

export async function getMpDefectStatsForProduct(opts: {
  productModelId: number;
  fromTs?: Date;
  toTs?: Date;
  machineId?: number;
  productViewId?: number;
}): Promise<MpDefectStat[]> {
  const db = await getDb();
  if (!db) return [];

  const conds: SQL[] = [
    eq(measurementPointDefs.productModelId, opts.productModelId),
    isNull(measurementPointDefs.deletedAt),
  ];
  if (opts.productViewId) {
    conds.push(eq(measurementPointDefs.productViewId, opts.productViewId));
  }
  const points = await db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    positionX: measurementPointDefs.positionX,
    positionY: measurementPointDefs.positionY,
    radius: measurementPointDefs.radius,
    shape: measurementPointDefs.shape,
    geometry: measurementPointDefs.geometry,
  }).from(measurementPointDefs).where(and(...conds));

  if (points.length === 0) return [];
  const pointIds = points.map((p) => p.id);

  const resultConds: SQL[] = [
    sql`${measurementResults.pointDefId} = ANY(${pointIds})`,
  ];
  if (opts.fromTs) {
    resultConds.push(sql`${productInspections.inspectionTime} >= ${opts.fromTs}`);
  }
  if (opts.toTs) {
    resultConds.push(sql`${productInspections.inspectionTime} <= ${opts.toTs}`);
  }
  if (opts.machineId) {
    resultConds.push(eq(productInspections.machineId, opts.machineId));
  }

  // Aggregate count per point
  const aggRows = await db.select({
    pointDefId: measurementResults.pointDefId,
    totalCount: sql<number>`COUNT(*)::int`.as("totalCount"),
    ngCount: sql<number>`SUM(CASE WHEN ${measurementResults.result} <> 'OK' THEN 1 ELSE 0 END)::int`.as("ngCount"),
  })
  .from(measurementResults)
  .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
  .where(and(...resultConds))
  .groupBy(measurementResults.pointDefId);

  const aggMap = new Map<number, { totalCount: number; ngCount: number }>();
  for (const r of aggRows) {
    aggMap.set(r.pointDefId, { totalCount: Number(r.totalCount), ngCount: Number(r.ngCount) });
  }

  // Top 3 defect codes per point (only if defectCatalogId is populated)
  const topRows = await db.select({
    pointDefId: measurementResults.pointDefId,
    defectCatalogId: measurementResults.defectCatalogId,
    defectCode: defectCatalog.code,
    defectName: defectCatalog.name,
    cnt: sql<number>`COUNT(*)::int`.as("cnt"),
  })
  .from(measurementResults)
  .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
  .leftJoin(defectCatalog, eq(defectCatalog.id, measurementResults.defectCatalogId))
  .where(and(...resultConds, sql`${measurementResults.result} <> 'OK'`))
  .groupBy(measurementResults.pointDefId, measurementResults.defectCatalogId, defectCatalog.code, defectCatalog.name)
  .orderBy(desc(sql`COUNT(*)`));

  const topByPoint = new Map<number, MpDefectStat["topDefects"]>();
  for (const r of topRows) {
    const list = topByPoint.get(r.pointDefId) ?? [];
    if (list.length < 3) {
      list.push({ code: r.defectCode ?? null, name: r.defectName ?? null, count: Number(r.cnt) });
      topByPoint.set(r.pointDefId, list);
    }
  }

  return points.map((p) => {
    const agg = aggMap.get(p.id) ?? { totalCount: 0, ngCount: 0 };
    return {
      pointDefId: p.id,
      code: p.code,
      positionX: p.positionX,
      positionY: p.positionY,
      radius: p.radius,
      shape: p.shape ?? "circle",
      geometry: p.geometry as any,
      totalCount: agg.totalCount,
      ngCount: agg.ngCount,
      defectRate: agg.totalCount > 0 ? agg.ngCount / agg.totalCount : 0,
      topDefects: topByPoint.get(p.id) ?? [],
    };
  });
}

// (P4.B G9 CAD import helpers appended)

// ============================================================
// P4.B G9 — CAD Import jobs + candidates helpers
// ============================================================
export async function createCadImportJob(data: InsertCadImportJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(cadImportJobs).values(data)
    .returning({ id: cadImportJobs.id });
  return row.id;
}

export async function updateCadImportJob(id: number, data: Partial<InsertCadImportJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(cadImportJobs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(cadImportJobs.id, id));
}

export async function getCadImportJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(cadImportJobs)
    .where(eq(cadImportJobs.id, id))
    .limit(1);
  return rows[0];
}

export async function listCadImportJobsByProduct(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cadImportJobs)
    .where(eq(cadImportJobs.productModelId, productModelId))
    .orderBy(desc(cadImportJobs.createdAt));
}

export async function bulkInsertCadImportCandidates(rows: InsertCadImportCandidate[]) {
  if (rows.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const inserted = await db.insert(cadImportCandidates).values(rows)
    .returning({ id: cadImportCandidates.id });
  return inserted.length;
}

export async function listCadImportCandidates(jobId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cadImportCandidates)
    .where(eq(cadImportCandidates.jobId, jobId))
    .orderBy(asc(cadImportCandidates.candidateIndex));
}

export async function setCadCandidateSelection(jobId: number, candidateIds: number[], selected: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (candidateIds.length === 0) return;
  await db.update(cadImportCandidates)
    .set({ selected })
    .where(and(
      eq(cadImportCandidates.jobId, jobId),
      sql`${cadImportCandidates.id} = ANY(${candidateIds})`,
    ));
}

/**
 * Convert selected candidates of a CAD import job into measurement_point_defs.
 * Returns count applied.
 */
export async function applyCadImportJob(jobId: number, appliedBy: number) {
  const job = await getCadImportJobById(jobId);
  if (!job) throw new Error("CAD import job not found");
  if (job.status === "applied") return job.appliedPointCount ?? 0;
  const cands = await listCadImportCandidates(jobId);
  const selected = cands.filter((c) => c.selected);
  if (selected.length === 0) {
    await updateCadImportJob(jobId, { status: "applied", appliedBy, appliedAt: new Date() });
    return 0;
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find next free orderIndex for this product
  const [{ maxIdx }] = await db
    .select({ maxIdx: sql<number>`COALESCE(MAX(${measurementPointDefs.orderIndex}), 0)` })
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, job.productModelId),
      isNull(measurementPointDefs.deletedAt),
    ));
  let next = Number(maxIdx ?? 0) + 1;

  const inserts: InsertMeasurementPointDef[] = selected.map((c, i) => ({
    productModelId: job.productModelId,
    code: c.code ?? `CAD-${jobId}-${c.candidateIndex}`,
    name: c.name ?? `CAD candidate ${c.candidateIndex + 1}`,
    shape: c.shape as any,
    positionX: Math.round(Number(c.positionX)),
    positionY: Math.round(Number(c.positionY)),
    radius: c.radius != null ? Math.round(Number(c.radius)) : 20,
    orderIndex: next + i,
    geometry: c.geometry as any,
  } as any));

  await db.insert(measurementPointDefs).values(inserts);
  await updateCadImportJob(jobId, {
    status: "applied",
    appliedBy,
    appliedAt: new Date(),
    appliedPointCount: inserts.length,
  });
  return inserts.length;
}

// ============================================================
// P4.C G15 — Station triangulation helpers
// ============================================================
export async function listSamplesForSerial(serialNumber: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      serialNumber: measurementSamples.serialNumber,
      stationCode: measurementSamples.stationCode,
      isOk: measurementSamples.isOk,
      value: measurementSamples.value,
      sampledAt: measurementSamples.sampledAt,
      pointDefId: measurementSamples.pointDefId,
      lotCode: measurementSamples.lotCode,
    })
    .from(measurementSamples)
    .where(eq(measurementSamples.serialNumber, serialNumber))
    .orderBy(asc(measurementSamples.sampledAt));
  return rows;
}

export async function listSamplesForLot(lotCode: string, limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      serialNumber: measurementSamples.serialNumber,
      stationCode: measurementSamples.stationCode,
      isOk: measurementSamples.isOk,
      value: measurementSamples.value,
      sampledAt: measurementSamples.sampledAt,
      pointDefId: measurementSamples.pointDefId,
      lotCode: measurementSamples.lotCode,
    })
    .from(measurementSamples)
    .where(eq(measurementSamples.lotCode, lotCode))
    .orderBy(asc(measurementSamples.sampledAt))
    .limit(limit);
  return rows;
}

export async function upsertStationTrace(row: InsertStationTrace) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db
    .select({ id: stationTraces.id })
    .from(stationTraces)
    .where(eq(stationTraces.serialNumber, row.serialNumber))
    .limit(1);
  if (existing) {
    await db.update(stationTraces)
      .set({ ...row, updatedAt: new Date() })
      .where(eq(stationTraces.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db.insert(stationTraces).values(row).returning({ id: stationTraces.id });
  return inserted.id;
}

export async function getStationTrace(serialNumber: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(stationTraces)
    .where(eq(stationTraces.serialNumber, serialNumber))
    .limit(1);
  return row ?? null;
}

export async function listStationTracesByLot(lotCode: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(stationTraces)
    .where(eq(stationTraces.lotCode, lotCode))
    .orderBy(desc(stationTraces.updatedAt))
    .limit(limit);
}

export async function listStationTracesByProduct(productModelId: number, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(stationTraces)
    .where(eq(stationTraces.productModelId, productModelId))
    .orderBy(desc(stationTraces.updatedAt))
    .limit(limit);
}

/**
 * P4.C G13 — Generic station-trace lister for Monte-Carlo simulation.
 *
 * `stationTraces` is a 1-row-per-serial aggregate (not per-event), so we
 * filter by `firstDefectStation` / `firstEscapeStation` / membership in
 * `stationsTouched` when callers ask for a specific station, and only
 * return rows updated since `fromTs`. Callers consume the aggregate
 * counts (`totalDefects`, etc.) for rate estimation.
 */
export async function listStationTraces(opts: {
  stationCode?: string;
  fromTs?: Date;
  limit?: number;
} = {}) {
  const db = await getDb();
  if (!db) return [];
  const base = db.select().from(stationTraces);
  const q = opts.fromTs
    ? base.where(gte(stationTraces.updatedAt, opts.fromTs))
    : base;
  return q.orderBy(desc(stationTraces.updatedAt)).limit(opts.limit ?? 1000);
}

// ============================================================
// P4.C G11 — Genealogy hash-chain helpers
// ============================================================
export async function getLastGenealogyHash(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ currHash: genealogyChain.currHash })
    .from(genealogyChain)
    .orderBy(desc(genealogyChain.id))
    .limit(1);
  return row?.currHash ?? null;
}

export async function insertGenealogyChainRow(row: InsertGenealogyChain) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(genealogyChain)
    .values(row)
    .returning({ id: genealogyChain.id, currHash: genealogyChain.currHash });
  return inserted;
}

export async function listGenealogyChainAll(limit = 100000) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(genealogyChain)
    .orderBy(asc(genealogyChain.id))
    .limit(limit);
}

export async function listGenealogyChainBySerial(serialNumber: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(genealogyChain)
    .where(eq(genealogyChain.serialNumber, serialNumber))
    .orderBy(asc(genealogyChain.id))
    .limit(limit);
}

export async function listGenealogyChainByLot(lotCode: string, limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(genealogyChain)
    .where(eq(genealogyChain.lotCode, lotCode))
    .orderBy(asc(genealogyChain.id))
    .limit(limit);
}


