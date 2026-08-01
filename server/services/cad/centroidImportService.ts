/**
 * Doc 31 — Đợt C (C.1 · MP5 / PM4 · decision #5)
 * ============================================================================
 * Centroid / pick-place IMPORT service — wires the generic parser
 * (centroidParser.ts) to the EXISTING cad_import_jobs / cad_import_candidates
 * ledger (schema already sufficient — no migration 0196 needed) and generates
 * measurement_point_defs.
 *
 * Flow (three router endpoints call these):
 *   preview  — parse+transform, NO persistence (live re-parse as the user edits
 *              the column map / flip / unit in the wizard).
 *   commit   — parse+transform and PERSIST a cad_import_job (format='centroid')
 *              + one cad_import_candidate per component.
 *   apply    — turn SELECTED candidates into measurement_point_defs, in ONE
 *              transaction, IDEMPOTENT (skips refDesignators that already exist),
 *              audited, and bumps pointsConfigVersion so machines re-fetch.
 *
 * Coordinate handling: the transform (mm↔pixel, Y-flip, origin, fit-to-image)
 * lives in the parser and respects the product's coordinateMode + image dims.
 * componentCode / refDesignator are populated from the file (lights up the
 * Đợt-8 Pareto-by-package chain — WB-1).
 * ============================================================================
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { createAuditLog, getProductModelById, bumpPointsConfigVersion } from "../../db";
import {
  cadImportJobs,
  cadImportCandidates,
  measurementPointDefs,
  productModels,
  type CadImportCandidate,
  type InsertMeasurementPointDef,
} from "../../../drizzle/schema";
import {
  buildCentroidCandidates,
  inspectCentroidHeaders,
  type CentroidColumnMap,
  type CentroidParseOptions,
  type CentroidTransformOptions,
  type CentroidCandidate,
  type TransformProductInfo,
} from "./centroidParser";

export const CENTROID_PARSER_VERSION = "centroid-1.0";

const LEGACY_MEASUREMENT_TYPES = [
  "DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER",
] as const;
export type LegacyMeasurementType = (typeof LEGACY_MEASUREMENT_TYPES)[number];

export interface CentroidApplyDefaults {
  /** measurementType for every generated point. Default VISUAL. */
  measurementType?: LegacyMeasurementType;
  radius?: number;
  cropWidth?: number;
  cropHeight?: number;
}

// ── Pure point-def builder (unit-tested; no DB) ─────────────────────────────

/** Normalized shape the builder consumes (from a fresh transform OR a DB row). */
export interface CentroidPointSource {
  code: string;
  name: string;
  positionX: number;
  positionY: number;
  refDesignator: string;
  componentCode?: string;
  rotation?: number;
  side?: string;
  package?: string;
  placedStatus?: string;
}

export interface BuildPointDefsResult {
  rows: InsertMeasurementPointDef[];
  appliedCodes: string[];
  skippedCodes: string[];
}

/**
 * Build measurement_point_defs inserts from centroid sources. IDEMPOTENT:
 * any source whose code OR refDesignator already exists (case-insensitive,
 * in `existingKeys`) is skipped, as is any intra-batch duplicate.
 */
export function buildCentroidPointDefRows(
  sources: CentroidPointSource[],
  existingKeys: Set<string>,
  product: TransformProductInfo,
  defaults: CentroidApplyDefaults,
  startOrderIndex: number,
): BuildPointDefsResult {
  const measurementType: LegacyMeasurementType =
    defaults.measurementType && LEGACY_MEASUREMENT_TYPES.includes(defaults.measurementType)
      ? defaults.measurementType
      : "VISUAL";
  const radius = defaults.radius != null && defaults.radius >= 0 ? Math.round(defaults.radius) : 20;
  const cropWidth = defaults.cropWidth ?? 100;
  const cropHeight = defaults.cropHeight ?? 100;
  const hasDims = !!(product.imageWidth && product.imageHeight);

  const rows: InsertMeasurementPointDef[] = [];
  const appliedCodes: string[] = [];
  const skippedCodes: string[] = [];
  const localSeen = new Set<string>();
  let order = startOrderIndex;

  for (const s of sources) {
    const codeKey = s.code.toLowerCase();
    const refKey = (s.refDesignator || "").toLowerCase();
    if (
      existingKeys.has(codeKey) ||
      (refKey && existingKeys.has(refKey)) ||
      localSeen.has(codeKey)
    ) {
      skippedCodes.push(s.code);
      continue;
    }
    localSeen.add(codeKey);

    const posX = Math.max(0, Math.round(s.positionX));
    const posY = Math.max(0, Math.round(s.positionY));
    let normalizedX: string | undefined;
    let normalizedY: string | undefined;
    let normalizedRadius: string | undefined;
    if (hasDims) {
      normalizedX = (posX / product.imageWidth!).toFixed(8);
      normalizedY = (posY / product.imageHeight!).toFixed(8);
      normalizedRadius = (radius / product.imageWidth!).toFixed(8);
    }

    rows.push({
      productModelId: 0, // set by caller (kept 0 here so the fn stays product-agnostic)
      code: s.code.slice(0, 50),
      name: (s.name || s.code).slice(0, 255),
      measurementType,
      positionX: posX,
      positionY: posY,
      radius,
      cropWidth,
      cropHeight,
      orderIndex: order++,
      shape: "circle",
      normalizedX,
      normalizedY,
      normalizedRadius,
      componentCode: s.componentCode ? s.componentCode.slice(0, 100) : undefined,
      refDesignator: s.refDesignator ? s.refDesignator.slice(0, 64) : undefined,
      geometry: {
        shape: "circle",
        x: posX,
        y: posY,
        radius,
        centroid: {
          refDesignator: s.refDesignator,
          rotation: s.rotation,
          side: s.side,
          package: s.package,
          placedStatus: s.placedStatus,
        },
      },
    } as InsertMeasurementPointDef);
    appliedCodes.push(s.code);
  }

  return { rows, appliedCodes, skippedCodes };
}

/** Map a persisted cad_import_candidate (centroid geometry payload) to a source. */
export function candidateToSource(c: CadImportCandidate): CentroidPointSource {
  const g = (c.geometry ?? {}) as any;
  const meta = (g.centroid ?? g) as any;
  return {
    code: c.code ?? String(meta.refDesignator ?? `C-${c.candidateIndex}`),
    name: c.name ?? c.code ?? `Component ${c.candidateIndex + 1}`,
    positionX: Number(c.positionX),
    positionY: Number(c.positionY),
    refDesignator: String(meta.refDesignator ?? c.code ?? ""),
    componentCode: meta.componentCode ?? undefined,
    rotation: meta.rotation ?? undefined,
    side: meta.side ?? undefined,
    package: meta.package ?? undefined,
    placedStatus: meta.placedStatus ?? undefined,
  };
}

/** Map a fresh transform candidate to the persisted-candidate insert shape. */
export function centroidCandidateToInsertRow(jobId: number, c: CentroidCandidate) {
  return {
    jobId,
    candidateIndex: c.candidateIndex,
    code: c.code.slice(0, 100),
    name: c.name.slice(0, 255),
    shape: "circle",
    positionX: String(c.positionX) as any,
    positionY: String(c.positionY) as any,
    radius: undefined,
    geometry: {
      shape: "circle",
      centroid: {
        refDesignator: c.refDesignator,
        rotation: c.rotation,
        side: c.side,
        package: c.package,
        componentCode: c.componentCode,
        placedStatus: c.placedStatus,
      },
      rawX: c.rawX,
      rawY: c.rawY,
      mmX: c.mmX,
      mmY: c.mmY,
      unit: c.unit,
      normalizedX: c.normalizedX,
      normalizedY: c.normalizedY,
    } as any,
    sourceEntityType: "centroid",
    sourceEntityId: c.refDesignator.slice(0, 120),
    selected: true,
  };
}

// ── DB orchestration ────────────────────────────────────────────────────────

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/**
 * Assemble product-aware build options from the raw wizard pieces:
 *  - guesses the column map from headers when the caller hasn't mapped yet;
 *  - defaults the coordinate target mode to the product's coordinateMode.
 */
function assembleBuildOptions(
  text: string,
  productInfo: TransformProductInfo,
  columnMap: Partial<CentroidColumnMap> | undefined,
  parseOptions: Partial<CentroidParseOptions> | undefined,
  transformOptions: Partial<CentroidTransformOptions> | undefined,
): { parse: CentroidParseOptions; transform: CentroidTransformOptions } {
  let map = columnMap;
  if (!map || map.refDesignator == null || map.x == null || map.y == null) {
    const inspected = inspectCentroidHeaders(text, {
      delimiter: parseOptions?.delimiter,
      hasHeader: parseOptions?.hasHeader,
      commentPrefixes: parseOptions?.commentPrefixes,
    });
    map = { ...inspected.guessedMap, ...(map ?? {}) };
  }
  const fullMap: CentroidColumnMap = {
    refDesignator: map.refDesignator ?? "",
    x: map.x ?? "",
    y: map.y ?? "",
    rotation: map.rotation,
    side: map.side,
    package: map.package,
    componentCode: map.componentCode,
    placedStatus: map.placedStatus,
    name: map.name,
  };
  const targetMode: "mm" | "pixel" =
    transformOptions?.targetMode ??
    (productInfo.coordinateMode === "mm" ? "mm" : "pixel");
  return {
    parse: {
      columnMap: fullMap,
      delimiter: parseOptions?.delimiter,
      decimal: parseOptions?.decimal,
      hasHeader: parseOptions?.hasHeader,
      commentPrefixes: parseOptions?.commentPrefixes,
    },
    transform: {
      unit: transformOptions?.unit ?? "mm",
      flipX: transformOptions?.flipX ?? false,
      flipY: transformOptions?.flipY ?? false,
      targetMode,
      fitToImage: transformOptions?.fitToImage,
      marginPct: transformOptions?.marginPct,
      scale: transformOptions?.scale,
      offsetX: transformOptions?.offsetX,
      offsetY: transformOptions?.offsetY,
    },
  };
}

export interface CentroidPreviewInput {
  productModelId: number;
  text: string;
  columnMap?: Partial<CentroidColumnMap>;
  parseOptions?: Partial<CentroidParseOptions>;
  transformOptions?: Partial<CentroidTransformOptions>;
}

function productInfoFrom(product: Awaited<ReturnType<typeof getProductModelById>>): TransformProductInfo {
  return {
    imageWidth: product?.imageWidth ?? null,
    imageHeight: product?.imageHeight ?? null,
    coordinateMode: product?.coordinateMode ?? "pixel",
  };
}

/** Parse + transform WITHOUT persisting — for the live wizard preview. */
export async function previewCentroidImport(input: CentroidPreviewInput) {
  const product = await getProductModelById(input.productModelId);
  const productInfo = productInfoFrom(product);
  const buildOptions = assembleBuildOptions(
    input.text, productInfo, input.columnMap, input.parseOptions, input.transformOptions,
  );
  const built = buildCentroidCandidates(input.text, buildOptions, productInfo);
  return {
    headers: built.parse.headers,
    detectedDelimiter: built.parse.detectedDelimiter,
    stats: built.parse.stats,
    warnings: built.warnings,
    effectiveScale: built.effectiveScale,
    bbox: built.bbox,
    coordinateMode: productInfo.coordinateMode,
    hasImageDimensions: !!(productInfo.imageWidth && productInfo.imageHeight),
    // The map/transform that were actually applied (guessed values surfaced to UI).
    appliedColumnMap: buildOptions.parse.columnMap,
    appliedTransform: buildOptions.transform,
    // Cap the preview payload; the full set is re-parsed at commit.
    candidates: built.candidates.slice(0, 1000),
    candidateCount: built.candidates.length,
  };
}

export interface CentroidCommitInput extends CentroidPreviewInput {
  fileName: string;
  fileSha256?: string;
  fileSizeBytes?: number;
  uploadedBy?: number;
}

/** Persist a cad_import_job (format='centroid') + candidates. Returns job id. */
export async function commitCentroidImport(input: CentroidCommitInput) {
  const db = await requireDb();
  const product = await getProductModelById(input.productModelId);
  const productInfo = productInfoFrom(product);
  const buildOptions = assembleBuildOptions(
    input.text, productInfo, input.columnMap, input.parseOptions, input.transformOptions,
  );
  const built = buildCentroidCandidates(input.text, buildOptions, productInfo);

  const entityCounts: Record<string, number> = {
    parsed: built.parse.stats.parsed,
    skipped: built.parse.stats.skipped,
    duplicates: built.parse.stats.duplicates,
    dataLines: built.parse.stats.dataLines,
  };

  const [jobRow] = await db.insert(cadImportJobs).values({
    productModelId: input.productModelId,
    format: "centroid",
    fileName: input.fileName.slice(0, 255),
    fileSizeBytes: input.fileSizeBytes,
    fileSha256: input.fileSha256,
    status: "parsed",
    parserVersion: CENTROID_PARSER_VERSION,
    entityCounts,
    candidatePointCount: built.candidates.length,
    uploadedBy: input.uploadedBy,
  }).returning({ id: cadImportJobs.id });
  const jobId = jobRow.id;

  if (built.candidates.length > 0) {
    await db.insert(cadImportCandidates).values(
      built.candidates.map((c) => centroidCandidateToInsertRow(jobId, c)) as any,
    );
  }

  await createAuditLog({
    userId: input.uploadedBy ?? 0,
    action: "centroidImport.commit",
    entityType: "product",
    entityId: input.productModelId,
    entityName: input.fileName,
    details: {
      jobId,
      candidates: built.candidates.length,
      columnMap: buildOptions.parse.columnMap,
      transform: buildOptions.transform,
      warnings: built.warnings.slice(0, 20),
    },
    status: "success",
  }).catch(() => undefined);

  return {
    jobId,
    candidates: built.candidates.length,
    warnings: built.warnings,
    stats: built.parse.stats,
  };
}

export interface CentroidApplyInput {
  jobId: number;
  appliedBy: number;
  appliedByName?: string;
  defaults?: CentroidApplyDefaults;
}

export interface CentroidApplyResult {
  applied: number;
  skipped: number;
  skippedCodes: string[];
  warnings: string[];
}

/**
 * Convert a centroid job's SELECTED candidates into measurement_point_defs.
 * IDEMPOTENT + transactional + audited. Re-applying (or applying a file that
 * overlaps existing refDesignators) skips the duplicates instead of erroring.
 */
export async function applyCentroidImport(input: CentroidApplyInput): Promise<CentroidApplyResult> {
  const db = await requireDb();
  const warnings: string[] = [];

  const [job] = await db.select().from(cadImportJobs)
    .where(eq(cadImportJobs.id, input.jobId)).limit(1);
  if (!job) throw new Error("Centroid import job not found");
  if (job.format !== "centroid") {
    throw new Error(`Job #${input.jobId} is not a centroid import (format=${job.format})`);
  }
  if (job.status === "applied") {
    return { applied: 0, skipped: 0, skippedCodes: [], warnings: ["Job already applied."] };
  }

  const product = await getProductModelById(job.productModelId);
  const productInfo: TransformProductInfo = {
    imageWidth: product?.imageWidth ?? null,
    imageHeight: product?.imageHeight ?? null,
    coordinateMode: product?.coordinateMode ?? "pixel",
  };
  if (!productInfo.imageWidth || !productInfo.imageHeight) {
    warnings.push("Product has no image dimensions — points inserted without normalized coordinates (PM8).");
  }

  const result = await db.transaction(async (tx: any) => {
    // Selected candidates.
    const cands: CadImportCandidate[] = await tx.select().from(cadImportCandidates)
      .where(and(eq(cadImportCandidates.jobId, input.jobId), eq(cadImportCandidates.selected, true)))
      .orderBy(cadImportCandidates.candidateIndex);

    // Existing live keys (code + refDesignator) for idempotency.
    const existing = await tx.select({
      code: measurementPointDefs.code,
      refDesignator: measurementPointDefs.refDesignator,
    }).from(measurementPointDefs)
      .where(and(
        eq(measurementPointDefs.productModelId, job.productModelId),
        isNull(measurementPointDefs.deletedAt),
      ));
    const existingKeys = new Set<string>();
    for (const e of existing) {
      if (e.code) existingKeys.add(String(e.code).toLowerCase());
      if (e.refDesignator) existingKeys.add(String(e.refDesignator).toLowerCase());
    }

    // Next order index.
    const [{ maxIdx }] = await tx.select({
      maxIdx: sql<number>`COALESCE(MAX(${measurementPointDefs.orderIndex}), 0)`,
    }).from(measurementPointDefs)
      .where(and(
        eq(measurementPointDefs.productModelId, job.productModelId),
        isNull(measurementPointDefs.deletedAt),
      ));
    const startOrder = Number(maxIdx ?? 0) + 1;

    const sources = cands.map(candidateToSource);
    const built = buildCentroidPointDefRows(
      sources, existingKeys, productInfo, input.defaults ?? {}, startOrder,
    );

    if (built.rows.length > 0) {
      const withProduct = built.rows.map((r) => ({ ...r, productModelId: job.productModelId }));
      await tx.insert(measurementPointDefs).values(withProduct as any);
      // Bump pointsConfigVersion so machines re-fetch (deltaSync).
      const nextVer = (product?.pointsConfigVersion ?? 1) + 1;
      await tx.update(productModels)
        .set({ pointsConfigVersion: nextVer, updatedAt: new Date() } as any)
        .where(eq(productModels.id, job.productModelId));
    }

    await tx.update(cadImportJobs).set({
      status: "applied",
      appliedBy: input.appliedBy,
      appliedAt: new Date(),
      appliedPointCount: built.appliedCodes.length,
      updatedAt: new Date(),
    }).where(eq(cadImportJobs.id, input.jobId));

    return built;
  });

  await createAuditLog({
    userId: input.appliedBy,
    userName: input.appliedByName,
    action: "centroidImport.apply",
    entityType: "product",
    entityId: job.productModelId,
    entityName: job.fileName,
    details: {
      jobId: input.jobId,
      applied: result.appliedCodes.length,
      skipped: result.skippedCodes.length,
      skippedCodes: result.skippedCodes.slice(0, 50),
    },
    status: "success",
  }).catch(() => undefined);

  return {
    applied: result.appliedCodes.length,
    skipped: result.skippedCodes.length,
    skippedCodes: result.skippedCodes,
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 54 §11 P0.1 — APPLY COORDINATES ONTO EXISTING measurement points.
// ────────────────────────────────────────────────────────────────────────────
// The commit/apply flow above CREATES new points and SKIPS refdes that already
// exist. But the failure doc 54 P0.1 targets is the OPPOSITE: points were bulk-
// created earlier (dataRouters.importMeasurementPoints) with NO coordinate source
// and landed at (0,0). This flow takes the SAME centroid / pick-place file,
// MATCHES each parsed component to an EXISTING point by refDesignator/code (with
// a unique-only componentCode fallback), then WRITES the real positionX/positionY
// (+ normalized + rotation) onto the matched points — in ONE transaction, bumping
// pointsConfigVersion so machines re-fetch. Unmatched rows are reported, never
// invented; matched points are consumed at most once so coords never double-write.
// ════════════════════════════════════════════════════════════════════════════

export const CENTROID_COORDS_VERSION = "centroid-coords-1.0";

/** Minimal projection of an existing point used by the matcher (pure, no DB). */
export interface ExistingPointLite {
  id: number;
  code: string;
  refDesignator: string | null;
  componentCode: string | null;
  positionX: number;
  positionY: number;
  geometry: Record<string, any> | null;
}

export interface CoordinateMatchRow {
  candidateIndex: number;
  refDesignator: string;
  code: string;
  componentCode?: string;
  pointId: number;
  pointCode: string;
  matchedBy: "refDesignator" | "code" | "componentCode";
  oldX: number;
  oldY: number;
  newX: number;
  newY: number;
  rotation?: number;
  normalizedX?: number;
  normalizedY?: number;
}

export interface CoordinateUnmatchedRow {
  candidateIndex: number;
  refDesignator: string;
  code: string;
  componentCode?: string;
  newX: number;
  newY: number;
  reason: string;
}

export interface CoordinateMatchResult {
  matched: CoordinateMatchRow[];
  unmatched: CoordinateUnmatchedRow[];
}

/**
 * PURE matcher (unit-tested; no DB). Maps centroid candidates onto existing
 * points. Priority per candidate:
 *   1. refDesignator (candidate.refDesignator || candidate.code) → point.refDesignator
 *   2. same key → point.code
 *   3. UNIQUE componentCode (a value shared by many refdes is skipped as ambiguous)
 * All matches are case-insensitive. A point is consumed by at most one candidate
 * (first-match wins). Everything unmatched is reported with a reason.
 */
export function matchCandidatesToPoints(
  candidates: CentroidCandidate[],
  points: ExistingPointLite[],
): CoordinateMatchResult {
  const byRef = new Map<string, ExistingPointLite>();
  const byCode = new Map<string, ExistingPointLite>();
  const byComponent = new Map<string, ExistingPointLite | null>(); // null = ambiguous (>1)
  for (const p of points) {
    const code = (p.code || "").toLowerCase();
    if (code && !byCode.has(code)) byCode.set(code, p);
    const ref = (p.refDesignator || "").toLowerCase();
    if (ref && !byRef.has(ref)) byRef.set(ref, p);
    const cc = (p.componentCode || "").toLowerCase();
    if (cc) byComponent.set(cc, byComponent.has(cc) ? null : p);
  }

  const consumed = new Set<number>();
  const matched: CoordinateMatchRow[] = [];
  const unmatched: CoordinateUnmatchedRow[] = [];

  const free = (m: Map<string, ExistingPointLite>, key: string): ExistingPointLite | undefined => {
    const hit = m.get(key);
    return hit && !consumed.has(hit.id) ? hit : undefined;
  };

  for (const c of candidates) {
    const refKey = (c.refDesignator || c.code || "").toLowerCase();
    const codeKey = (c.code || "").toLowerCase();

    let hit: ExistingPointLite | undefined;
    let matchedBy: CoordinateMatchRow["matchedBy"] = "refDesignator";
    if (refKey && (hit = free(byRef, refKey))) {
      matchedBy = "refDesignator";
    } else if (codeKey && (hit = free(byCode, codeKey))) {
      matchedBy = "code";
    } else if (refKey && (hit = free(byCode, refKey))) {
      matchedBy = "code";
    } else if (c.componentCode) {
      const uniq = byComponent.get(c.componentCode.toLowerCase());
      if (uniq && !consumed.has(uniq.id)) { hit = uniq; matchedBy = "componentCode"; }
    }

    const newX = Math.max(0, Math.round(c.positionX));
    const newY = Math.max(0, Math.round(c.positionY));

    if (hit) {
      consumed.add(hit.id);
      matched.push({
        candidateIndex: c.candidateIndex,
        refDesignator: c.refDesignator,
        code: c.code,
        componentCode: c.componentCode,
        pointId: hit.id,
        pointCode: hit.code,
        matchedBy,
        oldX: Number(hit.positionX) || 0,
        oldY: Number(hit.positionY) || 0,
        newX,
        newY,
        rotation: c.rotation,
        normalizedX: c.normalizedX,
        normalizedY: c.normalizedY,
      });
    } else {
      unmatched.push({
        candidateIndex: c.candidateIndex,
        refDesignator: c.refDesignator,
        code: c.code,
        componentCode: c.componentCode,
        newX,
        newY,
        reason: "no existing measurement point with this RefDes / code",
      });
    }
  }

  return { matched, unmatched };
}

function toExistingPointLite(r: any): ExistingPointLite {
  return {
    id: r.id,
    code: r.code,
    refDesignator: r.refDesignator ?? null,
    componentCode: r.componentCode ?? null,
    positionX: Number(r.positionX) || 0,
    positionY: Number(r.positionY) || 0,
    geometry: (r.geometry ?? null) as Record<string, any> | null,
  };
}

const EXISTING_POINT_COLUMNS = {
  id: measurementPointDefs.id,
  code: measurementPointDefs.code,
  refDesignator: measurementPointDefs.refDesignator,
  componentCode: measurementPointDefs.componentCode,
  positionX: measurementPointDefs.positionX,
  positionY: measurementPointDefs.positionY,
  geometry: measurementPointDefs.geometry,
};

/** Parse + transform + match — NO persistence (live wizard preview). */
export async function previewCoordinateApply(input: CentroidPreviewInput) {
  const db = await requireDb();
  const product = await getProductModelById(input.productModelId);
  const productInfo = productInfoFrom(product);
  const buildOptions = assembleBuildOptions(
    input.text, productInfo, input.columnMap, input.parseOptions, input.transformOptions,
  );
  const built = buildCentroidCandidates(input.text, buildOptions, productInfo);

  const rows = await db.select(EXISTING_POINT_COLUMNS).from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, input.productModelId),
      isNull(measurementPointDefs.deletedAt),
    ));
  const points = rows.map(toExistingPointLite);
  const match = matchCandidatesToPoints(built.candidates, points);

  return {
    headers: built.parse.headers,
    detectedDelimiter: built.parse.detectedDelimiter,
    stats: built.parse.stats,
    warnings: built.warnings,
    coordinateMode: productInfo.coordinateMode,
    hasImageDimensions: !!(productInfo.imageWidth && productInfo.imageHeight),
    appliedColumnMap: buildOptions.parse.columnMap,
    appliedTransform: buildOptions.transform,
    existingPointCount: points.length,
    parsedCount: built.candidates.length,
    matchedCount: match.matched.length,
    unmatchedCount: match.unmatched.length,
    // Cap the payloads; the full set is re-matched at apply.
    matched: match.matched.slice(0, 1000),
    unmatched: match.unmatched.slice(0, 1000),
  };
}

export type CoordinateApplyInput = CentroidCommitInput;

export interface CoordinateApplyResult {
  matched: number;
  applied: number;
  unmatched: number;
  errors: string[];
  jobId: number | null;
  warnings: string[];
  /** Non-null when the config version was bumped — router publishes the MQTT nudge. */
  bumped: { code: string; version: number } | null;
}

/**
 * Match the file to existing points and WRITE coordinates onto the matches, in
 * ONE transaction: bumps pointsConfigVersion (atomic col+1) and records a
 * cad_import_job (format 'centroid' — the only value 0196's CHECK allows besides
 * step/dxf/gerber) for traceability. Idempotent: re-running rewrites the same
 * coords (a no-op) and never duplicates points. Returns {matched, applied,
 * unmatched, errors}.
 */
export async function applyCoordinatesToPoints(input: CoordinateApplyInput): Promise<CoordinateApplyResult> {
  const db = await requireDb();
  const errors: string[] = [];
  const product = await getProductModelById(input.productModelId);
  const productInfo = productInfoFrom(product);
  const buildOptions = assembleBuildOptions(
    input.text, productInfo, input.columnMap, input.parseOptions, input.transformOptions,
  );
  const built = buildCentroidCandidates(input.text, buildOptions, productInfo);

  const result = await db.transaction(async (tx: any) => {
    // Snapshot existing points inside the txn for a consistent match.
    const rows = await tx.select(EXISTING_POINT_COLUMNS).from(measurementPointDefs)
      .where(and(
        eq(measurementPointDefs.productModelId, input.productModelId),
        isNull(measurementPointDefs.deletedAt),
      ));
    const points = rows.map(toExistingPointLite);
    const byId = new Map<number, ExistingPointLite>(points.map((p: ExistingPointLite) => [p.id, p]));
    const match = matchCandidatesToPoints(built.candidates, points);

    let applied = 0;
    for (const m of match.matched) {
      try {
        const set: Record<string, any> = {
          positionX: m.newX,
          positionY: m.newY,
          lastModifiedAt: new Date(),
          updatedAt: new Date(),
        };
        if (m.normalizedX != null) set.normalizedX = m.normalizedX.toFixed(8);
        if (m.normalizedY != null) set.normalizedY = m.normalizedY.toFixed(8);
        // Merge into any existing geometry so non-circle shapes / other keys survive.
        const prev = byId.get(m.pointId);
        const geom: Record<string, any> = { ...(prev?.geometry ?? {}) };
        geom.shape = geom.shape ?? "circle";
        geom.x = m.newX;
        geom.y = m.newY;
        if (m.rotation != null) {
          geom.centroid = { ...(geom.centroid ?? {}), rotation: m.rotation };
        }
        set.geometry = geom;
        await tx.update(measurementPointDefs).set(set).where(eq(measurementPointDefs.id, m.pointId));
        applied++;
      } catch (e: any) {
        errors.push(`${m.pointCode}: ${e?.message ?? "update failed"}`);
      }
    }

    let bumped: { code: string; version: number } | null = null;
    if (applied > 0) {
      const b = await bumpPointsConfigVersion(input.productModelId, tx);
      bumped = b ? { code: b.code, version: b.version } : null;
    }

    const [jobRow] = await tx.insert(cadImportJobs).values({
      productModelId: input.productModelId,
      format: "centroid",
      fileName: input.fileName.slice(0, 255),
      fileSizeBytes: input.fileSizeBytes,
      fileSha256: input.fileSha256,
      status: applied > 0 ? "applied" : "parsed",
      parserVersion: CENTROID_COORDS_VERSION,
      entityCounts: {
        parsed: built.parse.stats.parsed,
        matched: match.matched.length,
        applied,
        unmatched: match.unmatched.length,
      },
      candidatePointCount: built.candidates.length,
      appliedPointCount: applied,
      appliedBy: applied > 0 ? (input.uploadedBy ?? undefined) : undefined,
      appliedAt: applied > 0 ? new Date() : undefined,
      uploadedBy: input.uploadedBy,
    }).returning({ id: cadImportJobs.id });

    return { match, applied, bumped, jobId: (jobRow?.id ?? null) as number | null };
  });

  await createAuditLog({
    userId: input.uploadedBy ?? 0,
    action: "centroidImport.applyCoordinates",
    entityType: "product",
    entityId: input.productModelId,
    entityName: input.fileName,
    details: {
      jobId: result.jobId,
      matched: result.match.matched.length,
      applied: result.applied,
      unmatched: result.match.unmatched.length,
      unmatchedRefDes: result.match.unmatched.slice(0, 50).map((u) => u.refDesignator),
      columnMap: buildOptions.parse.columnMap,
      transform: buildOptions.transform,
    },
    status: "success",
  }).catch(() => undefined);

  return {
    matched: result.match.matched.length,
    applied: result.applied,
    unmatched: result.match.unmatched.length,
    errors,
    jobId: result.jobId,
    warnings: built.warnings,
    bumped: result.bumped,
  };
}
