import { getDb } from "./connection";
import { rethrowDbError } from "../_core/dbErrors";
import { eq, and, desc, asc, like, or, sql, isNull, isNotNull, gte, inArray, SQL } from "drizzle-orm";
import {
  productModels, InsertProductModel,
  measurementPointDefs, InsertMeasurementPointDef, MeasurementPointDef,
  measurementPointVersions,
  measurementTypeCatalog, InsertMeasurementTypeCatalog,
  defectCatalog, InsertDefectCatalog,
  unmatchedDefectCodes,
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
  mpLightingProfiles, InsertMpLightingProfile, MpLightingProfile,
  measurementSamples, InsertMeasurementSample,
  mpSpcAlerts, InsertMpSpcAlert,
  mpSpcRolling, InsertMpSpcRolling,
  cadImportJobs, InsertCadImportJob,
  cadImportCandidates, InsertCadImportCandidate,
  stationTraces, InsertStationTrace,
  genealogyChain, InsertGenealogyChain,
  // Doc 31 PM1 (WC-2) — deep-clone copies panel defs + their board placements.
  productPanelDefs,
  productPanelBoards,
} from "../../drizzle/schema";
import { measurementResults, productInspections } from "../../drizzle/schema/inspection";
import { GENESIS_HASH } from "../utils/genealogyChain";

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

// ============ Doc 31 PM1 (WC-2) — deep clone a product model ============

/** Shallow copy of a DB row minus the given column names (audit/identity cols). */
function omitCols<T extends Record<string, any>>(row: T, keys: string[]): Record<string, any> {
  const drop = new Set(keys);
  const out: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    if (!drop.has(k)) out[k] = row[k];
  }
  return out;
}

export interface CloneProductModelSummary {
  newCode: string;
  revision: string | null;
  clonedFromId: number;
  measurementPoints: number;
  fiducialMarks: number;
  panelDefs: number;
  panelBoards: number;
  samplingPlans: number;
  machineMappings: number;
}

/**
 * Deep-clone a product model into a NEW code in ONE transaction.
 *
 * COPIED (deep): measurement_point_defs (EVERY column — componentCode/refDesignator/
 * limits/tolerance/geometry/3D/criteria/extraFields/GD&T...), fiducial_marks,
 * product_panel_defs + product_panel_boards, sampling_plans, and OPTIONALLY
 * product_machine_mappings (copyMappings — default FALSE, because a freshly-cloned
 * board is not on the same machines yet).
 *
 * NOT copied (fresh start): inspection results, golden samples (per-image, product-
 * specific), program releases, measurement_point_versions history.
 *
 * The clone is reset to lifecycleStatus='development', pointsConfigVersion=1, and
 * carries clonedFromId=sourceId (soft provenance). The reference image url/key/dims/
 * hash ARE copied so the clone is immediately usable — both products then reference
 * the same stored blob (deleting one never deletes the shared image).
 *
 * preferredSamplingPlanId on cloned points is REMAPPED to the freshly-cloned plan
 * (product-scoped); productViewId is CLEARED (product_views are out of clone scope,
 * so a dangling cross-product view ref would be worse than the "all views" default).
 *
 * Code collision relies on the router's pre-check; the product_models.code UNIQUE
 * index is the backstop (a 23505 propagates so the router maps it to CONFLICT).
 */
export async function cloneProductModel(opts: {
  sourceId: number;
  newCode: string;
  newName?: string;
  newRevision?: string | null;
  copyMappings?: boolean;
}): Promise<{ newProductId: number; summary: CloneProductModelSummary }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    // 1) Source product (live only).
    const [source] = await tx.select().from(productModels)
      .where(and(eq(productModels.id, opts.sourceId), isNull(productModels.deletedAt)))
      .limit(1);
    if (!source) throw new Error(`Source product ${opts.sourceId} not found`);

    // 2) New product row — copy every column, override identity + lifecycle + provenance.
    const productRest = omitCols(source, ["id", "createdAt", "updatedAt", "deletedAt"]);
    const revision = opts.newRevision !== undefined ? opts.newRevision : (source.revision ?? null);
    const [insertedProduct] = await tx.insert(productModels).values({
      ...(productRest as InsertProductModel),
      code: opts.newCode,
      name: opts.newName ?? source.name,
      revision,
      lifecycleStatus: "development",
      pointsConfigVersion: 1,
      clonedFromId: opts.sourceId,
      isActive: true,
    }).returning({ id: productModels.id });
    const newProductId = insertedProduct.id;

    // 3) Sampling plans first — so point.preferredSamplingPlanId can be remapped.
    const srcPlans = await tx.select().from(samplingPlans)
      .where(and(eq(samplingPlans.productModelId, opts.sourceId), isNull(samplingPlans.deletedAt)));
    const planIdMap = new Map<number, number>();
    for (const plan of srcPlans) {
      const planRest = omitCols(plan, ["id", "createdAt", "updatedAt", "deletedAt"]);
      const [newPlan] = await tx.insert(samplingPlans).values({
        ...(planRest as InsertSamplingPlan),
        productModelId: newProductId,
      }).returning({ id: samplingPlans.id });
      planIdMap.set(plan.id, newPlan.id);
    }

    // 4) Measurement point defs — deep copy every field, remap plan, clear view.
    const srcPoints = await tx.select().from(measurementPointDefs)
      .where(and(eq(measurementPointDefs.productModelId, opts.sourceId), isNull(measurementPointDefs.deletedAt)));
    for (const p of srcPoints) {
      const pointRest = omitCols(p, ["id", "createdAt", "updatedAt", "deletedAt", "lastModifiedAt"]);
      await tx.insert(measurementPointDefs).values({
        ...(pointRest as InsertMeasurementPointDef),
        productModelId: newProductId,
        preferredSamplingPlanId: p.preferredSamplingPlanId != null
          ? (planIdMap.get(p.preferredSamplingPlanId) ?? null)
          : null,
        productViewId: null,
      });
    }

    // 5) Fiducial marks — deep copy.
    const srcFids = await tx.select().from(fiducialMarks)
      .where(and(eq(fiducialMarks.productModelId, opts.sourceId), isNull(fiducialMarks.deletedAt)));
    for (const fid of srcFids) {
      const fidRest = omitCols(fid, ["id", "createdAt", "updatedAt", "deletedAt"]);
      await tx.insert(fiducialMarks).values({
        ...(fidRest as InsertFiducialMark),
        productModelId: newProductId,
      });
    }

    // 6) Panel defs + their board placements.
    const srcPanels = await tx.select().from(productPanelDefs)
      .where(and(eq(productPanelDefs.productModelId, opts.sourceId), isNull(productPanelDefs.deletedAt)));
    let panelBoardCount = 0;
    for (const panel of srcPanels) {
      const panelRest = omitCols(panel, ["id", "createdAt", "updatedAt", "deletedAt"]);
      const [newPanel] = await tx.insert(productPanelDefs).values({
        ...(panelRest as typeof productPanelDefs.$inferInsert),
        productModelId: newProductId,
      }).returning({ id: productPanelDefs.id });
      const srcBoards = await tx.select().from(productPanelBoards)
        .where(eq(productPanelBoards.panelDefId, panel.id));
      for (const board of srcBoards) {
        const boardRest = omitCols(board, ["id"]);
        await tx.insert(productPanelBoards).values({
          ...(boardRest as typeof productPanelBoards.$inferInsert),
          panelDefId: newPanel.id,
        });
        panelBoardCount++;
      }
    }

    // 7) Machine mappings — OPT-IN only (a fresh board isn't on the same machines yet).
    let machineMappingCount = 0;
    if (opts.copyMappings) {
      const srcMaps = await tx.select().from(productMachineMappings)
        .where(eq(productMachineMappings.productModelId, opts.sourceId));
      for (const map of srcMaps) {
        const mapRest = omitCols(map, ["id", "createdAt", "updatedAt"]);
        await tx.insert(productMachineMappings).values({
          ...(mapRest as InsertProductMachineMapping),
          productModelId: newProductId,
        });
        machineMappingCount++;
      }
    }

    return {
      newProductId,
      summary: {
        newCode: opts.newCode,
        revision,
        clonedFromId: opts.sourceId,
        measurementPoints: srcPoints.length,
        fiducialMarks: srcFids.length,
        panelDefs: srcPanels.length,
        panelBoards: panelBoardCount,
        samplingPlans: srcPlans.length,
        machineMappings: machineMappingCount,
      },
    };
  });
}

/**
 * Doc 31 PM8 — recompute normalized (0..1) coordinates for EVERY live point (and
 * fiducial) of a product once its image dimensions become known. Coordinates are
 * otherwise raw pixels and not portable across machines of differing resolution.
 * Returns how many rows were touched. No-op guard when dims are invalid.
 */
export async function backfillNormalizedCoordsForProduct(
  productModelId: number,
  imageWidth: number,
  imageHeight: number,
): Promise<{ points: number; fiducials: number }> {
  const db = await getDb();
  if (!db) return { points: 0, fiducials: 0 };
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return { points: 0, fiducials: 0 };
  }

  const points = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      isNull(measurementPointDefs.deletedAt),
    ));
  let pCount = 0;
  for (const p of points) {
    await db.update(measurementPointDefs).set({
      normalizedX: (p.positionX / imageWidth).toFixed(8),
      normalizedY: (p.positionY / imageHeight).toFixed(8),
      normalizedRadius: ((p.radius ?? 0) / imageWidth).toFixed(8),
    }).where(eq(measurementPointDefs.id, p.id));
    pCount++;
  }

  const fids = await db.select().from(fiducialMarks)
    .where(and(
      eq(fiducialMarks.productModelId, productModelId),
      isNull(fiducialMarks.deletedAt),
    ));
  let fCount = 0;
  for (const f of fids) {
    await db.update(fiducialMarks).set({
      normalizedX: (f.positionX / imageWidth).toFixed(8),
      normalizedY: (f.positionY / imageHeight).toFixed(8),
    }).where(eq(fiducialMarks.id, f.id));
    fCount++;
  }

  return { points: pCount, fiducials: fCount };
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
  if (rows[0]) return rows[0];
  // Doc 31 Đợt E (WE-3, migration 0201) — taxonomy consolidation forward-alias.
  // A retired duplicate code (isActive=false, aliasOfCode set by 0201) is resolved
  // to its surviving canonical row, so incoming duplicate codes never go unmatched.
  const aliasRows = await db.select({ aliasOfCode: defectCatalog.aliasOfCode })
    .from(defectCatalog)
    .where(and(
      eq(defectCatalog.code, code),
      isNull(defectCatalog.deletedAt),
      isNotNull(defectCatalog.aliasOfCode),
    ))
    .limit(1);
  const survivorCode = aliasRows[0]?.aliasOfCode;
  if (!survivorCode) return undefined;
  const survivorRows = await db.select().from(defectCatalog)
    .where(and(
      eq(defectCatalog.code, survivorCode),
      isNull(defectCatalog.deletedAt),
      eq(defectCatalog.isActive, true),
    ))
    .limit(1);
  return survivorRows[0];
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

// ============ Doc 31 Đợt B (OP3) — Unmatched defect-code telemetry ============

/**
 * Record a batch of defect codes that did NOT resolve to a defect_catalog row.
 * Aggregates by code (one row each) — increments seenCount and refreshes the
 * last-seen context. Best-effort: callers must NOT let a failure here block
 * inspection ingest (wrap in try/catch at the call site).
 *
 * `codes` may contain duplicates (one per measurement) — they are folded into a
 * per-code count before upserting so the hot path issues at most one statement
 * per DISTINCT unmatched code.
 */
export async function recordUnmatchedDefectCodes(
  codes: string[],
  ctx: { machineId?: number | null; productModelId?: number | null },
): Promise<void> {
  if (!codes.length) return;
  const db = await getDb();
  if (!db) return;
  // Fold duplicates → { code: count }.
  const counts = new Map<string, number>();
  for (const raw of codes) {
    const code = (raw ?? "").trim().slice(0, 50);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const now = new Date();
  for (const [code, n] of counts) {
    await db
      .insert(unmatchedDefectCodes)
      .values({
        code,
        seenCount: n,
        machineId: ctx.machineId ?? null,
        productModelId: ctx.productModelId ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: unmatchedDefectCodes.code,
        set: {
          seenCount: sql`${unmatchedDefectCodes.seenCount} + ${n}`,
          machineId: ctx.machineId ?? null,
          productModelId: ctx.productModelId ?? null,
          lastSeenAt: now,
          updatedAt: now,
        },
      });
  }
}

/**
 * List unmatched defect codes (rollup) for the curation panel. `onlyUnresolved`
 * hides codes already curated into the catalog (resolvedCatalogId set).
 */
export async function listUnmatchedDefectCodes(filters?: {
  onlyUnresolved?: boolean;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [];
  if (filters?.onlyUnresolved) {
    conds.push(isNull(unmatchedDefectCodes.resolvedCatalogId));
  }
  const q = db
    .select()
    .from(unmatchedDefectCodes)
    .where(conds.length ? and(...conds) : undefined as unknown as SQL)
    .orderBy(desc(unmatchedDefectCodes.seenCount))
    .limit(Math.min(filters?.limit ?? 200, 1000));
  return q;
}

/**
 * Mark an unmatched code as resolved (curated into the catalog). Idempotent —
 * safe to call when the code row does not exist.
 */
export async function markUnmatchedDefectCodeResolved(code: string, catalogId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(unmatchedDefectCodes)
    .set({ resolvedCatalogId: catalogId, updatedAt: new Date() })
    .where(eq(unmatchedDefectCodes.code, code.trim()));
}

/**
 * Per-component (package) defect tendency: which defect classes trend for which
 * component. Joins CLASSIFIED NG results (defectCatalogId not null) → point def
 * componentCode. Tolerates empty componentCode (WB-1 fills it) — such rows are
 * grouped under a NULL component and can be filtered out client-side.
 */
export async function getDefectTendencyByComponent(opts?: {
  productModelId?: number;
  fromTs?: Date;
  toTs?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [sql`${measurementResults.defectCatalogId} IS NOT NULL`];
  if (opts?.productModelId) {
    conds.push(eq(measurementPointDefs.productModelId, opts.productModelId));
  }
  if (opts?.fromTs) conds.push(sql`${productInspections.inspectionTime} >= ${opts.fromTs}`);
  if (opts?.toTs) conds.push(sql`${productInspections.inspectionTime} <= ${opts.toTs}`);
  return db
    .select({
      componentCode: measurementPointDefs.componentCode,
      defectCatalogId: measurementResults.defectCatalogId,
      defectCode: defectCatalog.code,
      defectName: defectCatalog.name,
      severity: defectCatalog.severity,
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
    .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, measurementResults.pointDefId))
    .leftJoin(defectCatalog, eq(defectCatalog.id, measurementResults.defectCatalogId))
    .where(and(...conds))
    .groupBy(
      measurementPointDefs.componentCode,
      measurementResults.defectCatalogId,
      defectCatalog.code,
      defectCatalog.name,
      defectCatalog.severity,
    )
    .orderBy(desc(sql`COUNT(*)`))
    .limit(Math.min(opts?.limit ?? 100, 500));
}

// ============ Doc 31 Đợt B (MP3) — __UNMAPPED__ point visibility + remap ============

/**
 * Unmatched-rate metric: fraction of measurement_results whose point definition
 * lives under the synthetic __UNMAPPED__ product model (auto-provisioned because
 * the machine-reported point code did not match a real def). Returns an overall
 * rate plus an optional per-machine breakdown.
 *
 * `unmappedModelId` is passed in (from the resolver) to keep this module free of
 * a resolver import cycle. When it is undefined (no __UNMAPPED__ model exists
 * yet) the rate is 0 by definition.
 */
export async function computeUnmappedPointRate(opts: {
  unmappedModelId?: number;
  machineId?: number;
  productModelId?: number;
  fromTs?: Date;
  toTs?: Date;
}): Promise<{
  total: number;
  unmatched: number;
  rate: number;
  byMachine: Array<{ machineId: number; total: number; unmatched: number; rate: number }>;
}> {
  const db = await getDb();
  if (!db || !opts.unmappedModelId) {
    return { total: 0, unmatched: 0, rate: 0, byMachine: [] };
  }
  const conds: SQL[] = [];
  if (opts.machineId) conds.push(eq(productInspections.machineId, opts.machineId));
  if (opts.fromTs) conds.push(sql`${productInspections.inspectionTime} >= ${opts.fromTs}`);
  if (opts.toTs) conds.push(sql`${productInspections.inspectionTime} <= ${opts.toTs}`);
  // productModelId filter applies to the INSPECTION's product model (what the
  // machine claimed), not the point def — so we can see "this product's feed is
  // 68% unmapped".
  if (opts.productModelId) conds.push(eq(productInspections.productModelId, opts.productModelId));

  const unmatchedExpr = sql<number>`SUM(CASE WHEN ${measurementPointDefs.productModelId} = ${opts.unmappedModelId} THEN 1 ELSE 0 END)::int`;

  const [overall] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      unmatched: unmatchedExpr,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, measurementResults.pointDefId))
    .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
    .where(conds.length ? and(...conds) : undefined as unknown as SQL);

  const total = Number(overall?.total ?? 0);
  const unmatched = Number(overall?.unmatched ?? 0);

  const byMachineRows = await db
    .select({
      machineId: productInspections.machineId,
      total: sql<number>`COUNT(*)::int`,
      unmatched: unmatchedExpr,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, measurementResults.pointDefId))
    .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
    .where(conds.length ? and(...conds) : undefined as unknown as SQL)
    .groupBy(productInspections.machineId)
    .orderBy(desc(unmatchedExpr))
    .limit(50);

  return {
    total,
    unmatched,
    rate: total > 0 ? unmatched / total : 0,
    byMachine: byMachineRows.map((r) => {
      const t = Number(r.total);
      const u = Number(r.unmatched);
      return { machineId: r.machineId, total: t, unmatched: u, rate: t > 0 ? u / t : 0 };
    }),
  };
}

/**
 * List __UNMAPPED__ point defs with their measurement-result counts and a
 * best-effort remap suggestion (a real product model that has an active point
 * def with the SAME code). Ordered by result volume (most-impactful first).
 */
export async function listUnmappedPointDefsWithStats(unmappedModelId: number) {
  const db = await getDb();
  if (!db) return [];
  const defs = await db
    .select({
      id: measurementPointDefs.id,
      code: measurementPointDefs.code,
      name: measurementPointDefs.name,
      machineId: measurementPointDefs.machineId,
      createdAt: measurementPointDefs.createdAt,
    })
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, unmappedModelId),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(asc(measurementPointDefs.code));
  if (defs.length === 0) return [];

  const ids = defs.map((d) => d.id);
  const countRows = await db
    .select({
      pointDefId: measurementResults.pointDefId,
      resultCount: sql<number>`COUNT(*)::int`.as("resultCount"),
    })
    .from(measurementResults)
    .where(sql`${measurementResults.pointDefId} = ANY(${ids})`)
    .groupBy(measurementResults.pointDefId);
  const countMap = new Map<number, number>();
  for (const r of countRows) countMap.set(r.pointDefId, Number(r.resultCount));

  // Suggestion: a real (non-unmapped, active) def sharing the same code.
  const codes = Array.from(new Set(defs.map((d) => d.code)));
  const suggestionRows = codes.length
    ? await db
        .select({
          code: measurementPointDefs.code,
          productModelId: measurementPointDefs.productModelId,
          productModelCode: productModels.code,
          productModelName: productModels.name,
        })
        .from(measurementPointDefs)
        .innerJoin(productModels, eq(productModels.id, measurementPointDefs.productModelId))
        .where(and(
          sql`${measurementPointDefs.code} = ANY(${codes})`,
          sql`${measurementPointDefs.productModelId} <> ${unmappedModelId}`,
          isNull(measurementPointDefs.deletedAt),
          eq(measurementPointDefs.isActive, true),
        ))
    : [];
  const suggestByCode = new Map<string, { productModelId: number; productModelCode: string; productModelName: string }>();
  for (const s of suggestionRows) {
    if (!suggestByCode.has(s.code)) {
      suggestByCode.set(s.code, {
        productModelId: s.productModelId,
        productModelCode: s.productModelCode,
        productModelName: s.productModelName,
      });
    }
  }

  return defs.map((d) => ({
    ...d,
    resultCount: countMap.get(d.id) ?? 0,
    suggestion: suggestByCode.get(d.code) ?? null,
  }));
}

/**
 * Bulk-remap __UNMAPPED__ point defs to a real product model.
 *
 * For each selected def:
 *   - If the target model already has an ACTIVE def with the same code, MERGE:
 *     re-point that def's measurement_results to the target def, then soft-delete
 *     the (now empty) unmapped def.
 *   - Otherwise MOVE: reassign the def's productModelId to the target (its
 *     results follow automatically since they reference pointDefId).
 *
 * Runs in one transaction. Returns a summary. `targetMachineId` (optional) is
 * written onto MOVED defs so they can also bind to a machine.
 */
export async function remapMeasurementPoints(opts: {
  pointDefIds: number[];
  targetProductModelId: number;
  unmappedModelId: number;
  targetMachineId?: number | null;
}): Promise<{ moved: number; merged: number; resultsReassigned: number; skipped: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { pointDefIds, targetProductModelId, unmappedModelId } = opts;
  if (!pointDefIds.length) return { moved: 0, merged: 0, resultsReassigned: 0, skipped: 0 };

  return db.transaction(async (tx) => {
    let moved = 0;
    let merged = 0;
    let resultsReassigned = 0;
    let skipped = 0;

    for (const id of pointDefIds) {
      // Only remap defs that are genuinely under the __UNMAPPED__ model.
      const [def] = await tx
        .select()
        .from(measurementPointDefs)
        .where(and(
          eq(measurementPointDefs.id, id),
          eq(measurementPointDefs.productModelId, unmappedModelId),
          isNull(measurementPointDefs.deletedAt),
        ))
        .limit(1);
      if (!def) { skipped++; continue; }

      // Is there an existing active target def with the same code?
      const [target] = await tx
        .select()
        .from(measurementPointDefs)
        .where(and(
          eq(measurementPointDefs.productModelId, targetProductModelId),
          eq(measurementPointDefs.code, def.code),
          isNull(measurementPointDefs.deletedAt),
          eq(measurementPointDefs.isActive, true),
        ))
        .limit(1);

      if (target && target.id !== id) {
        // MERGE — re-point results, then retire the unmapped def.
        const reassigned = await tx
          .update(measurementResults)
          .set({ pointDefId: target.id })
          .where(eq(measurementResults.pointDefId, id))
          .returning({ rid: measurementResults.id });
        resultsReassigned += reassigned.length;
        await tx
          .update(measurementPointDefs)
          .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
          .where(eq(measurementPointDefs.id, id));
        merged++;
      } else {
        // MOVE — reassign the def to the target product model.
        await tx
          .update(measurementPointDefs)
          .set({
            productModelId: targetProductModelId,
            machineId: opts.targetMachineId ?? def.machineId,
            updatedAt: new Date(),
          })
          .where(eq(measurementPointDefs.id, id));
        moved++;
      }
    }
    return { moved, merged, resultsReassigned, skipped };
  });
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

// ============ Doc 31 UX3 (WD-2) — optimistic lock on measurement-point edits ============

/**
 * Raised by updateMeasurementPointDef when a compare-and-set finds the row was
 * modified since the editor loaded it (stale `expectedUpdatedAt`). The router
 * maps this to a tRPC CONFLICT and forwards `current` so the client can offer
 * "reload / overwrite anyway". Duck-typed via `.code` (routers must NOT `instanceof`
 * it — the db module is frequently mocked in tests).
 */
export class MeasurementPointConflictError extends Error {
  readonly code = "MP_STALE_WRITE" as const;
  readonly current: MeasurementPointDef;
  readonly expectedUpdatedAt: string | null;
  readonly actualUpdatedAt: string | null;
  constructor(current: MeasurementPointDef, expectedUpdatedAt: Date | string | null | undefined) {
    super("Measurement point was modified by someone else since it was loaded.");
    this.name = "MeasurementPointConflictError";
    this.current = current;
    this.expectedUpdatedAt = toIsoOrNull(expectedUpdatedAt);
    this.actualUpdatedAt = toIsoOrNull(current.updatedAt ?? null);
  }
}

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * PURE compare — is the caller's `expected` timestamp stale vs the row's `current`?
 * Compared at millisecond granularity (node-postgres already truncates the stored
 * microseconds to ms on read, so both sides are consistent). `expected == null`
 * means "no optimistic-lock requested" → never stale (backward compatible).
 */
export function isStaleUpdate(
  current: Date | string | null | undefined,
  expected: Date | string | null | undefined,
): boolean {
  if (expected == null) return false; // opt-in — absent = skip the check
  const cur = current instanceof Date ? current : current != null ? new Date(current) : null;
  const exp = expected instanceof Date ? expected : new Date(expected);
  if (!cur || Number.isNaN(cur.getTime()) || Number.isNaN(exp.getTime())) return false;
  return cur.getTime() !== exp.getTime();
}

export async function updateMeasurementPointDef(
  id: number,
  data: Partial<InsertMeasurementPointDef>,
  options?: {
    changedBy?: number | null;
    changeReason?: string | null;
    // UX3: when supplied, the update is a compare-and-set against the row's
    // updatedAt — a mismatch throws MeasurementPointConflictError. Absent =
    // legacy blind update (skip the check).
    expectedUpdatedAt?: Date | string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Do the snapshot + compare-and-set + write in ONE transaction. The previous
  // row is locked FOR UPDATE so two concurrent editors serialize (mirrors the
  // program-release / golden FOR-UPDATE pattern) instead of last-write-wins.
  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(measurementPointDefs)
      .where(eq(measurementPointDefs.id, id))
      .for("update")
      .limit(1);

    // UX3 optimistic lock — throw BEFORE mutating anything so no version row is
    // created for a rejected write.
    if (previous && isStaleUpdate(previous.updatedAt, options?.expectedUpdatedAt)) {
      throw new MeasurementPointConflictError(previous as MeasurementPointDef, options?.expectedUpdatedAt);
    }

    // P0 versioning: snapshot the *previous* state before applying the update.
    if (previous) {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number>`COALESCE(MAX(${measurementPointVersions.version}), 0)` })
        .from(measurementPointVersions)
        .where(eq(measurementPointVersions.pointDefId, id));

      const nextVersion = Number(maxVersion ?? 0) + 1;

      await tx.insert(measurementPointVersions).values({
        pointDefId: id,
        version: nextVersion,
        snapshotJson: previous as unknown as Record<string, any>,
        changedBy: options?.changedBy ?? null,
        changeReason: options?.changeReason ?? null,
      });
    }

    // Bump updatedAt so the NEXT editor's compare-and-set detects this change
    // (drizzle does not auto-touch updatedAt on update). A caller-supplied
    // updatedAt in `data` would be overridden here intentionally.
    await tx.update(measurementPointDefs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(measurementPointDefs.id, id));
  });
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
  
  // QA4F-1 (high): .where() gọi nhiều lần GHI ĐÈ nhau (không AND) → khi cả machineId
  // lẫn productModelId đều set thì filter machineId bị mất → trả mapping của sản phẩm
  // trên MỌI máy (wizard đổi-sản-phẩm báo "sẵn sàng" sai). Gom điều kiện + and().
  const conds = [];
  if (machineId) conds.push(eq(productMachineMappings.machineId, machineId));
  if (productModelId) conds.push(eq(productMachineMappings.productModelId, productModelId));

  const query = conds.length
    ? db.select().from(productMachineMappings).where(and(...conds))
    : db.select().from(productMachineMappings);

  return query.orderBy(desc(productMachineMappings.priority));
}

export async function createProductMachineMapping(data: InsertProductMachineMapping) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const [result] = await db.insert(productMachineMappings).values(data).returning({ id: productMachineMappings.id });
    return { id: result.id };
  } catch (err: any) {
    // W3-A (doc 27 M6, 0180): uq_pm_mappings_pair — a (product, machine) pair
    // exists at most once. Doc 42 #10: drizzle bọc lỗi pg trong DrizzleQueryError
    // (23505 nằm ở err.cause) → dò bằng rethrowDbError thay vì err.code trực tiếp.
    rethrowDbError(err, {
      conflictMessage: "Mapping đã tồn tại cho cặp sản phẩm/máy này — hãy sửa (kích hoạt lại / đổi priority) bản ghi hiện có thay vì tạo mới.",
    });
  }
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

/**
 * Doc 42 Đợt 1 (#11/#40) — dọn mapping mồ côi: bản ghi trỏ tới sản phẩm đã xoá
 * (hard-delete hoặc soft-delete `deletedAt`) hoặc máy không còn tồn tại → hiện
 * "N/A" trên UI và khiến máy vẫn "được gán" sản phẩm không tồn tại. Trả về số
 * bản ghi đã xoá. Tính trong JS (bảng mapping nhỏ) để tránh ngữ nghĩa NOT IN với
 * subquery rỗng.
 */
export async function deleteOrphanProductMachineMappings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [allMaps, validProducts, validMachines] = await Promise.all([
    db.select({
      id: productMachineMappings.id,
      productModelId: productMachineMappings.productModelId,
      machineId: productMachineMappings.machineId,
    }).from(productMachineMappings),
    db.select({ id: productModels.id }).from(productModels).where(isNull(productModels.deletedAt)),
    db.select({ id: machines.id }).from(machines),
  ]);
  const validProductIds = new Set(validProducts.map((p) => p.id));
  const validMachineIds = new Set(validMachines.map((m) => m.id));
  const orphanIds = allMaps
    .filter((m) => !validProductIds.has(m.productModelId) || !validMachineIds.has(m.machineId))
    .map((m) => m.id);
  if (orphanIds.length === 0) return 0;
  await db.delete(productMachineMappings).where(inArray(productMachineMappings.id, orphanIds));
  return orphanIds.length;
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

/**
 * Doc 31 MP6 — batch-load active lighting profiles for many points at once
 * (avoids an N+1 in deltaSyncPoints). Returns a Map keyed by pointDefId.
 */
export async function listMpLightingProfilesByPointDefIds(
  pointDefIds: number[],
): Promise<Map<number, MpLightingProfile[]>> {
  const out = new Map<number, MpLightingProfile[]>();
  const db = await getDb();
  if (!db || pointDefIds.length === 0) return out;
  const rows = await db.select().from(mpLightingProfiles)
    .where(and(
      inArray(mpLightingProfiles.pointDefId, pointDefIds),
      eq(mpLightingProfiles.isActive, true),
      isNull(mpLightingProfiles.deletedAt),
    ))
    .orderBy(asc(mpLightingProfiles.shotIndex));
  for (const row of rows) {
    const list = out.get(row.pointDefId) ?? [];
    list.push(row);
    out.set(row.pointDefId, list);
  }
  return out;
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

// Distinct from AUDIT_CHAIN_LOCK (918_273_645) / RUN_EVENT_LOCK_NS (771_004_221).
const GENEALOGY_CHAIN_LOCK = 615_243_870;

/**
 * ATOMIC append to the genealogy hash-chain (doc 48 R4 fork-fix).
 *
 * The chain is tamper-evident: each row links to the previous via
 * prevHash = tail.currHash. Doing "read tail" and "insert new row" as TWO
 * separate statements (getLastGenealogyHash + insertGenealogyChainRow) lets two
 * concurrent appends both read the SAME tail and both link to it → the chain
 * FORKS (two rows sharing one prevHash), silently breaking verification.
 *
 * This mirrors the control-audit hash-chain (controlAuditService): a single
 * transaction takes a transaction-scoped advisory lock (auto-released on
 * commit/rollback) so read-tail → compute → insert is atomic and appends
 * serialise. `build(prevHash)` receives the resolved tail hash (or GENESIS on an
 * empty chain) and returns the full row to insert, so the caller can compute
 * currHash = hashEntry(prevHash, ...) inside the critical section.
 *
 * Note: genealogy appends serialise globally (one chain, one tail). That is
 * inherent to a single linear tamper-evident chain and acceptable — correctness
 * over throughput; genealogy events are per-unit-station, not a firehose.
 */
export async function appendGenealogyChainRow(
  build: (prevHash: string) => InsertGenealogyChain,
): Promise<{ id: number; prevHash: string; currHash: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GENEALOGY_CHAIN_LOCK})`);
    const [tail] = await tx
      .select({ currHash: genealogyChain.currHash })
      .from(genealogyChain)
      .orderBy(desc(genealogyChain.id))
      .limit(1);
    const prevHash = tail?.currHash ?? GENESIS_HASH;
    const row = build(prevHash);
    const [inserted] = await tx
      .insert(genealogyChain)
      .values(row)
      .returning({ id: genealogyChain.id, currHash: genealogyChain.currHash });
    return { id: inserted.id, prevHash, currHash: inserted.currHash };
  });
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


