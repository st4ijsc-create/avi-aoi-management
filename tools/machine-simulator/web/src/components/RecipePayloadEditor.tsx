import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { getRecipePayloadFieldSpecs } from "@/lib/recipePayloadFields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/FormField"

interface PayloadRow {
  /** Stable React key independent of `key`'s TEXT so renaming/re-typing a generic row's key doesn't
   * remount the row (and drop focus mid-edit). */
  id: string
  key: string
  value: string
}

let rowIdSeq = 0
function nextRowId(): string {
  rowIdSeq += 1
  return `payload-row-${rowIdSeq}`
}

function stringifyPayloadValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  // Arbitrary jsonb (object/array) — not expected for a recipe payload per the contract's flat
  // key/value shape (`{speedRpm,angleTarget,...}`), but rendered as JSON text rather than silently
  // dropped so nothing is lost on save. Re-saving it back out makes it a JSON-text STRING value, not
  // its original shape — an acceptable edge case for a Demo authoring tool, not a real data path.
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function rowsFromPayload(payload: Record<string, unknown>): PayloadRow[] {
  return Object.entries(payload).map(([key, value]) => ({
    id: nextRowId(),
    key,
    value: stringifyPayloadValue(value),
  }))
}

/** Best-effort string→JSON-primitive coercion for the GENERIC key/value rows (payload keys with no
 * known typed spec) — `"true"/"false"` → boolean, a finite numeric string → number, anything else
 * stays a string. Typed fields (`getRecipePayloadFieldSpecs`) never go through this — their type is
 * spec-declared, not guessed. */
function coerceGenericValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true"
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return trimmed
}

/** Order-independent structural equality for two payload records — used by `RecipeConfigDetail` to
 * decide the dirty/clean indicator without caring about key insertion order. */
export function payloadsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const normalize = (p: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(p)
        .sort()
        .map((k) => [k, p[k]])
    )
  return normalize(a) === normalize(b)
}

export interface RecipePayloadEditorProps {
  /** The recipe FORM's currently-selected `machineType` (not necessarily the loaded record's saved
   * value — see `getRecipePayloadFieldSpecs`'s doc comment: switching this only changes which rows
   * render as "typed" vs "other" below, it never drops a row's data). */
  machineType: string | null
  /** Seeds this editor's local row state ONCE on mount — like `ProductFormFields`'/`PointForm`'s own
   * string-keyed form state, this is intentionally NOT a fully-controlled `value` prop (a controlled
   * numeric `<input>` round-tripped through a coerced `number` would clobber an in-progress "-" or
   * trailing "." while typing). Callers that need to reset it for a DIFFERENT record remount this
   * component via `key` — `RecipeConfigDetail.tsx` gets that for free from its own outer `key={code}`. */
  initialPayload: Record<string, unknown>
  onChange: (payload: Record<string, unknown>) => void
  idPrefix: string
}

/**
 * Task C6 — the recipe payload (System A, `machine_recipes.payload` jsonb) editor: known-shape fields
 * for machine types with a typed vocabulary (`recipePayloadFields.ts`) rendered as real number/text
 * inputs, plus a generic add/remove key-value grid underneath for anything else — so an arbitrary
 * payload key (any machine type, any future field the server adds) always stays editable even without
 * a typed spec for it.
 */
export function RecipePayloadEditor({ machineType, initialPayload, onChange, idPrefix }: RecipePayloadEditorProps) {
  const t = useT()
  const gloss = useGloss()
  const [rows, setRows] = React.useState<PayloadRow[]>(() => rowsFromPayload(initialPayload))
  const [newKey, setNewKey] = React.useState("")
  const [newValue, setNewValue] = React.useState("")
  const [addError, setAddError] = React.useState<string | null>(null)

  const specs = getRecipePayloadFieldSpecs(machineType)
  const specKeys = React.useMemo(() => new Set(specs.map((s) => s.key)), [specs])

  function emit(nextRows: PayloadRow[]) {
    setRows(nextRows)
    const payload: Record<string, unknown> = {}
    for (const row of nextRows) {
      const key = row.key.trim()
      if (!key || row.value.trim() === "") continue
      const spec = specs.find((s) => s.key === key)
      if (spec?.type === "number") {
        const n = Number(row.value)
        if (Number.isFinite(n)) payload[key] = n // non-finite (mid-typed "-", garbage) silently omitted, not saved as NaN/null
      } else if (spec) {
        payload[key] = row.value
      } else {
        payload[key] = coerceGenericValue(row.value)
      }
    }
    onChange(payload)
  }

  function setTypedValue(key: string, value: string) {
    const existing = rows.find((r) => r.key === key)
    emit(existing ? rows.map((r) => (r.key === key ? { ...r, value } : r)) : [...rows, { id: nextRowId(), key, value }])
  }

  function setExtraValue(id: string, value: string) {
    emit(rows.map((r) => (r.id === id ? { ...r, value } : r)))
  }

  function removeRow(id: string) {
    emit(rows.filter((r) => r.id !== id))
  }

  function handleAdd() {
    const key = newKey.trim()
    if (!key) {
      setAddError(t("recipeConfigDetail.payload.addKeyRequired"))
      return
    }
    if (rows.some((r) => r.key === key)) {
      setAddError(t("recipeConfigDetail.payload.addKeyDuplicate", { key }))
      return
    }
    setAddError(null)
    emit([...rows, { id: nextRowId(), key, value: newValue }])
    setNewKey("")
    setNewValue("")
  }

  const extraRows = rows.filter((r) => !specKeys.has(r.key))

  return (
    <div className="flex flex-col gap-5">
      {specs.length > 0 ? (
        <div className="flex flex-col gap-4">
          <span className="flex flex-col gap-0">
            <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {t("recipeConfigDetail.payload.typedTitle")}
            </h3>
            <span className="hmi-micro" aria-hidden="true">
              {gloss("recipeConfigDetail.payload.typedTitle")}
            </span>
          </span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {specs.map((spec) => {
              const row = rows.find((r) => r.key === spec.key)
              const fieldId = `${idPrefix}-payload-${spec.key}`
              return (
                <FormField
                  key={spec.key}
                  label={spec.unit ? `${t(spec.labelKey)} (${spec.unit})` : t(spec.labelKey)}
                  htmlFor={fieldId}
                >
                  <Input
                    id={fieldId}
                    type={spec.type === "number" ? "number" : "text"}
                    inputMode={spec.type === "number" ? "decimal" : undefined}
                    value={row?.value ?? ""}
                    onChange={(e) => setTypedValue(spec.key, e.target.value)}
                  />
                </FormField>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <span className="flex flex-col gap-0">
          <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            {t("recipeConfigDetail.payload.otherTitle")}
          </h3>
          <span className="hmi-micro" aria-hidden="true">
            {gloss("recipeConfigDetail.payload.otherTitle")}
          </span>
        </span>
        {extraRows.length === 0 ? (
          <p className="text-sm text-text-muted">{t("recipeConfigDetail.payload.otherEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {extraRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <span
                  className="font-mono w-40 shrink-0 truncate border border-border-strong bg-surface-muted px-2.5 py-1 text-xs text-text-strong"
                  title={row.key}
                >
                  {row.key}
                </span>
                <Input
                  value={row.value}
                  onChange={(e) => setExtraValue(row.id, e.target.value)}
                  aria-label={t("recipeConfigDetail.payload.otherValueAria", { key: row.key })}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRow(row.id)}
                  aria-label={t("recipeConfigDetail.payload.otherRemoveAria", { key: row.key })}
                >
                  <Trash2 className="size-3.5 text-danger-text" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border border-dashed border-border-strong p-3">
          <FormField
            label={t("recipeConfigDetail.payload.addKeyLabel")}
            htmlFor={`${idPrefix}-payload-new-key`}
            className="w-40"
          >
            <Input
              id={`${idPrefix}-payload-new-key`}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={t("recipeConfigDetail.payload.addKeyPlaceholder")}
            />
          </FormField>
          <FormField
            label={t("recipeConfigDetail.payload.addValueLabel")}
            htmlFor={`${idPrefix}-payload-new-value`}
            className="min-w-40 flex-1"
          >
            <Input
              id={`${idPrefix}-payload-new-value`}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t("recipeConfigDetail.payload.addValuePlaceholder")}
            />
          </FormField>
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("recipeConfigDetail.payload.addBtn")}
          </Button>
        </div>
        {addError ? (
          <p role="alert" className="text-xs text-danger-text">
            {addError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
