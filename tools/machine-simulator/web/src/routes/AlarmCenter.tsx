import * as React from "react"
import { motion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, Loader2, Siren } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  useAckAlarm,
  useAlarmHistory,
  useAlarms,
  type Alarm,
  type AlarmHistoryEntry,
  type AlarmPriority,
  type AlarmSource,
} from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * GĐ3 sub-4 LC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/
 * task-4-brief.md`) — `/alarms`: the operator UI over LC-1/2's ISA-18.2 alarm backbone. Same
 * "reads are Operator, list + detail dialog" shape `AssetRegistry.tsx` established, plus a History
 * tab reusing `Audit.tsx`'s own paged-table idiom (limit/offset, prev/next). Only the Ack action is
 * wrapped in `RequireRole role="Operator"` — since reads are ALSO Operator, this is effectively every
 * signed-in user (Operator is the lowest role); the real enforcement is the server's own
 * `Policies.Operator` on `POST /v1/alarms/{id}/ack` (`AlarmEndpoints.cs`) — same honest caveat the
 * brief itself makes, and the same "gate exists for shape/defense-in-depth, not because most users are
 * actually excluded" reasoning `Site.tsx`'s Engineer+ gate documents for a DIFFERENT (non-trivial) role
 * floor.
 */

type TFunc = ReturnType<typeof useT>
type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

const PAGE_SIZE = 50

/** ISA-18.2 priority → `StatusBadge` tone. `Critical` is the one unambiguous `danger`; `Low` is the
 * mildest `info`. The app's status system has exactly 5 tones (ok/warn/danger/info/neutral) for a
 * 4-value priority ramp with no "genuinely fine" (`ok`) or "nothing to see" (`neutral`) reading — an
 * active alarm, however low-priority, is never either of those — so `High` and `Medium` share the
 * single amber `warn` tone this design system has, same "compress into the existing palette rather
 * than invent a new hue" call `TRANSPORT_MODE_TONE` (`lib/api.ts`) already made for Live/Auto
 * transport mode. */
const PRIORITY_TONE: Record<AlarmPriority, BadgeStatus> = {
  Critical: "danger",
  High: "warn",
  Medium: "warn",
  Low: "info",
}

const KNOWN_SOURCES = new Set<string>(["Policy", "DriverHealth", "NgRate", "Identity"])

/** Known-value lookup with a verbatim fallback for anything outside the four known sources — same
 * idiom `AssetRegistry.tsx`'s `deviceClassLabel`/`driverKindLabel` use for a wire value the client has
 * no i18n entry for yet (LC-2's `DriverHealth`/`NgRate` sources, and GĐ3 closeout WI-4's `Identity`
 * certificate-expiry source, already have entries here, so this only ever falls back for a genuinely
 * future addition). */
function sourceLabel(t: TFunc, value: AlarmSource | string): string {
  return KNOWN_SOURCES.has(value) ? t(`alarms.source.${value}`) : value
}

const KNOWN_EVENTS = new Set(["raised", "cleared", "acked"])

function eventLabel(t: TFunc, value: string): string {
  return KNOWN_EVENTS.has(value) ? t(`alarms.history.event.${value}`) : value
}

const alarmDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

function formatAlarmTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : alarmDateTimeFormatter.format(d)
}

/** Rank order for the Operator+ gate below — same hierarchy `AssetRegistry.tsx`'s/`Site.tsx`'s own
 * local `ROLE_RANK`/`meetsMinRole` already encode (duplicated per-file in this codebase rather than
 * shared). */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** Client-side gate for the Ack action only — never the whole page (reads are Operator,
 * `AlarmEndpoints.MapAlarmEndpoints`). Renders nothing for anyone below `role`; the server's own
 * `Policies.Operator` is the real enforcement. */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!meetsMinRole(role, user?.role)) return null
  return <>{children}</>
}

/** Bilingual column header — same register `AssetRegistry.tsx`'s/`Audit.tsx`'s own `Th` uses. */
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

function RowSkeleton({ cells = 6 }: { cells?: number }) {
  return (
    <TableRow>
      {Array.from({ length: cells }, (_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-20" />
        </TableCell>
      ))}
    </TableRow>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Alarm detail dialog — runbook + first/last-raised + acked-by, opened via a row's "view detail" (Eye)
// button, same idiom `Audit.tsx`'s own `AuditDetailDialog` uses.
// ─────────────────────────────────────────────────────────────────────────

function AlarmDetailDialog({ alarm, onOpenChange }: { alarm: Alarm | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()

  return (
    <Dialog open={alarm !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("alarms.detail.title", { id: alarm?.id ?? "" })}</DialogTitle>
          <DialogDescription>{t("alarms.detail.description")}</DialogDescription>
        </DialogHeader>
        {alarm ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.table.message")}
                </dt>
                <dd className="text-sm text-text-body">{alarm.message}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.detail.state")}
                </dt>
                <dd>
                  <StatusBadge status={PRIORITY_TONE[alarm.priority]}>
                    {t(`alarms.state.${alarm.state}`)}
                  </StatusBadge>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.table.priority")}
                </dt>
                <dd>
                  <StatusBadge status={PRIORITY_TONE[alarm.priority]}>
                    {t(`alarms.priority.${alarm.priority}`)}
                  </StatusBadge>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.detail.firstRaised")}
                </dt>
                <dd className="text-sm text-text-body">{formatAlarmTime(alarm.firstRaisedUtc)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.detail.lastRaised")}
                </dt>
                <dd className="text-sm text-text-body">{formatAlarmTime(alarm.lastRaisedUtc)}</dd>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.detail.runbook")}
                </dt>
                <dd className="text-sm text-text-body">{alarm.runbook ?? t("alarms.detail.runbookNone")}</dd>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("alarms.detail.acked")}
                </dt>
                <dd className="text-sm text-text-body">
                  {alarm.ackedBy && alarm.ackedUtc
                    ? t("alarms.detail.ackedBy", { actor: alarm.ackedBy, at: formatAlarmTime(alarm.ackedUtc) })
                    : t("alarms.detail.ackedNone")}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Active alarms table — polled (`useAlarms`, 4s), a priority chip per row, an Ack action, and a
// "view detail" button opening `AlarmDetailDialog`.
// ─────────────────────────────────────────────────────────────────────────

function ActiveAlarmsPanel({ onSelect }: { onSelect: (alarm: Alarm) => void }) {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useAlarms()
  const ack = useAckAlarm()

  const items = data ?? []

  function handleAck(alarm: Alarm) {
    ack.mutate(alarm.id, {
      onSuccess: () => toast.success(t("toast.alarmAcked", { code: alarm.code })),
      onError: () => toast.error(t("toast.alarmAckFailed")),
    })
  }

  if (isError) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-danger-text">
        {t("alarms.table.loadFailed")}
      </div>
    )
  }

  if (!isPending && items.length === 0) {
    // A calm, not-alarming empty state — brief's own wording: no alarms is good news, so this reads
    // like every other screen's plain empty state, never a red/amber "attention" treatment.
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 border border-border bg-surface-subtle text-sm text-text-muted">
        <CheckCircle2 className="size-6 text-ok-text" aria-hidden="true" />
        {t("alarms.table.empty")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-surface-card">
        <TableRow>
          <Th vi={t("alarms.table.priority")} en={gloss("alarms.table.priority")} />
          <Th vi={t("alarms.table.source")} en={gloss("alarms.table.source")} />
          <Th vi={t("alarms.table.code")} en={gloss("alarms.table.code")} />
          <Th vi={t("alarms.table.message")} en={gloss("alarms.table.message")} />
          <Th vi={t("alarms.table.count")} en={gloss("alarms.table.count")} className="w-16" />
          <Th vi={t("alarms.table.lastRaised")} en={gloss("alarms.table.lastRaised")} />
          <TableHead className="w-40" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <RowSkeleton key={i} cells={7} />)
          : items.map((alarm) => {
              const acking = ack.isPending && ack.variables === alarm.id
              return (
                <TableRow key={alarm.id}>
                  <TableCell>
                    <StatusBadge status={PRIORITY_TONE[alarm.priority]}>
                      {t(`alarms.priority.${alarm.priority}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-text-body">{sourceLabel(t, alarm.source)}</TableCell>
                  <TableCell className="font-mono text-xs text-text-body">{alarm.code}</TableCell>
                  <TableCell className="max-w-72 truncate text-text-body" title={alarm.message}>
                    {alarm.message}
                  </TableCell>
                  <TableCell className="font-numeric text-text-muted">{alarm.count}</TableCell>
                  <TableCell className="font-numeric whitespace-nowrap text-text-muted">
                    {formatAlarmTime(alarm.lastRaisedUtc)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => onSelect(alarm)}
                        aria-label={t("alarms.table.viewDetail")}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                      </Button>
                      <RequireRole role="Operator">
                        <Button size="sm" onClick={() => handleAck(alarm)} disabled={acking}>
                          {acking ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          )}
                          {acking ? t("alarms.table.acking") : t("alarms.table.ack")}
                        </Button>
                      </RequireRole>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
      </TableBody>
    </Table>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// History tab — a paged read over the append-only `alarm_history` log (`useAlarmHistory`), same
// limit/offset/prev/next paging idiom `Audit.tsx` established. Only mounted while the History tab is
// selected (`AlarmCenterScreen` below), so this query never fires for someone who never opens it.
// ─────────────────────────────────────────────────────────────────────────

function AlarmHistoryTable({ items, isPending, isError }: { items: AlarmHistoryEntry[]; isPending: boolean; isError: boolean }) {
  const t = useT()
  const gloss = useGloss()

  if (isError) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-danger-text">
        {t("alarms.history.table.loadFailed")}
      </div>
    )
  }

  if (!isPending && items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted">
        {t("alarms.history.table.empty")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-surface-card">
        <TableRow>
          <Th vi={t("alarms.history.table.time")} en={gloss("alarms.history.table.time")} />
          <Th vi={t("alarms.history.table.event")} en={gloss("alarms.history.table.event")} />
          <Th vi={t("alarms.history.table.priority")} en={gloss("alarms.history.table.priority")} />
          <Th vi={t("alarms.history.table.key")} en={gloss("alarms.history.table.key")} />
          <Th vi={t("alarms.history.table.message")} en={gloss("alarms.history.table.message")} />
          <Th vi={t("alarms.history.table.actor")} en={gloss("alarms.history.table.actor")} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} cells={6} />)
          : items.map((entry) => (
              <TableRow key={entry.seq}>
                <TableCell className="font-numeric whitespace-nowrap text-text-muted">
                  {formatAlarmTime(entry.atUtc)}
                </TableCell>
                <TableCell className="text-text-body">{eventLabel(t, entry.event)}</TableCell>
                <TableCell>
                  <StatusBadge status={PRIORITY_TONE[entry.priority]}>
                    {t(`alarms.priority.${entry.priority}`)}
                  </StatusBadge>
                </TableCell>
                {/* `source` is deliberately not its own column here (unlike the Active table) — it's
                    already encoded as the `key`'s own prefix (`Policy:CODE:target`), and dropping it
                    keeps this multi-column history table from needing horizontal scroll on an
                    ordinary 1440px viewport. */}
                <TableCell className="max-w-40 truncate font-mono text-xs text-text-muted" title={entry.key}>
                  {entry.key}
                </TableCell>
                <TableCell className="max-w-64 truncate text-text-body" title={entry.message}>
                  {entry.message}
                </TableCell>
                <TableCell className="text-text-muted">{entry.actor ?? t("alarms.history.table.actorNone")}</TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function AlarmHistoryPanel() {
  const t = useT()
  const [offset, setOffset] = React.useState(0)
  const filter = React.useMemo(() => ({ limit: PAGE_SIZE, offset }), [offset])
  const { data, isPending, isError } = useAlarmHistory(filter)

  const total = data?.total ?? 0
  const rangeFrom = total === 0 ? 0 : offset + 1
  const rangeTo = Math.min(offset + PAGE_SIZE, total)
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <>
      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <AlarmHistoryTable items={data?.items ?? []} isPending={isPending} isError={isError} />
      </div>
      {!isPending && !isError && total > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
          <span className="text-xs text-text-muted">
            {t("alarms.pagination.showing", { from: rangeFrom, to: rangeTo, total })}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              {t("alarms.pagination.prev")}
            </Button>
            <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
              {t("alarms.pagination.next")}
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Screen — a simple Active/History tab toggle over the two panels above, plus the shared detail dialog.
// ─────────────────────────────────────────────────────────────────────────

function AlarmCenterScreen() {
  const t = useT()
  const gloss = useGloss()
  const [tab, setTab] = React.useState<"active" | "history">("active")
  const [selectedAlarm, setSelectedAlarm] = React.useState<Alarm | null>(null)

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Siren className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("alarms.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("alarms.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("alarms.description")}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("alarms.title")}
        className="flex w-fit items-center gap-px rounded-[var(--radius)] border border-border-strong bg-surface-muted p-0.5"
      >
        {(["active", "history"] as const).map((value) => {
          const selected = tab === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTab(value)}
              className={
                selected
                  ? "h-6 rounded-[var(--radius-sm)] bg-navy-700 px-3 text-[11px] font-semibold tracking-wide whitespace-nowrap text-white uppercase"
                  : "h-6 rounded-[var(--radius-sm)] px-3 text-[11px] font-semibold tracking-wide whitespace-nowrap text-text-muted uppercase transition-colors hover:text-text-strong"
              }
            >
              {t(`alarms.tabs.${value}`)}
            </button>
          )
        })}
      </div>

      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col gap-2 p-0">
        {tab === "active" ? (
          <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
            <ActiveAlarmsPanel onSelect={setSelectedAlarm} />
          </div>
        ) : (
          <AlarmHistoryPanel />
        )}
      </Sheet>

      <AlarmDetailDialog
        alarm={selectedAlarm}
        onOpenChange={(open) => {
          if (!open) setSelectedAlarm(null)
        }}
      />
    </motion.div>
  )
}

export default function AlarmCenter() {
  return <AlarmCenterScreen />
}
