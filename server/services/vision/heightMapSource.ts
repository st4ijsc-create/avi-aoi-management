/**
 * heightMapSource.ts — HEIGHT-MAP SOURCE seam (doc 27 §9 V12/V13 · Đợt 7.6 · decision #7).
 *
 * ── WHY A SEAM ────────────────────────────────────────────────────────────────
 * Decision #7 (doc 27 §11, locked 2026-07-04) COMMITS to a native height-map
 * source (structured-light / point-cloud) for 3D/SPI, but the camera hardware is
 * NOT chosen yet. So — exactly like the acquisition ImageSource seam — we design
 * the interface FIRST and bind the device LATER. Everything downstream (the
 * native SPI metrology in aiSpi3d.ts + enrichCanonicalWithSpi3d) already exists;
 * this module is the missing "where does the height-map come from" answer.
 *
 * ── WHAT IS REAL TODAY vs STUB ────────────────────────────────────────────────
 *   • "vendor-passthrough" — REAL. Extracts per-pad 3-D point samples that a
 *     vendor payload already carries (CanonicalMeasurement.rawExtras.points3d,
 *     which adapters populate losslessly), rasterizes them via
 *     aiSpi3d.pointsToHeightMap and derives pad geometry. No new hardware: any
 *     SPI/AOI export that includes point/height samples gets NATIVE server-side
 *     volume/coplanarity/warpage instead of trusting only transported scalars.
 *   • "file"  — REAL. Loads a depth map dropped ALONGSIDE the result file
 *     (hot-folder flow): `<stem>.heightmap.json` manifest with inline data, a
 *     CSV grid, or a 16-bit grayscale PNG. This is how structured-light vendors
 *     that export depth files integrate TODAY, before any camera SDK binding.
 *   • "device" — HONEST STUB. Throws HeightMapNotConfiguredError until the
 *     structured-light camera hardware is chosen and its SDK is bound here
 *     (mirrors GenICamImageSource). It never fabricates a height-map.
 *
 * ── SELECTION (env, per machine — no new table) ──────────────────────────────
 *   HEIGHT_MAP_SOURCE                 global default kind ("vendor-passthrough" |
 *                                     "file" | "device" | "off"). Default
 *                                     "vendor-passthrough" (safe: it only acts
 *                                     when the payload actually carries 3D data).
 *   HEIGHT_MAP_SOURCE_<MACHINE_CODE>  per-machine override; machine code is
 *                                     upper-cased with non-alphanumerics → "_"
 *                                     (e.g. machine "spi-01" → HEIGHT_MAP_SOURCE_SPI_01).
 *   The whole path additionally sits behind SPI_3D_NATIVE_ENABLED (aiSpi3d flag):
 *   flag off ⇒ maybeEnrichCanonicalWithHeightMap is a byte-for-byte pass-through.
 *   We deliberately did NOT add a config table/column (0190 not needed): the
 *   hot-folder config row keys the FOLDER, not the 3D modality; env-per-machine
 *   is the simplest honest home until the device kind lands with real hardware
 *   (at which point a device-binding table will be justified by real fields).
 *
 * ── FAIL-SAFE INVARIANT ───────────────────────────────────────────────────────
 * maybeEnrichCanonicalWithHeightMap NEVER throws and NEVER blocks ingest: any
 * error, missing sidecar, unknown kind or absent 3D data degrades to the exact
 * vendor pass-through behaviour that ships today.
 */
import fs from "node:fs";
import path from "node:path";
import type { CanonicalInspection, CanonicalMeasurement } from "./visionAdapterRegistry";
import {
  enrichCanonicalWithSpi3d,
  pointsToHeightMap,
  spi3dNativeEnabled,
  type BoardSpiResult,
  type HeightMap,
  type PadGeometry,
  type Point3D,
  type SpiCalibration,
  type SpiThresholds,
} from "../aiSpi3d";

// ════════════════════════════════════════════════════════════════════════════
// Contract
// ════════════════════════════════════════════════════════════════════════════

export type HeightMapSourceKind = "vendor-passthrough" | "file" | "device";

export interface HeightMapProbeResult {
  kind: HeightMapSourceKind;
  /** True when this source can genuinely produce height-maps right now. */
  available: boolean;
  detail: string;
}

/** Everything a source may need to locate the height data for ONE inspection. */
export interface HeightMapAcquireContext {
  /** The normalized inspection (vendor-passthrough reads rawExtras from it). */
  canonical: CanonicalInspection;
  /** Machine identity (env override resolution + logging). */
  machineCode?: string | null;
  /** For the "file" kind: path of the vendor RESULT file — depth sidecars are looked up next to it. */
  resultFilePath?: string | null;
}

/** A successfully acquired height-map + the pad geometry to analyse it with. */
export interface HeightMapAcquisition {
  heightMap: HeightMap;
  pads: PadGeometry[];
  calibration?: SpiCalibration | null;
  thresholds?: Partial<SpiThresholds>;
  /** Honest provenance for logs/UI. */
  detail: string;
}

/**
 * The pluggable seam. `acquire` returns null when the source has no height data
 * for THIS inspection (normal, not an error). It throws only for real faults
 * (unreadable sidecar, device not configured) — callers treat a throw as
 * "no enrichment" (fail-open pass-through), never as an ingest failure.
 */
export interface HeightMapSource {
  readonly kind: HeightMapSourceKind;
  probe(): Promise<HeightMapProbeResult>;
  acquire(ctx: HeightMapAcquireContext): Promise<HeightMapAcquisition | null>;
}

/**
 * Thrown by the "device" stub: the seam exists, the hardware binding does not.
 * Mirrors GenICamNotConfiguredError (acquisition seam) — an honest "not yet".
 */
export class HeightMapNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeightMapNotConfiguredError";
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Shared parsing helpers (exported for tests)
// ════════════════════════════════════════════════════════════════════════════

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface RawBbox { x: number; y: number; w: number; h: number }

function parseBbox(v: unknown): RawBbox | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h);
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Parse an array of {x,y,z} samples; drops non-finite entries. */
export function parsePoints3d(v: unknown): Point3D[] {
  if (!Array.isArray(v)) return [];
  const out: Point3D[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const x = num(o.x), y = num(o.y), z = num(o.z);
    if (x == null || y == null || z == null) continue;
    out.push({ x, y, z });
  }
  return out;
}

/** Parse an inspection-level rawExtras.spiCalibration block (all optional). */
export function parseCalibration(v: unknown): SpiCalibration | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const cal: SpiCalibration = {};
  const kx = num(o.umPerPxX ?? o.umPerPx);
  const ky = num(o.umPerPxY);
  const z = num(o.zScale);
  if (kx != null && kx > 0) cal.umPerPxX = kx;
  if (ky != null && ky > 0) cal.umPerPxY = ky;
  if (z != null && z > 0) cal.zScale = z;
  return cal.umPerPxX != null || cal.umPerPxY != null || cal.zScale != null ? cal : null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1) vendor-passthrough — REAL today (rawExtras.points3d → rasterized height-map)
// ════════════════════════════════════════════════════════════════════════════

interface PadPoints {
  padId: string;
  points: Point3D[];
  bbox: RawBbox | null;
  nominalHeight?: number;
  nominalVolume?: number;
  nominalArea?: number;
  componentId?: string;
}

function collectPadPoints(measurements: CanonicalMeasurement[]): PadPoints[] {
  const out: PadPoints[] = [];
  for (const m of measurements) {
    const padId = (m.pointCode ?? m.pointId ?? "").toString().trim();
    if (!padId) continue; // cannot merge results back without a pad key
    const extras = (m.rawExtras ?? {}) as Record<string, unknown>;
    const points = parsePoints3d(extras.points3d ?? extras.points3D);
    if (points.length === 0) continue;
    const pad: PadPoints = { padId, points, bbox: parseBbox(extras.padBbox) };
    const nh = num(extras.nominalHeight);
    const nv = num(extras.nominalVolume);
    const na = num(extras.nominalArea);
    if (nh != null && nh > 0) pad.nominalHeight = nh;
    if (nv != null && nv > 0) pad.nominalVolume = nv;
    if (na != null && na > 0) pad.nominalArea = na;
    if (typeof extras.componentId === "string" && extras.componentId.trim()) {
      pad.componentId = extras.componentId.trim();
    }
    out.push(pad);
  }
  return out;
}

/**
 * Build one board height-map + pad geometry from the point samples the vendor
 * payload already carries. Pure (no I/O) — exported for tests.
 * Returns null when NO measurement carries points3d (the common vendor case →
 * honest pass-through; we never invent a height-map).
 */
export function buildVendorPassthroughAcquisition(
  canonical: CanonicalInspection,
): HeightMapAcquisition | null {
  const pads = collectPadPoints(canonical.measurements ?? []);
  if (pads.length === 0) return null;

  const allPoints: Point3D[] = [];
  for (const p of pads) allPoints.push(...p.points);
  const { heightMap, originX, originY, width, height } = pointsToHeightMap(allPoints);

  const geometry: PadGeometry[] = pads.map((p) => {
    let bbox: RawBbox;
    if (p.bbox) {
      bbox = { x: p.bbox.x - originX, y: p.bbox.y - originY, w: p.bbox.w, h: p.bbox.h };
    } else {
      // Derive the aperture bbox from the pad's own sample extent.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of p.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      bbox = {
        x: Math.floor(minX) - originX,
        y: Math.floor(minY) - originY,
        w: Math.floor(maxX) - Math.floor(minX) + 1,
        h: Math.floor(maxY) - Math.floor(minY) + 1,
      };
    }
    const g: PadGeometry = { padId: p.padId, bbox };
    if (p.nominalHeight != null) g.nominalHeight = p.nominalHeight;
    if (p.nominalVolume != null) g.nominalVolume = p.nominalVolume;
    if (p.nominalArea != null) g.nominalArea = p.nominalArea;
    if (p.componentId) g.componentId = p.componentId;
    return g;
  });

  const extras = (canonical.rawExtras ?? {}) as Record<string, unknown>;
  return {
    heightMap,
    pads: geometry,
    calibration: parseCalibration(extras.spiCalibration),
    detail: `vendor-passthrough: ${pads.length} pad(s) with 3D samples → ${width}×${height} raster`,
  };
}

class VendorPassthroughSource implements HeightMapSource {
  readonly kind = "vendor-passthrough" as const;

  async probe(): Promise<HeightMapProbeResult> {
    return {
      kind: this.kind,
      available: true,
      detail:
        "Rasterizes 3-D point samples the vendor payload already carries " +
        "(measurement rawExtras.points3d). Acts only when such samples exist.",
    };
  }

  async acquire(ctx: HeightMapAcquireContext): Promise<HeightMapAcquisition | null> {
    return buildVendorPassthroughAcquisition(ctx.canonical);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2) file — REAL today (depth sidecar dropped alongside the result file)
// ════════════════════════════════════════════════════════════════════════════

/** Sidecar suffixes the hot-folder must NEVER ingest as result files. */
export const HEIGHT_MAP_SIDECAR_SUFFIXES = [
  ".heightmap.json",
  ".heightmap.csv",
  ".heightmap.png",
] as const;

interface HeightMapManifest {
  width?: number;
  height?: number;
  /** Inline row-major Z data (µm before zScale). */
  data?: number[];
  /** Relative path (from the manifest dir) to a CSV grid of Z values. */
  csv?: string;
  /** Relative path to a 16-bit grayscale PNG depth image (zScale REQUIRED). */
  png16?: string;
  /** Raw-Z → µm multiplier (default 1 for data/csv; REQUIRED for png16). */
  zScale?: number;
  umPerPxX?: number;
  umPerPxY?: number;
  pads?: Array<{
    padId?: string;
    bbox?: RawBbox;
    nominalHeight?: number;
    nominalVolume?: number;
    nominalArea?: number;
    componentId?: string;
  }>;
  thresholds?: Partial<SpiThresholds>;
}

/** Parse a CSV grid (rows of comma/semicolon/whitespace-separated Z values). Exported for tests. */
export function parseCsvHeightMap(text: string): HeightMap {
  const rows: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cells = trimmed.split(/[,;\s]+/).map((c) => Number(c));
    if (cells.some((c) => !Number.isFinite(c))) {
      throw new Error("heightmap CSV contains a non-numeric cell");
    }
    rows.push(cells);
  }
  if (rows.length === 0) throw new Error("heightmap CSV is empty");
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) {
    throw new Error("heightmap CSV rows have inconsistent widths");
  }
  const data = new Float32Array(width * rows.length);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = rows[y][x];
  }
  return { data, width, height: rows.length };
}

/** Decode a 16-bit grayscale PNG into a raw DN grid (zScale applied by the caller). */
async function decodePng16(filePath: string): Promise<HeightMap> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(filePath)
    .toColourspace("grey16")
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const out = new Float32Array(px);
  // 16-bit little-endian samples; take channel 0 if multiple channels remain.
  const channels = Math.max(1, info.channels ?? 1);
  for (let i = 0; i < px; i++) out[i] = data.readUInt16LE(i * 2 * channels);
  return { data: out, width: info.width, height: info.height };
}

function applyZScale(hm: HeightMap, zScale: number): HeightMap {
  if (zScale === 1) return hm;
  const data = new Float32Array(hm.width * hm.height);
  for (let i = 0; i < data.length; i++) data[i] = Number(hm.data[i]) * zScale;
  return { data, width: hm.width, height: hm.height };
}

/** Candidate manifest paths for a result file (checked in order). Exported for tests. */
export function sidecarManifestCandidates(resultFilePath: string): string[] {
  const dir = path.dirname(resultFilePath);
  const base = path.basename(resultFilePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  return [
    path.join(dir, `${stem}.heightmap.json`), // board1.csv → board1.heightmap.json
    `${resultFilePath}.heightmap.json`, //         board1.csv → board1.csv.heightmap.json
  ];
}

/** Bare-CSV sidecar path (no manifest): `<stem>.heightmap.csv`. */
function sidecarBareCsv(resultFilePath: string): string {
  const dir = path.dirname(resultFilePath);
  const base = path.basename(resultFilePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  return path.join(dir, `${stem}.heightmap.csv`);
}

/** Derive pad geometry from canonical measurements' rawExtras.padBbox (bare-CSV fallback). */
function padsFromCanonicalBboxes(canonical: CanonicalInspection): PadGeometry[] {
  const out: PadGeometry[] = [];
  for (const m of canonical.measurements ?? []) {
    const padId = (m.pointCode ?? m.pointId ?? "").toString().trim();
    if (!padId) continue;
    const extras = (m.rawExtras ?? {}) as Record<string, unknown>;
    const bbox = parseBbox(extras.padBbox);
    if (!bbox) continue;
    const g: PadGeometry = { padId, bbox };
    const nh = num(extras.nominalHeight);
    const nv = num(extras.nominalVolume);
    const na = num(extras.nominalArea);
    if (nh != null && nh > 0) g.nominalHeight = nh;
    if (nv != null && nv > 0) g.nominalVolume = nv;
    if (na != null && na > 0) g.nominalArea = na;
    if (typeof extras.componentId === "string" && extras.componentId.trim()) {
      g.componentId = extras.componentId.trim();
    }
    out.push(g);
  }
  return out;
}

class FileHeightMapSource implements HeightMapSource {
  readonly kind = "file" as const;

  async probe(): Promise<HeightMapProbeResult> {
    return {
      kind: this.kind,
      available: true,
      detail:
        "Loads a depth sidecar dropped next to the result file: <stem>.heightmap.json " +
        "(manifest with inline data / csv / png16 refs + pad geometry) or a bare " +
        "<stem>.heightmap.csv grid (pads from measurement rawExtras.padBbox).",
    };
  }

  async acquire(ctx: HeightMapAcquireContext): Promise<HeightMapAcquisition | null> {
    const resultPath = ctx.resultFilePath?.trim();
    if (!resultPath) return null; // not a file-drop flow (e.g. direct API ingest)

    // (a) Manifest sidecar — the full-fidelity path.
    for (const manifestPath of sidecarManifestCandidates(resultPath)) {
      if (!fs.existsSync(manifestPath)) continue;
      return await this.loadFromManifest(manifestPath);
    }

    // (b) Bare CSV sidecar — pads must come from the canonical payload.
    const csvPath = sidecarBareCsv(resultPath);
    if (fs.existsSync(csvPath)) {
      const pads = padsFromCanonicalBboxes(ctx.canonical);
      if (pads.length === 0) {
        console.warn(
          `[heightMapSource] ${path.basename(csvPath)} found but no pad geometry ` +
            `(measurement rawExtras.padBbox) — skipping enrichment (honest pass-through).`,
        );
        return null;
      }
      const hm = parseCsvHeightMap(await fs.promises.readFile(csvPath, "utf8"));
      return {
        heightMap: hm,
        pads,
        calibration: parseCalibration(((ctx.canonical.rawExtras ?? {}) as Record<string, unknown>).spiCalibration),
        detail: `file: ${path.basename(csvPath)} (${hm.width}×${hm.height} CSV grid, pads from payload)`,
      };
    }

    return null; // no sidecar — normal
  }

  private async loadFromManifest(manifestPath: string): Promise<HeightMapAcquisition | null> {
    const dir = path.dirname(manifestPath);
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as HeightMapManifest;

    const pads: PadGeometry[] = [];
    for (const p of manifest.pads ?? []) {
      const padId = (p?.padId ?? "").toString().trim();
      const bbox = parseBbox(p?.bbox);
      if (!padId || !bbox) continue;
      const g: PadGeometry = { padId, bbox };
      if (num(p.nominalHeight) != null) g.nominalHeight = Number(p.nominalHeight);
      if (num(p.nominalVolume) != null) g.nominalVolume = Number(p.nominalVolume);
      if (num(p.nominalArea) != null) g.nominalArea = Number(p.nominalArea);
      if (typeof p.componentId === "string" && p.componentId.trim()) g.componentId = p.componentId.trim();
      pads.push(g);
    }
    if (pads.length === 0) {
      console.warn(`[heightMapSource] ${path.basename(manifestPath)}: no valid pads[] — skipping`);
      return null;
    }

    let hm: HeightMap;
    let detail: string;
    const zScale = num(manifest.zScale) ?? 1;
    if (Array.isArray(manifest.data) && manifest.width && manifest.height) {
      if (manifest.data.length !== manifest.width * manifest.height) {
        throw new Error("heightmap manifest: data length ≠ width×height");
      }
      hm = applyZScale(
        { data: manifest.data.map(Number), width: manifest.width, height: manifest.height },
        zScale,
      );
      detail = `file: ${path.basename(manifestPath)} (inline ${manifest.width}×${manifest.height})`;
    } else if (typeof manifest.csv === "string" && manifest.csv.trim()) {
      const csvPath = path.resolve(dir, manifest.csv.trim());
      hm = applyZScale(parseCsvHeightMap(await fs.promises.readFile(csvPath, "utf8")), zScale);
      detail = `file: ${path.basename(csvPath)} via manifest (${hm.width}×${hm.height} CSV)`;
    } else if (typeof manifest.png16 === "string" && manifest.png16.trim()) {
      // PNG16 stores raw DN — without an explicit zScale the µm unit would be
      // fabricated, so we honestly refuse instead of guessing.
      if (!(num(manifest.zScale) != null && Number(manifest.zScale) > 0)) {
        console.warn(
          `[heightMapSource] ${path.basename(manifestPath)}: png16 requires an explicit ` +
            `zScale (µm per DN) — skipping (no fabricated units).`,
        );
        return null;
      }
      const pngPath = path.resolve(dir, manifest.png16.trim());
      hm = applyZScale(await decodePng16(pngPath), zScale);
      detail = `file: ${path.basename(pngPath)} via manifest (${hm.width}×${hm.height} PNG16, zScale=${zScale})`;
    } else {
      console.warn(`[heightMapSource] ${path.basename(manifestPath)}: no data/csv/png16 — skipping`);
      return null;
    }

    const calibration: SpiCalibration = {};
    const kx = num(manifest.umPerPxX);
    const ky = num(manifest.umPerPxY);
    if (kx != null && kx > 0) calibration.umPerPxX = kx;
    if (ky != null && ky > 0) calibration.umPerPxY = ky;
    // zScale already applied above → the metrology must NOT re-apply it.

    return {
      heightMap: hm,
      pads,
      calibration: calibration.umPerPxX != null || calibration.umPerPxY != null ? calibration : null,
      thresholds: manifest.thresholds,
      detail,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3) device — documented stub (future structured-light camera binding)
// ════════════════════════════════════════════════════════════════════════════

class DeviceHeightMapSource implements HeightMapSource {
  readonly kind = "device" as const;

  async probe(): Promise<HeightMapProbeResult> {
    return {
      kind: this.kind,
      available: false,
      detail:
        "Native 3D camera binding NOT configured. Decision #7 committed the investment; " +
        "hardware (structured-light / point-cloud sensor) is still to be selected. " +
        "Bind the vendor SDK by implementing HeightMapSource behind this kind.",
    };
  }

  async acquire(_ctx: HeightMapAcquireContext): Promise<HeightMapAcquisition | null> {
    throw new HeightMapNotConfiguredError(
      "Height-map DEVICE source is a seam, not an implementation: no structured-light " +
        "camera SDK is bound (decision #7 — hardware selection pending). Implement " +
        "acquire() with the chosen vendor SDK (e.g. a GenTL/points-cloud grabber that " +
        "returns Z µm per pixel), or select HEIGHT_MAP_SOURCE=vendor-passthrough|file.",
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Registry + env selection
// ════════════════════════════════════════════════════════════════════════════

const registry = new Map<HeightMapSourceKind, () => HeightMapSource>([
  ["vendor-passthrough", () => new VendorPassthroughSource()],
  ["file", () => new FileHeightMapSource()],
  ["device", () => new DeviceHeightMapSource()],
]);

/** Register/override a source factory (a real device driver plugs in here). */
export function registerHeightMapSource(kind: HeightMapSourceKind, factory: () => HeightMapSource): void {
  registry.set(kind, factory);
}

/** Resolve + instantiate a source. Throws a clear Error for an unknown kind. */
export function getHeightMapSource(kind: HeightMapSourceKind): HeightMapSource {
  const factory = registry.get(kind);
  if (!factory) throw new Error(`No height-map source registered for kind "${kind}"`);
  return factory();
}

/** Discovery (UI/status): every kind + live availability. */
export async function listHeightMapSources(): Promise<HeightMapProbeResult[]> {
  const out: HeightMapProbeResult[] = [];
  for (const factory of registry.values()) {
    try {
      out.push(await factory().probe());
    } catch {
      /* a broken factory must not break listing */
    }
  }
  return out;
}

const KIND_VALUES: readonly HeightMapSourceKind[] = ["vendor-passthrough", "file", "device"];

/**
 * Env selection: HEIGHT_MAP_SOURCE_<MACHINE_CODE> (per machine) falls back to
 * HEIGHT_MAP_SOURCE (global, default "vendor-passthrough"). "off"/"none" disables.
 * Unknown values disable with a warning (fail-safe, never a crash).
 */
export function resolveHeightMapSourceKind(machineCode?: string | null): HeightMapSourceKind | null {
  const norm = (machineCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
  const perMachine = norm ? process.env[`HEIGHT_MAP_SOURCE_${norm}`] : undefined;
  const raw = (perMachine ?? process.env.HEIGHT_MAP_SOURCE ?? "vendor-passthrough").trim().toLowerCase();
  if (raw === "" || raw === "off" || raw === "none" || raw === "false") return null;
  if ((KIND_VALUES as readonly string[]).includes(raw)) return raw as HeightMapSourceKind;
  console.warn(`[heightMapSource] unknown HEIGHT_MAP_SOURCE value "${raw}" — height-map enrichment disabled`);
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// The ONE wiring helper (used by visionAdapterRouter.ingest + hotFolderService)
// ════════════════════════════════════════════════════════════════════════════

export interface HeightMapEnrichOutcome {
  canonical: CanonicalInspection;
  /** True only when native SPI metrics were actually computed + merged. */
  native: boolean;
  report: BoardSpiResult | null;
  sourceKind: HeightMapSourceKind | null;
  /** Why enrichment did not run (when native=false). */
  reason?: string;
}

/**
 * Flag-gated, fail-safe enrichment of a canonical inspection with native SPI
 * metrics computed from a height-map resolved through the seam.
 *
 *   SPI_3D_NATIVE_ENABLED off  → byte-for-byte pass-through (reason "flag_off").
 *   source disabled/unknown    → pass-through (reason "source_disabled").
 *   source has no height data  → pass-through (reason "no_height_data").
 *   ANY error                  → pass-through (reason "error: …") — ingest is
 *                                never blocked by 3D enrichment.
 */
export async function maybeEnrichCanonicalWithHeightMap(
  canonical: CanonicalInspection,
  opts: { machineCode?: string | null; resultFilePath?: string | null } = {},
): Promise<HeightMapEnrichOutcome> {
  if (!spi3dNativeEnabled()) {
    return { canonical, native: false, report: null, sourceKind: null, reason: "flag_off" };
  }
  const machineCode = opts.machineCode ?? canonical.machineCode ?? null;
  const kind = resolveHeightMapSourceKind(machineCode);
  if (!kind) {
    return { canonical, native: false, report: null, sourceKind: null, reason: "source_disabled" };
  }
  try {
    const source = getHeightMapSource(kind);
    const acq = await source.acquire({
      canonical,
      machineCode,
      resultFilePath: opts.resultFilePath ?? null,
    });
    if (!acq) {
      return { canonical, native: false, report: null, sourceKind: kind, reason: "no_height_data" };
    }
    const enriched = enrichCanonicalWithSpi3d(canonical, {
      heightMap: acq.heightMap,
      pads: acq.pads,
      calibration: acq.calibration,
      thresholds: acq.thresholds,
    });
    if (enriched.native) {
      console.log(
        `[heightMapSource] native SPI enrichment applied (${acq.detail}) — ` +
          `${enriched.report?.pads.length ?? 0} pad(s), board=${enriched.report?.boardResult}`,
      );
    }
    return {
      canonical: enriched.canonical,
      native: enriched.native,
      report: enriched.report,
      sourceKind: kind,
      reason: enriched.native ? undefined : "enrich_skipped",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[heightMapSource] enrichment failed (pass-through): ${msg}`);
    return { canonical, native: false, report: null, sourceKind: kind, reason: `error: ${msg}` };
  }
}
