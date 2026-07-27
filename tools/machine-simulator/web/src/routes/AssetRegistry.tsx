import * as React from "react"
import { motion } from "framer-motion"
import { Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import { useAsset, useAssets, useSetAssetLifecycle, type AssetLifecycleState, type AssetRecord } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * P2-2 (WS-J Asset Registry, `.superpowers/sdd/2026-07-27-giaidoan2-pass2-blueprint/task-2-brief.md`)
 * — `/assets`: an Operator-readable list over P2-1's persisted asset registry (`GET /v1/assets`), a
 * row-click detail dialog (`GET /v1/assets/{code}`), and an Engineer+ lifecycle transition control
 * (`PUT /v1/assets/{code}/lifecycle`). Same filter-free list + detail-dialog idiom `Audit.tsx`
 * established, simplified: reads are Operator (every authenticated role sees the whole page, unlike
 * `Audit`/`Users`' own Admin-only full-page `RequireRole`), and the registry is expected to stay small
 * (one row per provisioned machine) so there's no pagination.
 *
 * Only the transition CONTROL (inside the detail dialog) is role-gated — see `RequireRole` below.
 */

const LIFECYCLE_STATES: AssetLifecycleState[] = [
  "Provisioned",
  "Commissioning",
  "Active",
  "Maintenance",
  "Decommissioned",
]

/** Lifecycle → `StatusBadge` tone. `Active` is the one genuinely-`ok` state; `Decommissioned` is a
 * hard stop (`danger`); `Maintenance` is a caution (`warn`); `Commissioning` is "in progress, worth
 * noting" (`info`); `Provisioned` (freshly registered, not yet commissioned) is `neutral` — matching
 * `TRANSPORT_MODE_TONE`'s own reasoning above in `lib/api.ts`: a lifecycle STAGE isn't automatically
 * good or bad, only `Active`/`Decommissioned` carry an unambiguous verdict. */
const LIFECYCLE_TONE: Record<AssetLifecycleState, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  Provisioned: "neutral",
  Commissioning: "info",
  Active: "ok",
  Maintenance: "warn",
  Decommissioned: "danger",
}

// The web app's own `DeviceClass`/`DriverKind` unions (`lib/api.ts`) don't necessarily cover every
// value the registry can hold (P2-3 adds a `"Modbus"` driver kind later; GĐ3 sub-3 OU-2 adds `"OpcUa"`) —
// `AssetRecord.deviceClass`/`driverKind` are plain `string` for exactly that reason. These two label
// helpers render the resolved i18n label for a KNOWN value, falling back to the raw wire value verbatim
// for anything else, rather than `t()`'s own generic "missing key" fallback (which would print the ugly
// literal dot-path, e.g. `"driverKind.Modbus"`).
const KNOWN_DEVICE_CLASSES = new Set(["Automation", "Iot", "AoiAvi"])
const KNOWN_DRIVER_KINDS = new Set(["Simulated", "HotFolderAoi", "Mqtt", "Modbus", "OpcUa"])

type TFunc = ReturnType<typeof useT>

function deviceClassLabel(t: TFunc, value: string): string {
  return KNOWN_DEVICE_CLASSES.has(value) ? t(`deviceClass.${value}`) : value
}

function driverKindLabel(t: TFunc, value: string): string {
  return KNOWN_DRIVER_KINDS.has(value) ? t(`driverKind.${value}`) : value
}

const assetDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatAssetTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : assetDateTimeFormatter.format(d)
}

/** Rank order for the Engineer+ gate below — same hierarchy `Sidebar.tsx`'s `ROLE_RANK`/`meetsMinRole`
 * already encode server-side (`Policies.Engineer` = Engineer OR Admin). This is the first Engineer+
 * (not Admin-only) client gate in the app: `Audit.tsx`/`Users.tsx`'s own local `RequireRole` checks
 * exact string equality, which happens to be correct for THEM only because Admin has nothing above it
 * to differ from — reused verbatim here it would wrongly block an Admin from a control the SERVER
 * lets Admin use just as freely as Engineer. */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** Client-side Engineer+ gate for the lifecycle transition control ONLY — never the whole page (reads
 * are Operator, `AssetEndpoints.MapAssetEndpoints`). Renders a small inline note instead of the
 * control for anyone below `role`; the server's own `Policies.Engineer` is the real enforcement. */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const t = useT()
  const { user } = useAuth()

  if (!meetsMinRole(role, user?.role)) {
    return <p className="text-xs text-text-muted">{t("assets.detail.transitionRequiresEngineer")}</p>
  }

  return <>{children}</>
}

/** Bilingual column header — same register `Audit.tsx`'s own `Th` uses (primary language on top, a
 * small uppercase gloss beneath, `aria-hidden`). */
function Th({ vi, en, className }: { vi: string; en: string; className?: string }) {
  return (
    <TableHead className={className}>
      <span className="flex flex-col">
        <span>{vi}</span>
        <span className="hmi-micro font-normal" aria-hidden="true">
          {en}
        </span>
      </span>
    </TableHead>
  )
}

function RowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-48" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
    </TableRow>
  )
}

function AssetTable({
  items,
  isPending,
  isError,
  onSelect,
}: {
  items: AssetRecord[]
  isPending: boolean
  isError: boolean
  onSelect: (code: string) => void
}) {
  const t = useT()
  const gloss = useGloss()

  if (isError) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-danger-text">
        {t("assets.table.loadFailed")}
      </div>
    )
  }

  if (!isPending && items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted">
        {t("assets.table.empty")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-surface-card">
        <TableRow>
          <Th vi={t("assets.table.code")} en={gloss("assets.table.code")} />
          <Th vi={t("assets.table.urn")} en={gloss("assets.table.urn")} />
          <Th vi={t("assets.table.deviceClass")} en={gloss("assets.table.deviceClass")} />
          <Th vi={t("assets.table.driverKind")} en={gloss("assets.table.driverKind")} />
          <Th vi={t("assets.table.lifecycle")} en={gloss("assets.table.lifecycle")} />
          <Th vi={t("assets.table.updated")} en={gloss("assets.table.updated")} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <RowSkeleton key={i} />)
          : items.map((asset) => (
              <TableRow
                key={asset.code}
                tabIndex={0}
                role="button"
                aria-label={t("assets.table.rowAria", { code: asset.code })}
                onClick={() => onSelect(asset.code)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(asset.code)
                  }
                }}
                className="cursor-pointer transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50"
              >
                <TableCell className="font-medium text-text-strong">{asset.code}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs text-text-muted" title={asset.urn}>
                  {asset.urn}
                </TableCell>
                <TableCell className="text-text-body">{deviceClassLabel(t, asset.deviceClass)}</TableCell>
                <TableCell className="text-text-body">{driverKindLabel(t, asset.driverKind)}</TableCell>
                <TableCell>
                  <StatusBadge status={LIFECYCLE_TONE[asset.lifecycle]}>
                    {t(`assets.lifecycle.${asset.lifecycle}`)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="font-numeric whitespace-nowrap text-text-muted">
                  {formatAssetTime(asset.updatedAtUtc)}
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="text-sm text-text-body">{children}</dd>
    </div>
  )
}

function AssetDetailDialog({ code, onOpenChange }: { code: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const { data: asset, isPending, isError } = useAsset(code ?? undefined)
  const setLifecycle = useSetAssetLifecycle()
  const [nextState, setNextState] = React.useState<AssetLifecycleState | null>(null)

  // The <select> always starts on the asset's OWN current lifecycle — reset the pending selection
  // whenever a different asset's record loads (a fresh `code`, or the mutation's own refreshed data),
  // never carrying over whatever was left selected for a previously viewed asset.
  React.useEffect(() => {
    setNextState(asset?.lifecycle ?? null)
  }, [asset?.code, asset?.lifecycle])

  function handleSave() {
    if (!asset || !nextState || nextState === asset.lifecycle) return
    setLifecycle.mutate(
      { code: asset.code, state: nextState },
      {
        onSuccess: () => toast.success(t("toast.assetLifecycleUpdated", { code: asset.code })),
        onError: () => toast.error(t("toast.assetLifecycleUpdateFailed")),
      }
    )
  }

  return (
    <Dialog open={code !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("assets.detail.title", { code: code ?? "" })}</DialogTitle>
          <DialogDescription>{t("assets.detail.description")}</DialogDescription>
        </DialogHeader>

        {isError ? (
          <p className="text-sm text-danger-text">{t("assets.detail.loadFailed")}</p>
        ) : isPending || !asset ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("assets.detail.urn")}
                </dt>
                <dd className="font-mono text-xs break-all text-text-body">{asset.urn}</dd>
              </div>
              <DetailField label={t("assets.detail.deviceClass")}>{deviceClassLabel(t, asset.deviceClass)}</DetailField>
              <DetailField label={t("assets.detail.driverKind")}>{driverKindLabel(t, asset.driverKind)}</DetailField>
              <DetailField label={t("assets.detail.machineType")}>{asset.machineType}</DetailField>
              <DetailField label={t("assets.detail.currentLifecycle")}>
                <StatusBadge status={LIFECYCLE_TONE[asset.lifecycle]}>
                  {t(`assets.lifecycle.${asset.lifecycle}`)}
                </StatusBadge>
              </DetailField>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("assets.detail.checksum")}
                </dt>
                <dd className="font-mono text-xs break-all text-text-muted">
                  {asset.configChecksum ?? t("assets.detail.checksumNone")}
                </dd>
              </div>
              <DetailField label={t("assets.detail.created")}>{formatAssetTime(asset.createdAtUtc)}</DetailField>
              <DetailField label={t("assets.detail.updated")}>{formatAssetTime(asset.updatedAtUtc)}</DetailField>
            </dl>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                {t("assets.detail.transition")}
              </span>
              <RequireRole role="Engineer">
                <div className="flex items-center gap-2">
                  <Select
                    value={nextState ?? asset.lifecycle}
                    onValueChange={(next) => next && setNextState(next)}
                  >
                    <SelectTrigger aria-label={t("assets.detail.transition")} className="h-8 w-48 text-xs">
                      <SelectValue>{t(`assets.lifecycle.${nextState ?? asset.lifecycle}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectPortal>
                      <SelectPositioner>
                        <SelectPopup>
                          {LIFECYCLE_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {t(`assets.lifecycle.${state}`)}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </SelectPositioner>
                    </SelectPortal>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={setLifecycle.isPending || !nextState || nextState === asset.lifecycle}
                  >
                    {setLifecycle.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                    {setLifecycle.isPending ? t("assets.detail.saving") : t("assets.detail.save")}
                  </Button>
                </div>
              </RequireRole>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AssetRegistryScreen() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useAssets()
  const [selectedCode, setSelectedCode] = React.useState<string | null>(null)

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Package className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("assets.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("assets.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("assets.description")}</p>
      </div>

      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col gap-2 p-0">
        <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
          <AssetTable items={data ?? []} isPending={isPending} isError={isError} onSelect={setSelectedCode} />
        </div>
      </Sheet>

      <AssetDetailDialog
        code={selectedCode}
        onOpenChange={(open) => {
          if (!open) setSelectedCode(null)
        }}
      />
    </motion.div>
  )
}

export default function AssetRegistry() {
  return <AssetRegistryScreen />
}
