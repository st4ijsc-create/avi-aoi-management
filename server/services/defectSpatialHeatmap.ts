/**
 * Defect spatial heatmap service — REAL bbox-based aggregation.
 * Doc 27 §6 gap A5 (P1), Đợt 5 item 5.1 (W5-A).
 *
 * Replaces the fabricated `gridX = pointDefId % gridWidth` pseudo-heatmap with
 * real spatial bucketing of `measurement_results.defectBboxX/Y/W/H` (bbox
 * CENTER) into a configurable grid.
 *
 * ── Coordinate space (be honest — doc 27 W5-A mandate) ─────────────────────
 * The bbox columns are REAL pixel coordinates. Per the schema comment
 * (drizzle/schema/inspection.ts, "Defect location on board image") they are
 * relative to the top-left corner of the FULL board/panel image submitted
 * with the result. Neither `product_inspections` nor `measurement_results`
 * stores that image's pixel dimensions, so the board extent is resolved as:
 *
 *   1. "product_image"   — productModels.imageWidth/imageHeight (native
 *      dimensions of the product reference image) when the query is filtered
 *      to a single product, the dims exist, AND every observed bbox fits
 *      inside them. The machine's board image is assumed to share the
 *      reference-image pixel space (true when points were programmed on it).
 *   2. "observed_extent" — max(bboxX + bboxW), max(bboxY + bboxH) over the
 *      queried rows otherwise. Honest fallback: the grid is normalized to the
 *      data itself; absolute pixel positions across differently-sized vendor
 *      images are only comparable within one product/machine scope.
 *
 * Rows whose bbox is NULL (legacy data written before the bbox columns, or
 * vendors that do not export locations) are EXCLUDED from the grid and
 * reported in `excludedNoBbox` — never silently dropped.
 *
 * A separate `pointDef` fallback mode keeps the legacy pointDefId-derived
 * layout for datasets with no bbox at all, explicitly labeled
 * `coordinateSpace: "logical_point_index"` / `realCoordinates: false` —
 * these are LOGICAL positions, not spatial ones.
 */
import { sql, eq, and, gte, lte, isNotNull, or, isNull, type SQL } from "drizzle-orm";
import {
  measurementResults,
  productInspections,
  productModels,
  defectCatalog,
} from "../../drizzle/schema";
import type { getDb } from "../db/connection";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─── Types ──────────────────────────────────────────────────────────────────

export type HeatmapCoordinateSpace =
  | "product_image"
  | "observed_extent"
  | "logical_point_index"
  // W8-B (doc 29 §2.2): panel-aware mode — defects folded to SINGLE-BOARD mm space.
  | "board_local_mm";

export interface SpatialDefectRow {
  bboxX: number;
  bboxY: number;
  /** NULL/absent width/height are treated as 0 (point defect). */
  bboxW: number | null;
  bboxH: number | null;
  defectClassCode: string | null;
  defectClassName: string | null;
  severity: string | null;
}

export interface HeatmapHotspot {
  x: number; // grid cell X
  y: number; // grid cell Y
  defectCount: number;
  /** Defect classes in this cell (top 3 by count). `type` = catalog code or "UNCLASSIFIED". */
  defectTypes: Array<{ type: string; count: number }>;
  percentage: number;
  /** Board-pixel center of the cell (only meaningful for spatial modes). */
  realX: number;
  realY: number;
  topDefectClass: string | null;
}

export interface SpatialHeatmapResult {
  grid: number[][];
  gridWidth: number;
  gridHeight: number;
  totalDefects: number;
  maxDefectsInCell: number;
  hotspots: HeatmapHotspot[];
  /** True for the spatial modes — cells map to physical board positions. */
  realCoordinates: boolean;
  mode: "bbox" | "pointDef" | "panelBoard";
  coordinateSpace: HeatmapCoordinateSpace;
  boardWidth: number;
  boardHeight: number;
  /** NG rows in scope whose bbox is NULL — excluded from the grid (bbox mode). */
  excludedNoBbox: number;
  /** Convenience: excluded / (included + excluded) in %, for honest UI badges. */
  excludedNoBboxPct: number;
  // ── W8-B (doc 29 §2.2) — panel-aware mode extras (present only for mode
  // "panelBoard"; `panelAware:false` = an honest fallback ran instead). ──
  /** True when a panel def existed and the panel fold was actually applied. */
  panelAware?: boolean;
  /** The product_panel_defs.id used, or null when absent (honest label). */
  panelDefId?: number | null;
  /** Why the panel fold could not run (mode "panelBoard" fallback only). */
  panelFallbackReason?: "no_product_filter" | "no_panel_def" | "no_panel_dims" | "no_board_dims";
  /** Per-board-position Pareto (geometric assignment; X-out boards flagged). */
  perBoard?: Array<{ boardIndex: number; defectCount: number; skipped: boolean }>;
  /** Defects whose panel position fell on NO board (rails/tooling) — never guessed. */
  unassigned?: number;
}

/** Severity weights used when `weightBySeverity` is on (IPC-ish ordering). */
export const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  cosmetic: 1,
};

export function severityWeight(severity: string | null | undefined): number {
  if (!severity) return 1;
  return SEVERITY_WEIGHTS[severity.toLowerCase()] ?? 1;
}

// ─── Pure math (unit-tested without a DB) ───────────────────────────────────

/**
 * Resolve the board extent / coordinate space. See module docblock for the
 * honesty rules. `product` dims are used only when every bbox fits in them.
 */
export function resolveBoardExtent(
  rows: Array<Pick<SpatialDefectRow, "bboxX" | "bboxY" | "bboxW" | "bboxH">>,
  product?: { imageWidth: number | null; imageHeight: number | null } | null,
): { boardWidth: number; boardHeight: number; coordinateSpace: HeatmapCoordinateSpace } {
  let maxX = 0;
  let maxY = 0;
  for (const r of rows) {
    const xExtent = r.bboxX + Math.max(0, r.bboxW ?? 0);
    const yExtent = r.bboxY + Math.max(0, r.bboxH ?? 0);
    if (xExtent > maxX) maxX = xExtent;
    if (yExtent > maxY) maxY = yExtent;
  }
  const pw = product?.imageWidth ?? null;
  const ph = product?.imageHeight ?? null;
  if (pw != null && ph != null && pw > 0 && ph > 0 && maxX <= pw && maxY <= ph) {
    return { boardWidth: pw, boardHeight: ph, coordinateSpace: "product_image" };
  }
  // Observed extent — guard against a degenerate 0-extent (all bboxes at the
  // origin) so bucketing still divides by a positive number.
  return {
    boardWidth: Math.max(maxX, 1),
    boardHeight: Math.max(maxY, 1),
    coordinateSpace: "observed_extent",
  };
}

export interface BucketOptions {
  gridWidth: number;
  gridHeight: number;
  boardWidth: number;
  boardHeight: number;
  /** Weight grid values by defect severity (counts in hotspots stay raw). */
  weightBySeverity?: boolean;
  hotspotLimit?: number;
}

/**
 * Bucket bbox defects (by bbox CENTER) into a gridWidth × gridHeight grid.
 * Returns the weighted grid plus raw-count cell stats and ranked hotspots.
 */
export function bucketSpatialDefects(
  rows: SpatialDefectRow[],
  opts: BucketOptions,
): Pick<
  SpatialHeatmapResult,
  "grid" | "totalDefects" | "maxDefectsInCell" | "hotspots"
> {
  const { gridWidth, gridHeight, boardWidth, boardHeight } = opts;
  const grid: number[][] = [];
  for (let i = 0; i < gridHeight; i++) grid.push(new Array(gridWidth).fill(0));

  const cellStats = new Map<string, { count: number; classes: Map<string, number> }>();

  for (const r of rows) {
    const cx = r.bboxX + Math.max(0, r.bboxW ?? 0) / 2;
    const cy = r.bboxY + Math.max(0, r.bboxH ?? 0) / 2;
    // Clamp into [0, grid-1]: bboxes touching the right/bottom edge land in
    // the last cell instead of overflowing the grid.
    const gx = Math.min(gridWidth - 1, Math.max(0, Math.floor((cx / boardWidth) * gridWidth)));
    const gy = Math.min(gridHeight - 1, Math.max(0, Math.floor((cy / boardHeight) * gridHeight)));

    grid[gy][gx] += opts.weightBySeverity ? severityWeight(r.severity) : 1;

    const key = `${gx},${gy}`;
    const stats = cellStats.get(key) ?? { count: 0, classes: new Map() };
    stats.count++;
    const cls = r.defectClassCode ?? "UNCLASSIFIED";
    stats.classes.set(cls, (stats.classes.get(cls) ?? 0) + 1);
    cellStats.set(key, stats);
  }

  const totalDefects = rows.length;
  let maxDefectsInCell = 0;
  for (const row of grid) {
    for (const cell of row) if (cell > maxDefectsInCell) maxDefectsInCell = cell;
  }

  const hotspots: HeatmapHotspot[] = Array.from(cellStats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, opts.hotspotLimit ?? 10)
    .map(([key, stats]) => {
      const [x, y] = key.split(",").map(Number);
      const rankedClasses = Array.from(stats.classes.entries())
        .sort((a, b) => b[1] - a[1]);
      return {
        x,
        y,
        defectCount: stats.count,
        defectTypes: rankedClasses.slice(0, 3).map(([type, count]) => ({ type, count })),
        percentage: totalDefects > 0 ? (stats.count / totalDefects) * 100 : 0,
        realX: Math.round(((x + 0.5) / gridWidth) * boardWidth),
        realY: Math.round(((y + 0.5) / gridHeight) * boardHeight),
        topDefectClass: rankedClasses[0]?.[0] ?? null,
      };
    });

  return { grid, totalDefects, maxDefectsInCell, hotspots };
}

// ─── DB orchestration ───────────────────────────────────────────────────────

export interface SpatialHeatmapQuery {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  productModelId?: number;
  defectCatalogId?: number;
  gridWidth: number;
  gridHeight: number;
  /**
   * "bbox" (default) — real panel/board-image pixel aggregation;
   * "pointDef" — legacy logical fallback;
   * "panelBoard" (W8-B, doc 29 §2.2) — fold every board of an N-up panel onto
   * the SINGLE-BOARD mm space using the product's active panel def + per-board
   * Pareto by boardIndex. Falls back to "bbox" (labeled panelAware:false) when
   * no usable panel def exists — it never fabricates a panel.
   */
  mode?: "bbox" | "pointDef" | "panelBoard";
  weightBySeverity?: boolean;
}

function baseConditions(q: SpatialHeatmapQuery): SQL[] {
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, q.startDate),
    lte(productInspections.inspectionTime, q.endDate),
    eq(measurementResults.result, "NG"),
  ];
  if (q.machineId) conditions.push(eq(productInspections.machineId, q.machineId));
  if (q.productModelId) conditions.push(eq(productInspections.productModelId, q.productModelId));
  if (q.defectCatalogId) conditions.push(eq(measurementResults.defectCatalogId, q.defectCatalogId));
  return conditions;
}

/** Hard cap to bound memory on very large windows (same cap the legacy code used). */
const MAX_ROWS = 500_000;

/**
 * Shared fetch for the spatial modes: NG rows WITH a real bbox, the count of
 * NG rows WITHOUT one (never silently dropped), and the product's native image
 * dims (candidate coordinate space, single-product scope only).
 */
async function fetchBboxRows(db: Db, q: SpatialHeatmapQuery): Promise<{
  typedRows: SpatialDefectRow[];
  excludedNoBbox: number;
  product: { imageWidth: number | null; imageHeight: number | null } | null;
}> {
  const conditions = baseConditions(q);

  // NG rows WITH a real bbox (+ defect-class info for per-cell breakdown).
  const rows = await db
    .select({
      bboxX: measurementResults.defectBboxX,
      bboxY: measurementResults.defectBboxY,
      bboxW: measurementResults.defectBboxW,
      bboxH: measurementResults.defectBboxH,
      defectClassCode: defectCatalog.code,
      defectClassName: defectCatalog.name,
      severity: sql<string | null>`COALESCE(${measurementResults.defectSeverity}, ${defectCatalog.severity})`,
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .where(and(
      ...conditions,
      isNotNull(measurementResults.defectBboxX),
      isNotNull(measurementResults.defectBboxY),
    ))
    .limit(MAX_ROWS);

  // NG rows WITHOUT a bbox — excluded from the grid but counted (no silent drops).
  const [excluded] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(
      ...conditions,
      or(isNull(measurementResults.defectBboxX), isNull(measurementResults.defectBboxY)),
    ));
  const excludedNoBbox = Number(excluded?.count) || 0;

  // Product native image dims (candidate coordinate space) — single-product scope only.
  let product: { imageWidth: number | null; imageHeight: number | null } | null = null;
  if (q.productModelId) {
    const [p] = await db
      .select({ imageWidth: productModels.imageWidth, imageHeight: productModels.imageHeight })
      .from(productModels)
      .where(eq(productModels.id, q.productModelId));
    product = p ?? null;
  }

  const typedRows: SpatialDefectRow[] = rows.map((r) => ({
    bboxX: Number(r.bboxX),
    bboxY: Number(r.bboxY),
    bboxW: r.bboxW == null ? null : Number(r.bboxW),
    bboxH: r.bboxH == null ? null : Number(r.bboxH),
    defectClassCode: r.defectClassCode ?? null,
    defectClassName: r.defectClassName ?? null,
    severity: r.severity ?? null,
  }));

  return { typedRows, excludedNoBbox, product };
}

/**
 * Compute the REAL bbox-based heatmap (or the labeled logical fallback when
 * mode = "pointDef" / the panel fold when mode = "panelBoard"). Pure
 * computation is delegated to the exported helpers above; this function only
 * runs the queries.
 */
export async function computeSpatialHeatmap(
  db: Db,
  q: SpatialHeatmapQuery,
): Promise<SpatialHeatmapResult> {
  if ((q.mode ?? "bbox") === "pointDef") {
    return computePointDefFallbackHeatmap(db, q);
  }
  if (q.mode === "panelBoard") {
    return computePanelBoardHeatmap(db, q);
  }

  const { typedRows, excludedNoBbox, product } = await fetchBboxRows(db, q);

  const extent = resolveBoardExtent(typedRows, product);
  const bucketed = bucketSpatialDefects(typedRows, {
    gridWidth: q.gridWidth,
    gridHeight: q.gridHeight,
    boardWidth: extent.boardWidth,
    boardHeight: extent.boardHeight,
    weightBySeverity: q.weightBySeverity,
  });

  const included = bucketed.totalDefects;
  return {
    ...bucketed,
    gridWidth: q.gridWidth,
    gridHeight: q.gridHeight,
    realCoordinates: true,
    mode: "bbox",
    coordinateSpace: extent.coordinateSpace,
    boardWidth: extent.boardWidth,
    boardHeight: extent.boardHeight,
    excludedNoBbox,
    excludedNoBboxPct:
      included + excludedNoBbox > 0
        ? Math.round((excludedNoBbox / (included + excludedNoBbox)) * 10000) / 100
        : 0,
  };
}

/**
 * LEGACY-layout fallback for datasets with NO bbox data at all.
 * Cells are derived from pointDefId (id % gridWidth) — LOGICAL positions with
 * no physical meaning, kept only so such datasets still get a density figure.
 * Labeled realCoordinates:false / coordinateSpace:"logical_point_index" so no
 * UI can present it as spatial truth.
 */
export async function computePointDefFallbackHeatmap(
  db: Db,
  q: SpatialHeatmapQuery,
): Promise<SpatialHeatmapResult> {
  const conditions = baseConditions(q);

  const rows = await db
    .select({
      pointDefId: measurementResults.pointDefId,
      defectClassCode: defectCatalog.code,
      count: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .where(and(...conditions))
    .groupBy(measurementResults.pointDefId, defectCatalog.code)
    .limit(MAX_ROWS);

  const grid: number[][] = [];
  for (let i = 0; i < q.gridHeight; i++) grid.push(new Array(q.gridWidth).fill(0));

  const cellStats = new Map<string, { count: number; classes: Map<string, number> }>();
  let totalDefects = 0;

  for (const r of rows) {
    const n = Number(r.count) || 0;
    totalDefects += n;
    const gx = r.pointDefId % q.gridWidth;
    const gy = Math.floor(r.pointDefId / q.gridWidth) % q.gridHeight;
    grid[gy][gx] += n;
    const key = `${gx},${gy}`;
    const stats = cellStats.get(key) ?? { count: 0, classes: new Map() };
    stats.count += n;
    const cls = r.defectClassCode ?? "UNCLASSIFIED";
    stats.classes.set(cls, (stats.classes.get(cls) ?? 0) + n);
    cellStats.set(key, stats);
  }

  let maxDefectsInCell = 0;
  for (const row of grid) for (const cell of row) if (cell > maxDefectsInCell) maxDefectsInCell = cell;

  const hotspots: HeatmapHotspot[] = Array.from(cellStats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([key, stats]) => {
      const [x, y] = key.split(",").map(Number);
      const rankedClasses = Array.from(stats.classes.entries()).sort((a, b) => b[1] - a[1]);
      return {
        x,
        y,
        defectCount: stats.count,
        defectTypes: rankedClasses.slice(0, 3).map(([type, count]) => ({ type, count })),
        percentage: totalDefects > 0 ? (stats.count / totalDefects) * 100 : 0,
        // Logical mode: no physical pixel space; realX/realY mirror the cell.
        realX: x,
        realY: y,
        topDefectClass: rankedClasses[0]?.[0] ?? null,
      };
    });

  return {
    grid,
    gridWidth: q.gridWidth,
    gridHeight: q.gridHeight,
    totalDefects,
    maxDefectsInCell,
    hotspots,
    realCoordinates: false,
    mode: "pointDef",
    coordinateSpace: "logical_point_index",
    boardWidth: q.gridWidth,
    boardHeight: q.gridHeight,
    excludedNoBbox: 0,
    excludedNoBboxPct: 0,
  };
}

// ─── W8-B (doc 29 §2.2) — panel-aware fold onto the single-board space ───────

/**
 * Panel-aware heatmap: when the product has an ACTIVE panel def, defect bboxes
 * (panel-image pixels — the schema's documented bbox space is the FULL board/
 * panel image) are scaled into panel mm, assigned to a board geometrically
 * (panelTransform.assignBoard: b = M(R(−rot)·(p − offset))) and FOLDED onto the
 * single-board mm grid; per-board-position Pareto comes from the same
 * assignment. Points landing on no board (rails/tooling) are counted in
 * `unassigned` — never guessed into a cell.
 *
 * HONESTY RULES (labels, not guesses):
 *   • no productModelId filter / no active panel def / missing panel or board
 *     dims → the ordinary bbox heatmap runs instead, labeled
 *     `panelAware:false` + `panelFallbackReason` (mode stays "bbox");
 *   • px→mm scaling uses the resolved panel-image extent (product dims or
 *     observed extent — same rules as bbox mode) mapped onto panelWidth/HeightMm.
 */
export async function computePanelBoardHeatmap(
  db: Db,
  q: SpatialHeatmapQuery,
): Promise<SpatialHeatmapResult> {
  const fallback = async (
    reason: NonNullable<SpatialHeatmapResult["panelFallbackReason"]>,
    panelDefId: number | null = null,
  ): Promise<SpatialHeatmapResult> => {
    const base = await computeSpatialHeatmap(db, { ...q, mode: "bbox" });
    return { ...base, panelAware: false, panelDefId, panelFallbackReason: reason };
  };

  if (!q.productModelId) return fallback("no_product_filter");

  // Dynamic import keeps this analytics module load-order independent of the
  // panel master service (mirrors the ingest seams' style).
  const { getActivePanelDefForProduct } = await import("./panel/panelService");
  const { assignBoard, resolveBoardDims } = await import("./panel/panelTransform");

  const panelDef = await getActivePanelDefForProduct(q.productModelId);
  if (!panelDef || panelDef.boards.length === 0) return fallback("no_panel_def");

  const panelW = Number(panelDef.panelWidthMm);
  const panelH = Number(panelDef.panelHeightMm);
  if (!Number.isFinite(panelW) || !Number.isFinite(panelH) || panelW <= 0 || panelH <= 0) {
    return fallback("no_panel_dims", panelDef.id);
  }
  const boardDims = resolveBoardDims(panelDef);
  if (!boardDims) return fallback("no_board_dims", panelDef.id);

  const { typedRows, excludedNoBbox, product } = await fetchBboxRows(db, q);

  // Panel-image pixel extent (same honesty rules as bbox mode), then px → mm.
  const extent = resolveBoardExtent(typedRows, product);
  const sx = panelW / extent.boardWidth;
  const sy = panelH / extent.boardHeight;

  const placements = panelDef.boards.map((b) => ({
    boardIndex: b.boardIndex,
    offsetXMm: Number(b.offsetXMm),
    offsetYMm: Number(b.offsetYMm),
    rotationDeg: Number(b.rotationDeg),
    mirrored: b.mirrored,
    skipped: b.skipped,
  }));

  const foldedRows: SpatialDefectRow[] = [];
  const perBoardCounts = new Map<number, { defectCount: number; skipped: boolean }>();
  for (const p of placements) {
    perBoardCounts.set(p.boardIndex, { defectCount: 0, skipped: p.skipped === true });
  }
  let unassigned = 0;

  for (const r of typedRows) {
    // bbox center in panel mm.
    const cx = (r.bboxX + Math.max(0, r.bboxW ?? 0) / 2) * sx;
    const cy = (r.bboxY + Math.max(0, r.bboxH ?? 0) / 2) * sy;
    const hit = assignBoard({ x: cx, y: cy }, placements, boardDims);
    if (!hit) {
      unassigned++;
      continue;
    }
    const stats = perBoardCounts.get(hit.boardIndex);
    if (stats) stats.defectCount++;
    // Synthesize a zero-size bbox at the board-local center so the shared
    // bucketer (bbox-center semantics) folds it onto the single-board grid.
    foldedRows.push({ ...r, bboxX: hit.local.x, bboxY: hit.local.y, bboxW: 0, bboxH: 0 });
  }

  const bucketed = bucketSpatialDefects(foldedRows, {
    gridWidth: q.gridWidth,
    gridHeight: q.gridHeight,
    boardWidth: boardDims.boardWidthMm,
    boardHeight: boardDims.boardHeightMm,
    weightBySeverity: q.weightBySeverity,
  });

  const included = bucketed.totalDefects;
  return {
    ...bucketed,
    gridWidth: q.gridWidth,
    gridHeight: q.gridHeight,
    realCoordinates: true,
    mode: "panelBoard",
    coordinateSpace: "board_local_mm",
    boardWidth: boardDims.boardWidthMm,
    boardHeight: boardDims.boardHeightMm,
    excludedNoBbox,
    excludedNoBboxPct:
      included + unassigned + excludedNoBbox > 0
        ? Math.round((excludedNoBbox / (included + unassigned + excludedNoBbox)) * 10000) / 100
        : 0,
    panelAware: true,
    panelDefId: panelDef.id,
    perBoard: [...perBoardCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([boardIndex, v]) => ({ boardIndex, defectCount: v.defectCount, skipped: v.skipped })),
    unassigned,
  };
}
