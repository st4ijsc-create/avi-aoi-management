/**
 * P4.C G20 — Specialized point-type subform validators.
 *
 * Each `measurementTypeCode` (free-text catalog code on
 * `measurement_point_defs.measurementTypeCode`) optionally maps to a Zod
 * schema describing structured `extraFields` for that point type.
 *
 * Conventions:
 *  - Codes are case-insensitive on the lookup side; we normalise to UPPER.
 *  - All schemas use `.passthrough()` so future fields don't break old data.
 *  - When no schema is registered for a code (or the point has no code),
 *    we accept any object as the payload (free-form).
 *  - `validateExtraFields(code, payload)` returns a normalised result so the
 *    router doesn't need to know Zod.
 */
import { z } from "zod";

// Built-in subform discriminators. UI registry binds these to React subforms.
export const MP_SUBFORM_TYPES = [
  "EDGE_BURR",        // CNC machined housings — edge / burr / chip-out
  "COSMETIC_DEFECT",  // Scratches / dents on visible surfaces
  "COLOR_GLOSS",      // Paint / anodise — L*a*b* + ΔE + gloss GU
  "ENGRAVING_MARK",   // Engraving / laser mark / OCR
  "GASKET_SEAL",      // Gasket / seal continuity
] as const;
export type MpSubformType = typeof MP_SUBFORM_TYPES[number];

// ---------- Per-type schemas ----------

const edgeBurrSchema = z.object({
  edgeType: z.enum(["INSIDE","OUTSIDE","CHAMFER","FILLET","DEBURR"]).optional(),
  maxBurrMm: z.number().nonnegative(),
  surfaceClass: z.enum(["A","B","C"]).optional(),
  chipOutMaxMm: z.number().nonnegative().optional(),
  inspectionMethod: z.enum(["VISUAL","CMM","PROFILOMETER","LASER"]).optional(),
  remarks: z.string().max(2000).optional(),
}).passthrough();

const cosmeticDefectSchema = z.object({
  zone: z.enum(["A","B","C"]),
  minLengthMm: z.number().nonnegative().optional(),
  maxLengthMm: z.number().positive(),
  maxDepthUm: z.number().nonnegative().optional(),
  maxAreaMm2: z.number().nonnegative().optional(),
  maxCount: z.number().int().nonnegative().optional(),
  defectType: z.enum(["SCRATCH","DENT","NICK","STAIN","DISCOLORATION","CONTAMINATION"]).optional(),
  viewingDistanceCm: z.number().positive().optional(),
  lightingLux: z.number().positive().optional(),
  remarks: z.string().max(2000).optional(),
}).passthrough();

const labSchema = z.object({
  L: z.number(),
  a: z.number(),
  b: z.number(),
});

const colorGlossSchema = z.object({
  labSpec: labSchema.optional(),
  deltaEMax: z.number().positive().optional(),
  deltaEFormula: z.enum(["CIE76","CIE94","CIEDE2000","CMC"]).optional(),
  glossGU: z.number().nonnegative().optional(),
  glossTolerance: z.number().nonnegative().optional(),
  glossAngleDeg: z.union([z.literal(20), z.literal(60), z.literal(85)]).optional(),
  illuminant: z.enum(["D65","D50","A","F2","F11"]).optional(),
  observerDeg: z.union([z.literal(2), z.literal(10)]).optional(),
  spectroId: z.string().max(100).optional(),
  remarks: z.string().max(2000).optional(),
}).passthrough();

const engravingMarkSchema = z.object({
  charHeightMm: z.number().positive(),
  charHeightTolMm: z.number().nonnegative().optional(),
  contrastPctMin: z.number().min(0).max(100).optional(),
  ocrConfidenceMin: z.number().min(0).max(1).optional(),
  fontFamily: z.string().max(100).optional(),
  expectedText: z.string().max(500).optional(),
  textRegex: z.string().max(500).optional(),
  markingMethod: z.enum(["LASER","INK","INKJET","STAMP","ENGRAVE","ETCH"]).optional(),
  decoderGrade: z.string().max(20).optional(), // e.g. "A","B","C" per ISO/IEC 15415
  remarks: z.string().max(2000).optional(),
}).passthrough();

const gasketSealSchema = z.object({
  continuityPct: z.number().min(0).max(100),
  minWidthMm: z.number().positive(),
  maxWidthMm: z.number().positive().optional(),
  minHeightMm: z.number().nonnegative().optional(),
  materialCode: z.string().max(50).optional(),
  inspectionMethod: z.enum(["VISUAL","VISION","LASER","PRESSURE_TEST"]).optional(),
  remarks: z.string().max(2000).optional(),
}).passthrough();

// ---------- Registry ----------

const SCHEMAS: Record<MpSubformType, z.ZodTypeAny> = {
  EDGE_BURR: edgeBurrSchema,
  COSMETIC_DEFECT: cosmeticDefectSchema,
  COLOR_GLOSS: colorGlossSchema,
  ENGRAVING_MARK: engravingMarkSchema,
  GASKET_SEAL: gasketSealSchema,
};

// ---------- Public API ----------

export interface SubformValidationOk {
  ok: true;
  data: Record<string, unknown>;
  knownType: boolean;
}
export interface SubformValidationErr {
  ok: false;
  errors: { path: string; message: string }[];
  knownType: boolean;
}
export type SubformValidationResult = SubformValidationOk | SubformValidationErr;

export function listMpSubformTypes(): { code: MpSubformType; description: string }[] {
  return [
    { code: "EDGE_BURR",       description: "CNC machined edge / burr / chip-out" },
    { code: "COSMETIC_DEFECT", description: "Cosmetic scratches / dents (zone-based)" },
    { code: "COLOR_GLOSS",     description: "Color (L*a*b*, ΔE) and gloss (GU)" },
    { code: "ENGRAVING_MARK",  description: "Engraving / laser mark / OCR-readable text" },
    { code: "GASKET_SEAL",     description: "Gasket / seal continuity and width" },
  ];
}

export function isKnownSubformType(code: string | null | undefined): code is MpSubformType {
  if (!code) return false;
  return (MP_SUBFORM_TYPES as readonly string[]).includes(code.toUpperCase());
}

/**
 * Validate `extraFields` for a measurement-point subform.
 *
 * - If `measurementTypeCode` is null/empty → free-form: any object accepted.
 * - If `measurementTypeCode` is registered → strict per-type validation.
 * - If `measurementTypeCode` is unknown → free-form (knownType=false), so
 *   custom downstream codes don't break the API.
 */
export function validateExtraFields(
  measurementTypeCode: string | null | undefined,
  payload: unknown,
): SubformValidationResult {
  // Default: must at least be an object (or null/undefined → empty object).
  const value = (payload === null || payload === undefined) ? {} : payload;
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      knownType: isKnownSubformType(measurementTypeCode ?? null),
      errors: [{ path: "(root)", message: "extraFields must be an object" }],
    };
  }

  if (!isKnownSubformType(measurementTypeCode ?? null)) {
    return { ok: true, data: value as Record<string, unknown>, knownType: false };
  }

  const schema = SCHEMAS[(measurementTypeCode as string).toUpperCase() as MpSubformType];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      knownType: true,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  return { ok: true, knownType: true, data: parsed.data as Record<string, unknown> };
}
