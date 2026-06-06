/**
 * P4.C G16 — Polymorphic inspection-type subform validators.
 *
 * `productInspections.variantPayload` is a JSONB blob whose shape depends on
 * `productInspections.inspectionType`. This module owns the type-keyed schemas
 * so callers don't have to reinvent validation per route. Schemas are zod and
 * intentionally permissive on unknown keys (`.passthrough()`) — we only enforce
 * the fields the business actually relies on.
 */
import { z } from "zod";

/** Canonical inspection-type discriminators. Extend as new variants are added. */
export const INSPECTION_TYPES = ["FAI", "IQC", "OQC", "AOI", "FCT", "ICT"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const inspectionTypeSchema = z.enum(INSPECTION_TYPES);

/** First-Article Inspection — sample of N units against drawing/spec. */
const faiPayloadSchema = z.object({
  drawingRev: z.string().min(1),
  sampleSize: z.number().int().positive(),
  approverId: z.union([z.number().int(), z.string()]).optional(),
  approverName: z.string().optional(),
  dimensions: z.array(z.object({
    label: z.string(),
    nominal: z.number(),
    measured: z.number(),
    tolPlus: z.number().nonnegative().optional(),
    tolMinus: z.number().nonnegative().optional(),
    pass: z.boolean().optional(),
  })).optional(),
  remarks: z.string().optional(),
}).passthrough();

/** Incoming Quality Control — supplier lot acceptance. */
const iqcPayloadSchema = z.object({
  supplierCode: z.string().min(1),
  supplierLot: z.string().min(1),
  poNumber: z.string().optional(),
  receivedQty: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  defectsFound: z.number().int().nonnegative().default(0),
  acceptanceLevel: z.string().optional(), // e.g. "AQL 1.0"
  disposition: z.enum(["ACCEPT", "REJECT", "REWORK", "QUARANTINE"]).optional(),
  certNumber: z.string().optional(),
  remarks: z.string().optional(),
}).passthrough();

/** Outgoing Quality Control — pre-shipment audit. */
const oqcPayloadSchema = z.object({
  customerCode: z.string().min(1),
  shipmentLot: z.string().min(1),
  poNumber: z.string().optional(),
  shippedQty: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  defectsFound: z.number().int().nonnegative().default(0),
  acceptanceLevel: z.string().optional(),
  disposition: z.enum(["ACCEPT", "REJECT", "REWORK", "HOLD"]).optional(),
  packingSpec: z.string().optional(),
  remarks: z.string().optional(),
}).passthrough();

/** AOI — Automated Optical Inspection result snapshot. */
const aoiPayloadSchema = z.object({
  recipeCode: z.string().optional(),
  recipeRev: z.string().optional(),
  totalPoints: z.number().int().nonnegative().optional(),
  okPoints: z.number().int().nonnegative().optional(),
  ngPoints: z.number().int().nonnegative().optional(),
  reinspectedBy: z.union([z.number().int(), z.string()]).optional(),
  defectCodes: z.array(z.string()).optional(),
}).passthrough();

/** Functional / In-Circuit Test — generic test bench result. */
const fctIctPayloadSchema = z.object({
  testProgramCode: z.string().optional(),
  testProgramRev: z.string().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  passedSteps: z.number().int().nonnegative().optional(),
  failedSteps: z.number().int().nonnegative().optional(),
  firstFailStep: z.string().optional(),
  fixtureId: z.string().optional(),
  measurements: z.array(z.object({
    name: z.string(),
    value: z.number(),
    unit: z.string().optional(),
    pass: z.boolean().optional(),
  })).optional(),
}).passthrough();

const SCHEMAS: Record<InspectionType, z.ZodTypeAny> = {
  FAI: faiPayloadSchema,
  IQC: iqcPayloadSchema,
  OQC: oqcPayloadSchema,
  AOI: aoiPayloadSchema,
  FCT: fctIctPayloadSchema,
  ICT: fctIctPayloadSchema,
};

export interface ValidatePayloadResult<T = unknown> {
  ok: boolean;
  data?: T;
  errors?: Array<{ path: string; message: string }>;
}

/**
 * Validate a `variantPayload` against its inspection-type schema.
 * Returns a structured result instead of throwing so callers can attach
 * field-level errors to their tRPC responses.
 */
export function validatePayload(
  inspectionType: string | null | undefined,
  payload: unknown,
): ValidatePayloadResult {
  if (!inspectionType) {
    // No discriminator → allow free-form payload (back-compat with rows
    // created before G16). Treat null/undefined payload as ok.
    if (payload === null || payload === undefined) return { ok: true, data: payload };
    if (typeof payload !== "object") {
      return { ok: false, errors: [{ path: "", message: "variantPayload must be an object when inspectionType is not set" }] };
    }
    return { ok: true, data: payload };
  }
  const upper = String(inspectionType).toUpperCase() as InspectionType;
  const schema = SCHEMAS[upper];
  if (!schema) {
    return {
      ok: false,
      errors: [{ path: "inspectionType", message: `Unknown inspection type "${inspectionType}". Known: ${INSPECTION_TYPES.join(", ")}` }],
    };
  }
  const parsed = schema.safeParse(payload ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

/** Convenience: list known types for UI dropdowns. */
export function listInspectionTypes(): InspectionType[] {
  return [...INSPECTION_TYPES];
}
