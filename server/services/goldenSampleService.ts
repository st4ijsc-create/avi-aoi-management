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
  type GoldenKey,
} from "../db/goldenSample";
import type { GoldenSampleReference } from "../../drizzle/schema";

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

/**
 * Retrieve the ACTIVE reference for a key as a ready-to-use GrayImage (null when
 * none stored or no DB). This is what the registration pipeline consumes.
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

/** List stored references (optionally filtered). */
export async function listReferences(filter?: {
  productCode?: string | null;
  recipeCode?: string | null;
  activeOnly?: boolean;
  limit?: number;
}): Promise<GoldenSampleReference[]> {
  return listGoldenReferences(filter ?? {});
}

/** Deactivate (soft-delete) a reference by id. */
export async function removeReference(id: number): Promise<void> {
  return deactivateGoldenReference(id);
}
