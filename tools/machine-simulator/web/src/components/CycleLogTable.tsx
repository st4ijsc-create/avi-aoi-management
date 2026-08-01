import * as React from "react"
import type { VariantProps } from "class-variance-authority"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { CycleLogRow } from "@/lib/api"
import { cn } from "@/lib/utils"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>
type T = (key: string, vars?: Record<string, string | number>) => string

/** `CycleLogEntry.Verdict` — `Verdict.ToString()` on the wire (`Enums.cs`: Pass/Warn/Fail/Skip).
 * "Skip" is the telemetry-reading case (nothing judged), rendered as the neutral "Telemetry" i18n key
 * rather than a literal "Skip" — matches `MachineCard`'s `STATUS_META` for the same underlying
 * distinction. */
const VERDICT_META: Record<string, { status: BadgeStatus; key: string }> = {
  Pass: { status: "ok", key: "cycleLogTable.verdict.pass" },
  Warn: { status: "warn", key: "cycleLogTable.verdict.warn" },
  Fail: { status: "danger", key: "cycleLogTable.verdict.fail" },
  Skip: { status: "neutral", key: "cycleLogTable.verdict.telemetry" },
}

export function verdictMeta(t: T, verdict: string): { status: BadgeStatus; label: string } {
  const meta = VERDICT_META[verdict]
  return meta ? { status: meta.status, label: t(meta.key) } : { status: "neutral", label: verdict }
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

export function formatCycleTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : timeFormatter.format(d)
}

interface CycleLogTableProps {
  rows: CycleLogRow[]
  className?: string
}

const MAX_VISIBLE_ROWS = 100

/** Cycle log table — newest first (the server appends oldest→newest and caps at 200 rows; this
 * further caps the client render to the most recent 100, since a plain table this deep is a scroll
 * chore either way — the API Inspector's virtualized grid is the tool for a truly long, live-streamed
 * feed, not this one-machine summary). */
/** Bilingual column header — primary active-language caption over a small uppercase gloss in the
 * other language (spec §1/§3), same register `Machines.tsx`'s own roster table uses. */
function Th({ vi, en }: { vi: string; en: string }) {
  return (
    <TableHead>
      <span className="flex flex-col">
        <span>{vi}</span>
        {/* `aria-hidden` — visual gloss register only (spec §1), not a second accessible name; see
            `FormField.tsx`'s doc comment (H3c a11y fix) for the concrete collision an exposed gloss
            caused inside a labelling element. */}
        <span className="hmi-micro font-normal" aria-hidden="true">
          {en}
        </span>
      </span>
    </TableHead>
  )
}

export function CycleLogTable({ rows, className }: CycleLogTableProps) {
  const t = useT()
  const gloss = useGloss()
  const visible = React.useMemo(() => [...rows].reverse().slice(0, MAX_VISIBLE_ROWS), [rows])

  if (rows.length === 0) {
    return (
      <div className={className}>
        <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted">
          {t("cycleLogTable.empty")}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-xs text-text-muted">
        {t("cycleLogTable.showing", { visible: visible.length, total: rows.length })}
      </p>
      <div
        tabIndex={0}
        className="hmi-scroll max-h-[28rem] overflow-y-auto border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-surface-card">
            <TableRow>
              <Th vi={t("cycleLogTable.headers.time")} en={gloss("cycleLogTable.headers.time")} />
              <Th vi={t("cycleLogTable.headers.serial")} en={gloss("cycleLogTable.headers.serial")} />
              <Th vi={t("cycleLogTable.headers.verdict")} en={gloss("cycleLogTable.headers.verdict")} />
              <Th vi={t("cycleLogTable.headers.keyMetric")} en={gloss("cycleLogTable.headers.keyMetric")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, i) => {
              const meta = verdictMeta(t, row.verdict)
              return (
                <TableRow key={`${row.time}-${row.serial}-${i}`}>
                  <TableCell className="font-numeric text-text-muted">{formatCycleTime(row.time)}</TableCell>
                  <TableCell className="font-medium text-text-strong">{row.serial}</TableCell>
                  <TableCell>
                    <StatusBadge status={meta.status}>{meta.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="font-numeric text-text-body">{row.keyMetric}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
