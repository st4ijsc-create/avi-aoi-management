import * as React from "react"
import {
  Box,
  Info,
  Image as ImageIcon,
  Loader2,
  MousePointerClick,
  Move,
  Plus,
  Ruler,
  Save,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  useSavePoint,
  type LightingShot,
  type MeasurementPoint,
  type MeasurementType,
  type PointShape,
  type ProductModel,
  type ToleranceMode,
} from "@/lib/configApi"
import { cn } from "@/lib/utils"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"
import { FormField } from "@/components/FormField"
import { ProductImageThumb } from "@/components/ProductImageThumb"

const MEASUREMENT_TYPES: MeasurementType[] = ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]
const TOLERANCE_MODES: ToleranceMode[] = ["min_only", "max_only", "range", "bilateral"]
const SHAPES: PointShape[] = ["circle", "rect", "polygon", "line", "ring", "mask", "array"]
const TOLERANCE_NONE = "__none__"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const TEXTAREA_CLASS =
  "w-full min-w-0 border border-border-strong bg-surface-muted px-2.5 py-1.5 text-sm text-text-body transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"

/** Prefills a brand-new point's normalized position from a `BoardCanvas` click (or the header
 * "+ Add point" button's center default) — `PointsEditor.tsx`'s seam into this form. */
export interface NewPointSeed {
  normalizedX: number
  normalizedY: number
  orderIndex: number
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n)
}

function strToNum(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function intOrNull(raw: string): number | null {
  const n = strToNum(raw)
  return n == null ? null : Math.trunc(n)
}

function jsonToText(value: unknown): string {
  return value == null ? "" : JSON.stringify(value, null, 2)
}

// I-14 (branch-review) — a per-row REACT-ONLY identity, never sent to the server (the submit mapping
// below lists every wire field explicitly, so `_key` is dropped on save automatically). `shotIndex`
// itself can't serve as the list key: it's just a user-facing ordinal seeded from `form.lighting.length`
// at add-time, so removing shot 0 and then adding a new one re-mints the SAME `shotIndex` the removed
// row had, and it isn't rendered as an editable field either (nothing keeps it unique across edits).
// Using array `index` as the key had the concrete bug this fixes: deleting shot 1 of 3 shifted every
// row after it up by one array position, so React matched the OLD index-2 DOM node (inputs, focus,
// open/closed state) to the NEW row 1's data instead of unmounting the removed row — visible as focus
// landing on the wrong shot's field and uncontrolled input state bleeding across rows.
let lightingKeySeq = 0
function nextLightingKey(): string {
  lightingKeySeq += 1
  return `lighting-${lightingKeySeq}`
}

interface LightingShotFormValues {
  _key: string
  shotIndex: string
  name: string
  lightSource: string
  color: string
  colorHex: string
  intensityPct: string
  angleDeg: string
  exposureUs: string
  gain: string
  focusOffsetUm: string
  opticalFilter: string
  purpose: string
}

function blankLighting(index: number): LightingShotFormValues {
  return {
    _key: nextLightingKey(),
    shotIndex: String(index),
    name: "",
    lightSource: "",
    color: "",
    colorHex: "",
    intensityPct: "",
    angleDeg: "",
    exposureUs: "",
    gain: "",
    focusOffsetUm: "",
    opticalFilter: "",
    purpose: "",
  }
}

function lightingToForm(shot: LightingShot): LightingShotFormValues {
  return {
    _key: nextLightingKey(),
    shotIndex: String(shot.shotIndex),
    name: shot.name ?? "",
    lightSource: shot.lightSource ?? "",
    color: shot.color ?? "",
    colorHex: shot.colorHex ?? "",
    intensityPct: numToStr(shot.intensityPct),
    angleDeg: numToStr(shot.angleDeg),
    exposureUs: numToStr(shot.exposureUs),
    gain: numToStr(shot.gain),
    focusOffsetUm: numToStr(shot.focusOffsetUm),
    opticalFilter: shot.opticalFilter ?? "",
    purpose: shot.purpose ?? "",
  }
}

interface PointFormValues {
  code: string
  name: string
  description: string
  measurementType: MeasurementType
  measurementTypeCode: string
  unit: string
  orderIndex: string
  isActive: boolean

  nominalValue: string
  lowerLimit: string
  upperLimit: string
  toleranceMode: ToleranceMode | ""
  tolPlus: string
  tolMinus: string

  positionX: string
  positionY: string
  normalizedX: string
  normalizedY: string
  radius: string
  normalizedRadius: string
  cropWidth: string
  cropHeight: string
  shape: PointShape
  geometryText: string

  positionZ: string
  heightMin: string
  heightMax: string
  heightNominal: string
  heightUnit: string
  areaMin: string
  areaMax: string
  areaNominal: string
  areaUnit: string
  volumeMin: string
  volumeMax: string
  volumeNominal: string
  volumeUnit: string
  coplanarityMax: string
  warpageMax: string
  voidPctMax: string
  offsetXMax: string
  offsetYMax: string
  tiltMax: string
  thicknessMin: string
  thicknessMax: string
  criteriaText: string

  referenceImageUrl: string
  lighting: LightingShotFormValues[]
}

function toFormValues(point: MeasurementPoint | null, seed: NewPointSeed | null, product: ProductModel): PointFormValues {
  if (point) {
    return {
      code: point.code,
      name: point.name,
      description: point.description ?? "",
      measurementType: point.measurementType,
      measurementTypeCode: point.measurementTypeCode ?? "",
      unit: point.unit ?? "",
      orderIndex: String(point.orderIndex),
      isActive: point.isActive,
      nominalValue: numToStr(point.nominalValue),
      lowerLimit: numToStr(point.lowerLimit),
      upperLimit: numToStr(point.upperLimit),
      toleranceMode: point.toleranceMode ?? "",
      tolPlus: numToStr(point.tolPlus),
      tolMinus: numToStr(point.tolMinus),
      positionX: numToStr(point.positionX),
      positionY: numToStr(point.positionY),
      normalizedX: numToStr(point.normalizedX),
      normalizedY: numToStr(point.normalizedY),
      radius: numToStr(point.radius),
      normalizedRadius: numToStr(point.normalizedRadius),
      cropWidth: numToStr(point.cropWidth),
      cropHeight: numToStr(point.cropHeight),
      shape: point.shape,
      geometryText: jsonToText(point.geometry),
      positionZ: numToStr(point.positionZ),
      heightMin: numToStr(point.heightMin),
      heightMax: numToStr(point.heightMax),
      heightNominal: numToStr(point.heightNominal),
      heightUnit: point.heightUnit ?? "",
      areaMin: numToStr(point.areaMin),
      areaMax: numToStr(point.areaMax),
      areaNominal: numToStr(point.areaNominal),
      areaUnit: point.areaUnit ?? "",
      volumeMin: numToStr(point.volumeMin),
      volumeMax: numToStr(point.volumeMax),
      volumeNominal: numToStr(point.volumeNominal),
      volumeUnit: point.volumeUnit ?? "",
      coplanarityMax: numToStr(point.coplanarityMax),
      warpageMax: numToStr(point.warpageMax),
      voidPctMax: numToStr(point.voidPctMax),
      offsetXMax: numToStr(point.offsetXMax),
      offsetYMax: numToStr(point.offsetYMax),
      tiltMax: numToStr(point.tiltMax),
      thicknessMin: numToStr(point.thicknessMin),
      thicknessMax: numToStr(point.thicknessMax),
      criteriaText: jsonToText(point.criteria),
      referenceImageUrl: point.referenceImageUrl ?? "",
      lighting: point.lighting.map(lightingToForm),
    }
  }

  const nx = seed?.normalizedX ?? 0.5
  const ny = seed?.normalizedY ?? 0.5
  const positionX = product.imageWidth ? nx * product.imageWidth : 0
  const positionY = product.imageHeight ? ny * product.imageHeight : 0

  return {
    code: "",
    name: "",
    description: "",
    measurementType: "DIMENSION",
    measurementTypeCode: "",
    unit: "",
    orderIndex: String(seed?.orderIndex ?? 0),
    isActive: true,
    nominalValue: "",
    lowerLimit: "",
    upperLimit: "",
    toleranceMode: "",
    tolPlus: "",
    tolMinus: "",
    positionX: String(Math.round(positionX * 100) / 100),
    positionY: String(Math.round(positionY * 100) / 100),
    normalizedX: String(Math.round(nx * 1000) / 1000),
    normalizedY: String(Math.round(ny * 1000) / 1000),
    radius: "",
    normalizedRadius: "",
    cropWidth: "",
    cropHeight: "",
    shape: "circle",
    geometryText: "",
    positionZ: "",
    heightMin: "",
    heightMax: "",
    heightNominal: "",
    heightUnit: "",
    areaMin: "",
    areaMax: "",
    areaNominal: "",
    areaUnit: "",
    volumeMin: "",
    volumeMax: "",
    volumeNominal: "",
    volumeUnit: "",
    coplanarityMax: "",
    warpageMax: "",
    voidPctMax: "",
    offsetXMax: "",
    offsetYMax: "",
    tiltMax: "",
    thicknessMin: "",
    thicknessMax: "",
    criteriaText: "",
    referenceImageUrl: "",
    lighting: [],
  }
}

type BuildResult = { ok: true; point: MeasurementPoint } | { ok: false; errors: Record<string, string> }

function buildPayload(
  form: PointFormValues,
  base: MeasurementPoint | null,
  isNew: boolean,
  existingCodes: Set<string>,
  t: (key: string, vars?: Record<string, string | number>) => string
): BuildResult {
  const errors: Record<string, string> = {}
  const trimmedCode = form.code.trim()
  const trimmedName = form.name.trim()

  if (!trimmedCode) errors.code = t("pointsEditor.form.codeRequired")
  else if (isNew && existingCodes.has(trimmedCode.toLowerCase())) {
    errors.code = t("pointsEditor.form.codeDuplicate", { code: trimmedCode })
  }
  if (!trimmedName) errors.name = t("pointsEditor.form.nameRequired")

  const lower = strToNum(form.lowerLimit)
  const upper = strToNum(form.upperLimit)
  const nominal = strToNum(form.nominalValue)
  const orderBroken =
    (lower != null && upper != null && lower > upper) ||
    (lower != null && nominal != null && lower > nominal) ||
    (nominal != null && upper != null && nominal > upper)
  if (orderBroken) errors.limits = t("pointsEditor.form.limits.orderError")

  const nx = strToNum(form.normalizedX)
  const ny = strToNum(form.normalizedY)
  const nr = strToNum(form.normalizedRadius)
  if (nx != null && (nx < 0 || nx > 1)) errors.normalizedX = t("pointsEditor.form.position.normalizedRangeError")
  if (ny != null && (ny < 0 || ny > 1)) errors.normalizedY = t("pointsEditor.form.position.normalizedRangeError")
  if (nr != null && (nr < 0 || nr > 1)) errors.normalizedRadius = t("pointsEditor.form.position.normalizedRangeError")

  let geometry: unknown = base?.geometry
  if (form.geometryText.trim()) {
    try {
      geometry = JSON.parse(form.geometryText)
    } catch {
      errors.geometry = t("pointsEditor.form.position.geometryInvalid")
    }
  } else {
    geometry = undefined
  }

  let criteria: unknown = base?.criteria
  if (form.criteriaText.trim()) {
    try {
      criteria = JSON.parse(form.criteriaText)
    } catch {
      errors.criteria = t("pointsEditor.form.threeD.criteriaInvalid")
    }
  } else {
    criteria = undefined
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const point: MeasurementPoint = {
    code: trimmedCode,
    name: trimmedName,
    description: form.description.trim() || null,
    measurementType: form.measurementType,
    measurementTypeCode: form.measurementTypeCode.trim() || null,
    unit: form.unit.trim() || null,
    lowerLimit: lower,
    upperLimit: upper,
    nominalValue: nominal,
    toleranceMode: form.toleranceMode === "" ? null : form.toleranceMode,
    tolPlus: strToNum(form.tolPlus),
    tolMinus: strToNum(form.tolMinus),
    positionX: strToNum(form.positionX) ?? 0,
    positionY: strToNum(form.positionY) ?? 0,
    radius: strToNum(form.radius),
    normalizedX: nx,
    normalizedY: ny,
    normalizedRadius: strToNum(form.normalizedRadius),
    cropWidth: intOrNull(form.cropWidth),
    cropHeight: intOrNull(form.cropHeight),
    orderIndex: intOrNull(form.orderIndex) ?? 0,
    isActive: form.isActive,
    shape: form.shape,
    geometry,
    cells: base?.cells,
    positionZ: strToNum(form.positionZ),
    heightMin: strToNum(form.heightMin),
    heightMax: strToNum(form.heightMax),
    heightNominal: strToNum(form.heightNominal),
    heightUnit: form.heightUnit.trim() || null,
    areaMin: strToNum(form.areaMin),
    areaMax: strToNum(form.areaMax),
    areaNominal: strToNum(form.areaNominal),
    areaUnit: form.areaUnit.trim() || null,
    volumeMin: strToNum(form.volumeMin),
    volumeMax: strToNum(form.volumeMax),
    volumeNominal: strToNum(form.volumeNominal),
    volumeUnit: form.volumeUnit.trim() || null,
    coplanarityMax: strToNum(form.coplanarityMax),
    warpageMax: strToNum(form.warpageMax),
    voidPctMax: strToNum(form.voidPctMax),
    offsetXMax: strToNum(form.offsetXMax),
    offsetYMax: strToNum(form.offsetYMax),
    tiltMax: strToNum(form.tiltMax),
    thicknessMin: strToNum(form.thicknessMin),
    thicknessMax: strToNum(form.thicknessMax),
    criteria,
    lighting: form.lighting.map((shot) => ({
      shotIndex: intOrNull(shot.shotIndex) ?? 0,
      name: shot.name.trim() || null,
      lightSource: shot.lightSource.trim() || null,
      color: shot.color.trim() || null,
      colorHex: shot.colorHex.trim() || null,
      intensityPct: strToNum(shot.intensityPct),
      angleDeg: strToNum(shot.angleDeg),
      exposureUs: strToNum(shot.exposureUs),
      gain: strToNum(shot.gain),
      focusOffsetUm: strToNum(shot.focusOffsetUm),
      opticalFilter: shot.opticalFilter.trim() || null,
      purpose: shot.purpose.trim() || null,
    })),
    lastModifiedAt: base?.lastModifiedAt ?? null,
    referenceImageUrl: form.referenceImageUrl.trim() || null,
    deletedAt: base?.deletedAt ?? null,
    deletedAtVersion: base?.deletedAtVersion ?? null,
  }

  return { ok: true, point }
}

// ─────────────────────────────────────────────────────────────────────────
// Small field wrappers — reduce repetition across ~40 numeric/text inputs.
// ─────────────────────────────────────────────────────────────────────────

function NumField({
  id,
  label,
  value,
  onChange,
  error,
  step = "any",
  min,
  max,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  step?: string
  min?: number
  max?: number
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </FormField>
  )
}

function TextField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FormField label={label} htmlFor={id}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} />
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Main form
// ─────────────────────────────────────────────────────────────────────────

interface PointFormProps {
  product: ProductModel
  /** The point being edited, or null when authoring a brand-new one (`newSeed` carries the click
   * position in that case). */
  point: MeasurementPoint | null
  newSeed: NewPointSeed | null
  /** Lower-cased existing point codes, for the new-point duplicate-code check. */
  existingCodes: Set<string>
  onSaved: (code: string) => void
  onCancelNew: () => void
  onRequestDelete: (point: MeasurementPoint) => void
}

/**
 * The point detail form — `PointsEditor.tsx` remounts this (via `key={selectedCode ?? "new"}`) every
 * time the selection changes, which is what gives it a trivially-correct dirty check (compare current
 * form state to the value captured in `initialFormRef` on THIS mount) without needing a manual
 * "sync form to prop changes" effect.
 */
export function PointForm({ product, point, newSeed, existingCodes, onSaved, onCancelNew, onRequestDelete }: PointFormProps) {
  const t = useT()
  const gloss = useGloss()
  const savePoint = useSavePoint()
  const isNew = point == null
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const [form, setForm] = React.useState<PointFormValues>(() => toFormValues(point, newSeed, product))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [imageError, setImageError] = React.useState<string | null>(null)
  const initialFormRef = React.useRef(form)

  const dirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current)

  function update<K extends keyof PointFormValues>(key: K, value: PointFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateLighting(index: number, patch: Partial<LightingShotFormValues>) {
    setForm((prev) => ({ ...prev, lighting: prev.lighting.map((s, i) => (i === index ? { ...s, ...patch } : s)) }))
  }
  function addLighting() {
    setForm((prev) => ({ ...prev, lighting: [...prev.lighting, blankLighting(prev.lighting.length)] }))
  }
  function removeLighting(index: number) {
    setForm((prev) => ({ ...prev, lighting: prev.lighting.filter((_, i) => i !== index) }))
  }

  function handleImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t("pointsEditor.form.image.tooLarge"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageError(null)
        update("referenceImageUrl", reader.result)
      }
    }
    reader.onerror = () => setImageError(t("pointsEditor.form.image.readFailed"))
    reader.readAsDataURL(file)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const result = buildPayload(form, point, isNew, existingCodes, t)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    // Captured now (not read from `form` inside `onSuccess`) so a save of an EXISTING point — where
    // `PointsEditor`'s `key={selectedCode}` stays the same code before and after, so this component
    // does NOT remount — still correctly flips the dirty indicator to "Đã lưu." the instant the save
    // resolves. Without this, `initialFormRef.current` stays pinned to the pre-edit snapshot forever
    // (no remount to refresh it), so `dirty` stayed permanently true post-save — caught live via the
    // Playwright spec, not by manual testing (a reload always remounts fresh, masking the bug).
    const submittedForm = form
    savePoint.mutate(
      { code: product.code, pointCode: result.point.code, point: result.point },
      {
        onSuccess: () => {
          initialFormRef.current = submittedForm
          toast.success(isNew ? t("toast.pointCreated", { code: result.point.code }) : t("toast.pointSaved"))
          onSaved(result.point.code)
        },
        onError: () => toast.error(t("toast.pointSaveFailed")),
      }
    )
  }

  if (!point && !newSeed) {
    return (
      <Sheet className="h-full" bodyClassName="flex h-full min-h-64 flex-col items-center justify-center gap-2 py-10 text-center">
        <div className="flex size-11 items-center justify-center border border-border-strong bg-surface-card">
          <MousePointerClick className="size-5 text-primary-text" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-text-strong">{t("pointsEditor.form.noSelection.title")}</p>
        <p className="max-w-xs text-sm text-text-muted">{t("pointsEditor.form.noSelection.description")}</p>
      </Sheet>
    )
  }

  const hasThreeD = Boolean(
    form.positionZ ||
      form.heightMin ||
      form.heightMax ||
      form.heightNominal ||
      form.areaMin ||
      form.areaMax ||
      form.volumeMin ||
      form.volumeMax ||
      form.coplanarityMax ||
      form.warpageMax ||
      form.voidPctMax ||
      form.offsetXMax ||
      form.offsetYMax ||
      form.tiltMax ||
      form.thicknessMin ||
      form.thicknessMax ||
      form.criteriaText
  )
  const isUploadedImage = form.referenceImageUrl.startsWith("data:")

  return (
    <Sheet className="h-full">
      {/* `noValidate` — this form owns validation entirely via `buildPayload`'s inline
          errors (below), which show styled messages under the offending field. Without it, the
          browser's native constraint validation silently blocks submission (no console error, no
          network request, no visible feedback) whenever a numeric field's `step`/`min`/`max` hint
          doesn't match the actual value — e.g. `normalizedRadius`'s `step="0.001"` against a seeded
          value like `0.00875` (not a multiple of 0.001). Found live: clicking "Lưu điểm đo" on P02
          (real seed data) did nothing, no error, no request — root-caused via
          `form.checkValidity()` in the browser console. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold text-text-strong">
                {isNew ? t("pointsEditor.form.newTitle") : t("pointsEditor.form.editTitle", { code: point!.code })}
              </h2>
              {/* A brand-new, untouched draft is trivially "not dirty" relative to its own blank
                  initial state, but showing "Đã lưu." (Saved.) for something that was never saved
                  would be actively misleading — only render the dirty/clean indicator once there's
                  something to be clean/dirty ABOUT (an existing point, or a new one the user has
                  started filling in). */}
              {!isNew || dirty ? (
                <span className="text-xs text-text-muted">{dirty ? t("pointsEditor.form.dirtyHint") : t("pointsEditor.form.cleanHint")}</span>
              ) : null}
            </div>
            {!isNew ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRequestDelete(point!)}
                className="text-danger-text hover:bg-danger/10"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {t("pointsEditor.form.deleteBtn")}
              </Button>
            ) : null}
          </div>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.basic")}
            titleEn={gloss("pointsEditor.form.sections.basic")}
            icon={Info}
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label={t("pointsEditor.form.codeLabel")}
                labelEn={gloss("pointsEditor.form.codeLabel")}
                htmlFor="point-code"
                hint={!isNew ? t("pointsEditor.form.codeLocked") : undefined}
              >
                <Input
                  id="point-code"
                  value={form.code}
                  onChange={(e) => update("code", e.target.value)}
                  disabled={!isNew}
                  maxLength={40}
                  autoFocus={isNew}
                  aria-invalid={errors.code ? true : undefined}
                />
                {errors.code ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {errors.code}
                  </p>
                ) : null}
              </FormField>
              <FormField label={t("pointsEditor.form.nameLabel")} labelEn={gloss("pointsEditor.form.nameLabel")} htmlFor="point-name">
                <Input
                  id="point-name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={120}
                  aria-invalid={errors.name ? true : undefined}
                />
                {errors.name ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {errors.name}
                  </p>
                ) : null}
              </FormField>
            </div>

            <FormField label={t("pointsEditor.form.descriptionLabel")} htmlFor="point-description">
              <textarea
                id="point-description"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={2}
                className={TEXTAREA_CLASS}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={t("pointsEditor.form.typeLabel")} htmlFor="point-type">
                <Select<MeasurementType> value={form.measurementType} onValueChange={(v) => v && update("measurementType", v)}>
                  <SelectTrigger id="point-type">
                    <SelectValue>{t(`measurementType.${form.measurementType}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectPortal>
                    <SelectPositioner>
                      <SelectPopup>
                        {MEASUREMENT_TYPES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {t(`measurementType.${v}`)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </SelectPositioner>
                  </SelectPortal>
                </Select>
              </FormField>
              <TextField
                id="point-type-code"
                label={t("pointsEditor.form.typeCodeLabel")}
                value={form.measurementTypeCode}
                onChange={(v) => update("measurementTypeCode", v)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField id="point-unit" label={t("pointsEditor.form.unitLabel")} value={form.unit} onChange={(v) => update("unit", v)} />
              <NumField
                id="point-order"
                label={t("pointsEditor.form.orderIndexLabel")}
                value={form.orderIndex}
                onChange={(v) => update("orderIndex", v)}
                step="1"
              />
              <FormField label={t("pointsEditor.form.activeLabel")} htmlFor="point-active">
                <div className="flex h-8 items-center">
                  <Switch id="point-active" checked={form.isActive} onCheckedChange={(checked) => update("isActive", checked)} />
                </div>
              </FormField>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.limits")}
            titleEn={gloss("pointsEditor.form.sections.limits")}
            icon={Ruler}
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumField
                id="point-nominal"
                label={t("pointsEditor.form.limits.nominalLabel")}
                value={form.nominalValue}
                onChange={(v) => update("nominalValue", v)}
              />
              <NumField
                id="point-lower"
                label={t("pointsEditor.form.limits.lowerLabel")}
                value={form.lowerLimit}
                onChange={(v) => update("lowerLimit", v)}
              />
              <NumField
                id="point-upper"
                label={t("pointsEditor.form.limits.upperLabel")}
                value={form.upperLimit}
                onChange={(v) => update("upperLimit", v)}
              />
            </div>
            {errors.limits ? (
              <p role="alert" className="text-xs text-danger-text">
                {errors.limits}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label={t("pointsEditor.form.limits.toleranceModeLabel")} htmlFor="point-tol-mode">
                <Select
                  value={form.toleranceMode || TOLERANCE_NONE}
                  onValueChange={(v) => v && update("toleranceMode", v === TOLERANCE_NONE ? "" : (v as ToleranceMode))}
                >
                  <SelectTrigger id="point-tol-mode">
                    <SelectValue>
                      {form.toleranceMode ? t(`toleranceMode.${form.toleranceMode}`) : t("pointsEditor.form.limits.toleranceModeNone")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPortal>
                    <SelectPositioner>
                      <SelectPopup>
                        <SelectItem value={TOLERANCE_NONE}>{t("pointsEditor.form.limits.toleranceModeNone")}</SelectItem>
                        {TOLERANCE_MODES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {t(`toleranceMode.${v}`)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </SelectPositioner>
                  </SelectPortal>
                </Select>
              </FormField>
              <NumField
                id="point-tol-plus"
                label={t("pointsEditor.form.limits.tolPlusLabel")}
                value={form.tolPlus}
                onChange={(v) => update("tolPlus", v)}
              />
              <NumField
                id="point-tol-minus"
                label={t("pointsEditor.form.limits.tolMinusLabel")}
                value={form.tolMinus}
                onChange={(v) => update("tolMinus", v)}
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.position")}
            titleEn={gloss("pointsEditor.form.sections.position")}
            icon={Move}
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumField
                id="point-nx"
                label={t("pointsEditor.form.position.normalizedXLabel")}
                value={form.normalizedX}
                onChange={(v) => update("normalizedX", v)}
                step="0.001"
                min={0}
                max={1}
                error={errors.normalizedX}
              />
              <NumField
                id="point-ny"
                label={t("pointsEditor.form.position.normalizedYLabel")}
                value={form.normalizedY}
                onChange={(v) => update("normalizedY", v)}
                step="0.001"
                min={0}
                max={1}
                error={errors.normalizedY}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumField
                id="point-px"
                label={t("pointsEditor.form.position.positionXLabel", { unit: t(`coordinateMode.${product.coordinateMode}`) })}
                value={form.positionX}
                onChange={(v) => update("positionX", v)}
              />
              <NumField
                id="point-py"
                label={t("pointsEditor.form.position.positionYLabel", { unit: t(`coordinateMode.${product.coordinateMode}`) })}
                value={form.positionY}
                onChange={(v) => update("positionY", v)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumField
                id="point-radius"
                label={t("pointsEditor.form.position.radiusLabel")}
                value={form.radius}
                onChange={(v) => update("radius", v)}
              />
              <NumField
                id="point-nr"
                label={t("pointsEditor.form.position.normalizedRadiusLabel")}
                value={form.normalizedRadius}
                onChange={(v) => update("normalizedRadius", v)}
                step="0.001"
                min={0}
                max={1}
                error={errors.normalizedRadius}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumField
                id="point-cw"
                label={t("pointsEditor.form.position.cropWidthLabel")}
                value={form.cropWidth}
                onChange={(v) => update("cropWidth", v)}
                step="1"
              />
              <NumField
                id="point-ch"
                label={t("pointsEditor.form.position.cropHeightLabel")}
                value={form.cropHeight}
                onChange={(v) => update("cropHeight", v)}
                step="1"
              />
            </div>
            <FormField label={t("pointsEditor.form.position.shapeLabel")} htmlFor="point-shape">
              <Select<PointShape> value={form.shape} onValueChange={(v) => v && update("shape", v)}>
                <SelectTrigger id="point-shape">
                  <SelectValue>{t(`pointShape.${form.shape}`)}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectPositioner>
                    <SelectPopup>
                      {SHAPES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`pointShape.${v}`)}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </SelectPositioner>
                </SelectPortal>
              </Select>
            </FormField>
            <FormField
              label={t("pointsEditor.form.position.geometryLabel")}
              htmlFor="point-geometry"
              hint={t("pointsEditor.form.position.geometryHint")}
            >
              <textarea
                id="point-geometry"
                value={form.geometryText}
                onChange={(e) => update("geometryText", e.target.value)}
                rows={3}
                className={cn(TEXTAREA_CLASS, "font-mono text-xs")}
                aria-invalid={errors.geometry ? true : undefined}
              />
              {errors.geometry ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.geometry}
                </p>
              ) : null}
            </FormField>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.threeD")}
            titleEn={gloss("pointsEditor.form.sections.threeD")}
            icon={Box}
            defaultOpen={hasThreeD}
          >
            <NumField
              id="point-pz"
              label={t("pointsEditor.form.threeD.positionZLabel")}
              value={form.positionZ}
              onChange={(v) => update("positionZ", v)}
            />

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                {t("pointsEditor.form.threeD.heightGroupLabel")}
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumField id="point-h-min" label={t("pointsEditor.form.threeD.minLabel")} value={form.heightMin} onChange={(v) => update("heightMin", v)} />
                <NumField id="point-h-max" label={t("pointsEditor.form.threeD.maxLabel")} value={form.heightMax} onChange={(v) => update("heightMax", v)} />
                <NumField
                  id="point-h-nom"
                  label={t("pointsEditor.form.threeD.nominalLabel")}
                  value={form.heightNominal}
                  onChange={(v) => update("heightNominal", v)}
                />
                <TextField id="point-h-unit" label={t("pointsEditor.form.threeD.unitLabel")} value={form.heightUnit} onChange={(v) => update("heightUnit", v)} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                {t("pointsEditor.form.threeD.areaGroupLabel")}
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumField id="point-a-min" label={t("pointsEditor.form.threeD.minLabel")} value={form.areaMin} onChange={(v) => update("areaMin", v)} />
                <NumField id="point-a-max" label={t("pointsEditor.form.threeD.maxLabel")} value={form.areaMax} onChange={(v) => update("areaMax", v)} />
                <NumField
                  id="point-a-nom"
                  label={t("pointsEditor.form.threeD.nominalLabel")}
                  value={form.areaNominal}
                  onChange={(v) => update("areaNominal", v)}
                />
                <TextField id="point-a-unit" label={t("pointsEditor.form.threeD.unitLabel")} value={form.areaUnit} onChange={(v) => update("areaUnit", v)} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                {t("pointsEditor.form.threeD.volumeGroupLabel")}
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumField id="point-v-min" label={t("pointsEditor.form.threeD.minLabel")} value={form.volumeMin} onChange={(v) => update("volumeMin", v)} />
                <NumField id="point-v-max" label={t("pointsEditor.form.threeD.maxLabel")} value={form.volumeMax} onChange={(v) => update("volumeMax", v)} />
                <NumField
                  id="point-v-nom"
                  label={t("pointsEditor.form.threeD.nominalLabel")}
                  value={form.volumeNominal}
                  onChange={(v) => update("volumeNominal", v)}
                />
                <TextField
                  id="point-v-unit"
                  label={t("pointsEditor.form.threeD.unitLabel")}
                  value={form.volumeUnit}
                  onChange={(v) => update("volumeUnit", v)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumField
                id="point-coplanarity"
                label={t("pointsEditor.form.threeD.coplanarityMaxLabel")}
                value={form.coplanarityMax}
                onChange={(v) => update("coplanarityMax", v)}
              />
              <NumField
                id="point-warpage"
                label={t("pointsEditor.form.threeD.warpageMaxLabel")}
                value={form.warpageMax}
                onChange={(v) => update("warpageMax", v)}
              />
              <NumField
                id="point-void"
                label={t("pointsEditor.form.threeD.voidPctMaxLabel")}
                value={form.voidPctMax}
                onChange={(v) => update("voidPctMax", v)}
              />
              <NumField
                id="point-offx"
                label={t("pointsEditor.form.threeD.offsetXMaxLabel")}
                value={form.offsetXMax}
                onChange={(v) => update("offsetXMax", v)}
              />
              <NumField
                id="point-offy"
                label={t("pointsEditor.form.threeD.offsetYMaxLabel")}
                value={form.offsetYMax}
                onChange={(v) => update("offsetYMax", v)}
              />
              <NumField id="point-tilt" label={t("pointsEditor.form.threeD.tiltMaxLabel")} value={form.tiltMax} onChange={(v) => update("tiltMax", v)} />
              <NumField
                id="point-thick-min"
                label={t("pointsEditor.form.threeD.thicknessMinLabel")}
                value={form.thicknessMin}
                onChange={(v) => update("thicknessMin", v)}
              />
              <NumField
                id="point-thick-max"
                label={t("pointsEditor.form.threeD.thicknessMaxLabel")}
                value={form.thicknessMax}
                onChange={(v) => update("thicknessMax", v)}
              />
            </div>

            <FormField
              label={t("pointsEditor.form.threeD.criteriaLabel")}
              htmlFor="point-criteria"
              hint={t("pointsEditor.form.threeD.criteriaHint")}
            >
              <textarea
                id="point-criteria"
                value={form.criteriaText}
                onChange={(e) => update("criteriaText", e.target.value)}
                rows={3}
                className={cn(TEXTAREA_CLASS, "font-mono text-xs")}
                aria-invalid={errors.criteria ? true : undefined}
              />
              {errors.criteria ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.criteria}
                </p>
              ) : null}
            </FormField>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.image")}
            titleEn={gloss("pointsEditor.form.sections.image")}
            icon={ImageIcon}
            defaultOpen={Boolean(form.referenceImageUrl)}
          >
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <ProductImageThumb
                  url={form.referenceImageUrl}
                  alt={t("pointsEditor.form.image.previewAlt")}
                  className="size-16 shrink-0 border border-border-strong"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {isUploadedImage ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => update("referenceImageUrl", "")} className="w-fit">
                      <X className="size-3.5" aria-hidden="true" />
                      {t("pointsEditor.form.image.removeBtn")}
                    </Button>
                  ) : (
                    <Input
                      id="point-image-url"
                      value={form.referenceImageUrl}
                      onChange={(e) => update("referenceImageUrl", e.target.value)}
                      placeholder={t("pointsEditor.form.image.urlPlaceholder")}
                    />
                  )}
                </div>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleImageFile}
                  aria-label={t("pointsEditor.form.image.uploadBtn")}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-3.5" aria-hidden="true" />
                  {t("pointsEditor.form.image.uploadBtn")}
                </Button>
              </div>
              {imageError ? (
                <p role="alert" className="text-xs text-danger-text">
                  {imageError}
                </p>
              ) : null}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={t("pointsEditor.form.sections.lighting")}
            titleEn={gloss("pointsEditor.form.sections.lighting")}
            icon={Sun}
            defaultOpen={form.lighting.length > 0}
            badge={form.lighting.length > 0 ? <StatusBadge status="neutral">{form.lighting.length}</StatusBadge> : undefined}
          >
            <div className="flex flex-col gap-3">
              {form.lighting.length === 0 ? (
                <p className="text-sm text-text-muted">{t("pointsEditor.form.lighting.empty")}</p>
              ) : (
                form.lighting.map((shot, index) => (
                  <div key={shot._key} className="flex flex-col gap-3 border border-border-strong p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-text-strong">
                        {t("pointsEditor.form.lighting.shotTitle", { index: index + 1 })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeLighting(index)}
                        aria-label={t("pointsEditor.form.lighting.removeShotAria", { index: index + 1 })}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <TextField
                        id={`shot-${index}-name`}
                        label={t("pointsEditor.form.lighting.nameLabel")}
                        value={shot.name}
                        onChange={(v) => updateLighting(index, { name: v })}
                      />
                      <TextField
                        id={`shot-${index}-source`}
                        label={t("pointsEditor.form.lighting.lightSourceLabel")}
                        value={shot.lightSource}
                        onChange={(v) => updateLighting(index, { lightSource: v })}
                      />
                      <TextField
                        id={`shot-${index}-color`}
                        label={t("pointsEditor.form.lighting.colorLabel")}
                        value={shot.color}
                        onChange={(v) => updateLighting(index, { color: v })}
                      />
                      <TextField
                        id={`shot-${index}-colorhex`}
                        label={t("pointsEditor.form.lighting.colorHexLabel")}
                        value={shot.colorHex}
                        onChange={(v) => updateLighting(index, { colorHex: v })}
                      />
                      <NumField
                        id={`shot-${index}-intensity`}
                        label={t("pointsEditor.form.lighting.intensityLabel")}
                        value={shot.intensityPct}
                        onChange={(v) => updateLighting(index, { intensityPct: v })}
                      />
                      <NumField
                        id={`shot-${index}-angle`}
                        label={t("pointsEditor.form.lighting.angleLabel")}
                        value={shot.angleDeg}
                        onChange={(v) => updateLighting(index, { angleDeg: v })}
                      />
                      <NumField
                        id={`shot-${index}-exposure`}
                        label={t("pointsEditor.form.lighting.exposureLabel")}
                        value={shot.exposureUs}
                        onChange={(v) => updateLighting(index, { exposureUs: v })}
                      />
                      <NumField
                        id={`shot-${index}-gain`}
                        label={t("pointsEditor.form.lighting.gainLabel")}
                        value={shot.gain}
                        onChange={(v) => updateLighting(index, { gain: v })}
                      />
                      <NumField
                        id={`shot-${index}-focus`}
                        label={t("pointsEditor.form.lighting.focusOffsetLabel")}
                        value={shot.focusOffsetUm}
                        onChange={(v) => updateLighting(index, { focusOffsetUm: v })}
                      />
                      <TextField
                        id={`shot-${index}-filter`}
                        label={t("pointsEditor.form.lighting.filterLabel")}
                        value={shot.opticalFilter}
                        onChange={(v) => updateLighting(index, { opticalFilter: v })}
                      />
                    </div>
                    <TextField
                      id={`shot-${index}-purpose`}
                      label={t("pointsEditor.form.lighting.purposeLabel")}
                      value={shot.purpose}
                      onChange={(v) => updateLighting(index, { purpose: v })}
                    />
                  </div>
                ))
              )}
              <Button type="button" variant="outline" size="sm" onClick={addLighting} className="w-fit">
                <Plus className="size-3.5" aria-hidden="true" />
                {t("pointsEditor.form.lighting.addShotBtn")}
              </Button>
            </div>
          </CollapsibleSection>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={savePoint.isPending}>
              {savePoint.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              {savePoint.isPending
                ? isNew
                  ? t("pointsEditor.form.creating")
                  : t("pointsEditor.form.saving")
                : isNew
                  ? t("pointsEditor.form.create")
                  : t("pointsEditor.form.save")}
            </Button>
            {isNew ? (
              <Button type="button" variant="outline" onClick={onCancelNew}>
                <X className="size-3.5" aria-hidden="true" />
                {t("pointsEditor.form.cancelNew")}
              </Button>
            ) : null}
          </div>
      </form>
    </Sheet>
  )
}
