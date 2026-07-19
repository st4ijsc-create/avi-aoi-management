import * as React from "react"
import { motion } from "framer-motion"
import { Download, Pause, Play, Terminal, Trash2 } from "lucide-react"

import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  traceStatusBucket,
  useInspectorStream,
  type StreamConnectionState,
} from "@/lib/inspector"
import { fadeSlideUp } from "@/theme/motion"
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
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  allLabel: string
}

function FilterSelect({ label, value, options, onChange, allLabel }: FilterSelectProps) {
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
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

interface StreamStatusIndicatorProps {
  connectionState: StreamConnectionState
  paused: boolean
  eventsPerSecond: number
}

/** Mirrors `TopBar`'s `ServerStatusDot` idiom (dot + short label) rather than inventing a new status
 * affordance — this is the same "is the live connection healthy" question, just for the inspector's
 * own socket instead of the polled HTTP health check. */
function StreamStatusIndicator({ connectionState, paused, eventsPerSecond }: StreamStatusIndicatorProps) {
  const t = useT()
  const live = !paused && connectionState === "open"

  const dotClass = paused
    ? "bg-warn"
    : connectionState === "open"
      ? "bg-ok"
      : connectionState === "connecting"
        ? "bg-neutral"
        : "bg-danger"

  const label = paused
    ? t("inspector.status.paused")
    : connectionState === "open"
      ? t("inspector.status.live")
      : connectionState === "connecting"
        ? t("inspector.status.connecting")
        : t("inspector.status.reconnecting")

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-muted">
      <span className={cn("size-2 rounded-full", live && "animate-pulse", dotClass)} aria-hidden="true" />
      <span className="font-medium text-text-body">{label}</span>
      {live ? (
        <span className="font-numeric tabular-nums text-text-muted">· {eventsPerSecond.toFixed(1)}/s</span>
      ) : null}
    </div>
  )
}

export default function ApiInspector() {
  const t = useT()
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
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex min-h-0 flex-1 flex-col gap-4 p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Terminal className="size-5 text-navy-600" aria-hidden="true" />
            <h1 className="text-2xl font-semibold text-text-strong">{t("inspector.title")}</h1>
          </div>
          <p className="text-sm text-text-muted">{t("inspector.subtitle", { count: stream.totalCount.toLocaleString() })}</p>
        </div>
        <StreamStatusIndicator
          connectionState={stream.connectionState}
          paused={stream.paused}
          eventsPerSecond={stream.eventsPerSecond}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label={t("inspector.filters.machine")}
            value={filterMachine}
            options={machineOptions}
            onChange={setFilterMachine}
            allLabel={t("inspector.filters.all")}
          />
          <FilterSelect
            label={t("inspector.filters.kind")}
            value={filterKind}
            options={kindOptions}
            onChange={setFilterKind}
            allLabel={t("inspector.filters.all")}
          />
          <FilterSelect
            label={t("inspector.filters.status")}
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

      <TraceTable rows={filteredEvents} emptyMessage={emptyMessage} className="min-h-0 flex-1" />
    </motion.div>
  )
}
