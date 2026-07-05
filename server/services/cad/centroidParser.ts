/**
 * Doc 31 — Đợt C (C.1 · MP5 / PM4 · decision #5)
 * ============================================================================
 * GENERIC centroid / pick-place CSV parser.
 *
 * WHY generic-first (decision #5, §8): we have NO real vendor file yet, so we do
 * NOT hardcode any vendor's column order. Instead the caller supplies a
 * CONFIGURABLE column map (which of the file's columns is refDesignator / x / y
 * / rotation / side / package / value / placedStatus) + parse options
 * (delimiter, decimal separator, unit, header). This mirrors the hot-folder
 * adapter pattern: a real Fuji / Panasonic / Siemens / JUKI / generic KiCad file
 * is onboarded by MAPPING columns in the UI — no code change. See the README in
 * this folder for the alias table used by `guessColumnMap`.
 *
 * TWO stages, kept separate so both are trivially unit-testable:
 *   1. parseCentroidCsv(text, opts)   — raw file  → normalized rows (file units)
 *   2. transformCentroidRows(rows, …) — rows      → candidates in the product's
 *                                        coordinate space (mm | pixel), with the
 *                                        Y-flip / origin / scale options centroid
 *                                        files typically need.
 *
 * Pure functions only. No DB, no I/O. The service (centroidImportService.ts)
 * wires these to cad_import_jobs / cad_import_candidates + point-def generation.
 * ============================================================================
 */

// ── Column map & options ────────────────────────────────────────────────────

/** Which column (by 0-based index OR header name) supplies each field. */
export interface CentroidColumnMap {
  refDesignator: number | string;          // REQUIRED
  x: number | string;                       // REQUIRED
  y: number | string;                       // REQUIRED
  rotation?: number | string;
  side?: number | string;                   // top / bottom layer
  package?: number | string;                // footprint / package
  componentCode?: number | string;          // value / part number
  placedStatus?: number | string;           // placed / skip / fitted
  name?: number | string;                   // optional human label
}

export interface CentroidParseOptions {
  /** Field delimiter. Auto-detected from the header line when omitted. */
  delimiter?: "," | ";" | "\t" | "auto";
  /** Decimal separator inside numeric fields. Default ".". */
  decimal?: "." | ",";
  /** First non-comment row is a header. Default true. */
  hasHeader?: boolean;
  /** Column map. When absent, callers usually guess via guessColumnMap(). */
  columnMap: CentroidColumnMap;
  /** Comment-line prefixes to skip. Default ["#", "//"]. */
  commentPrefixes?: string[];
}

export interface ParsedCentroidRow {
  refDesignator: string;
  rawX: number;
  rawY: number;
  rotation?: number;
  side?: "top" | "bottom";
  package?: string;
  componentCode?: string;
  placedStatus?: string;
  name?: string;
  /** 1-based line number in the source file (for error reporting). */
  sourceLine: number;
}

export interface CentroidParseResult {
  rows: ParsedCentroidRow[];
  headers: string[] | null;
  detectedDelimiter: "," | ";" | "\t";
  warnings: string[];
  stats: {
    totalLines: number;
    dataLines: number;
    parsed: number;
    skipped: number;
    duplicates: number;
  };
}

const DEFAULT_COMMENTS = ["#", "//"];

// ── Delimiter / header helpers ──────────────────────────────────────────────

/** Pick the delimiter that best splits the given (header) line. */
export function detectDelimiter(line: string): "," | ";" | "\t" {
  const counts: Record<string, number> = {
    ",": (line.match(/,/g) || []).length,
    ";": (line.match(/;/g) || []).length,
    "\t": (line.match(/\t/g) || []).length,
  };
  let best: "," | ";" | "\t" = ",";
  let bestN = -1;
  for (const d of [",", ";", "\t"] as const) {
    if (counts[d] > bestN) { bestN = counts[d]; best = d; }
  }
  return best;
}

/**
 * Split one CSV line respecting double-quoted fields (RFC-4180-ish: a quote
 * inside a quoted field is escaped by doubling it). Embedded newlines are NOT
 * supported (centroid files are line-oriented) — noted in the README.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Common header aliases → field. Used to PRE-FILL the column map in the UI. */
const HEADER_ALIASES: Record<keyof CentroidColumnMap, string[]> = {
  refDesignator: ["refdes", "ref des", "ref", "designator", "reference", "part", "component ref", "name", "id", "rd", "位号"],
  x: ["x", "posx", "pos x", "mid x", "midx", "center-x", "centerx", "x (mm)", "x_mm", "pos_x", "ref-x", "x坐标"],
  y: ["y", "posy", "pos y", "mid y", "midy", "center-y", "centery", "y (mm)", "y_mm", "pos_y", "ref-y", "y坐标"],
  rotation: ["rot", "rotation", "angle", "rotate", "theta", "orientation", "rot (deg)", "角度"],
  side: ["side", "layer", "tb", "top/bottom", "board side", "placement", "面"],
  package: ["package", "footprint", "fp", "pattern", "shape", "pkg", "封装"],
  componentCode: ["value", "comment", "part number", "partnumber", "part no", "pn", "mpn", "component", "componentcode", "型号"],
  placedStatus: ["placed", "status", "fitted", "populate", "dnp", "assembly", "贴装"],
  name: ["name", "label", "description", "desc"],
};

/**
 * Best-effort auto-map from header names (case/space insensitive). Returns a
 * partial map — refDesignator/x/y may be missing and MUST be confirmed in the UI.
 */
export function guessColumnMap(headers: string[]): Partial<CentroidColumnMap> {
  const norm = headers.map((h) => h.toLowerCase().replace(/["']/g, "").trim());
  const map: Partial<CentroidColumnMap> = {};
  const used = new Set<number>();
  const fields = Object.keys(HEADER_ALIASES) as (keyof CentroidColumnMap)[];
  // Pass 1: exact alias match (longest aliases first to prefer "posx" over "x").
  for (const field of fields) {
    const aliases = [...HEADER_ALIASES[field]].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h === alias);
      if (idx >= 0) { map[field] = idx; used.add(idx); break; }
    }
  }
  // Pass 2: substring match for anything still unmapped.
  for (const field of fields) {
    if (map[field] != null) continue;
    const aliases = [...HEADER_ALIASES[field]].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(alias));
      if (idx >= 0) { map[field] = idx; used.add(idx); break; }
    }
  }
  return map;
}

export interface CentroidInspectResult {
  headers: string[] | null;
  detectedDelimiter: "," | ";" | "\t";
  guessedMap: Partial<CentroidColumnMap>;
  /** First few data rows split into cells — for a preview grid in the UI. */
  sampleRows: string[][];
}

/**
 * Lightweight first-pass: detect delimiter + header + a guessed column map so
 * the wizard can pre-fill mapping dropdowns before the user confirms.
 */
export function inspectCentroidHeaders(
  text: string,
  opts?: { delimiter?: "," | ";" | "\t" | "auto"; hasHeader?: boolean; commentPrefixes?: string[] },
): CentroidInspectResult {
  const comments = opts?.commentPrefixes ?? DEFAULT_COMMENTS;
  const hasHeader = opts?.hasHeader ?? true;
  const clean = text.replace(/^﻿/, "");
  const rawLines = clean.split(/\r\n|\r|\n/);
  const significant: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (comments.some((c) => trimmed.startsWith(c))) continue;
    significant.push(line);
    if (significant.length >= 8) break;
  }
  if (significant.length === 0) {
    return { headers: null, detectedDelimiter: ",", guessedMap: {}, sampleRows: [] };
  }
  const delimiter =
    opts?.delimiter && opts.delimiter !== "auto" ? opts.delimiter : detectDelimiter(significant[0]);
  const headers = hasHeader ? splitCsvLine(significant[0], delimiter) : null;
  const guessedMap = headers ? guessColumnMap(headers) : {};
  const dataStart = hasHeader ? 1 : 0;
  const sampleRows = significant.slice(dataStart, dataStart + 5).map((l) => splitCsvLine(l, delimiter));
  return { headers, detectedDelimiter: delimiter, guessedMap, sampleRows };
}

// ── Value normalization ─────────────────────────────────────────────────────

/** Resolve a column reference (index or header name) to a 0-based index. */
function resolveColumn(
  ref: number | string | undefined,
  headers: string[] | null,
): number | undefined {
  if (ref == null || ref === "") return undefined;
  if (typeof ref === "number") return Number.isInteger(ref) && ref >= 0 ? ref : undefined;
  // string → match header name (case/space-insensitive)
  if (!headers) {
    const n = Number(ref);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }
  const want = ref.toLowerCase().replace(/["']/g, "").trim();
  const idx = headers.findIndex((h) => h.toLowerCase().replace(/["']/g, "").trim() === want);
  return idx >= 0 ? idx : undefined;
}

function parseNumberField(raw: string | undefined, decimal: "." | ","): number | undefined {
  if (raw == null) return undefined;
  let s = raw.trim();
  if (s === "") return undefined;
  if (decimal === ",") {
    // "1.234,56" (thousands '.') → strip '.' then ',' → '.'
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // Strip any trailing unit suffix like "mm" a user left in the cell.
  s = s.replace(/[^0-9eE+\-.]+$/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize a side / layer token to top | bottom (undefined if unknown). */
export function normalizeSide(raw: string | undefined): "top" | "bottom" | undefined {
  if (raw == null) return undefined;
  const s = raw.toLowerCase().trim();
  if (s === "") return undefined;
  if (["top", "t", "top side", "topside", "top layer", "1", "f", "front", "f.cu", "顶层", "top层"].includes(s)) return "top";
  if (["bottom", "bot", "b", "bottom side", "bottomside", "bottom layer", "2", "back", "b.cu", "底层"].includes(s)) return "bottom";
  if (s.startsWith("top") || s.startsWith("front") || s === "f.cu") return "top";
  if (s.startsWith("bot") || s.startsWith("back") || s === "b.cu") return "bottom";
  return undefined;
}

// ── Stage 1: parse ──────────────────────────────────────────────────────────

export function parseCentroidCsv(text: string, opts: CentroidParseOptions): CentroidParseResult {
  const warnings: string[] = [];
  const comments = opts.commentPrefixes ?? DEFAULT_COMMENTS;
  const decimal = opts.decimal ?? ".";
  const hasHeader = opts.hasHeader ?? true;

  // Strip UTF-8 BOM, split lines.
  const clean = text.replace(/^﻿/, "");
  const rawLines = clean.split(/\r\n|\r|\n/);
  const totalLines = rawLines.length;

  // Build a list of significant (non-blank, non-comment) lines with source #.
  const significant: Array<{ line: string; lineNo: number }> = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line == null) continue;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (comments.some((c) => trimmed.startsWith(c))) continue;
    significant.push({ line, lineNo: i + 1 });
  }

  if (significant.length === 0) {
    return {
      rows: [], headers: null, detectedDelimiter: ",",
      warnings: ["File has no data rows."],
      stats: { totalLines, dataLines: 0, parsed: 0, skipped: 0, duplicates: 0 },
    };
  }

  // Delimiter.
  const delimiter =
    opts.delimiter && opts.delimiter !== "auto"
      ? opts.delimiter
      : detectDelimiter(significant[0].line);
  if (delimiter === "," && decimal === ",") {
    warnings.push(
      "Delimiter and decimal separator are both ',' — ambiguous. Use ';' or Tab as the delimiter for comma-decimal files.",
    );
  }

  // Header + data slice.
  let headers: string[] | null = null;
  let dataStart = 0;
  if (hasHeader) {
    headers = splitCsvLine(significant[0].line, delimiter);
    dataStart = 1;
  }

  const colX = resolveColumn(opts.columnMap.x, headers);
  const colY = resolveColumn(opts.columnMap.y, headers);
  const colRef = resolveColumn(opts.columnMap.refDesignator, headers);
  const colRot = resolveColumn(opts.columnMap.rotation, headers);
  const colSide = resolveColumn(opts.columnMap.side, headers);
  const colPkg = resolveColumn(opts.columnMap.package, headers);
  const colCC = resolveColumn(opts.columnMap.componentCode, headers);
  const colPlaced = resolveColumn(opts.columnMap.placedStatus, headers);
  const colName = resolveColumn(opts.columnMap.name, headers);

  if (colRef == null) warnings.push("No refDesignator column mapped — every row will be skipped.");
  if (colX == null) warnings.push("No X column mapped.");
  if (colY == null) warnings.push("No Y column mapped.");

  const rows: ParsedCentroidRow[] = [];
  const seen = new Map<string, number>(); // lowered refdes → first sourceLine
  let skipped = 0;
  let duplicates = 0;
  let dataLines = 0;

  for (let i = dataStart; i < significant.length; i++) {
    const { line, lineNo } = significant[i];
    dataLines++;
    const cells = splitCsvLine(line, delimiter);
    const at = (c: number | undefined): string | undefined =>
      c != null && c < cells.length ? cells[c] : undefined;

    const refRaw = (at(colRef) ?? "").trim();
    if (refRaw === "") { skipped++; continue; }

    const x = parseNumberField(at(colX), decimal);
    const y = parseNumberField(at(colY), decimal);
    if (x == null || y == null) {
      skipped++;
      warnings.push(`Line ${lineNo} (${refRaw}): missing/invalid X or Y — skipped.`);
      continue;
    }

    const key = refRaw.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      warnings.push(`Line ${lineNo}: duplicate refDesignator "${refRaw}" (first at line ${seen.get(key)}) — kept first.`);
      continue;
    }
    seen.set(key, lineNo);

    rows.push({
      refDesignator: refRaw,
      rawX: x,
      rawY: y,
      rotation: parseNumberField(at(colRot), decimal),
      side: normalizeSide(at(colSide)),
      package: (at(colPkg) ?? "").trim() || undefined,
      componentCode: (at(colCC) ?? "").trim() || undefined,
      placedStatus: (at(colPlaced) ?? "").trim() || undefined,
      name: (at(colName) ?? "").trim() || undefined,
      sourceLine: lineNo,
    });
  }

  if (rows.length === 0 && skipped > 0) {
    warnings.push("No rows parsed — check the column mapping and delimiter.");
  }

  return {
    rows,
    headers,
    detectedDelimiter: delimiter,
    warnings: warnings.slice(0, 200),
    stats: { totalLines, dataLines, parsed: rows.length, skipped, duplicates },
  };
}

// ── Stage 2: coordinate transform ───────────────────────────────────────────

export type CoordinateUnit = "mm" | "cm" | "mil" | "inch" | "um";

const UNIT_TO_MM: Record<CoordinateUnit, number> = {
  mm: 1,
  cm: 10,
  um: 0.001,
  mil: 0.0254,   // 1 mil = 1/1000 inch = 0.0254 mm
  inch: 25.4,
};

export interface CentroidTransformOptions {
  /** Unit of the file's X/Y values. Default "mm". */
  unit?: CoordinateUnit;
  /** Mirror about the point-cloud bounding box in X. Default false. */
  flipX?: boolean;
  /** Mirror about the point-cloud bounding box in Y. Centroid files are usually
   *  board-origin bottom-left (Y up); product images are top-left (Y down) →
   *  set true. Default false. */
  flipY?: boolean;
  /** Target coordinate space. Should match product_models.coordinateMode. */
  targetMode: "mm" | "pixel";
  // ── pixel-mode placement ──
  /** Auto-scale the point cloud to FIT the product image (recommended when the
   *  product has an image but no known px-per-mm). Default true for pixel mode. */
  fitToImage?: boolean;
  /** Inner margin (% of the smaller image side) used by fitToImage. Default 5. */
  marginPct?: number;
  /** Manual px-per-mm scale (used when fitToImage=false). */
  scale?: number;
  /** Constant offset applied in the TARGET space (px or mm). */
  offsetX?: number;
  offsetY?: number;
}

export interface CentroidCandidate {
  candidateIndex: number;
  code: string;               // = refDesignator
  name: string;
  shape: "circle";
  /** Target-space coordinates (px if pixel mode, mm if mm mode). */
  positionX: number;
  positionY: number;
  /** 0..1 relative to image dims (only when dims are known). */
  normalizedX?: number;
  normalizedY?: number;
  refDesignator: string;
  rotation?: number;
  side?: "top" | "bottom";
  package?: string;
  componentCode?: string;
  placedStatus?: string;
  /** Source values preserved for traceability / re-transform. */
  rawX: number;
  rawY: number;
  mmX: number;
  mmY: number;
  unit: CoordinateUnit;
}

export interface CentroidTransformResult {
  candidates: CentroidCandidate[];
  warnings: string[];
  /** Effective scale (px per mm) used in pixel mode, else 1. */
  effectiveScale: number;
  bbox: { minXmm: number; minYmm: number; maxXmm: number; maxYmm: number };
}

export interface TransformProductInfo {
  imageWidth?: number | null;
  imageHeight?: number | null;
  coordinateMode?: string | null;
}

/**
 * Transform parsed rows into candidates in the product's coordinate space.
 * Pure: everything it needs about the product is passed in `product`.
 */
export function transformCentroidRows(
  rows: ParsedCentroidRow[],
  options: CentroidTransformOptions,
  product: TransformProductInfo,
): CentroidTransformResult {
  const warnings: string[] = [];
  const unit = options.unit ?? "mm";
  const unitFactor = UNIT_TO_MM[unit];
  const targetMode = options.targetMode;

  // mm bounding box of the raw cloud.
  let minXmm = Infinity, minYmm = Infinity, maxXmm = -Infinity, maxYmm = -Infinity;
  const mm = rows.map((r) => {
    const mx = r.rawX * unitFactor;
    const my = r.rawY * unitFactor;
    if (mx < minXmm) minXmm = mx;
    if (my < minYmm) minYmm = my;
    if (mx > maxXmm) maxXmm = mx;
    if (my > maxYmm) maxYmm = my;
    return { mx, my };
  });
  if (rows.length === 0) {
    minXmm = minYmm = maxXmm = maxYmm = 0;
  }
  const boardW = Math.max(maxXmm - minXmm, 1e-6);
  const boardH = Math.max(maxYmm - minYmm, 1e-6);

  const hasDims = !!(product.imageWidth && product.imageHeight);
  const imgW = product.imageWidth ?? 0;
  const imgH = product.imageHeight ?? 0;

  let effectiveScale = 1;
  let pxOffsetX = 0;
  let pxOffsetY = 0;

  if (targetMode === "pixel") {
    const fit = options.fitToImage ?? true;
    if (fit && hasDims) {
      const margin = (Math.min(imgW, imgH) * (options.marginPct ?? 5)) / 100;
      const sx = (imgW - 2 * margin) / boardW;
      const sy = (imgH - 2 * margin) / boardH;
      effectiveScale = Math.min(sx, sy);
      // Center the scaled cloud within the image.
      pxOffsetX = (imgW - boardW * effectiveScale) / 2;
      pxOffsetY = (imgH - boardH * effectiveScale) / 2;
    } else {
      if (fit && !hasDims) {
        warnings.push("Pixel mode + fit-to-image requested but the product has no image dimensions — falling back to scale=1 (px≈mm). Set image width/height for correct placement (PM8).");
      }
      effectiveScale = options.scale && options.scale > 0 ? options.scale : 1;
      pxOffsetX = 0;
      pxOffsetY = 0;
    }
  } else {
    // mm mode
    if (!hasDims) {
      warnings.push("Product is in mm mode with no image dimensions — placing points in mm; coordinates are not pixel-portable until an image + dimensions are set (PM8).");
    }
  }

  const candidates: CentroidCandidate[] = rows.map((r, i) => {
    const { mx, my } = mm[i];
    // Flip about the bbox (keeps points inside the same extent).
    const fx = options.flipX ? (minXmm + maxXmm - mx) : mx;
    const fy = options.flipY ? (minYmm + maxYmm - my) : my;

    let px: number;
    let py: number;
    if (targetMode === "pixel") {
      // Anchor to bbox min so the cloud starts at the image margin.
      px = pxOffsetX + (fx - minXmm) * effectiveScale + (options.offsetX ?? 0);
      py = pxOffsetY + (fy - minYmm) * effectiveScale + (options.offsetY ?? 0);
    } else {
      px = fx + (options.offsetX ?? 0);
      py = fy + (options.offsetY ?? 0);
    }
    px = Math.max(0, px);
    py = Math.max(0, py);

    let normalizedX: number | undefined;
    let normalizedY: number | undefined;
    if (hasDims && targetMode === "pixel") {
      normalizedX = Math.min(1, Math.max(0, px / imgW));
      normalizedY = Math.min(1, Math.max(0, py / imgH));
    }

    const nameParts = [r.refDesignator, r.package].filter(Boolean);
    return {
      candidateIndex: i,
      code: r.refDesignator,
      name: r.name ?? nameParts.join(" · "),
      shape: "circle" as const,
      positionX: px,
      positionY: py,
      normalizedX,
      normalizedY,
      refDesignator: r.refDesignator,
      rotation: r.rotation,
      side: r.side,
      package: r.package,
      componentCode: r.componentCode,
      placedStatus: r.placedStatus,
      rawX: r.rawX,
      rawY: r.rawY,
      mmX: mx,
      mmY: my,
      unit,
    };
  });

  return {
    candidates,
    warnings,
    effectiveScale,
    bbox: { minXmm, minYmm, maxXmm, maxYmm },
  };
}

// ── One-shot convenience: parse + transform ─────────────────────────────────

export interface CentroidBuildOptions {
  parse: CentroidParseOptions;
  transform: CentroidTransformOptions;
}

export interface CentroidBuildResult {
  parse: CentroidParseResult;
  candidates: CentroidCandidate[];
  warnings: string[];
  effectiveScale: number;
  bbox: CentroidTransformResult["bbox"];
}

export function buildCentroidCandidates(
  text: string,
  buildOpts: CentroidBuildOptions,
  product: TransformProductInfo,
): CentroidBuildResult {
  const parse = parseCentroidCsv(text, buildOpts.parse);
  const tf = transformCentroidRows(parse.rows, buildOpts.transform, product);
  return {
    parse,
    candidates: tf.candidates,
    warnings: [...parse.warnings, ...tf.warnings],
    effectiveScale: tf.effectiveScale,
    bbox: tf.bbox,
  };
}
