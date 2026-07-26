import { GitBranch } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { HistorianResultDto } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { verdictMeta } from "@/components/CycleLogTable"

/**
 * Task 12 (WS-A) — the Historian screen's results table (`routes/Historian.tsx`), modeled directly
 * on `CycleLogTable.tsx` (same bilingual `Th`, same reused `verdictMeta`/`StatusBadge` — Historian
 * rows carry the SAME `Verdict.ToString()` vocabulary a machine's own cycle log does, so there's no
 * second verdict→tone map to invent or keep in sync). Unlike `CycleLogTable` (one machine, client-side
 * capped at 100 of a 200-row server cap), this table is SERVER-paged — `items` is already exactly
 * one page (`HistorianResultsPageDto.items`), `Historian.tsx` owns the limit/offset driving which
 * page that is, so this component has no windowing/slicing logic of its own.
 */

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/** Full date+time (unlike `CycleLogTable.formatCycleTime`'s time-only) — historian rows span days/
 * weeks apart, not one machine's last few minutes, so the date matters here. */
export function formatHistorianEventTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormatter.format(d)
}

/** Rounds to 3 decimals and lets `String()` drop any trailing zeros — `KeyMetricValue` is a raw
 * double off the wire with no server-side formatting (unlike `CycleLogRow.keyMetric`, already a
 * pre-formatted string), so this table does its own light rounding rather than rendering long
 * floating-point tails. */
function formatKeyMetric(row: HistorianResultDto): string {
  if (row.keyMetricName == null || row.keyMetricValue == null) return "—"
  const rounded = Math.round(row.keyMetricValue * 1000) / 1000
  const unit = row.keyMetricUnit ? ` ${row.keyMetricUnit}` : ""
  return `${row.keyMetricName}: ${rounded}${unit}`
}

/** Bilingual column header — same register `CycleLogTable.tsx`'s own `Th` uses (primary language on
 * top, small uppercase gloss beneath, `aria-hidden` since it's a visual register, not a second
 * accessible name). */
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
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-7 w-28" />
      </TableCell>
    </TableRow>
  )
}

interface HistorianResultsTableProps {
  items: HistorianResultDto[]
  isPending: boolean
  isError: boolean
  onViewGenealogy: (serial: string) => void
  className?: string
}

export function HistorianResultsTable({ items, isPending, isError, onViewGenealogy, className }: HistorianResultsTableProps) {
  const t = useT()
  const gloss = useGloss()

  if (isError) {
    return (
      <div className={cn("flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-danger-text", className)}>
        {t("historian.table.loadFailed")}
      </div>
    )
  }

  if (!isPending && items.length === 0) {
    return (
      <div className={cn("flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted", className)}>
        {t("historian.table.empty")}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface-card">
          <TableRow>
            <Th vi={t("historian.table.time")} en={gloss("historian.table.time")} />
            <Th vi={t("historian.table.machine")} en={gloss("historian.table.machine")} />
            <Th vi={t("historian.table.serial")} en={gloss("historian.table.serial")} />
            <Th vi={t("historian.table.verdict")} en={gloss("historian.table.verdict")} />
            <Th vi={t("historian.table.keyMetric")} en={gloss("historian.table.keyMetric")} />
            <Th vi={t("historian.table.ngPoints")} en={gloss("historian.table.ngPoints")} />
            {/* Genealogy action column carries no data of its own — `sr-only` label, same idiom
                Machines.tsx's own trailing/HMI-entry columns use. */}
            <TableHead className="w-32">
              <span className="sr-only">{t("historian.table.genealogyAction")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending
            ? Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} />)
            : items.map((row) => {
                const meta = verdictMeta(t, row.verdict)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-numeric text-text-muted">{formatHistorianEventTime(row.eventTimeUtc)}</TableCell>
                    <TableCell className="font-numeric font-medium text-text-strong">{row.machineCode}</TableCell>
                    <TableCell className="font-numeric text-text-body">{row.serialNumber}</TableCell>
                    <TableCell>
                      <StatusBadge status={meta.status}>{meta.label}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-text-body">{formatKeyMetric(row)}</TableCell>
                    <TableCell className="font-numeric text-text-body">{`${row.ngCount}/${row.pointCount}`}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => onViewGenealogy(row.serialNumber)}>
                        <GitBranch className="size-3.5" aria-hidden="true" />
                        {t("historian.table.genealogyAction")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
        </TableBody>
      </Table>
    </div>
  )
}
