import * as React from "react"
import { Pencil, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"
import { useMachineConfigCheck, useProducts } from "@/lib/configApi"
import {
  MachineSettingsApiError,
  useMachineSettings,
  useResetMachineSetting,
  useUpdateMachineSetting,
  type AdjustmentScope,
  type ConfigProvenance,
  type EffectiveParameter,
} from "@/lib/machineSettingsApi"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import type { VariantProps } from "class-variance-authority"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type T = (key: string, vars?: Record<string, string | number>) => string
type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

/**
 * Task 4/5 — the provenance badge tone map. Deliberately NEVER `warn`/`danger` (spec §2: status colors
 * are for STATE only; "has local adjustments" is a normal, expected, desirable state, not a fault —
 * this exact class of error has shipped 6+ times on this project). `machine`/`machineProduct` both
 * read `info` (the same neutral-but-noteworthy tone `TRANSPORT_MODE_TONE` uses for Live/Auto) — the
 * two are told apart by their TEXT ("Chỉnh theo máy" vs "Chỉnh cho sản phẩm này"), not by color
 * severity.
 */
const PROVENANCE_TONE: Record<ConfigProvenance, BadgeStatus> = {
  baseline: "neutral",
  machine: "info",
  machineProduct: "info",
}

function formatNumber(value: number, decimals: number): string {
  return value.toFixed(Math.max(0, decimals))
}

function formatRelativeTime(t: T, iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return t("machineSettings.relativeTime.justNow")
  if (minutes < 60) return t("machineSettings.relativeTime.minutesAgo", { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t("machineSettings.relativeTime.hoursAgo", { n: hours })
  const days = Math.round(hours / 24)
  return t("machineSettings.relativeTime.daysAgo", { n: days })
}

// ─────────────────────────────────────────────────────────────────────────
// Edit dialog — offers the scope choice (design doc §2/§5: "cho máy này" vs "chỉ cho sản phẩm đang
// chạy"), blocks an out-of-range value AT THE FIELD (client-side, immediate — never a round trip to
// discover it), and falls back to the server's own verbatim message (`MachineSettingsApiError.
// serverMessage`) as defense-in-depth if a write somehow still reaches the API out of range.
// ─────────────────────────────────────────────────────────────────────────

function EditParameterDialog({
  open,
  onOpenChange,
  machineCode,
  param,
  supportsProductScope,
  productCode,
  attributedTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  machineCode: string
  param: EffectiveParameter
  supportsProductScope: boolean
  productCode: string | null
  attributedTo: string
}) {
  const t = useT()
  const { def } = param
  const [rawValue, setRawValue] = React.useState(() => formatNumber(param.value, def.decimals))
  const [scope, setScope] = React.useState<AdjustmentScope>(
    supportsProductScope && param.source === "machineProduct" ? "product" : "machine"
  )
  const [note, setNote] = React.useState("")
  const update = useUpdateMachineSetting()

  // Re-seed from the CURRENT row every time a fresh dialog opens for a (possibly different)
  // parameter — a `key`-remount would also work, but resetting explicitly here keeps this component
  // reusable for a single persistent dialog instance instead of one-per-row.
  React.useEffect(() => {
    if (!open) return
    setRawValue(formatNumber(param.value, def.decimals))
    setScope(supportsProductScope && param.source === "machineProduct" ? "product" : "machine")
    setNote("")
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, param.def.key])

  const parsed = Number(rawValue)
  const isValidNumber = rawValue.trim().length > 0 && Number.isFinite(parsed)
  const inRange = isValidNumber && parsed >= def.min && parsed <= def.max
  const rangeText = t("machineSettings.editDialog.rangeHint", {
    min: formatNumber(def.min, def.decimals),
    max: formatNumber(def.max, def.decimals),
    unit: def.unit,
  })
  const fieldError = !isValidNumber
    ? t("machineSettings.editDialog.invalidNumber")
    : !inRange
      ? t("machineSettings.editDialog.outOfRange", {
          key: def.key,
          min: formatNumber(def.min, def.decimals),
          max: formatNumber(def.max, def.decimals),
          unit: def.unit,
          value: rawValue,
        })
      : null

  const serverError =
    update.error instanceof MachineSettingsApiError
      ? (update.error.serverMessage ?? t("machineSettings.editDialog.serverErrorFallback"))
      : update.isError
        ? t("machineSettings.editDialog.serverErrorFallback")
        : null

  function submit() {
    if (fieldError || !isValidNumber) return
    update.mutate(
      {
        machineCode,
        key: def.key,
        body: {
          value: parsed,
          scope,
          product: scope === "product" ? productCode : null,
          note: note.trim().length > 0 ? note.trim() : null,
          by: attributedTo,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("toast.machineSettingUpdated", { key: def.key }))
          onOpenChange(false)
        },
        onError: () => {
          toast.error(t("toast.machineSettingUpdateFailed"))
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("machineSettings.editDialog.titleFor", { label: def.labelVi })}</DialogTitle>
          <DialogDescription>{rangeText}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <span className="flex flex-col gap-0.5">
            {/* Bilingual gloss stays OUTSIDE the <label> element (hard requirement) — a sibling span,
                not a `<label>` descendant, so a screen reader announces the field's name once. */}
            <label htmlFor={`setting-value-${def.key}`} className="text-xs font-medium text-text-body">
              {t("machineSettings.editDialog.valueLabel")}
            </label>
            <span className="hmi-micro" aria-hidden="true">
              {def.labelEn}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Input
              id={`setting-value-${def.key}`}
              type="number"
              inputMode="decimal"
              step={def.step || undefined}
              value={rawValue}
              onChange={(event) => setRawValue(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `setting-value-error-${def.key}` : undefined}
              className="max-w-[180px]"
            />
            <span className="hmi-micro">{def.unit}</span>
          </div>
          {fieldError ? (
            <p id={`setting-value-error-${def.key}`} role="alert" className="text-xs font-medium text-danger-text">
              {fieldError}
            </p>
          ) : (
            <p className="text-[11px] text-text-muted">{rangeText}</p>
          )}
        </div>

        {supportsProductScope ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-text-body">{t("machineSettings.editDialog.scopeLabel")}</legend>
            <label className="flex items-center gap-2 text-sm text-text-body">
              <input
                type="radio"
                name={`setting-scope-${def.key}`}
                checked={scope === "machine"}
                onChange={() => setScope("machine")}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              {t("machineSettings.editDialog.scopeMachine")}
            </label>
            <label className="flex items-center gap-2 text-sm text-text-body">
              <input
                type="radio"
                name={`setting-scope-${def.key}`}
                checked={scope === "product"}
                onChange={() => setScope("product")}
                disabled={!productCode}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              {t("machineSettings.editDialog.scopeProduct", { product: productCode ?? "—" })}
            </label>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`setting-note-${def.key}`} className="text-xs font-medium text-text-body">
            {t("machineSettings.editDialog.noteLabel")}
          </label>
          <Input
            id={`setting-note-${def.key}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("machineSettings.editDialog.notePlaceholder")}
          />
        </div>

        {serverError ? (
          <p role="alert" className="border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs font-medium text-danger-text">
            {serverError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {t("machineSettings.editDialog.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={Boolean(fieldError) || update.isPending}>
            {update.isPending ? t("machineSettings.editDialog.saving") : t("machineSettings.editDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// One parameter row.
// ─────────────────────────────────────────────────────────────────────────

function ParameterRow({
  param,
  onEdit,
  onReset,
  resetPending,
}: {
  param: EffectiveParameter
  onEdit: () => void
  onReset: () => void
  resetPending: boolean
}) {
  const t = useT()
  const { def, source } = param
  const adjustment = source === "machineProduct" ? param.productAdjustment : source === "machine" ? param.machineAdjustment : null
  const canReset = source !== "baseline"

  return (
    <div
      className="grid grid-cols-[minmax(150px,1.3fr)_110px_150px_100px_150px_76px] items-center gap-x-2 border-b border-border px-3 py-2 last:border-b-0"
      data-machine-setting-row={def.key}
    >
      <span className="flex flex-col gap-0 pr-2">
        <span className="truncate text-[13px] font-medium text-text-body">{def.labelVi}</span>
        <span className="hmi-micro truncate">{def.labelEn}</span>
      </span>

      <span className="font-heading text-[22px] leading-none font-semibold tabular-nums text-text-strong">
        {formatNumber(param.value, def.decimals)}
        <span className="hmi-micro ml-1 normal-case">{def.unit}</span>
      </span>

      <span className="font-mono text-[11px] tabular-nums text-text-muted">
        {formatNumber(def.min, def.decimals)}–{formatNumber(def.max, def.decimals)} {def.unit}
      </span>

      <span className="font-mono text-[11px] tabular-nums text-text-body">{formatNumber(param.baselineValue, def.decimals)}</span>

      <span className="flex flex-col gap-0.5">
        <StatusBadge status={PROVENANCE_TONE[source]} className="w-fit">
          {t(`machineSettings.provenance.${source}`)}
        </StatusBadge>
        {adjustment ? (
          <span className="hmi-micro truncate normal-case" title={adjustment.note ?? undefined}>
            {adjustment.by
              ? t("machineSettings.adjustedBy", { by: adjustment.by, when: formatRelativeTime(t, adjustment.at) })
              : t("machineSettings.adjustedByUnknown", { when: formatRelativeTime(t, adjustment.at) })}
          </span>
        ) : null}
      </span>

      <span className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onEdit}
          aria-label={t("machineSettings.editAria", { key: def.key })}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onReset}
          disabled={!canReset || resetPending}
          aria-label={t("machineSettings.resetAria", { key: def.key })}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </Button>
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Root panel — shared by the HMI's CÀI ĐẶT/SETTINGS tab (`SettingsTab.tsx`, wraps this in the kiosk's
// own `<Sheet>` chrome) and the machine detail screen's own settings tab (`routes/MachineDetail.tsx`,
// wraps this directly). Same data source (`useMachineSettings`), same vocabulary (design doc §5) —
// "someone standing at the machine" and "someone looking from the office" read the exact same state.
// ─────────────────────────────────────────────────────────────────────────

export interface MachineSettingsPanelProps {
  machineCode: string
  deviceClass: DeviceClass
  machineType?: string | null
  /** `"hmi"` — attributes edits as coming from the panel at the machine; `"detail"` — from the office
   * detail screen. Purely a `by` attribution string (no real auth in this exhibition simulator, same
   * simplification `ConfigSyncPanel`'s pull/push already makes). */
  attributedAs?: "hmi" | "detail"
  /** `true` (default, `MachineDetail.tsx`'s own tab — mirrors `ConfigSyncPanel`'s self-titled root) —
   * renders this panel's own "Cài đặt máy/Machine Settings" heading. `false` (`SettingsTab.tsx`) —
   * the caller already supplies a framed `<Sheet title=…>` around this panel, so a second title line
   * would just duplicate the first. */
  showHeader?: boolean
  className?: string
}

export function MachineSettingsPanel({
  machineCode,
  deviceClass,
  machineType,
  attributedAs = "detail",
  showHeader = true,
  className,
}: MachineSettingsPanelProps) {
  const t = useT()
  const gloss = useGloss()

  // Design doc §2: only a machine whose configKind carries a product dimension shows one at all — IoT
  // sensors/gateways never do (`MachineParameterSchema.SupportsProductScope`'s only `false` case).
  // Derivable from `deviceClass` alone WITHOUT waiting on the settings response (avoids a flash where
  // the selector briefly renders then disappears once data lands).
  const deviceSupportsProduct = deviceClass !== "Iot"

  const products = useProducts()
  // The OLDER config-sync system's own machine→product hint (populated for AOI/AVI machines that have
  // already been linked to a product via `/config/check`) — a reasonable default selection, not a
  // hard requirement (any product in the catalogue is a valid pairing in this simulator).
  const configCheck = useMachineConfigCheck(machineCode)
  const hintedProduct = configCheck.data?.products?.[0]?.productModelCode ?? null

  const [selectedProduct, setSelectedProduct] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!deviceSupportsProduct || selectedProduct) return
    const fallback = hintedProduct ?? products.data?.[0]?.code ?? null
    if (fallback) setSelectedProduct(fallback)
  }, [deviceSupportsProduct, selectedProduct, hintedProduct, products.data])

  const activeProduct = deviceSupportsProduct ? selectedProduct : null
  const settings = useMachineSettings(machineCode, activeProduct)
  const resetMutation = useResetMachineSetting()
  const [editingKey, setEditingKey] = React.useState<string | null>(null)

  const attributedTo = attributedAs === "hmi" ? "operator (HMI)" : "operator (office)"

  function handleReset(param: EffectiveParameter) {
    if (param.source === "baseline") return
    const scope: AdjustmentScope = param.source === "machineProduct" ? "product" : "machine"
    resetMutation.mutate(
      { machineCode, key: param.def.key, scope, product: scope === "product" ? activeProduct : null },
      {
        onSuccess: () => toast.success(t("toast.machineSettingReset", { key: param.def.key })),
        onError: () => toast.error(t("toast.machineSettingResetFailed")),
      }
    )
  }

  const notSupported =
    settings.isError && settings.error instanceof MachineSettingsApiError && settings.error.status === 400

  const editingParam = settings.data?.effective.find((p) => p.def.key === editingKey) ?? null

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-2.5">
        {showHeader ? (
          <div className="flex flex-col gap-0.5">
            <h3 className="font-heading text-[15px] leading-none font-semibold tracking-tight text-text-strong">
              {t("machineSettings.title")}
            </h3>
            <span className="hmi-micro mt-1">{gloss("machineSettings.title")}</span>
          </div>
        ) : (
          <span className="text-xs text-text-muted">{t("machineSettings.description")}</span>
        )}

        {deviceSupportsProduct ? (
          products.isPending || (products.data && products.data.length > 0 && !selectedProduct) ? (
            <Skeleton className="h-7 w-48" />
          ) : products.data && products.data.length > 0 && selectedProduct ? (
            <div className="flex items-center gap-2">
              <span className="hmi-micro" aria-hidden="true">
                {t("machineSettings.productLabel")}
              </span>
              {/* `value` is only ever a real string here (never `undefined`) — the block above only
                  renders once `selectedProduct` has resolved, so this Select is CONTROLLED from its
                  very first render. Passing `selectedProduct ?? undefined` (as an earlier draft did)
                  let it mount uncontrolled for one tick then flip controlled once the product resolved
                  a moment later — Base UI warns loudly about exactly that switch. */}
              <Select<string> value={selectedProduct} onValueChange={(value) => value && setSelectedProduct(value)}>
                <SelectTrigger aria-label={t("machineSettings.productSelectAria")} className="h-7 w-48 text-xs">
                  <SelectValue>
                    {`${selectedProduct} — ${products.data.find((p) => p.code === selectedProduct)?.name ?? ""}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectPositioner>
                    <SelectPopup>
                      {products.data.map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.code} — {p.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </SelectPositioner>
                </SelectPortal>
              </Select>
            </div>
          ) : (
            <span className="text-xs text-text-muted">{t("machineSettings.noProducts")}</span>
          )
        ) : (
          <span className="hmi-micro max-w-[220px] text-right normal-case">{t("machineSettings.iotHint")}</span>
        )}
      </div>

      {settings.isPending ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : notSupported ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="text-sm font-medium text-text-strong">{t("machineSettings.notSupported.title")}</p>
          <p className="max-w-md text-xs text-text-muted">
            {t("machineSettings.notSupported.description", { machineType: machineType ?? deviceClass })}
          </p>
        </div>
      ) : settings.isError ? (
        <p role="alert" className="p-3 text-sm text-danger-text">
          {t("machineSettings.loadFailed")}
        </p>
      ) : settings.data ? (
        <>
          <div className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="hmi-micro">
              {t("machineSettings.baselineInfo", {
                version: settings.data.baseline.version,
                driftedCount: settings.data.driftedKeys.length,
              })}
            </span>
          </div>

          <div
            tabIndex={0}
            className="hmi-scroll min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
          >
            <div className="grid grid-cols-[minmax(150px,1.3fr)_110px_150px_100px_150px_76px] gap-x-2 border-b border-border-strong px-3 py-1.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
              <span>{t("machineSettings.columns.label")}</span>
              <span>{t("machineSettings.columns.value")}</span>
              <span>{t("machineSettings.columns.range")}</span>
              <span>{t("machineSettings.columns.recommended")}</span>
              <span>{t("machineSettings.columns.source")}</span>
              <span aria-hidden="true" />
            </div>
            {settings.data.effective.map((param) => (
              <ParameterRow
                key={param.def.key}
                param={param}
                onEdit={() => setEditingKey(param.def.key)}
                onReset={() => handleReset(param)}
                resetPending={resetMutation.isPending}
              />
            ))}
          </div>
        </>
      ) : null}

      {editingParam ? (
        <EditParameterDialog
          open={Boolean(editingParam)}
          onOpenChange={(open) => {
            if (!open) setEditingKey(null)
          }}
          machineCode={machineCode}
          param={editingParam}
          supportsProductScope={settings.data?.supportsProductScope ?? false}
          productCode={activeProduct}
          attributedTo={attributedTo}
        />
      ) : null}
    </div>
  )
}
