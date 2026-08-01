/**
 * Task C6 — known payload field vocabularies per `Recipe.machineType`, so `RecipePayloadEditor` can
 * render TYPED inputs (number vs text, with a unit) for the fields a given automation/IoT machine
 * type actually understands, instead of forcing every payload edit through a raw key/value grid.
 *
 * Deliberately open-ended: only a few machine types have a known spec here (SCREWDRIVE — matches the
 * seeded `SCREWDRIVE-M4` recipe exactly, `ProductConfigStore.SeedRecipes` — and the two IoT types, per
 * `CONFIG_SYNC_SERVER_CONTRACT.md`'s "device_settings ↔ IoT" mapping). Any other machine type (or any
 * payload key not in that type's spec) still round-trips fine through `RecipePayloadEditor`'s generic
 * key/value rows — this file is a UX nicety for the common cases, not a schema the server enforces
 * (System A's `payload` column is `jsonb`, genuinely open-shape).
 */
export type PayloadFieldType = "number" | "text"

export interface RecipePayloadFieldSpec {
  key: string
  /** i18n key under `recipeConfigDetail.payload.fields.*`. */
  labelKey: string
  type: PayloadFieldType
  /** Short unit suffix shown next to the label (e.g. "rpm", "ms") — display-only, not sent on save. */
  unit?: string
}

const SCREWDRIVE_FIELDS: RecipePayloadFieldSpec[] = [
  { key: "speedRpm", labelKey: "recipeConfigDetail.payload.fields.speedRpm", type: "number", unit: "rpm" },
  { key: "angleTarget", labelKey: "recipeConfigDetail.payload.fields.angleTarget", type: "number", unit: "°" },
  { key: "torqueTarget", labelKey: "recipeConfigDetail.payload.fields.torqueTarget", type: "number" },
  { key: "torqueTolerance", labelKey: "recipeConfigDetail.payload.fields.torqueTolerance", type: "number" },
  { key: "torqueUnit", labelKey: "recipeConfigDetail.payload.fields.torqueUnit", type: "text" },
  { key: "screwCount", labelKey: "recipeConfigDetail.payload.fields.screwCount", type: "number" },
  { key: "clampTimeMs", labelKey: "recipeConfigDetail.payload.fields.clampTimeMs", type: "number", unit: "ms" },
]

const IOT_FIELDS: RecipePayloadFieldSpec[] = [
  { key: "sampleIntervalMs", labelKey: "recipeConfigDetail.payload.fields.sampleIntervalMs", type: "number", unit: "ms" },
  { key: "thresholdLow", labelKey: "recipeConfigDetail.payload.fields.thresholdLow", type: "number" },
  { key: "thresholdHigh", labelKey: "recipeConfigDetail.payload.fields.thresholdHigh", type: "number" },
]

const RECIPE_PAYLOAD_FIELD_SPECS: Record<string, RecipePayloadFieldSpec[]> = {
  SCREWDRIVE: SCREWDRIVE_FIELDS,
  IOT_SENSOR: IOT_FIELDS,
  IOT_GATEWAY: IOT_FIELDS,
}

/** Typed fields for a `machineType` (empty array — not "no fields at all" — for any type without a
 * known vocabulary above; those payloads are edited entirely through the generic key/value rows). */
export function getRecipePayloadFieldSpecs(machineType: string | null | undefined): RecipePayloadFieldSpec[] {
  if (!machineType) return []
  return RECIPE_PAYLOAD_FIELD_SPECS[machineType] ?? []
}
