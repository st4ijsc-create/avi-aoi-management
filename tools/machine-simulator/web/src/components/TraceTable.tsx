import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { motion, useReducedMotion } from "framer-motion"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { traceStatusTone, type TraceRow } from "@/lib/inspector"
import { rowEnter } from "@/theme/motion"
import { StatusBadge as StatusChip } from "@/components/ui/status-badge"
import { StatusBadge } from "@/components/StatusBadge"

const ROW_HEIGHT = 34
const OVERSCAN = 12

/** Shared column template for the header row and every body row — one source of truth so the two
 * can never drift out of alignment. `minmax(…)` on path/dup-error lets those two absorb extra width;
 * everything else is a fixed measurement sized to its content (time/latency/status are tabular-nums,
 * so a fixed width never jitters as digits change). */
const GRID_TEMPLATE =
  "grid grid-cols-[92px_100px_110px_58px_minmax(220px,1.7fr)_60px_74px_68px_minmax(140px,1fr)] gap-x-3"

const KIND_DOT: Record<string, string> = {
  ProcessResult: "bg-chart-1",
  Telemetry: "bg-chart-2",
  Inspection: "bg-chart-3",
}

const MODE_TONE: Record<string, "info" | "neutral" | "warn"> = {
  Live: "info",
  Demo: "neutral",
  Auto: "warn",
}

const ROW_TONE_CLASS: Record<ReturnType<typeof traceStatusTone>, string> = {
  ok: "border-l-ok/70 bg-ok/5 hover:bg-ok/10",
  warn: "border-l-warn/70 bg-warn/10 hover:bg-warn/15",
  danger: "border-l-danger/70 bg-danger/5 hover:bg-danger/10",
  neutral: "border-l-transparent hover:bg-surface-muted",
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function formatTime(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return "—"
  const ms = String(d.getMilliseconds()).padStart(3, "0")
  return `${timeFormatter.format(d)}.${ms}`
}

function DupErrorCell({ row }: { row: TraceRow }) {
  if (row.error) {
    return (
      <span className="truncate text-danger-text" title={row.error}>
        {row.error}
      </span>
    )
  }
  if (row.duplicate) {
    return <span className="font-medium text-warn-text">DUP</span>
  }
  return <span className="text-text-muted">—</span>
}

interface HeaderCellProps {
  /** Active-language column name. */
  children: React.ReactNode
  /** Uppercase EN gloss, stacked beneath — same bilingual header treatment as `Machines.tsx`'s own
   * `BilingualHead` (spec §3), so this table's column row matches the app's one approved standard. */
  en: React.ReactNode
  align?: "left" | "right" | "center"
}

function HeaderCell({ children, en, align = "left" }: HeaderCellProps) {
  return (
    <div
      role="columnheader"
      className={cn(
        "flex flex-col justify-center py-1.5 text-[11px] font-semibold tracking-wide text-text-muted uppercase",
        align === "right" && "items-end text-right",
        align === "center" && "items-center text-center"
      )}
    >
      <span>{children}</span>
      {/* `aria-hidden` — visual gloss register only (spec §1), not a second accessible name; left
          exposed it doubles what a screen reader announces for every column header. */}
      <span className="hmi-micro font-normal tracking-[0.1em]" aria-hidden="true">
        {en}
      </span>
    </div>
  )
}

interface TraceTableProps {
  /** Already-filtered, newest-first. */
  rows: TraceRow[]
  emptyMessage: string
  className?: string
}

/**
 * Virtualized live-trace table — `time / machine / kind / method / path / status / latency / mode /
 * dup-error`, one row per `ApiTraceEvent`. Uses `@tanstack/react-virtual` so the ~1000-row ring never
 * mounts more than a couple dozen DOM rows at once regardless of how deep the buffer gets.
 *
 * Rendered as ARIA `role="table"`/`"row"`/`"cell"` `div`s rather than a native `<table>` — a real
 * `<table>`'s layout algorithm doesn't cooperate with react-virtual's absolutely-positioned rows
 * (native table row/cell sizing needs the whole table present to lay out columns), so this follows
 * the standard "ARIA grid over divs" pattern for virtualized tabular UI, with an explicit
 * `aria-rowindex` per row since the DOM only ever holds the visible window, not every row in order.
 */
export function TraceTable({ rows, emptyMessage, className }: TraceTableProps) {
  const t = useT()
  const gloss = useGloss()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // No self-owned border/corners here — the registration-corner `.sheet` frame is rendered ONLY by
  // the `<Sheet>` primitive (spec §4), and `.sheet`'s marks sit 6px outside the box, so they must
  // never share an element with `overflow: hidden` (this table's own scroll container needs exactly
  // that). `ApiInspector.tsx` wraps this component in a `<Sheet>` instead.
  return (
    <div className={cn("flex flex-col overflow-hidden bg-surface-card", className)}>
      <div
        ref={scrollRef}
        role="table"
        aria-label={t("inspector.title")}
        aria-rowcount={rows.length + 1}
        // Keyboard-focusable (axe `scrollable-region-focusable`): this div is the actual scroll
        // container (react-virtual scrolls it directly), so a keyboard-only user needs to be able to
        // Tab into it and scroll with arrow keys/Page Down — a scrollable region with no host element
        // in the tab order is otherwise unreachable without a mouse/touch.
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-navy-600/50"
      >
        <div className="min-w-[960px]">
          <div
            role="row"
            aria-rowindex={1}
            className={cn(
              GRID_TEMPLATE,
              "sticky top-0 z-10 border-b border-border bg-surface-subtle px-3"
            )}
          >
            <HeaderCell en={gloss("inspector.table.time")}>{t("inspector.table.time")}</HeaderCell>
            <HeaderCell en={gloss("inspector.table.machine")}>{t("inspector.table.machine")}</HeaderCell>
            <HeaderCell en={gloss("inspector.table.kind")}>{t("inspector.table.kind")}</HeaderCell>
            <HeaderCell en={gloss("inspector.table.method")}>{t("inspector.table.method")}</HeaderCell>
            <HeaderCell en={gloss("inspector.table.path")}>{t("inspector.table.path")}</HeaderCell>
            <HeaderCell align="center" en={gloss("inspector.table.status")}>
              {t("inspector.table.status")}
            </HeaderCell>
            <HeaderCell align="right" en={gloss("inspector.table.latency")}>
              {t("inspector.table.latency")}
            </HeaderCell>
            <HeaderCell align="center" en={gloss("inspector.table.mode")}>
              {t("inspector.table.mode")}
            </HeaderCell>
            <HeaderCell en={gloss("inspector.table.dupError")}>{t("inspector.table.dupError")}</HeaderCell>
          </div>

          {rows.length === 0 ? (
            <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-text-muted">
              {emptyMessage}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) return null
                const tone = traceStatusTone(row)

                return (
                  // Positioning lives on this OUTER plain element via a raw CSS `transform` — kept
                  // separate from the animated inner element on purpose. Framer-motion owns the
                  // `transform` property outright as soon as anything animates `x`/`y` (it composes
                  // its own translate/scale into that one CSS property), so a motion component
                  // animating `y` would silently discard react-virtual's `translateY(virtualRow.start)`
                  // positioning and stack every row at the same offset. Splitting "where" (this div)
                  // from "how it enters" (the inner `motion.div`, which owns no positioning of its
                  // own) keeps both concerns intact — this is also why `role="row"` sits here: it's
                  // the element react-virtual actually indexes/sizes.
                  <div
                    key={row.id}
                    role="row"
                    aria-rowindex={virtualRow.index + 2}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <motion.div
                      initial={reduceMotion ? false : "hidden"}
                      animate="visible"
                      variants={rowEnter}
                      className={cn(
                        GRID_TEMPLATE,
                        "h-full items-center border-b border-l-[3px] border-border px-3 text-xs text-text-body",
                        ROW_TONE_CLASS[tone]
                      )}
                    >
                      <div role="cell" className="font-numeric truncate tabular-nums text-text-muted">
                        {formatTime(row.at)}
                      </div>
                      <div role="cell" className="truncate font-medium text-text-strong" title={row.machineCode}>
                        {row.machineCode}
                      </div>
                      <div role="cell" className="flex items-center gap-1.5 truncate">
                        <span
                          aria-hidden="true"
                          className={cn("size-1.5 shrink-0 rounded-full", KIND_DOT[row.kind] ?? "bg-neutral")}
                        />
                        <span className="truncate">{row.kind}</span>
                      </div>
                      <div role="cell" className="truncate font-mono text-[11px] text-text-body">
                        {row.method}
                      </div>
                      <div role="cell" className="truncate font-mono text-[11px] text-text-body" title={row.path}>
                        {row.path}
                      </div>
                      <div role="cell" className="flex justify-center">
                        <StatusBadge event={row} />
                      </div>
                      <div role="cell" className="font-numeric text-right tabular-nums text-text-body">
                        {row.latencyMs}ms
                      </div>
                      <div role="cell" className="flex justify-center">
                        <StatusChip status={MODE_TONE[row.mode] ?? "neutral"} className="w-fit">
                          {row.mode}
                        </StatusChip>
                      </div>
                      <div role="cell" className="min-w-0 truncate text-[11px]">
                        <DupErrorCell row={row} />
                      </div>
                    </motion.div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
