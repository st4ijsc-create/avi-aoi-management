import * as React from "react"
import { motion } from "framer-motion"
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  buildHistorianExportCsvUrl,
  useFleet,
  useHistorianBySerial,
  useHistorianResults,
  type HistorianResultsFilter,
} from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { verdictMeta } from "@/components/CycleLogTable"
import { HistorianResultsTable } from "@/components/HistorianResultsTable"

/**
 * Task 12 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/historian`: a browse/filter/
 * export screen over the durable per-cycle result log Tasks 8/10 of the same workstream already
 * wrote server-side (`HistorianEndpoints.cs`). Same page-header/filter-bar/`<Sheet>`-table layout
 * `Machines.tsx` already established for a filterable roster — this is that SAME idiom applied to a
 * paged, server-filtered history instead of the always-in-memory live fleet snapshot.
 */

const ALL = "__all__"
const PAGE_SIZE = 50
const VERDICT_OPTIONS = ["Pass", "Warn", "Fail", "Skip"]

/** One filter dropdown, built on the Base UI `Select` primitive per the brief (not a native
 * `<select>`, unlike `Machines.tsx`'s own `FilterSelect` — the brief calls out `ui/select.tsx`
 * specifically for this screen's machine filter). `aria-label` (not an external `<label htmlFor>`)
 * supplies the trigger's accessible name — same idiom `MachineSettingsPanel.tsx`'s own product
 * `<Select>` uses, since the trigger renders as a button, not a labelable native form control. */
function FilterSelect({
  ariaLabel,
  label,
  labelEn,
  value,
  onChange,
  options,
  allLabel,
}: {
  ariaLabel: string
  label: string
  labelEn: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  allLabel: string
}) {
  const selectedLabel = value === ALL ? allLabel : (options.find((o) => o.value === value)?.label ?? value)
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-col gap-0.5">
        <span className="truncate text-[13px] leading-tight font-medium text-text-body">{label}</span>
        <span className="hmi-micro truncate" aria-hidden="true">
          {labelEn}
        </span>
      </span>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger aria-label={ariaLabel} className="h-8 w-44 text-xs">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              <SelectItem value={ALL}>{allLabel}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </div>
  )
}

function DateField({ id, label, labelEn, value, onChange }: { id: string; label: string; labelEn: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-col gap-0.5">
        <label htmlFor={id} className="truncate text-[13px] leading-tight font-medium text-text-body">
          {label}
        </label>
        <span className="hmi-micro truncate" aria-hidden="true">
          {labelEn}
        </span>
      </span>
      <Input id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-36 text-xs" />
    </div>
  )
}

/** Row action "View genealogy" (brief) — every historian record on file for one serial number,
 * across every machine, in a `dialog.tsx` popup. Reuses `verdictMeta`/`StatusBadge` (same as the
 * results table) rather than a second verdict→tone map. */
function GenealogyDialog({ serial, onOpenChange }: { serial: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const { data, isPending, isError } = useHistorianBySerial(serial ?? undefined)

  return (
    <Dialog open={serial !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("historian.genealogy.title", { serial: serial ?? "" })}</DialogTitle>
          <DialogDescription>{t("historian.genealogy.description")}</DialogDescription>
        </DialogHeader>
        <div className="hmi-scroll max-h-96 min-h-24 overflow-y-auto">
          {isPending ? (
            <p className="p-3 text-sm text-text-muted">{t("historian.genealogy.loading")}</p>
          ) : isError ? (
            <p className="p-3 text-sm text-danger-text">{t("historian.genealogy.failed")}</p>
          ) : !data || data.length === 0 ? (
            <p className="p-3 text-sm text-text-muted">{t("historian.genealogy.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.map((row) => {
                const meta = verdictMeta(t, row.verdict)
                return (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-3 border border-border bg-surface-subtle px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-text-strong">{row.machineCode}</span>
                      <span className="hmi-micro truncate" aria-hidden="true">
                        {new Date(row.eventTimeUtc).toLocaleString()}
                      </span>
                    </div>
                    <StatusBadge status={meta.status}>{meta.label}</StatusBadge>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Historian() {
  const t = useT()
  const gloss = useGloss()
  const fleet = useFleet()

  const [machine, setMachine] = React.useState(ALL)
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [serial, setSerial] = React.useState("")
  const [verdict, setVerdict] = React.useState(ALL)
  const [offset, setOffset] = React.useState(0)
  const [genealogySerial, setGenealogySerial] = React.useState<string | null>(null)

  // A filter change (anything but a page turn itself) always lands back on page 1 — otherwise a
  // narrower filter could leave `offset` pointing past the end of the newly-filtered result set.
  React.useEffect(() => {
    setOffset(0)
  }, [machine, from, to, serial, verdict])

  const filter: HistorianResultsFilter = React.useMemo(
    () => ({
      machine: machine !== ALL ? machine : undefined,
      from: from || undefined,
      to: to || undefined,
      serial: serial.trim() || undefined,
      verdict: verdict !== ALL ? verdict : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [machine, from, to, serial, verdict, offset]
  )

  const { data, isPending, isError } = useHistorianResults(filter)
  const csvUrl = buildHistorianExportCsvUrl(filter)

  const machineOptions = React.useMemo(
    () => (fleet.data?.machines ?? []).map((m) => ({ value: m.code, label: m.code })),
    [fleet.data]
  )
  const verdictOptions = React.useMemo(
    () => VERDICT_OPTIONS.map((v) => ({ value: v, label: verdictMeta(t, v).label })),
    [t]
  )

  const filtersActive = machine !== ALL || from !== "" || to !== "" || serial.trim() !== "" || verdict !== ALL
  const clearFilters = React.useCallback(() => {
    setMachine(ALL)
    setFrom("")
    setTo("")
    setSerial("")
    setVerdict(ALL)
  }, [])

  const total = data?.total ?? 0
  const rangeFrom = total === 0 ? 0 : offset + 1
  const rangeTo = Math.min(offset + PAGE_SIZE, total)
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("historian.title")}
          </h1>
          <p className="hmi-micro mt-1">{gloss("historian.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("historian.description")}</p>
        </div>
        {/* Brief: a plain `<a download>` — no fetch/blob code. Styled via the SAME `buttonVariants`
            the `<Button>` primitive uses, since a real anchor (not the Base UI button primitive) is
            what makes a browser-native download happen on click. */}
        <a href={csvUrl} download className={buttonVariants({ variant: "outline" })}>
          <Download className="size-3.5" aria-hidden="true" />
          {t("historian.export.csv")}
        </a>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-3 border border-border bg-surface-card p-3">
        <FilterSelect
          ariaLabel={t("historian.filters.machine")}
          label={t("historian.filters.machine")}
          labelEn={gloss("historian.filters.machine")}
          value={machine}
          onChange={setMachine}
          options={machineOptions}
          allLabel={t("historian.filters.allMachines")}
        />
        <DateField
          id="historian-from"
          label={t("historian.filters.from")}
          labelEn={gloss("historian.filters.from")}
          value={from}
          onChange={setFrom}
        />
        <DateField
          id="historian-to"
          label={t("historian.filters.to")}
          labelEn={gloss("historian.filters.to")}
          value={to}
          onChange={setTo}
        />
        <div className="flex flex-col gap-1">
          <span className="flex flex-col gap-0.5">
            <label htmlFor="historian-serial" className="truncate text-[13px] leading-tight font-medium text-text-body">
              {t("historian.filters.serial")}
            </label>
            <span className="hmi-micro truncate" aria-hidden="true">
              {gloss("historian.filters.serial")}
            </span>
          </span>
          <Input
            id="historian-serial"
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            placeholder={t("historian.filters.serialPlaceholder")}
            className="h-8 w-48"
          />
        </div>
        <FilterSelect
          ariaLabel={t("historian.filters.verdict")}
          label={t("historian.filters.verdict")}
          labelEn={gloss("historian.filters.verdict")}
          value={verdict}
          onChange={setVerdict}
          options={verdictOptions}
          allLabel={t("historian.filters.allVerdicts")}
        />
        {filtersActive ? (
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <X className="size-3.5" aria-hidden="true" />
            {t("historian.filters.clear")}
          </Button>
        ) : null}
      </div>

      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col gap-2 p-0">
        <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
          <HistorianResultsTable
            items={data?.items ?? []}
            isPending={isPending}
            isError={isError}
            onViewGenealogy={setGenealogySerial}
          />
        </div>
        {!isPending && !isError && total > 0 ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
            <span className="text-xs text-text-muted">
              {t("historian.pagination.showing", { from: rangeFrom, to: rangeTo, total })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                {t("historian.pagination.prev")}
              </Button>
              <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
                {t("historian.pagination.next")}
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <GenealogyDialog
        serial={genealogySerial}
        onOpenChange={(open) => {
          if (!open) setGenealogySerial(null)
        }}
      />
    </motion.div>
  )
}
