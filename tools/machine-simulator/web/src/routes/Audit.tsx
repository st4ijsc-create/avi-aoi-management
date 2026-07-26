import * as React from "react"
import { motion } from "framer-motion"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  Loader2,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import { useAudit, useAuditVerify, type AuditEntry, type AuditFilter } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * WS-D-D8 (.superpowers/sdd/2026-07-26-ws-d-local-security-blueprint/task-8-brief.md) — `/audit`:
 * an Admin-only paginated/filterable viewer over D3's hash-chained audit log
 * (`GET /v1/audit?from=&to=&actor=&action=&target=&limit=&offset=`), plus a "Verify chain integrity"
 * button (`GET /v1/audit/verify`). Same filter-bar + paginated-table idiom `Historian.tsx` (WS-A)
 * already established (date range, text filters, limit/offset paging, a "Clear filters" button that
 * only appears once a filter is actually active) and the same client-side `RequireRole` Admin gate
 * `Users.tsx` (D7) established — the REAL gate is the server's own `Policies.Admin` on both `/v1/audit*`
 * routes (`AuditEndpoints.cs`); this only keeps a non-admin from ever seeing the chrome (or the
 * `Sidebar.tsx`/Command Palette nav entry — `minRole:"Admin"`) instead of flashing it then 403ing.
 *
 * `actor`/`action`/`target` are EXACT-match filters server-side (`SqliteAuditStore.QueryAsync`'s own
 * `= @actor`/`= @action`/`= @target` WHERE clauses, not a `LIKE`) — unlike Historian's own free-text
 * `serial` search, so these are plain text inputs with an example placeholder rather than a "search…"
 * one, and there's no fuzzy-match promise anywhere in this screen's copy.
 *
 * Honest tamper-evidence wording (`audit.limitation.body`, surfaced as a subtle info-icon tooltip next
 * to the title, never the headline copy) mirrors D3's own `SqliteAuditStore` doc comment verbatim —
 * "detects in-app modification & interior deletion; not resistant to direct database-file tampering" —
 * never an unqualified "tamper-proof"/"immutable" claim anywhere on this screen.
 */

const PAGE_SIZE = 50

/** A stable, always-unfiltered `{limit:1}` query purely to learn the TRUE total row count in the audit
 * log (`AuditPage.total` ignores `limit`/`offset` but still respects whatever filter produced it) —
 * used ONLY for the "Chain intact (N entries)" verify banner. `GET /v1/audit/verify` walks the WHOLE
 * chain regardless of whatever filters this screen's OWN table currently has active, so the banner's
 * own entry count must come from an unfiltered read, never from `data?.total` of the (possibly
 * filtered) table above it — that would misreport how many rows were actually verified. A module-level
 * constant (not a fresh object literal per render) keeps this query's cache key stable across renders.
 */
const UNFILTERED_TOTAL_FILTER: AuditFilter = { limit: 1, offset: 0 }

const auditDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

function formatAuditTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : auditDateTimeFormatter.format(d)
}

function formatTarget(entry: AuditEntry): string {
  if (entry.targetType && entry.targetId) return `${entry.targetType}/${entry.targetId}`
  return entry.targetType ?? entry.targetId ?? "—"
}

function truncateMiddle(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** A one-line, best-effort compact preview of a JSON blob for the table cell — re-serializes (dropping
 * whitespace) when it parses as JSON, falls back to the raw text verbatim otherwise (never throws on a
 * malformed/legacy value). The full, pretty-printed value is always one click away via
 * {@link AuditDetailDialog}. */
function compactPreview(json: string, max = 44): string {
  let text: string
  try {
    text = JSON.stringify(JSON.parse(json))
  } catch {
    text = json
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Pretty-printed (2-space indent) for the detail dialog — same parse-or-fall-back-to-raw discipline as
 * {@link compactPreview}. */
function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

/** Client-side Admin gate — identical shape to `Users.tsx`'s own (private, un-exported) `RequireRole`:
 * `role` is the ONLY role let through; everyone else sees a themed "not authorized" card instead of the
 * screen's chrome. Duplicated locally rather than imported (Users.tsx doesn't export it) — this is now
 * the SECOND Admin-only screen to need this exact gate, same small, self-contained shape each time. */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const t = useT()
  const { user } = useAuth()

  if (user?.role !== role) {
    return (
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeSlideUp}
        className="flex flex-1 items-center justify-center p-8"
      >
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold text-text-strong">{t("audit.notAuthorized.title")}</h1>
            <p className="text-sm text-text-muted">{t("audit.notAuthorized.description")}</p>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  return <>{children}</>
}

function DateField({
  id,
  label,
  labelEn,
  value,
  onChange,
}: {
  id: string
  label: string
  labelEn: string
  value: string
  onChange: (v: string) => void
}) {
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

function TextFilterField({
  id,
  label,
  labelEn,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  labelEn: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
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
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-40"
      />
    </div>
  )
}

/** Bilingual column header — same register `Users.tsx`'s/`HistorianResultsTable.tsx`'s own `Th` uses
 * (primary language on top, small uppercase gloss beneath, `aria-hidden` — a visual register, not a
 * second accessible name). */
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
        <Skeleton className="h-4 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
    </TableRow>
  )
}

/** Full-JSON expansion for one row's old/new value — opened via the row's "view detail" (`Eye`) button,
 * only rendered when at least one of `oldValueJson`/`newValueJson` is non-null. */
function AuditDetailDialog({ entry, onOpenChange }: { entry: AuditEntry | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("audit.detailDialog.title", { seq: entry?.seq ?? "" })}</DialogTitle>
          <DialogDescription>{t("audit.detailDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="hmi-scroll flex max-h-96 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {t("audit.detailDialog.oldValue")}
            </span>
            <pre className="overflow-x-auto border border-border bg-surface-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-text-body">
              {entry?.oldValueJson ? prettyJson(entry.oldValueJson) : t("audit.detailDialog.none")}
            </pre>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {t("audit.detailDialog.newValue")}
            </span>
            <pre className="overflow-x-auto border border-border bg-surface-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-text-body">
              {entry?.newValueJson ? prettyJson(entry.newValueJson) : t("audit.detailDialog.none")}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AuditTable({
  items,
  isPending,
  isError,
  onViewDetail,
}: {
  items: AuditEntry[]
  isPending: boolean
  isError: boolean
  onViewDetail: (entry: AuditEntry) => void
}) {
  const t = useT()
  const gloss = useGloss()

  if (isError) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-danger-text">
        {t("audit.table.loadFailed")}
      </div>
    )
  }

  if (!isPending && items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted">
        {t("audit.table.empty")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-surface-card">
        <TableRow>
          <Th vi={t("audit.table.seq")} en={gloss("audit.table.seq")} className="w-14" />
          <Th vi={t("audit.table.time")} en={gloss("audit.table.time")} />
          <Th vi={t("audit.table.actor")} en={gloss("audit.table.actor")} />
          <Th vi={t("audit.table.action")} en={gloss("audit.table.action")} />
          <Th vi={t("audit.table.target")} en={gloss("audit.table.target")} />
          <Th vi={t("audit.table.change")} en={gloss("audit.table.change")} />
          <Th vi={t("audit.table.correlationId")} en={gloss("audit.table.correlationId")} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} />)
          : items.map((entry) => {
              const hasChange = entry.oldValueJson !== null || entry.newValueJson !== null
              return (
                <TableRow key={entry.seq}>
                  <TableCell className="font-numeric text-text-muted">{entry.seq}</TableCell>
                  <TableCell className="font-numeric whitespace-nowrap text-text-muted">
                    {formatAuditTime(entry.atUtc)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-text-strong">{entry.actorUsername}</span>
                      <StatusBadge status="neutral" className="w-fit">
                        {entry.actorRole}
                      </StatusBadge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-body">{entry.action}</TableCell>
                  <TableCell className="text-text-body">{formatTarget(entry)}</TableCell>
                  <TableCell className="max-w-64">
                    <div className="flex items-center gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-[11px] text-text-muted">
                        {entry.oldValueJson ? <span className="truncate">− {compactPreview(entry.oldValueJson)}</span> : null}
                        {entry.newValueJson ? <span className="truncate">+ {compactPreview(entry.newValueJson)}</span> : null}
                        {!hasChange ? <span>—</span> : null}
                      </div>
                      {hasChange ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onViewDetail(entry)}
                          aria-label={t("audit.table.viewDetail")}
                        >
                          <Eye className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-text-muted" title={entry.correlationId ?? undefined}>
                    {entry.correlationId ? truncateMiddle(entry.correlationId) : "—"}
                  </TableCell>
                </TableRow>
              )
            })}
      </TableBody>
    </Table>
  )
}

function AuditScreen() {
  const t = useT()
  const gloss = useGloss()

  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [actor, setActor] = React.useState("")
  const [action, setAction] = React.useState("")
  const [target, setTarget] = React.useState("")
  const [offset, setOffset] = React.useState(0)
  const [detailEntry, setDetailEntry] = React.useState<AuditEntry | null>(null)

  // Same "a filter change always lands back on page 1" reasoning `Historian.tsx` documents — otherwise
  // a narrower filter could leave `offset` pointing past the end of the newly-filtered result set.
  React.useEffect(() => {
    setOffset(0)
  }, [from, to, actor, action, target])

  const filter: AuditFilter = React.useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      actor: actor.trim() || undefined,
      action: action.trim() || undefined,
      target: target.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [from, to, actor, action, target, offset]
  )

  const { data, isPending, isError } = useAudit(filter)
  const totalCount = useAudit(UNFILTERED_TOTAL_FILTER)
  const verify = useAuditVerify()

  const filtersActive = from !== "" || to !== "" || actor.trim() !== "" || action.trim() !== "" || target.trim() !== ""
  const clearFilters = React.useCallback(() => {
    setFrom("")
    setTo("")
    setActor("")
    setAction("")
    setTarget("")
  }, [])

  function handleVerify() {
    verify.mutate(undefined, {
      onError: () => toast.error(t("audit.verify.failed")),
    })
  }

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
          <div className="flex items-center gap-2">
            <ScrollText className="size-5 text-primary-text" aria-hidden="true" />
            <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
              {t("audit.title")}
            </h1>
            {/* Subtle, tooltip-only honest-limitation note (brief: "note the honest limitation
                somewhere subtle") — the accessible name IS the full sentence (via `aria-label`, read
                immediately on focus by a screen reader), the tooltip popup is the same text surfaced
                visually on hover/focus. Never part of the headline description above. */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex size-5 items-center justify-center text-text-muted outline-none hover:text-text-body focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                      aria-label={t("audit.limitation.body")}
                    />
                  }
                >
                  <Info className="size-4" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="right">{t("audit.limitation.body")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="hmi-micro mt-1">{gloss("audit.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("audit.description")}</p>
        </div>
        <Button onClick={handleVerify} disabled={verify.isPending}>
          {verify.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-3.5" aria-hidden="true" />
          )}
          {verify.isPending ? t("audit.verify.verifying") : t("audit.verify.button")}
        </Button>
      </div>

      {verify.data ? (
        verify.data.ok ? (
          <p
            role="status"
            className="flex shrink-0 items-start gap-2 border border-ok/30 bg-ok/10 px-3 py-2 text-sm font-medium text-ok-text"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("audit.verify.intact", { count: totalCount.data?.total ?? total })}
          </p>
        ) : (
          <p
            role="alert"
            className="flex shrink-0 items-start gap-2 border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger-text"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("audit.verify.broken", { seq: verify.data.firstBrokenSeq ?? "?", detail: verify.data.detail })}
          </p>
        )
      ) : null}

      <div className="flex shrink-0 flex-wrap items-end gap-3 border border-border bg-surface-card p-3">
        <DateField id="audit-from" label={t("audit.filters.from")} labelEn={gloss("audit.filters.from")} value={from} onChange={setFrom} />
        <DateField id="audit-to" label={t("audit.filters.to")} labelEn={gloss("audit.filters.to")} value={to} onChange={setTo} />
        <TextFilterField
          id="audit-actor"
          label={t("audit.filters.actor")}
          labelEn={gloss("audit.filters.actor")}
          value={actor}
          onChange={setActor}
          placeholder={t("audit.filters.actorPlaceholder")}
        />
        <TextFilterField
          id="audit-action"
          label={t("audit.filters.action")}
          labelEn={gloss("audit.filters.action")}
          value={action}
          onChange={setAction}
          placeholder={t("audit.filters.actionPlaceholder")}
        />
        <TextFilterField
          id="audit-target"
          label={t("audit.filters.target")}
          labelEn={gloss("audit.filters.target")}
          value={target}
          onChange={setTarget}
          placeholder={t("audit.filters.targetPlaceholder")}
        />
        {filtersActive ? (
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <X className="size-3.5" aria-hidden="true" />
            {t("audit.filters.clear")}
          </Button>
        ) : null}
      </div>

      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col gap-2 p-0">
        <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
          <AuditTable items={data?.items ?? []} isPending={isPending} isError={isError} onViewDetail={setDetailEntry} />
        </div>
        {!isPending && !isError && total > 0 ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
            <span className="text-xs text-text-muted">
              {t("audit.pagination.showing", { from: rangeFrom, to: rangeTo, total })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                {t("audit.pagination.prev")}
              </Button>
              <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
                {t("audit.pagination.next")}
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <AuditDetailDialog
        entry={detailEntry}
        onOpenChange={(open) => {
          if (!open) setDetailEntry(null)
        }}
      />
    </motion.div>
  )
}

export default function Audit() {
  return (
    <RequireRole role="Admin">
      <AuditScreen />
    </RequireRole>
  )
}
