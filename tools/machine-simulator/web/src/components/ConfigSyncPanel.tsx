import * as React from "react"
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ExternalLink,
  GitCompareArrows,
  History,
  Info,
  Loader2,
  MinusCircle,
  PencilLine,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { toast } from "sonner"
import { Link } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { TRANSPORT_MODE_TONE, useMode, type DeviceClass, type TransportMode } from "@/lib/api"
import {
  useMachineConfigCheck,
  useMachineConfigDiff,
  useMachineConfigHistory,
  useMachineConfigPull,
  useMachineConfigPush,
  useProduct,
  useRecipe,
  type ChangedPointDto,
  type ConfigSyncHistoryEntryDto,
  type MachineConfigDiffDto,
  type MachineConfigPullResultDto,
  type MachineConfigPushResultDto,
  type PointFieldChangeDto,
  type ProductModel,
  type UseQueryResult,
} from "@/lib/configApi"
import { cn, shortChecksum } from "@/lib/utils"
import { Sheet } from "@/components/industrial"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCycleTime } from "@/components/CycleLogTable"
import { ProductImageThumb } from "@/components/ProductImageThumb"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>
type T = (key: string, vars?: Record<string, string | number>) => string

const DRIFT_BADGE: Record<string, BadgeStatus> = {
  in_sync: "ok",
  drift: "warn",
  unknown: "neutral",
}

// Task review #1/#7 — the backend's diff (ConfigSyncEngine.DiffFields) now drives its field set off the
// SAME canonicalization the checksum-based drift badge uses, so it covers the FULL point spec, not just
// ~13 hand-picked fields. This set is kept in sync with that full field list purely to give every field an
// i18n LABEL (configSyncPanel.diff.fields.*) — `fieldLabel` below already falls back to the raw field name
// for anything NOT in this set, so a future backend field the frontend hasn't caught up on yet still
// renders (unlabeled, but never silently dropped) instead of breaking.
const DIFF_FIELD_KEYS = new Set([
  "name",
  "description",
  "measurementType",
  "measurementTypeCode",
  "unit",
  "lowerLimit",
  "upperLimit",
  "nominalValue",
  "toleranceMode",
  "tolPlus",
  "tolMinus",
  "positionX",
  "positionY",
  "radius",
  "normalizedX",
  "normalizedY",
  "normalizedRadius",
  "cropWidth",
  "cropHeight",
  "orderIndex",
  "isActive",
  "shape",
  "geometry",
  "cells",
  "positionZ",
  "heightMin",
  "heightMax",
  "heightNominal",
  "heightUnit",
  "areaMin",
  "areaMax",
  "areaNominal",
  "areaUnit",
  "volumeMin",
  "volumeMax",
  "volumeNominal",
  "volumeUnit",
  "coplanarityMax",
  "warpageMax",
  "voidPctMax",
  "offsetXMax",
  "offsetYMax",
  "tiltMax",
  "thicknessMin",
  "thicknessMax",
  "criteria",
  "lighting",
  "referenceImageUrl",
])

// Fields whose raw value is JSON (object/array), not a scalar — rendered monospace/break-all like
// `geometry` always was, since these are equally illegible as un-styled prose text.
const JSON_DIFF_FIELDS = new Set(["geometry", "cells", "criteria", "lighting"])

const POINT_STATUS_KEYS = new Set(["created", "updated", "conflict", "failed"])

function fieldLabel(t: T, field: string): string {
  return DIFF_FIELD_KEYS.has(field) ? t(`configSyncPanel.diff.fields.${field}`) : field
}

function pointStatusLabel(t: T, status: string): string {
  return POINT_STATUS_KEYS.has(status) ? t(`configSyncPanel.pushResult.pointStatus.${status}`) : status
}

/** Formats one diff scalar for display — `isActive`'s raw value is a C# `bool.ToString()` ("True"/
 * "False"), translated to Có/Không (Yes/No) rather than shown verbatim; every other field's raw string
 * (a number, a name, an enum member name) is legible as-is. `null`/empty renders as the shared em-dash
 * placeholder so "this side never had a value" reads distinctly from "the value is the empty string". */
function formatDiffScalar(t: T, field: string, raw: string | null | undefined): string {
  if (raw == null || raw.length === 0) return t("configSyncPanel.diff.noValue")
  if (field === "isActive") {
    const lower = raw.toLowerCase()
    if (lower === "true") return t("configSyncPanel.diff.yes")
    if (lower === "false") return t("configSyncPanel.diff.no")
  }
  return raw
}

// ─────────────────────────────────────────────────────────────────────────
// Mode indicator — "which ecosystem does a pull/push here actually reach". Mirrors `shell/TopBar.tsx`'s
// own `showDemoFallback` reasoning (Auto's per-call fallback isn't exposed over HTTP, so `mode ===
// "Auto"` is the practical proxy for "currently effectively Demo" — see that file's comment).
// ─────────────────────────────────────────────────────────────────────────

function ModeIndicator() {
  const t = useT()
  const { data } = useMode()
  const mode = data?.mode ?? "Demo"

  return (
    <div className="flex items-center gap-2">
      <span className="hmi-micro">{t("configSyncPanel.modeLabel")}</span>
      <StatusBadge status={TRANSPORT_MODE_TONE[mode]}>{t(`configSyncPanel.mode.${mode}`)}</StatusBadge>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Diff view — Task C7 §2: fetched + rendered BEFORE any apply. Added/removed are code-only chips (the
// diff DTO only carries codes for those — see `MachineConfigDiffDto`'s own doc comment: only "changed"
// gets field-level detail); removed codes are enriched with the LOCAL point's name since that side is
// still known locally. Changed points get a full field-by-field local→ecosystem readout, with
// before/after thumbnails when `referenceImageUrl` itself is one of the changed fields.
// ─────────────────────────────────────────────────────────────────────────

function DiffValueCell({ field, value, imageAlt }: { field: string; value: string | null | undefined; imageAlt: string }) {
  const t = useT()
  if (field === "referenceImageUrl") {
    return (
      <span className="flex items-center py-1">
        <ProductImageThumb
          url={value}
          alt={imageAlt}
          className="size-10 border border-border-strong"
          fallbackIconClassName="size-3.5"
        />
      </span>
    )
  }
  const isJson = JSON_DIFF_FIELDS.has(field)
  return (
    <span className={cn("py-1 font-mono break-words tabular-nums", isJson ? "text-[10px] break-all" : "text-[11px]")}>
      {formatDiffScalar(t, field, value)}
    </span>
  )
}

function DiffFieldRow({ change }: { change: PointFieldChangeDto }) {
  const t = useT()
  return (
    <>
      <span className="py-1 pr-2 font-mono text-[11px] font-medium text-text-body">{fieldLabel(t, change.field)}</span>
      <DiffValueCell field={change.field} value={change.localValue} imageAlt={t("configSyncPanel.diff.imageBefore")} />
      <DiffValueCell field={change.field} value={change.ecosystemValue} imageAlt={t("configSyncPanel.diff.imageAfter")} />
    </>
  )
}

function ChangedPointCard({ point }: { point: ChangedPointDto }) {
  return (
    <div className="flex flex-col gap-1.5 border border-border-strong bg-surface-subtle p-2.5">
      <div className="flex flex-wrap items-baseline gap-1.5 text-xs font-medium text-text-strong">
        <span className="font-numeric">{point.code}</span>
        <span className="text-text-muted">· {point.name}</span>
      </div>
      <div className="grid grid-cols-[minmax(84px,auto)_1fr_1fr] gap-x-3 gap-y-0.5 text-xs">
        {point.fields.map((change) => (
          <DiffFieldRow key={change.field} change={change} />
        ))}
      </div>
    </div>
  )
}

function ProductDiffView({
  diff,
  localProduct,
}: {
  diff: UseQueryResult<MachineConfigDiffDto>
  localProduct?: ProductModel
}) {
  const t = useT()

  return (
    <div className="flex flex-col gap-3 border border-border-strong p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-text-strong">
          <GitCompareArrows className="size-4 text-primary-text" aria-hidden="true" />
          {t("configSyncPanel.diff.title")}
        </h4>
        {diff.data ? (
          <StatusBadge status={diff.data.versionDelta === 0 ? "ok" : diff.data.versionDelta > 0 ? "warn" : "info"}>
            {diff.data.versionDelta === 0
              ? t("configSyncPanel.diff.versionSame")
              : diff.data.versionDelta > 0
                ? t("configSyncPanel.diff.versionEcosystemAhead", { count: diff.data.versionDelta })
                : t("configSyncPanel.diff.versionLocalAhead", { count: Math.abs(diff.data.versionDelta) })}
          </StatusBadge>
        ) : null}
      </div>

      {diff.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : diff.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("configSyncPanel.diff.failed")}
        </p>
      ) : !diff.data ? null : diff.data.addedPointCodes.length === 0 &&
        diff.data.removedPointCodes.length === 0 &&
        diff.data.changedPoints.length === 0 ? (
        <p className="text-sm text-text-muted">{t("configSyncPanel.diff.upToDate")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {diff.data.addedPointCodes.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ok-text">
                <PlusCircle className="size-3.5" aria-hidden="true" />
                {t("configSyncPanel.diff.addedTitle", { count: diff.data.addedPointCodes.length })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {diff.data.addedPointCodes.map((code) => (
                  <Badge key={code} variant="outline" className="font-numeric">
                    {code}
                  </Badge>
                ))}
              </div>
              <p className="text-[11px] text-text-muted">{t("configSyncPanel.diff.addedHint")}</p>
            </div>
          ) : null}

          {diff.data.removedPointCodes.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-danger-text">
                <MinusCircle className="size-3.5" aria-hidden="true" />
                {t("configSyncPanel.diff.removedTitle", { count: diff.data.removedPointCodes.length })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {diff.data.removedPointCodes.map((code) => {
                  const local = localProduct?.points.find((p) => p.code.toLowerCase() === code.toLowerCase())
                  return (
                    <Badge key={code} variant="outline" className="font-numeric">
                      {code}
                      {local ? ` · ${local.name}` : ""}
                    </Badge>
                  )
                })}
              </div>
              <p className="text-[11px] text-text-muted">{t("configSyncPanel.diff.removedHint")}</p>
            </div>
          ) : null}

          {diff.data.changedPoints.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-warn-text">
                <PencilLine className="size-3.5" aria-hidden="true" />
                {t("configSyncPanel.diff.changedTitle", { count: diff.data.changedPoints.length })}
              </span>
              <div className="grid grid-cols-[minmax(84px,auto)_1fr_1fr] gap-x-3 px-2.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                <span>{t("configSyncPanel.diff.fieldColumn")}</span>
                <span>{t("configSyncPanel.diff.localColumn")}</span>
                <span>{t("configSyncPanel.diff.ecosystemColumn")}</span>
              </div>
              <div className="flex flex-col gap-2">
                {diff.data.changedPoints.map((point) => (
                  <ChangedPointCard key={point.code} point={point} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Pull result — shared between the points (AOI/AVI) and recipe (Automation/IoT) sync sections; both
// mutations return the same `MachineConfigPullResultDto` shape.
// ─────────────────────────────────────────────────────────────────────────

function PullResultPanel({ result }: { result: MachineConfigPullResultDto }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 border border-ok/30 bg-ok/5 p-3" role="status">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ok-text">
        <ArrowDownToLine className="size-4" aria-hidden="true" />
        {t("configSyncPanel.pullResult.title")}
      </div>
      {result.applied ? (
        <>
          <p className="font-numeric text-sm text-text-strong">
            {t("configSyncPanel.pullResult.summary", {
              from: result.fromVersion ?? t("configSyncPanel.detail.noLocalVersion"),
              to: result.toVersion ?? "—",
            })}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:w-fit sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-text-muted">{t("configSyncPanel.pullResult.pointsApplied")}</dt>
              <dd className="font-numeric font-medium text-text-strong">{result.pointsApplied}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-text-muted">{t("configSyncPanel.pullResult.pointsRemoved")}</dt>
              <dd className="font-numeric font-medium text-text-strong">{result.pointsRemoved}</dd>
            </div>
          </dl>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-text-muted">{t("configSyncPanel.pullResult.notApplied")}</p>
          <p className="font-mono text-[11px] text-text-muted">{result.message}</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Push result — Task C7 §4: version bump, counts, and — the part that must never hide behind a plain
// "success" — governance blocks (`limitChangesBlocked`) and conflicts (`staleConflicts`/
// `blindOverwrites`) surfaced as their own prominent banners, plus a per-point outcome chip strip so a
// SPECIFIC blocked point is identifiable, not just an aggregate count.
// ─────────────────────────────────────────────────────────────────────────

function PushResultPanel({ result }: { result: MachineConfigPushResultDto }) {
  const t = useT()

  const notConfirmed = !result.success && result.previousVersion == null && result.newVersion == null && result.points.length === 0
  if (notConfirmed) {
    return (
      <div className="flex flex-col gap-1 border border-border-strong p-3" role="status">
        <p className="text-sm text-text-muted">{t("configSyncPanel.pushResult.notConfirmed")}</p>
      </div>
    )
  }

  const tone: "danger" | "warn" | "ok" = !result.success
    ? "danger"
    : result.limitChangesBlocked || result.staleConflicts > 0
      ? "warn"
      : "ok"
  const toneClasses: Record<typeof tone, { border: string; text: string }> = {
    danger: { border: "border-danger/30 bg-danger/5", text: "text-danger-text" },
    warn: { border: "border-warn/30 bg-warn/5", text: "text-warn-text" },
    ok: { border: "border-ok/30 bg-ok/5", text: "text-ok-text" },
  }

  return (
    <div className={cn("flex flex-col gap-3 border p-3", toneClasses[tone].border)} role="status">
      <div className={cn("flex flex-wrap items-center gap-1.5 text-sm font-semibold", toneClasses[tone].text)}>
        <ArrowUpFromLine className="size-4 shrink-0" aria-hidden="true" />
        {t("configSyncPanel.pushResult.title")}
        {result.previousVersion != null && result.newVersion != null ? (
          <span className="font-numeric font-normal">
            {t("configSyncPanel.pushResult.versionBump", { from: result.previousVersion, to: result.newVersion })}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-text-muted">{t("configSyncPanel.pushResult.created")}</dt>
          <dd className="font-numeric font-medium text-text-strong">{result.pointsCreated}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-text-muted">{t("configSyncPanel.pushResult.updated")}</dt>
          <dd className="font-numeric font-medium text-text-strong">{result.pointsUpdated}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-text-muted">{t("configSyncPanel.pushResult.pointsFailed")}</dt>
          <dd className="font-numeric font-medium text-text-strong">{result.pointsFailed}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-text-muted">{t("configSyncPanel.pushResult.staleConflicts")}</dt>
          <dd className="font-numeric font-medium text-text-strong">{result.staleConflicts}</dd>
        </div>
      </dl>

      {/* Governance/conflict banners — deliberately rendered even when `result.success` is true (a
          blocked-limits push IS a "success" at the HTTP/point level, per the contract: geometry/name
          still synced). This is the "never present a blocked push as a plain success" requirement. */}
      {result.limitChangesBlocked ? (
        <p
          role="alert"
          className="flex items-start gap-2 border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs font-medium text-warn-text"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("configSyncPanel.pushResult.limitBlockedBanner")}
        </p>
      ) : null}

      {result.staleConflicts > 0 ? (
        <p
          role="alert"
          className="flex items-start gap-2 border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs font-medium text-warn-text"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("configSyncPanel.pushResult.conflictBanner", { count: result.staleConflicts })}
        </p>
      ) : null}

      {result.points.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-muted">{t("configSyncPanel.pushResult.pointsTitle")}</span>
          <div className="flex flex-wrap gap-1.5">
            {result.points.map((point) => (
              <span
                key={point.code}
                className={cn(
                  "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] font-medium",
                  point.limitBlocked
                    ? "border-warn/30 bg-warn/10 text-warn-text"
                    : "border-border-strong bg-surface-subtle text-text-body"
                )}
              >
                <span className="font-numeric">{point.code}</span>
                <span className="text-text-muted">· {pointStatusLabel(t, point.status)}</span>
                {point.limitBlocked ? (
                  <>
                    <ShieldAlert className="size-3" aria-hidden="true" />
                    <span className="sr-only">{t("configSyncPanel.pushResult.pointLimitBlocked")}</span>
                  </>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <p className="font-mono text-[11px] text-text-muted">{result.message}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Push confirm dialog — Task C7 §4: guarded, Live gets an explicit "writes to the real ecosystem"
// warning (danger-toned submit button too), Demo gets a calmer "safe to try" note. Summarizes what a
// push actually does (pushes every currently-active LOCAL point of this product — see
// `ConfigSyncEngine.PushAsync`'s own doc comment — not just the diffed subset).
// ─────────────────────────────────────────────────────────────────────────

function PushConfirmDialog({
  open,
  onOpenChange,
  productCode,
  mode,
  activePointCount,
  localVersion,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productCode: string
  mode: TransportMode
  activePointCount: number
  localVersion: number | null | undefined
  pending: boolean
  onConfirm: () => void
}) {
  const t = useT()
  // Auto's per-call resolution (Live if a server+key are configured, else Demo) isn't exposed over HTTP
  // (see `ModeIndicator`'s own comment) — a guarded push errs toward the STRONGER caution whenever mode
  // isn't definitively "Demo", rather than silently under-warning a push that might actually be Live.
  const isDefinitelyLive = mode === "Live"
  const isAmbiguous = mode === "Auto"
  const noteTone = isDefinitelyLive ? "danger" : isAmbiguous ? "warn" : "info"
  const noteClasses: Record<typeof noteTone, string> = {
    danger: "border-danger/30 bg-danger/10 text-danger-text",
    warn: "border-warn/30 bg-warn/10 text-warn-text",
    info: "border-info/20 bg-info/10 text-info-text",
  }
  const noteText = isDefinitelyLive
    ? t("configSyncPanel.pushConfirm.liveWarning")
    : isAmbiguous
      ? t("configSyncPanel.pushConfirm.autoNote")
      : t("configSyncPanel.pushConfirm.demoNote")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("configSyncPanel.pushConfirm.title", { code: productCode })}</DialogTitle>
          <DialogDescription>
            {t("configSyncPanel.pushConfirm.summary", {
              count: activePointCount,
              code: productCode,
              version: localVersion ?? "—",
            })}
          </DialogDescription>
        </DialogHeader>

        <p className={cn("flex items-start gap-2 border px-2.5 py-2 text-xs font-medium", noteClasses[noteTone])}>
          {noteTone === "info" ? (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {noteText}
        </p>
        <p className="text-xs text-text-muted">{t("configSyncPanel.pushConfirm.governanceNote")}</p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("configSyncPanel.pushConfirm.cancel")}
          </Button>
          <Button type="button" variant={isDefinitelyLive ? "destructive" : "default"} onClick={onConfirm} disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpFromLine className="size-3.5" aria-hidden="true" />
            )}
            {pending ? t("configSyncPanel.pushConfirm.submitting") : t("configSyncPanel.pushConfirm.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Points (AOI/AVI, System B) — a products-drift overview (every product the ecosystem knows, since an
// AOI/AVI machine doesn't own a single fixed product any more than the real system does — see
// `ConfigSyncEngine.CheckAsync`'s own doc comment) plus a detail panel for whichever one is selected.
// ─────────────────────────────────────────────────────────────────────────

function ProductsDriftTable({
  machineCode,
  selected,
  onSelect,
}: {
  machineCode: string
  selected: string | null
  onSelect: (code: string) => void
}) {
  const t = useT()
  const gloss = useGloss()
  const check = useMachineConfigCheck(machineCode)

  return (
    <Sheet
      title={t("configSyncPanel.products.title")}
      titleEn={gloss("configSyncPanel.products.title")}
      headerRight={
        <>
          <Boxes className="size-4 text-primary-text" aria-hidden="true" />
          <Button type="button" variant="outline" size="sm" onClick={() => void check.refetch()} disabled={check.isFetching}>
            <RefreshCw className={cn("size-3.5", check.isFetching && "animate-spin")} aria-hidden="true" />
            {check.isFetching ? t("configSyncPanel.refreshing") : t("configSyncPanel.refreshBtn")}
          </Button>
        </>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {check.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : check.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("configSyncPanel.checkFailed")}
        </p>
      ) : !check.data || check.data.products.length === 0 ? (
        <p className="text-sm text-text-muted">{t("configSyncPanel.products.empty")}</p>
      ) : (
        <div className="overflow-hidden border border-border-strong">
          <Table>
            <TableBody>
              {check.data.products.map((product) => {
                const isSelected = product.productModelCode.toLowerCase() === (selected ?? "").toLowerCase()
                return (
                  <TableRow
                    key={product.productModelCode}
                    onClick={() => onSelect(product.productModelCode)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelect(product.productModelCode)
                      }
                    }}
                    tabIndex={0}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={t("configSyncPanel.products.selectAria", { code: product.productModelCode })}
                    className={cn(
                      "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50",
                      isSelected && "bg-navy-50 dark:bg-navy-800/40"
                    )}
                  >
                    <TableCell className="font-numeric font-medium text-text-strong">{product.productModelCode}</TableCell>
                    <TableCell className="font-numeric text-text-muted">
                      {product.localVersion != null
                        ? t("configSyncPanel.products.localVersionShort", { version: product.localVersion })
                        : t("configSyncPanel.products.localVersionNone")}
                    </TableCell>
                    <TableCell className="font-numeric text-text-muted">
                      {t("configSyncPanel.products.ecosystemVersionShort", { version: product.ecosystemVersion })}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={DRIFT_BADGE[product.driftState] ?? "neutral"}>
                        {t(`configSyncPanel.driftState.${product.driftState}`)}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Sheet>
  )
}

function ProductSyncDetail({ machineCode, productCode }: { machineCode: string; productCode: string }) {
  const t = useT()
  const check = useMachineConfigCheck(machineCode)
  const drift = check.data?.products.find((p) => p.productModelCode.toLowerCase() === productCode.toLowerCase())
  const localProduct = useProduct(productCode)
  const diff = useMachineConfigDiff(machineCode, productCode)
  const { data: modeData } = useMode()
  const mode = modeData?.mode ?? "Demo"

  const pull = useMachineConfigPull()
  const push = useMachineConfigPush()
  const [pullResult, setPullResult] = React.useState<MachineConfigPullResultDto | null>(null)
  const [pushResult, setPushResult] = React.useState<MachineConfigPushResultDto | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // Selecting a DIFFERENT product clears the previous one's transient pull/push result panels — those
  // are per-product outcomes, not a running log (the history card below is the log).
  React.useEffect(() => {
    setPullResult(null)
    setPushResult(null)
    setConfirmOpen(false)
  }, [productCode])

  function handlePull() {
    pull.mutate(
      { machineCode, body: { productCode } },
      {
        onSuccess: (data) => {
          setPullResult(data)
          toast.success(t("toast.configPulled", { code: productCode, version: data.toVersion ?? "—" }))
        },
        onError: () => toast.error(t("toast.configPullFailed")),
      }
    )
  }

  function handlePushConfirmed() {
    push.mutate(
      { machineCode, body: { productCode, confirm: true } },
      {
        onSuccess: (data) => {
          setPushResult(data)
          setConfirmOpen(false)
          // Task review #5 — `data.success` alone overstates: it stays true when `staleConflicts>0`
          // (a conflict is rejected-not-overwritten, not counted as `failed`), so a plain green "pushed"
          // toast would misrepresent a push that actually left some points un-synced. Branch the SAME way
          // `PushResultPanel`'s persistent banner already does (governance block OR conflicts -> warn).
          if (!data.success) {
            toast.error(t("toast.configPushFailed"))
          } else if (data.limitChangesBlocked) {
            toast.warning(t("toast.configPushBlocked", { code: productCode }))
          } else if (data.staleConflicts > 0) {
            toast.warning(t("toast.configPushConflicts", { code: productCode, count: data.staleConflicts }))
          } else {
            toast.success(t("toast.configPushed", { code: productCode, version: data.newVersion ?? "—" }))
          }
        },
        onError: () => {
          setConfirmOpen(false)
          toast.error(t("toast.configPushFailed"))
        },
      }
    )
  }

  const localVersionLabel = drift?.localVersion != null ? String(drift.localVersion) : t("configSyncPanel.detail.noLocalVersion")
  const activePointCount = localProduct.data?.points.filter((p) => !p.deletedAt).length ?? 0
  const canPush = drift?.driftState !== "unknown"

  return (
    <Sheet bodyClassName="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-[15px] font-semibold tracking-tight text-text-strong">
          {t("configSyncPanel.detail.versionHeading", {
            code: productCode,
            local: localVersionLabel,
            eco: drift?.ecosystemVersion ?? "—",
          })}
        </h3>
        {drift ? (
          <StatusBadge status={DRIFT_BADGE[drift.driftState] ?? "neutral"}>
            {t(`configSyncPanel.driftState.${drift.driftState}`)}
          </StatusBadge>
        ) : null}
      </div>

      {localProduct.data?.imageHash ? (
        <p className="font-mono text-[11px] text-text-muted" title={localProduct.data.imageHash}>
          {t("configSyncPanel.detail.imageIdentityLabel")}: {shortChecksum(localProduct.data.imageHash)}
        </p>
      ) : null}

      {/* Task C8 — the checksum-first drift key the engine actually decided `drift.driftState`
          with (byte-exact when both sides have one; a version-only fallback otherwise). */}
      {drift?.localChecksum || drift?.ecosystemChecksum ? (
        <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          <div className="flex flex-col gap-0.5">
            <dt className="text-text-muted">{t("configSyncPanel.detail.pointsChecksumLocalLabel")}</dt>
            <dd className="font-mono text-text-strong" title={drift?.localChecksum ?? undefined}>
              {drift?.localChecksum ? shortChecksum(drift.localChecksum) : t("configSyncPanel.diff.noValue")}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-text-muted">{t("configSyncPanel.detail.pointsChecksumEcosystemLabel")}</dt>
            <dd className="font-mono text-text-strong" title={drift?.ecosystemChecksum ?? undefined}>
              {drift?.ecosystemChecksum ? shortChecksum(drift.ecosystemChecksum) : t("configSyncPanel.diff.noValue")}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handlePull} disabled={pull.isPending}>
            {pull.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowDownToLine className="size-3.5" aria-hidden="true" />
            )}
            {pull.isPending ? t("configSyncPanel.detail.pulling") : t("configSyncPanel.detail.pullBtn")}
          </Button>
          <Button type="button" onClick={() => setConfirmOpen(true)} disabled={push.isPending || !canPush}>
            <ArrowUpFromLine className="size-3.5" aria-hidden="true" />
            {t("configSyncPanel.detail.pushBtn")}
          </Button>
        </div>
        {!canPush ? <p className="text-[11px] text-text-muted">{t("configSyncPanel.detail.pushDisabledHint")}</p> : null}
      </div>

      {pull.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("configSyncPanel.detail.pullFailed")}
        </p>
      ) : null}

      {pullResult ? <PullResultPanel result={pullResult} /> : null}
      {pushResult ? <PushResultPanel result={pushResult} /> : null}

      <ProductDiffView diff={diff} localProduct={localProduct.data} />

      <PushConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        productCode={productCode}
        mode={mode}
        activePointCount={activePointCount}
        localVersion={localProduct.data?.pointsConfigVersion}
        pending={push.isPending}
        onConfirm={handlePushConfirmed}
      />
    </Sheet>
  )
}

function PointsSyncSection({ machineCode }: { machineCode: string }) {
  const check = useMachineConfigCheck(machineCode)
  const [selected, setSelected] = React.useState<string | null>(null)
  const autoSelectedRef = React.useRef(false)

  React.useEffect(() => {
    if (autoSelectedRef.current) return
    const products = check.data?.products
    if (!products || products.length === 0) return
    autoSelectedRef.current = true
    const firstDrift = products.find((p) => p.driftState !== "in_sync")
    setSelected((firstDrift ?? products[0]).productModelCode)
  }, [check.data])

  return (
    <>
      <ProductsDriftTable machineCode={machineCode} selected={selected} onSelect={setSelected} />
      {selected ? <ProductSyncDetail machineCode={machineCode} productCode={selected} /> : null}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Recipe (Automation/IoT, System A) — check + pull only. No diff (the engine's own `DiffAsync` 400s for
// non-AOI/AVI machines) and no push from here — machines can't author recipes at all (server: recipes
// are human-authored in SYNAPSE, 2-person approved); a Demo-only push exists on the recipe's own
// authoring page (`RecipeConfigDetail.tsx`), linked below instead of duplicated here.
// ─────────────────────────────────────────────────────────────────────────

function RecipeSyncSection({ machineCode }: { machineCode: string }) {
  const t = useT()
  const check = useMachineConfigCheck(machineCode)
  const recipeDrift = check.data?.recipe ?? null
  const localRecipe = useRecipe(recipeDrift?.code)
  const pull = useMachineConfigPull()
  const [pullResult, setPullResult] = React.useState<MachineConfigPullResultDto | null>(null)

  function handlePull() {
    pull.mutate(
      { machineCode, body: {} },
      {
        onSuccess: (data) => {
          setPullResult(data)
          if (data.applied) {
            toast.success(t("toast.configPulled", { code: data.code, version: data.toVersion ?? "—" }))
          } else {
            toast.error(t("configSyncPanel.recipe.pullFailed"))
          }
        },
        onError: () => toast.error(t("configSyncPanel.recipe.pullFailed")),
      }
    )
  }

  return (
    <Sheet
      title={t("configSyncPanel.title")}
      headerRight={<Wrench className="size-4 text-primary-text" aria-hidden="true" />}
      bodyClassName="flex flex-col gap-4"
    >
      {check.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : check.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("configSyncPanel.checkFailed")}
        </p>
      ) : !recipeDrift ? (
        <p className="text-sm text-text-muted">{t("configSyncPanel.recipe.noneResolved")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-heading text-sm font-semibold tracking-tight text-text-strong">
              {t("configSyncPanel.recipe.versionHeading", {
                code: recipeDrift.code,
                local: recipeDrift.localVersion ?? t("configSyncPanel.detail.noLocalVersion"),
                eco: recipeDrift.ecosystemVersion,
              })}
            </h4>
            <StatusBadge status={DRIFT_BADGE[recipeDrift.driftState] ?? "neutral"}>
              {t(`configSyncPanel.driftState.${recipeDrift.driftState}`)}
            </StatusBadge>
          </div>

          <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <dt className="text-text-muted">{t("configSyncPanel.recipe.resolvedByLabel")}</dt>
              <dd className="font-medium text-text-strong">
                {t(`configSyncPanel.recipe.resolvedBy.${recipeDrift.resolvedBy}`)}
              </dd>
            </div>
            {localRecipe.data?.checksum ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-text-muted">{t("configSyncPanel.recipe.checksumLabel")}</dt>
                <dd className="font-mono text-text-strong" title={localRecipe.data.checksum}>
                  {shortChecksum(localRecipe.data.checksum)}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={handlePull} disabled={pull.isPending}>
              {pull.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowDownToLine className="size-3.5" aria-hidden="true" />
              )}
              {pull.isPending ? t("configSyncPanel.recipe.pulling") : t("configSyncPanel.recipe.pullBtn")}
            </Button>
            <Link
              href={`/recipes/${recipeDrift.code}`}
              className="inline-flex items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline"
            >
              {t("configSyncPanel.recipe.viewRecipeLink", { code: recipeDrift.code })}
              <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          </div>

          {pullResult ? <PullResultPanel result={pullResult} /> : null}

          <p className="border border-info/20 bg-info/10 px-3 py-2 text-xs text-info-text">
            {t("configSyncPanel.recipe.pushUnavailable")}
          </p>
        </>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Sync history — the audit trail, shared by both device-class paths (keyed by machine code only).
// ─────────────────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: ConfigSyncHistoryEntryDto }) {
  const t = useT()
  const opLabel = entry.op === "push" ? t("configSyncPanel.history.op.push") : t("configSyncPanel.history.op.pull")
  const OpIcon = entry.op === "push" ? ArrowUpFromLine : ArrowDownToLine
  const statusTone: BadgeStatus = entry.status === "success" ? "ok" : "danger"
  const statusLabel = entry.status === "success" ? t("configSyncPanel.history.status.success") : t("configSyncPanel.history.status.failed")

  return (
    <TableRow>
      <TableCell className="text-text-body">
        <span className="inline-flex items-center gap-1.5">
          <OpIcon className="size-3.5 text-primary-text" aria-hidden="true" />
          {opLabel}
        </span>
      </TableCell>
      <TableCell className="font-numeric font-medium text-text-strong">{entry.code}</TableCell>
      <TableCell className="font-numeric text-text-muted">
        {t("configSyncPanel.history.versionCell", { from: entry.fromVersion ?? "—", to: entry.toVersion ?? "—" })}
      </TableCell>
      <TableCell>
        <StatusBadge status={statusTone}>{statusLabel}</StatusBadge>
      </TableCell>
      <TableCell className="font-numeric text-text-muted">{formatCycleTime(entry.occurredAt)}</TableCell>
    </TableRow>
  )
}

function SyncHistoryCard({ machineCode }: { machineCode: string }) {
  const t = useT()
  const gloss = useGloss()
  const history = useMachineConfigHistory(machineCode)

  return (
    <Sheet
      title={t("configSyncPanel.history.title")}
      titleEn={gloss("configSyncPanel.history.title")}
      headerRight={<History className="size-4 text-primary-text" aria-hidden="true" />}
      bodyClassName="flex flex-col gap-3"
    >
      {history.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : history.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("configSyncPanel.history.failed")}
        </p>
      ) : !history.data || history.data.length === 0 ? (
        <p className="text-sm text-text-muted">{t("configSyncPanel.history.empty")}</p>
      ) : (
        <div
          tabIndex={0}
          className="hmi-scroll overflow-x-auto border border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("configSyncPanel.history.columnOp")}</TableHead>
                <TableHead>{t("configSyncPanel.history.columnCode")}</TableHead>
                <TableHead>{t("configSyncPanel.history.columnVersion")}</TableHead>
                <TableHead>{t("configSyncPanel.history.columnStatus")}</TableHead>
                <TableHead>{t("configSyncPanel.history.columnTime")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data.map((entry) => (
                <HistoryRow key={entry.seq} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Root — Task C7. Replaces the old generic "sync recipe" stub (`/v1/machines/{code}/sync-config`, a
// pre-C1 mapping-profile concept unrelated to this product-config-sync system) with the real per-machine
// workspace against the C2/C3 sync engine: version/drift, diff-before-apply, pull, guarded push with
// governance/conflict surfacing, and sync history. AOI/AVI machines sync points (System B, multiple
// products); every other device class syncs a recipe (System A, auto-resolved by machine type).
// ─────────────────────────────────────────────────────────────────────────

export interface ConfigSyncPanelProps {
  code: string
  deviceClass: DeviceClass
  className?: string
}

export function ConfigSyncPanel({ code, deviceClass, className }: ConfigSyncPanelProps) {
  const t = useT()
  const gloss = useGloss()
  const isPoints = deviceClass === "AoiAvi"

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg leading-none font-semibold tracking-tight text-text-strong">
            {t("configSyncPanel.title")}
          </h2>
          <p className="hmi-micro mt-1">{gloss("configSyncPanel.title")}</p>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t("configSyncPanel.description")}</p>
        </div>
        <ModeIndicator />
      </div>

      {isPoints ? <PointsSyncSection machineCode={code} /> : <RecipeSyncSection machineCode={code} />}

      <SyncHistoryCard machineCode={code} />
    </div>
  )
}
