/**
 * AOI-B — Golden-sample management service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Store / retrieve / list the "known-good" reference image per product / recipe
 * (optionally per station / ROI) used by sub-pixel registration
 * (imageRegistration.ts) before defect-diff.
 *
 * ENCODING (self-contained): an encoded reference (jpeg/png/…) is decoded once to a
 * GRAYSCALE RAW plane via sharp, optionally downscaled to `maxEdge` (default 512 —
 * AOI ROIs are small, keeps base64 compact), then base64-serialised together with
 * its width/height. Retrieval reconstructs the exact GrayImage — no filesystem or
 * blob store needed, so a reference round-trips through the DB text column intact.
 *
 * DB is OPTIONAL: `encodeReference` / `decodeReference` are pure (no DB) so tests
 * round-trip without provisioning. The DB-backed setReference/getReference/list
 * delegate to server/db/goldenSample.ts (getDb null-guarded — honest degradation).
 * ════════════════════════════════════════════════════════════════════════════
 */
import sharp from "sharp";
import type { GrayImage } from "./imageRegistration";
import {
  getActiveGoldenReference,
  setGoldenReference,
  listGoldenReferences,
  deactivateGoldenReference,
  insertDraftGoldenReference,
  approveGoldenReference,
  rejectGoldenReference,
  retireGoldenReference,
  setGoldenAlignBeforeDiff,
  getGoldenReferenceById,
  listGoldenReferencesForProduct,
  listReleaseGoldenRefs,
  type GoldenKey,
  type ProductGoldenFilter,
  type GoldenRefProvenance,
} from "../db/goldenSample";
import type { GoldenSampleReference } from "../../drizzle/schema";

export { GoldenSoDError, GoldenStatusError } from "../db/goldenSample";

/** Default longest-edge cap when storing a reference (perf + compact base64). */
const DEFAULT_MAX_EDGE = 512;

export interface EncodedReference {
  grayBase64: string;
  width: number;
  height: number;
  format: "gray-raw";
}

/**
 * Decode an encoded image → grayscale raw base64 payload (pure, no DB).
 * Downscales the longest edge to `maxEdge` (default 512) without enlarging.
 */
export async function encodeReference(
  image: Buffer,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<EncodedReference> {
  let pipe = sharp(image).grayscale();
  if (maxEdge > 0) {
    pipe = pipe.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  }
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  return {
    grayBase64: Buffer.from(data).toString("base64"),
    width: info.width,
    height: info.height,
    format: "gray-raw",
  };
}

/** Reconstruct a GrayImage from a stored base64 payload (pure, no DB). */
export function decodeReference(enc: EncodedReference): GrayImage {
  const data = Buffer.from(enc.grayBase64, "base64");
  return { data, width: enc.width, height: enc.height };
}

/** Directly build a GrayImage from an encoded image buffer (pure convenience). */
export async function referenceFromImage(
  image: Buffer,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<GrayImage> {
  return decodeReference(await encodeReference(image, maxEdge));
}

export interface SetReferenceInput extends GoldenKey {
  /** Encoded source image (jpeg/png/…). One of `image` or `encoded` is required. */
  image?: Buffer;
  /** Pre-encoded gray payload (skip decode). */
  encoded?: EncodedReference;
  /** Doc 31 PM5 — logical FK to product_models.id (rename-safe golden↔product link). */
  productModelId?: number | null;
  imageUrl?: string | null;
  notes?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
  createdBy?: number | null;
  maxEdge?: number;
}

/**
 * Store a new ACTIVE golden reference for a key (deactivates any prior active row,
 * bumps version). Requires a DB; throws via the DB layer when unavailable.
 */
export async function setReference(input: SetReferenceInput): Promise<GoldenSampleReference> {
  const enc = input.encoded ?? (input.image
    ? await encodeReference(input.image, input.maxEdge ?? DEFAULT_MAX_EDGE)
    : null);
  if (!enc) throw new Error("setReference requires `image` or `encoded`");
  return setGoldenReference({
    productCode: input.productCode ?? null,
    productModelId: input.productModelId ?? null,
    recipeCode: input.recipeCode ?? null,
    stationCode: input.stationCode ?? null,
    roiKey: input.roiKey ?? null,
    grayBase64: enc.grayBase64,
    width: enc.width,
    height: enc.height,
    format: enc.format,
    imageUrl: input.imageUrl ?? null,
    notes: input.notes ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
    createdBy: input.createdBy ?? null,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// W7-C (doc 27 §9 V11 + V8) — governed capture/approve lifecycle.
// Capture (upload / from-inspection) creates a DRAFT (never resolvable);
// a DIFFERENT user approves it (SoD in the DB layer) which atomically makes it
// the single active golden for its key. setReference above remains the legacy
// direct-activate path (tests/seeds only — routers expose ONLY this governed path).
// ════════════════════════════════════════════════════════════════════════════

export interface SubmitDraftInput extends SetReferenceInput {
  sourceInspectionId?: number | null;
  sourceMeasurementId?: number | null;
}

/** Encode + store a DRAFT golden for a key (status='draft', active=false). */
export async function submitDraft(input: SubmitDraftInput): Promise<GoldenSampleReference> {
  const enc = input.encoded ?? (input.image
    ? await encodeReference(input.image, input.maxEdge ?? DEFAULT_MAX_EDGE)
    : null);
  if (!enc) throw new Error("submitDraft requires `image` or `encoded`");
  return insertDraftGoldenReference({
    productCode: input.productCode ?? null,
    productModelId: input.productModelId ?? null,
    recipeCode: input.recipeCode ?? null,
    stationCode: input.stationCode ?? null,
    roiKey: input.roiKey ?? null,
    grayBase64: enc.grayBase64,
    width: enc.width,
    height: enc.height,
    format: enc.format,
    imageUrl: input.imageUrl ?? null,
    notes: input.notes ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
    createdBy: input.createdBy ?? null,
    sourceInspectionId: input.sourceInspectionId ?? null,
    sourceMeasurementId: input.sourceMeasurementId ?? null,
  });
}

/** Approve a draft (SoD: capturer ≠ approver) → becomes the active golden for its key. */
export async function approveReference(input: { id: number; approvedBy: number; note?: string | null }): Promise<GoldenSampleReference> {
  return approveGoldenReference(input);
}

/** Reject a draft (→ retired, never activated). */
export async function rejectReference(id: number, note?: string | null): Promise<GoldenSampleReference> {
  return rejectGoldenReference(id, note);
}

/** Retire an approved golden (→ retired, active=false; removed from resolution). */
export async function retireReference(id: number, note?: string | null): Promise<GoldenSampleReference> {
  return retireGoldenReference(id, note);
}

/** Toggle per-golden align-before-diff (V7). */
export async function setAlignBeforeDiff(id: number, enabled: boolean): Promise<GoldenSampleReference> {
  return setGoldenAlignBeforeDiff(id, enabled);
}

/** Fetch one reference row by id (null when missing / no DB). */
export async function getReferenceById(id: number): Promise<GoldenSampleReference | null> {
  return getGoldenReferenceById(id);
}

/**
 * Retrieve the ACTIVE reference for a key as a ready-to-use GrayImage (null when
 * none stored or no DB). This is what the registration pipeline consumes.
 * W7-C — only status='approved' rows resolve (enforced in getActiveGoldenReference);
 * grandfathered pre-0189 rows were backfilled to 'approved' so they keep working.
 */
export async function getReferenceGray(key: GoldenKey): Promise<{ gray: GrayImage; row: GoldenSampleReference } | null> {
  const row = await getActiveGoldenReference(key);
  if (!row) return null;
  const gray = decodeReference({
    grayBase64: row.grayBase64,
    width: row.width,
    height: row.height,
    format: "gray-raw",
  });
  return { gray, row };
}

/** Raw active-reference row (metadata) without decoding, or null. */
export async function getReferenceRow(key: GoldenKey): Promise<GoldenSampleReference | null> {
  return getActiveGoldenReference(key);
}

/**
 * Doc 31 PM5 / UX8 — a product's goldens (FK-linked, falling back to legacy
 * productCode). This is the per-product query the product-page panel consumes.
 */
export async function listByProduct(filter: ProductGoldenFilter): Promise<GoldenSampleReference[]> {
  return listGoldenReferencesForProduct(filter);
}

/**
 * OP7 (doc 31, decision #1) — active+approved golden provenance for a release
 * snapshot (audit-only; does NOT change machine diff resolution).
 */
export async function goldenRefsForRelease(opts: {
  productModelId: number;
  productCode?: string | null;
}): Promise<GoldenRefProvenance[]> {
  return listReleaseGoldenRefs(opts);
}

/** List stored references (optionally filtered). */
export async function listReferences(filter?: {
  productCode?: string | null;
  recipeCode?: string | null;
  activeOnly?: boolean;
  status?: string | null;
  limit?: number;
}): Promise<GoldenSampleReference[]> {
  return listGoldenReferences(filter ?? {});
}

/** Deactivate (soft-delete) a reference by id. */
export async function removeReference(id: number): Promise<void> {
  return deactivateGoldenReference(id);
}

// ════════════════════════════════════════════════════════════════════════════
// W5-B (doc 27 §5 gap F8) — operator-flow surfacing helpers (READ-ONLY).
// Display-only: fetch the ACTIVE golden for a key (with a product-level
// fallback) and render it as a browser-displayable PNG data URL. The full
// golden-diff pipeline (capture UI, approval workflow, normalize/align before
// diff) is Đợt 7.4 territory (gaps V7/V8) — deliberately NOT wired here.
// ════════════════════════════════════════════════════════════════════════════

export interface ResolvedGoldenReference {
  row: GoldenSampleReference;
  /** "exact" = full key matched; "product" = fell back to the product-level golden. */
  matchedLevel: "exact" | "product";
}

/**
 * Resolve the ACTIVE golden for a key. Tries the EXACT key first (unset fields
 * match NULL — same semantics as getActiveGoldenReference); when nothing is
 * stored for the exact key and the key was narrower than product-level,
 * optionally falls back to the product-level golden (productCode only).
 * Returns null when nothing matches (or no DB) — honest, no fabrication.
 */
export async function resolveActiveReference(
  key: GoldenKey,
  opts: { fallbackToProductLevel?: boolean } = {},
): Promise<ResolvedGoldenReference | null> {
  const exact = await getActiveGoldenReference(key);
  if (exact) return { row: exact, matchedLevel: "exact" };

  const fallback = opts.fallbackToProductLevel ?? true;
  const hadNarrowKey = key.recipeCode != null || key.stationCode != null || key.roiKey != null;
  if (fallback && hadNarrowKey && key.productCode != null) {
    const productLevel = await getActiveGoldenReference({ productCode: key.productCode });
    if (productLevel) return { row: productLevel, matchedLevel: "product" };
  }
  return null;
}

/**
 * Encode a stored reference's raw gray plane as a PNG data URL the browser can
 * render directly (references are ≤512px — payload stays small). Pure sharp
 * transform, no DB.
 */
export async function referenceThumbnailDataUrl(row: GoldenSampleReference): Promise<string> {
  const raw = Buffer.from(row.grayBase64, "base64");
  const png = await sharp(raw, { raw: { width: row.width, height: row.height, channels: 1 } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
