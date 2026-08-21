/**
 * Doc 31 Đợt C (PM3 / C.4) — Product package export / import (portable JSON).
 *
 * A versioned, self-contained JSON bundle of a product's CONFIGURATION for
 * backup and line-transfer:
 *
 *   { formatVersion, exportedAt, source, model, points[], fiducials[],
 *     panelDefs[]{ …def, boards[] }, samplingPlans[] }
 *
 * The image BLOB is never embedded — only its reference metadata (url/key/dims)
 * travels, so a bundle stays small and text-diffable. Round-trip is LOSSLESS for
 * the covered entities (counts + field values), with three deliberate ref
 * resets on import (a fresh product cannot dangle into the source's rows):
 *   • preferredSamplingPlanId → remapped to the freshly-created plan (by code)
 *   • productViewId           → nulled (views are not part of the bundle)
 *   • lifecycleStatus         → forced to "development" (a transferred product is
 *                               re-verified before going live — also sidesteps
 *                               the threshold gate so limits import directly)
 *
 * Per-DB clone (WC-2) copies within one DB; this is the FILE format for moving a
 * product between databases / sites. They are intentionally independent.
 */
import { z } from "zod";
import { DbUnavailableError } from "../_core/dbErrors";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  productModels,
  measurementPointDefs,
  fiducialMarks,
  samplingPlans,
  productPanelDefs,
  productPanelBoards,
} from "../../drizzle/schema";

export const PRODUCT_PACKAGE_FORMAT_VERSION = 1 as const;

// ── columns copied verbatim on import (everything else — id / timestamps /
//    soft-delete / owning FK — is regenerated) ────────────────────────────────
const MODEL_COPY_COLS = [
  "description", "category", "categoryId", "productLine", "variant",
  "targetYieldRate", "minYieldRate", "referenceImageUrl", "referenceImageKey",
  "imageWidth", "imageHeight", "imageDisplayMode", "coordinateMode", "imageHash",
] as const;

const POINT_COPY_COLS = [
  "code", "name", "description", "measurementType", "measurementTypeCode", "unit",
  "lowerLimit", "upperLimit", "nominalValue",
  "positionX", "positionY", "radius", "normalizedX", "normalizedY", "normalizedRadius",
  "referenceImageUrl", "referenceImageKey", "cropWidth", "cropHeight", "orderIndex",
  "machineId", "workstationId", "preferredInstrumentId", "imageHash",
  "shape", "geometry", "positionZ",
  "heightMin", "heightMax", "heightNominal", "heightUnit",
  "areaMin", "areaMax", "areaNominal", "areaUnit",
  "volumeMin", "volumeMax", "volumeNominal", "volumeUnit",
  "coplanarityMax", "warpageMax", "voidPctMax", "offsetXMax", "offsetYMax", "tiltMax",
  "thicknessMin", "thicknessMax", "depthMapUrl", "pointCloudUrl",
  "toleranceMode", "tolPlus", "tolMinus", "criteria", "extraFields",
  "datumRefs", "materialCondition", "fitClass",
  "componentCode", "refDesignator", "isActive",
] as const;

const FIDUCIAL_COPY_COLS = [
  "code", "name", "description", "type", "positionX", "positionY",
  "normalizedX", "normalizedY", "searchWindowW", "searchWindowH",
  "templateImageUrl", "templateImageKey", "orderIndex", "isActive",
] as const;

const SAMPLING_COPY_COLS = [
  "code", "name", "strategy", "lotSize", "aqlCritical", "aqlMajor", "aqlMinor",
  "sampleSize", "acceptanceQty", "rejectionQty", "rules", "version", "isActive",
] as const;

const PANEL_DEF_COPY_COLS = [
  "code", "name", "rows", "cols", "nUp", "panelWidthMm", "panelHeightMm",
  "boardWidthMm", "boardHeightMm", "originCorner", "serialScheme", "fiducials",
  "version", "isActive",
] as const;

const PANEL_BOARD_COPY_COLS = [
  "boardIndex", "offsetXMm", "offsetYMm", "rotationDeg", "mirrored", "skipped", "refDesPrefix",
] as const;

function pick<T extends Record<string, any>>(obj: T, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// ── the on-disk bundle shape (validated on import; permissive per-entity) ──────
const jsonRecord = z.record(z.string(), z.any());
export const productPackageSchema = z.object({
  formatVersion: z.number(),
  exportedAt: z.string().optional(),
  source: z.object({ id: z.number().optional(), code: z.string().optional() }).partial().optional(),
  model: jsonRecord,
  points: z.array(jsonRecord).default([]),
  fiducials: z.array(jsonRecord).default([]),
  // panelDefs carry a nested `boards` array (accessed as `def.boards` on import).
  panelDefs: z.array(jsonRecord).default([]),
  samplingPlans: z.array(jsonRecord).default([]),
});
export type ProductPackage = z.infer<typeof productPackageSchema>;

/**
 * Build the portable JSON bundle for a product model. Throws when the product
 * does not exist. Reads degrade to empty arrays when the DB is offline.
 */
export async function exportProductPackage(productModelId: number): Promise<ProductPackage> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const [model] = await db
    .select()
    .from(productModels)
    .where(and(eq(productModels.id, productModelId), isNull(productModels.deletedAt)))
    .limit(1);
  if (!model) throw new Error(`Product model ${productModelId} not found`);

  const points = await db
    .select()
    .from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.productModelId, productModelId), isNull(measurementPointDefs.deletedAt)))
    .orderBy(asc(measurementPointDefs.orderIndex), asc(measurementPointDefs.id));

  const fids = await db
    .select()
    .from(fiducialMarks)
    .where(and(eq(fiducialMarks.productModelId, productModelId), isNull(fiducialMarks.deletedAt)))
    .orderBy(asc(fiducialMarks.orderIndex), asc(fiducialMarks.id));

  const plans = await db
    .select()
    .from(samplingPlans)
    .where(and(eq(samplingPlans.productModelId, productModelId), isNull(samplingPlans.deletedAt)))
    .orderBy(asc(samplingPlans.id));

  const panelDefRows = await db
    .select()
    .from(productPanelDefs)
    .where(and(eq(productPanelDefs.productModelId, productModelId), isNull(productPanelDefs.deletedAt)))
    .orderBy(desc(productPanelDefs.version), asc(productPanelDefs.id));

  const panelDefs: Array<Record<string, any>> = [];
  for (const def of panelDefRows) {
    const boards = await db
      .select()
      .from(productPanelBoards)
      .where(eq(productPanelBoards.panelDefId, def.id))
      .orderBy(asc(productPanelBoards.boardIndex));
    panelDefs.push({
      ...pick(def, PANEL_DEF_COPY_COLS),
      boards: boards.map((b) => pick(b, PANEL_BOARD_COPY_COLS)),
    });
  }

  // Points carry the CODE of their preferred sampling plan so a remap survives
  // the id change on import.
  const planCodeById = new Map<number, string>();
  for (const p of plans) planCodeById.set(p.id, p.code);

  return {
    formatVersion: PRODUCT_PACKAGE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: { id: model.id, code: model.code },
    model: {
      code: model.code,
      name: model.name,
      lifecycleStatus: model.lifecycleStatus,
      ...pick(model, MODEL_COPY_COLS),
    },
    points: points.map((p) => ({
      ...pick(p, POINT_COPY_COLS),
      // portable reference to the plan (id is DB-local)
      preferredSamplingPlanCode:
        p.preferredSamplingPlanId != null ? planCodeById.get(p.preferredSamplingPlanId) ?? null : null,
    })),
    fiducials: fids.map((f) => pick(f, FIDUCIAL_COPY_COLS)),
    panelDefs,
    samplingPlans: plans.map((s) => pick(s, SAMPLING_COPY_COLS)),
  };
}

export interface ImportPackageResult {
  productModelId: number;
  code: string;
  counts: { points: number; fiducials: number; samplingPlans: number; panelDefs: number; panelBoards: number };
  warnings: string[];
}

/**
 * Recreate a product from a package as a NEW product model (all children copied
 * in a single transaction). `newCode` must be free; `newName` defaults to the
 * bundle's model name. Ref resets: see file header.
 */
export async function importProductPackage(
  raw: unknown,
  opts: { newCode: string; newName?: string; createdBy?: number },
): Promise<ImportPackageResult> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const pkg = productPackageSchema.parse(raw);
  const warnings: string[] = [];
  if (pkg.formatVersion !== PRODUCT_PACKAGE_FORMAT_VERSION) {
    warnings.push(
      `Package formatVersion ${pkg.formatVersion} differs from supported ${PRODUCT_PACKAGE_FORMAT_VERSION}; imported best-effort.`,
    );
  }

  const newCode = opts.newCode.trim();
  if (!newCode) throw new Error("newCode is required");

  // Uniqueness (mirror productModel.create) — the FILE could otherwise collide.
  const [existing] = await db
    .select({ id: productModels.id })
    .from(productModels)
    .where(and(eq(productModels.code, newCode), isNull(productModels.deletedAt)))
    .limit(1);
  if (existing) throw new Error(`Product code '${newCode}' already exists`);

  const counts = { points: 0, fiducials: 0, samplingPlans: 0, panelDefs: 0, panelBoards: 0 };

  const newProductId = await db.transaction(async (tx) => {
    // 1) product model — fresh code/name, forced to development, fresh config version.
    const modelInsert: Record<string, any> = {
      ...pick(pkg.model, MODEL_COPY_COLS),
      code: newCode,
      name: (opts.newName ?? (pkg.model.name as string) ?? newCode).toString(),
      lifecycleStatus: "development",
      isActive: true,
      pointsConfigVersion: 1,
    };
    const [created] = await tx.insert(productModels).values(modelInsert as any).returning({ id: productModels.id });
    const pid = created.id;

    // 2) sampling plans first — capture code → new id for the point remap.
    const planIdByCode = new Map<string, number>();
    for (const plan of pkg.samplingPlans) {
      const row = { ...pick(plan, SAMPLING_COPY_COLS), productModelId: pid };
      const [ins] = await tx.insert(samplingPlans).values(row as any).returning({ id: samplingPlans.id });
      if (typeof plan.code === "string") planIdByCode.set(plan.code, ins.id);
      counts.samplingPlans++;
    }

    // 3) measurement points — remap plan by code, null the un-exported view ref.
    for (const p of pkg.points) {
      const row: Record<string, any> = { ...pick(p, POINT_COPY_COLS), productModelId: pid };
      const planCode = (p as any).preferredSamplingPlanCode;
      if (typeof planCode === "string" && planIdByCode.has(planCode)) {
        row.preferredSamplingPlanId = planIdByCode.get(planCode);
      }
      // productViewId deliberately omitted (views not in the bundle).
      await tx.insert(measurementPointDefs).values(row as any);
      counts.points++;
    }

    // 4) fiducials.
    for (const f of pkg.fiducials) {
      await tx.insert(fiducialMarks).values({ ...pick(f, FIDUCIAL_COPY_COLS), productModelId: pid } as any);
      counts.fiducials++;
    }

    // 5) panel defs + their boards.
    for (const def of pkg.panelDefs) {
      const defRow = { ...pick(def, PANEL_DEF_COPY_COLS), productModelId: pid };
      const [insDef] = await tx.insert(productPanelDefs).values(defRow as any).returning({ id: productPanelDefs.id });
      counts.panelDefs++;
      const boards = Array.isArray((def as any).boards) ? (def as any).boards : [];
      for (const b of boards) {
        await tx.insert(productPanelBoards).values({ ...pick(b, PANEL_BOARD_COPY_COLS), panelDefId: insDef.id } as any);
        counts.panelBoards++;
      }
    }

    return pid;
  });

  return { productModelId: newProductId, code: newCode, counts, warnings };
}
