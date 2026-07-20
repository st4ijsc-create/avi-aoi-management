import * as React from "react"
import { motion } from "framer-motion"
import { Download, Pause, Play, Trash2 } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  traceStatusBucket,
  useInspectorStream,
  type StreamConnectionState,
} from "@/lib/inspector"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet, StatusLamp } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { TraceTable } from "@/components/TraceTable"

const ALL = "__all__"

function distinctSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

/** Status filter options: numeric HTTP codes ascending first, then the two synthetic buckets
 * ("Queued/0", "Error") last — matches the desktop app's combo ordering. */
function sortStatusBuckets(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    const aNumeric = !Number.isNaN(na)
    const bNumeric = !Number.isNaN(nb)
    if (aNumeric && bNumeric) return na - nb
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a.localeCompare(b)
  })
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** `api-trace-yyyyMMdd-HHmmss.json` — same naming convention as the WPF app's own Export command. */
function exportFileName(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  return `api-trace-${date}-${time}.json`
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface FilterSelectProps {
  id: string
  label: string
  labelEn: string
  value: string
  options: string[]
  onChange: (value: string) => void
  allLabel: string
}

/** Same stacked-bilingual idiom as `Machines.tsx`'s own `FilterSelect` (spec §3) — vi primary on its
 * own line, uppercase EN gloss beneath, never inline on one `hmi-micro` span (that reads as a single
 * garbled string — see the H3c leftover fix on `Machines.tsx`).
 *
 * Explicit `id`/`htmlFor` (not the `<label>`-wraps-the-`<select>` idiom this used to use) — the
 * `<label>` needs to wrap ONLY the primary-language `label` text, with the `aria-hidden` gloss as a
 * sibling OUTSIDE it. `aria-hidden` alone isn't enough here: Playwright's `getByLabel` resolves an
 * associated `<label>` by its raw DOM text rather than the ARIA accessible-name algorithm, so a
 * hidden-but-still-present gloss inside the `<label>` still counted for that lookup (H3c a11y fix —
 * see `FormField.tsx`'s doc comment for the concrete "two fields, one collided name" bug this caused). */
function FilterSelect({ id, label, labelEn, value, options, onChange, allLabel }: FilterSelectProps) {
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
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 border border-border-strong bg-surface-muted px-2 text-xs text-text-body outline-none transition-colors focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
      >
        <option value={ALL}>{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

interface StreamStatusIndicatorProps {
  connectionState: StreamConnectionState
  paused: boolean
  eventsPerSecond: number
}

/** Same `StatusLamp` primitive as `TopBar`'s own `EngineStatusLamp` (spec §5) — this is the same "is
 * the live connection healthy" question, just for the inspector's own WS trace socket instead of the
 * polled HTTP health check, so it reads as the same instrument rather than a bespoke dot. */
function StreamStatusIndicator({ connectionState, paused, eventsPerSecond }: StreamStatusIndicatorProps) {
  const t = useT()
  const live = !paused && connectionState === "open"

  const state = paused ? "warn" : connectionState === "open" ? "run" : connectionState === "connecting" ? "idle" : "fault"

  const label = paused
    ? t("inspector.status.paused")
    : connectionState === "open"
      ? t("inspector.status.live")
      : connectionState === "connecting"
        ? t("inspector.status.connecting")
        : t("inspector.status.reconnecting")

  return (
    <StatusLamp
      state={state}
      live={live}
      label={label}
      sub={live ? `${eventsPerSecond.toFixed(1)}/s` : undefined}
      className="border border-border-strong bg-surface-card px-2.5 py-1.5"
    />
  )
}

export default function ApiInspector() {
  const t = useT()
  const gloss = useGloss()
  const stream = useInspectorStream()
  const [filterMachine, setFilterMachine] = React.useState(ALL)
  const [filterKind, setFilterKind] = React.useState(ALL)
  const [filterStatus, setFilterStatus] = React.useState(ALL)
  const [exportNote, setExportNote] = React.useState<string | null>(null)
  const exportNoteTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => () => clearTimeout(exportNoteTimer.current), [])

  const machineOptions = React.useMemo(
    () => distinctSorted(stream.events.map((e) => e.machineCode)),
    [stream.events]
  )
  const kindOptions = React.useMemo(() => distinctSorted(stream.events.map((e) => e.kind)), [stream.events])
  const statusOptions = React.useMemo(
    () => sortStatusBuckets(stream.events.map((e) => traceStatusBucket(e))),
    [stream.events]
  )

  const filtersActive = filterMachine !== ALL || filterKind !== ALL || filterStatus !== ALL

  const filteredEvents = React.useMemo(() => {
    if (!filtersActive) return stream.events
    return stream.events.filter((e) => {
      if (filterMachine !== ALL && e.machineCode !== filterMachine) return false
      if (filterKind !== ALL && e.kind !== filterKind) return false
      if (filterStatus !== ALL && traceStatusBucket(e) !== filterStatus) return false
      return true
    })
  }, [stream.events, filterMachine, filterKind, filterStatus, filtersActive])

  function handleClear() {
    stream.clear()
    setFilterMachine(ALL)
    setFilterKind(ALL)
    setFilterStatus(ALL)
    setExportNote(null)
  }

  function handleExport() {
    const snapshot = stream.events
    // Strip the client-assigned `id` (a react-virtual/React key aid, not part of the wire contract) —
    // the export should read as exactly what `ApiTraceEvent` looks like over the wire, not an artifact
    // of how this table renders it.
    const wireShape = snapshot.map(({ id: _id, ...event }) => event)
    downloadJson(wireShape, exportFileName())
    setExportNote(t("inspector.exportedNote", { count: snapshot.length }))
    clearTimeout(exportNoteTimer.current)
    exportNoteTimer.current = setTimeout(() => setExportNote(null), 4000)
  }

  const emptyMessage =
    stream.events.length === 0
      ? stream.connectionState === "connecting"
        ? t("inspector.emptyConnecting")
        : t("inspector.emptyNoTraffic")
      : t("inspector.emptyNoMatch")

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("inspector.title")}
          </h1>
          <p className="hmi-micro mt-1">{gloss("inspector.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">
            {t("inspector.subtitle", { count: stream.totalCount.toLocaleString() })}
          </p>
        </div>
        <StreamStatusIndicator
          connectionState={stream.connectionState}
          paused={stream.paused}
          eventsPerSecond={stream.eventsPerSecond}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border border-border bg-surface-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            id="inspector-filter-machine"
            label={t("inspector.filters.machine")}
            labelEn={gloss("inspector.filters.machine")}
            value={filterMachine}
            options={machineOptions}
            onChange={setFilterMachine}
            allLabel={t("inspector.filters.all")}
          />
          <FilterSelect
            id="inspector-filter-kind"
            label={t("inspector.filters.kind")}
            labelEn={gloss("inspector.filters.kind")}
            value={filterKind}
            options={kindOptions}
            onChange={setFilterKind}
            allLabel={t("inspector.filters.all")}
          />
          <FilterSelect
            id="inspector-filter-status"
            label={t("inspector.filters.status")}
            labelEn={gloss("inspector.filters.status")}
            value={filterStatus}
            options={statusOptions}
            onChange={setFilterStatus}
            allLabel={t("inspector.filters.all")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="font-numeric font-semibold text-text-strong">{filteredEvents.length.toLocaleString()}</span>
            <span className="text-text-muted"> {t("inspector.shownLabel")}</span>
            {filtersActive ? (
              <span className="font-numeric text-text-muted">
                {" "}
                {t("inspector.ofBuffered", { count: stream.events.length.toLocaleString() })}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={stream.paused ? "default" : "outline"}
              onClick={() => stream.setPaused(!stream.paused)}
              aria-pressed={stream.paused}
            >
              {stream.paused ? (
                <Play className="size-3.5" aria-hidden="true" />
              ) : (
                <Pause className="size-3.5" aria-hidden="true" />
              )}
              {stream.paused ? t("inspector.resume") : t("inspector.pause")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleClear} disabled={stream.events.length === 0}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("inspector.clear")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={stream.events.length === 0}>
              <Download className="size-3.5" aria-hidden="true" />
              {t("inspector.export")}
            </Button>
          </div>
        </div>
      </div>

      {exportNote ? (
        <p role="status" className="-mt-2 text-xs text-text-muted">
          {exportNote}
        </p>
      ) : null}

      <Sheet
        className="min-h-0 flex-1"
        title={t("inspector.title")}
        titleEn={gloss("inspector.title")}
        bodyClassName="flex flex-1 min-h-0 flex-col p-0"
      >
        <TraceTable rows={filteredEvents} emptyMessage={emptyMessage} className="min-h-0 flex-1" />
      </Sheet>
    </motion.div>
  )
}
