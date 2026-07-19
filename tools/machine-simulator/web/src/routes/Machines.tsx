import * as React from "react"
import { motion } from "framer-motion"
import { ChevronRight, Factory, Inbox, Search, SearchX, X } from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { useLocation } from "wouter"

import { useT } from "@/i18n"
import { useFleet, useFleetIsRunning, type DeviceClass, type FleetTile } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Sparkline } from "@/components/Sparkline"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>
type T = (key: string, vars?: Record<string, string | number>) => string

// Same StatusText → badge mapping as MachineCard.tsx/MachineDetail.tsx (the engine's own verdict
// label, MachineState.cs) — duplicated locally rather than shared, matching this codebase's own
// established convention for this small map (see MachineDetail.tsx's identical comment on its copy).
const STATUS_META: Record<string, { status: BadgeStatus; key: string }> = {
  Idle: { status: "neutral", key: "status.idle" },
  OK: { status: "ok", key: "status.ok" },
  WARN: { status: "warn", key: "status.warn" },
  FAIL: { status: "danger", key: "status.fail" },
  TELEMETRY: { status: "info", key: "status.telemetry" },
}

function statusMetaFor(t: T, statusText: string): { status: BadgeStatus; label: string } {
  const meta = STATUS_META[statusText]
  return meta ? { status: meta.status, label: t(meta.key) } : { status: "neutral", label: statusText }
}

// Canonical display order for the two filter dropdowns — deterministic, not alphabetical. Each list is
// further narrowed to whatever's actually present in the current roster (see `typeOptions`/
// `statusOptions` below), so a stopped fleet's Status filter only ever offers "Idle" instead of 4
// options that can't currently match anything.
const DEVICE_CLASS_ORDER: DeviceClass[] = ["Automation", "Iot", "AoiAvi"]
const STATUS_ORDER = ["Idle", "OK", "WARN", "FAIL", "TELEMETRY"]

const ALL = "__all__"

interface FilterSelectProps {
  label: string
  value: string
  options: string[]
  optionLabel: (value: string) => string
  onChange: (value: string) => void
  allLabel: string
}

/**
 * Same idiom as `ApiInspector.tsx`'s own `FilterSelect` (a plain native `<select>`, not the Base UI
 * Select primitive) — duplicated locally rather than extracted into a shared component for a
 * 2-usage, ~15-line presentational helper (YAGNI). `optionLabel` (not a raw string) routes each
 * option through `t()`, since these values are the enum-like device-class/status tokens, not free
 * text like the Inspector's machine/kind filters.
 */
function FilterSelect({ label, value, options, optionLabel, onChange, allLabel }: FilterSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-text-body outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value={ALL}>{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Implicit label association only (the wrapping `<label>`'s own visible caption, no separate
 * `aria-label`) — matches `ApiInspector.tsx`'s `FilterSelect` idiom, and avoids a "Label in Name"
 * mismatch an explicit `aria-label` with different wording than the visible caption would create. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
        {t("machines.search.label")}
      </span>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("machines.search.placeholder")}
          className="h-8 w-56 pl-7"
        />
      </div>
    </label>
  )
}

function MachinesTableHeaderRow() {
  const t = useT()
  return (
    <TableRow>
      <TableHead>{t("machines.table.code")}</TableHead>
      <TableHead>{t("machines.table.type")}</TableHead>
      <TableHead>{t("machines.table.driver")}</TableHead>
      <TableHead>{t("machines.table.status")}</TableHead>
      <TableHead className="text-right">{t("machines.table.passRate")}</TableHead>
      <TableHead className="text-right">{t("machines.table.cycles")}</TableHead>
      <TableHead>{t("machines.table.trend")}</TableHead>
      {/* Trailing chevron column carries no data of its own — `sr-only` label so the column still has
          an accessible name instead of a silently-empty header cell. */}
      <TableHead className="w-8">
        <span className="sr-only">{t("machines.table.viewAction")}</span>
      </TableHead>
    </TableRow>
  )
}

function MachineRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-4 w-10" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-4 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="size-4" />
      </TableCell>
    </TableRow>
  )
}

interface MachineRowProps {
  machine: FleetTile
  isRunning: boolean
  onOpen: (code: string) => void
}

/**
 * One roster row. The whole row is the click/keyboard target (not just one cell) — `tabIndex={0}` +
 * an Enter/Space `onKeyDown` handler on the native `<tr>` itself, WITHOUT overriding its implicit
 * `role="row"` (setting `role="button"` here would trip `aria-allowed-role`, since ARIA-in-HTML only
 * permits a handful of roles on `tr`). `aria-label` supplies the row's accessible name for a
 * keyboard user tabbing straight to it; a screen reader browsing the table normally (arrow-key table
 * navigation) still reads each cell's own content exactly as a native table row would.
 */
function MachineRow({ machine, isRunning, onOpen }: MachineRowProps) {
  const t = useT()
  const statusMeta = statusMetaFor(t, machine.statusText)
  const passRateApplicable = machine.deviceClass !== "Iot"
  const isActive = isRunning && machine.cycles > 0

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen(machine.code)
    }
  }

  return (
    <TableRow
      onClick={() => onOpen(machine.code)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={t("machines.table.rowAria", { code: machine.code })}
      className="cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50"
    >
      <TableCell className="font-medium text-text-strong">{machine.code}</TableCell>
      <TableCell className="text-text-body">{t(`deviceClass.${machine.deviceClass}`)}</TableCell>
      <TableCell className="text-text-body">{t(`driverKind.${machine.driverKind}`)}</TableCell>
      <TableCell>
        <StatusBadge status={statusMeta.status} pulse={isActive && statusMeta.status === "ok"}>
          {statusMeta.label}
        </StatusBadge>
      </TableCell>
      <TableCell className="font-numeric text-right text-text-body">
        {passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
      </TableCell>
      <TableCell className="font-numeric text-right text-text-body">{machine.cycles.toLocaleString()}</TableCell>
      <TableCell className="w-24">
        <Sparkline data={machine.spark} height={22} />
      </TableCell>
      <TableCell className="text-text-muted">
        <ChevronRight className="size-4" aria-hidden="true" />
      </TableCell>
    </TableRow>
  )
}

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
}

/** Same visual shape as Dashboard.tsx's own `EmptyState` (dashed card, icon roundel, title+description,
 * one action) — reused here for both "fleet roster is empty" and "filters matched nothing". */
function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface-card px-8 py-16 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-navy-600/10">
        <Icon className="size-7 text-primary-text" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-text-strong">{title}</p>
        <p className="max-w-sm text-sm text-text-muted">{description}</p>
      </div>
      {action}
    </motion.div>
  )
}

export default function Machines() {
  const t = useT()
  const { data, isPending, isError } = useFleet()
  const isRunning = useFleetIsRunning()
  const [, navigate] = useLocation()

  const [search, setSearch] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState(ALL)
  const [statusFilter, setStatusFilter] = React.useState(ALL)

  const openMachine = React.useCallback((code: string) => navigate(`/machines/${code}`), [navigate])

  // Memoized on `data` itself (not recomputed as a fresh `[]` every render when it's still loading) —
  // `typeOptions`/`statusOptions`/`filteredMachines` below all depend on this reference staying stable
  // across renders that don't actually change the underlying fleet snapshot.
  const roster = React.useMemo(() => data?.machines ?? [], [data])
  const online = data?.kpis.online ?? 0

  const typeOptions = React.useMemo(
    () => DEVICE_CLASS_ORDER.filter((dc) => roster.some((m) => m.deviceClass === dc)),
    [roster]
  )
  const statusOptions = React.useMemo(
    () => STATUS_ORDER.filter((s) => roster.some((m) => m.statusText === s)),
    [roster]
  )

  // Completion-review #4: statusOptions narrows to whatever's actually present in the roster (see its
  // own comment above) — a running→stopped transition can shrink that set out from under an ALREADY
  // selected value (e.g. filtered to "OK" while running, then Stop Fleet collapses every tile to
  // "Idle"). The native <select> would keep `statusFilter` pointing at an option that no longer exists,
  // so the table renders the "no match" empty state instead of self-correcting. Reset to ALL the moment
  // the current selection falls outside the (possibly just-narrowed) option set.
  React.useEffect(() => {
    if (statusFilter !== ALL && !statusOptions.includes(statusFilter)) {
      setStatusFilter(ALL)
    }
  }, [statusFilter, statusOptions])

  const filtersActive = search.trim() !== "" || typeFilter !== ALL || statusFilter !== ALL

  const filteredMachines = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return roster.filter((m) => {
      // Search is code-only — the fleet wire shape (`FleetTile`) carries no separate display name,
      // just the machine code itself.
      if (query && !m.code.toLowerCase().includes(query)) return false
      if (typeFilter !== ALL && m.deviceClass !== typeFilter) return false
      if (statusFilter !== ALL && m.statusText !== statusFilter) return false
      return true
    })
  }, [roster, search, typeFilter, statusFilter])

  const clearFilters = React.useCallback(() => {
    setSearch("")
    setTypeFilter(ALL)
    setStatusFilter(ALL)
  }, [])

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Factory className="size-5 text-navy-600" aria-hidden="true" />
            <h1 className="text-2xl font-semibold text-text-strong">{t("machines.title")}</h1>
          </div>
          <p className="text-sm text-text-muted">{t("machines.description")}</p>
        </div>
        {!isPending && !isError ? (
          <StatusBadge
            status={online === roster.length && roster.length > 0 ? "ok" : online > 0 ? "warn" : "neutral"}
          >
            {t("machines.onlineCount", { online, total: roster.length })}
          </StatusBadge>
        ) : null}
      </div>

      {isPending ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-card">
          <Table>
            <TableHeader>
              <MachinesTableHeaderRow />
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }, (_, i) => (
                <MachineRowSkeleton key={i} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : isError ? (
        <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
      ) : roster.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("machines.empty.noMachinesTitle")}
          description={t("machines.empty.noMachinesDescription")}
          action={<Button onClick={() => navigate("/onboarding")}>{t("shell.nav.onboarding")}</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface-card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField value={search} onChange={setSearch} />
              <FilterSelect
                label={t("machines.filters.type")}
                value={typeFilter}
                options={typeOptions}
                optionLabel={(value) => t(`deviceClass.${value}`)}
                onChange={setTypeFilter}
                allLabel={t("machines.filters.all")}
              />
              <FilterSelect
                label={t("machines.filters.status")}
                value={statusFilter}
                options={statusOptions}
                optionLabel={(value) => statusMetaFor(t, value).label}
                onChange={setStatusFilter}
                allLabel={t("machines.filters.all")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="font-numeric font-semibold text-text-strong">
                  {filteredMachines.length.toLocaleString()}
                </span>
                <span className="text-text-muted"> {t("machines.shownLabel")}</span>
                {filtersActive ? (
                  <span className="font-numeric text-text-muted">
                    {" "}
                    {t("machines.ofTotal", { count: roster.length })}
                  </span>
                ) : null}
              </div>
              {filtersActive ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  <X className="size-3.5" aria-hidden="true" />
                  {t("machines.filters.clear")}
                </Button>
              ) : null}
            </div>
          </div>

          {filteredMachines.length === 0 ? (
            // No separate "Clear filters" action here — the toolbar above already renders one
            // (`filtersActive` is always true whenever this state is reachable), and a second button
            // with the identical label right below it would be pure duplication, not extra affordance.
            <EmptyState
              icon={SearchX}
              title={t("machines.empty.noMatchTitle")}
              description={t("machines.empty.noMatchDescription")}
            />
          ) : (
            <div
              tabIndex={0}
              className="max-h-[36rem] overflow-y-auto rounded-xl border border-border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-navy-600/50"
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-surface-card">
                  <MachinesTableHeaderRow />
                </TableHeader>
                <TableBody>
                  {filteredMachines.map((machine) => (
                    <MachineRow key={machine.code} machine={machine} isRunning={isRunning} onOpen={openMachine} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}
