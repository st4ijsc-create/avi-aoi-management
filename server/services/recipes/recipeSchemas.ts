/**
 * doc 56 Đ4 — Typed recipe schemas (CONFIG-SYNC governance) + guardrail mapping.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * machine_recipes.payload is an untyped `jsonb` bag. This module gives it a TYPED
 * shape PER machine family (a zod discriminated union on `kind`), so a recipe can
 * be VALIDATED at authoring (recipes.create) and at sign-off (recipes.approve).
 *
 * MODE (RECIPE_TYPED_SCHEMA_MODE, default 'off'):
 *   off     — do NOT validate (byte-identical to pre-Đ4; the bag stays untyped).
 *   log     — validate + warn on mismatch, but ACCEPT (measure the dirty rate).
 *   enforce — REJECT a payload that does not match its machine-type schema.
 *
 * A machineType with NO typed schema (e.g. AOI/AVI/ICT) always passes — this layer
 * governs the automation families that carry structured setpoints. `.passthrough()`
 * keeps unknown keys (machines send extra fields) — only the KNOWN keys are typed.
 *
 * GUARDRAIL MAPPING (CONFIG-SYNC-5): each typed field that is a physical setpoint
 * maps to a parameter_guardrails.param_key, so recipes.approve can check the value
 * against the engineer's hard min–max range (parameterGuardrailService) and block a
 * sign-off that would ship an out-of-range setpoint. The mapping is data (exported +
 * unit-tested) so it can be tuned without touching the approve path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";

export type RecipeTypedSchemaMode = "off" | "log" | "enforce";

/** Validation mode, read at call time (tests flip it; no redeploy). Default 'off'. */
export function recipeTypedSchemaMode(): RecipeTypedSchemaMode {
  const v = String(process.env.RECIPE_TYPED_SCHEMA_MODE ?? "").trim().toLowerCase();
  if (v === "log") return "log";
  if (v === "enforce") return "enforce";
  return "off";
}

export const RECIPE_KINDS = ["screw_program", "dispense_program", "weld_profile", "iot_settings"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

/**
 * machineType → recipe kind. Only families that carry structured setpoints appear;
 * any other machineType has NO typed schema (validation is a no-op for it).
 */
export const MACHINE_TYPE_TO_RECIPE_KIND: Record<string, RecipeKind> = {
  SCREWDRIVE: "screw_program",
  DISPENSING: "dispense_program",
  WELDER: "weld_profile",
  IOT_SENSOR: "iot_settings",
  IOT_GATEWAY: "iot_settings",
};

// ── per-kind field shapes (no `kind` — used for validation-by-machineType) ─────

const screwProgramShape = {
  torqueTarget: z.number().positive(),
  torqueTolerance: z.number().nonnegative(),
  angleTarget: z.number().positive().optional(),
  speedRpm: z.number().positive().optional(),
  sequence: z
    .array(
      z.object({
        step: z.number().int().nonnegative(),
        torque: z.number().optional(),
        angle: z.number().optional(),
      }),
    )
    .optional(),
} as const;

const dispenseProgramShape = {
  volumeTarget: z.number().positive(),
  pressure: z.number().nonnegative(),
  speed: z.number().positive().optional(),
  temperature: z.number().optional(),
} as const;

const weldProfileShape = {
  current: z.number().positive(),
  time: z.number().positive(),
  tempMax: z.number().positive(),
  voltage: z.number().positive().optional(),
} as const;

const iotSettingsShape = {
  sampleRateHz: z.number().positive().optional(),
  reportIntervalSec: z.number().positive().optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
} as const;

/** Per-kind object schemas (unknown keys kept). Keyed for validation-by-machineType. */
export const RECIPE_PAYLOAD_SCHEMAS: Record<RecipeKind, z.ZodTypeAny> = {
  screw_program: z.object(screwProgramShape).passthrough(),
  dispense_program: z.object(dispenseProgramShape).passthrough(),
  weld_profile: z.object(weldProfileShape).passthrough(),
  iot_settings: z.object(iotSettingsShape).passthrough(),
};

/**
 * Discriminated union on `kind` — for callers/tests that carry an explicit tag
 * inside the payload. (The authoring path validates by machineType via
 * RECIPE_PAYLOAD_SCHEMAS, which does not require a `kind` field in the bag.)
 */
export const recipePayloadUnion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screw_program"), ...screwProgramShape }).passthrough(),
  z.object({ kind: z.literal("dispense_program"), ...dispenseProgramShape }).passthrough(),
  z.object({ kind: z.literal("weld_profile"), ...weldProfileShape }).passthrough(),
  z.object({ kind: z.literal("iot_settings"), ...iotSettingsShape }).passthrough(),
]);

/** The typed schema for a machineType, or null when the family has no typed recipe. */
export function schemaForMachineType(machineType: string | null | undefined): z.ZodTypeAny | null {
  if (!machineType) return null;
  const kind = MACHINE_TYPE_TO_RECIPE_KIND[machineType];
  return kind ? RECIPE_PAYLOAD_SCHEMAS[kind] : null;
}

export interface RecipeValidationResult {
  ok: boolean;
  /** The kind the machineType mapped to (null ⇒ no typed schema applied). */
  kind: RecipeKind | null;
  errors: string[];
}

/**
 * Validate a recipe payload for its machineType under the current mode.
 *   • mode 'off'           → always ok (no validation).
 *   • machineType untyped  → always ok (nothing to validate).
 *   • otherwise            → zod safeParse; ok reflects success, errors are flat.
 * The CALLER decides what ok=false means (log-mode warns + accepts; enforce rejects).
 */
export function validateRecipePayload(
  machineType: string | null | undefined,
  payload: unknown,
  mode: RecipeTypedSchemaMode = recipeTypedSchemaMode(),
): RecipeValidationResult {
  if (mode === "off") return { ok: true, kind: null, errors: [] };
  const kind = machineType ? MACHINE_TYPE_TO_RECIPE_KIND[machineType] ?? null : null;
  if (!kind) return { ok: true, kind: null, errors: [] };
  const res = RECIPE_PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (res.success) return { ok: true, kind, errors: [] };
  const errors = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, kind, errors };
}

// ── guardrail mapping (CONFIG-SYNC-5) ──────────────────────────────────────────

/**
 * Typed setpoint field → parameter_guardrails.param_key. Only PHYSICAL setpoints
 * that an engineer would bound appear (a tolerance/interval is not range-gated
 * here). Tune freely — this is data, not control flow.
 */
export const RECIPE_GUARDRAIL_KEY_MAP: Record<RecipeKind, Record<string, string>> = {
  screw_program: { torqueTarget: "torque_nm", angleTarget: "angle_deg", speedRpm: "speed_rpm" },
  dispense_program: { volumeTarget: "volume_ml", pressure: "pressure_kpa", temperature: "temp_c", speed: "speed_mm_s" },
  weld_profile: { current: "weld_current_a", time: "weld_time_ms", tempMax: "temp_c", voltage: "weld_voltage_v" },
  iot_settings: { sampleRateHz: "sample_rate_hz", reportIntervalSec: "report_interval_sec" },
};

/**
 * Extract the (paramKey, value) pairs a recipe payload should be guardrail-checked
 * against, for its machineType. Only finite NUMERIC fields present in the payload
 * are returned. Empty when the machineType has no typed schema (nothing to map).
 */
export function guardrailParamsFor(
  machineType: string | null | undefined,
  payload: unknown,
): Array<{ paramKey: string; value: number }> {
  const kind = machineType ? MACHINE_TYPE_TO_RECIPE_KIND[machineType] ?? null : null;
  if (!kind || !payload || typeof payload !== "object") return [];
  const map = RECIPE_GUARDRAIL_KEY_MAP[kind];
  const out: Array<{ paramKey: string; value: number }> = [];
  for (const [field, paramKey] of Object.entries(map)) {
    const v = (payload as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isFinite(v)) out.push({ paramKey, value: v });
  }
  return out;
}
