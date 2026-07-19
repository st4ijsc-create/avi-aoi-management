/**
 * Task 5 — API Inspector data layer: `useInspectorStream()` plus the pure status-classification
 * helpers `TraceTable`/`StatusBadge` build on.
 *
 * Wire contract (Task 3, `St4i.EngineApi.Hubs.InspectorStreamEndpoint` + `ApiTraceEvent.cs`):
 * `WS /v1/inspector/stream` backfills the EventBus's last ~200 buffered events (oldest-first) right
 * after the upgrade completes, then pushes every subsequent trace as its own JSON text frame for as
 * long as the socket stays open. Server-push-only — there is no client→server message contract.
 * `ApiJson.Options` (camelCase properties, enums as their literal C# member name) is what serializes
 * every frame, so field names below are camelCase and `kind`/`mode` come back as e.g. `"ProcessResult"`
 * / `"Live"`, not lower-cased.
 *
 * The desktop app (`St4iMachineSimulator.ViewModels.InspectorViewModel`) is the reference
 * implementation for this whole screen's *behavior* (ring cap, pause-drops-not-buffers, "N shown"
 * tracks the FILTERED view not the ring, Clear resets everything including filter options, Export
 * dumps the whole ring not just what's currently filtered). This file mirrors that ViewModel's rules
 * so the web and WPF apps read as the same product. `traceStatusTone`/`traceStatusBucket` below are
 * the direct analogues of its `ApiTraceRowBrushConverter` (coarse 2xx/4xx+/queued/error grouping for
 * color) and `StatusBucket` (exact-code grouping for the filter combo) respectively — deliberately
 * two different granularities for two different jobs, same split as the desktop app.
 */
import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with ApiTraceEvent.cs
// ─────────────────────────────────────────────────────────────────────────

export type ReadingKind = "ProcessResult" | "Telemetry" | "Inspection"
export type TransportMode = "Live" | "Demo" | "Auto"

export interface ApiTraceEvent {
  at: string
  machineCode: string
  kind: ReadingKind
  method: string
  path: string
  status: number
  latencyMs: number
  mode: TransportMode
  duplicate: boolean
  error: string | null
}

/** A received trace event plus a client-assigned monotonic id — stable React/virtualizer row key
 * that survives the ring shifting as new events arrive, independent of array index. */
export interface TraceRow extends ApiTraceEvent {
  id: number
}

// ─────────────────────────────────────────────────────────────────────────
// Status classification — shared by StatusBadge (color), TraceTable (row tint) and the
// route's status filter (bucket).
// ─────────────────────────────────────────────────────────────────────────

export type StatusTone = "ok" | "warn" | "danger" | "neutral"

/** Coarse grouping for color: a transport-level Error always wins (regardless of HTTP status),
 * then 2xx, then HttpStatus 0 (queued/no round-trip yet — the store-and-forward case), then 4xx/5xx.
 * Mirrors `ApiTraceRowBrushConverter`. */
export function traceStatusTone(e: Pick<ApiTraceEvent, "status" | "error">): StatusTone {
  if (e.error) return "danger"
  if (e.status >= 200 && e.status < 300) return "ok"
  if (e.status === 0) return "warn"
  if (e.status >= 400) return "danger"
  return "neutral"
}

/** Exact-code grouping for the status filter: "Error" / "Queued/0" / the literal status code as a
 * string (so 201 and 202 land in distinct, individually selectable buckets). Mirrors
 * `InspectorViewModel.StatusBucket`. */
export function traceStatusBucket(e: Pick<ApiTraceEvent, "status" | "error">): string {
  if (e.error) return "Error"
  if (e.status === 0) return "Queued/0"
  return String(e.status)
}

// ─────────────────────────────────────────────────────────────────────────
// useInspectorStream
// ─────────────────────────────────────────────────────────────────────────

/** Client-side ring cap. Bigger than the EventBus's own 500-capacity server ring / 200-event
 * backfill on purpose — this is how much history the tab itself is willing to hold in memory across
 * a long exhibition run, not a mirror of the server's bound. */
const RING_CAPACITY = 1000

const RECONNECT_DELAY_MS = 1500

/** Rolling window (ms) the live events/sec indicator averages over. */
const RATE_WINDOW_MS = 3000
const RATE_TICK_MS = 500

export type StreamConnectionState = "connecting" | "open" | "closed"

/** Derives `ws(s)://<host>/v1/inspector/stream` from `VITE_ENGINE_URL` (default
 * `http://localhost:5199`), matching Task 4's `lib/api.ts` `BASE_URL` convention exactly so the two
 * only need the env var set in one place. */
function inspectorStreamUrl(): string {
  const base = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://localhost:5199"
  const url = new URL(base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/v1/inspector/stream"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export interface UseInspectorStreamResult {
  /** Newest-first, capped at `RING_CAPACITY`. */
  events: TraceRow[]
  /** Cumulative count of every event ever added this session (survives ring eviction). Frozen while
   * paused — same rule as the WPF ViewModel's `TotalEventCount` (its `OnTraced` checks `IsPaused`
   * before incrementing at all). Reset by `clear()`. */
  totalCount: number
  /** Rolling live rate, averaged over `RATE_WINDOW_MS`. Settles to 0 shortly after the stream goes
   * quiet or the view is paused (no new timestamps feed the window). */
  eventsPerSecond: number
  connectionState: StreamConnectionState
  paused: boolean
  setPaused: (paused: boolean) => void
  /** Empties the ring and resets `totalCount`/rate — does not touch the socket. */
  clear: () => void
}

/**
 * Opens `WS /v1/inspector/stream`, keeps a capped newest-first ring, and reconnects on drop.
 *
 * Incoming frames are buffered in a ref and flushed at most once per animation frame rather than
 * calling `setState` per message — the initial ~200-event backfill (and any burst from a fleet of
 * dozens of machines cycling concurrently) would otherwise force that many synchronous re-renders in
 * a row. Batching keeps the commit count bounded to the display's refresh rate regardless of how many
 * frames arrive in between.
 *
 * Pause "drops while paused" per the task brief: a paused view neither buffers nor appends anything
 * that arrives while paused — it simply ignores those frames, so Resume never dumps a backlog.
 */
export function useInspectorStream(): UseInspectorStreamResult {
  const [events, setEvents] = React.useState<TraceRow[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [eventsPerSecond, setEventsPerSecond] = React.useState(0)
  const [connectionState, setConnectionState] = React.useState<StreamConnectionState>("connecting")
  const [paused, setPaused] = React.useState(false)

  const pausedRef = React.useRef(paused)
  pausedRef.current = paused

  const nextIdRef = React.useRef(0)
  const pendingRef = React.useRef<TraceRow[]>([])
  const rafRef = React.useRef<number | null>(null)
  const rateTimestampsRef = React.useRef<number[]>([])

  const flush = React.useCallback(() => {
    rafRef.current = null
    const batch = pendingRef.current
    if (batch.length === 0) return
    pendingRef.current = []

    setEvents((prev) => {
      // batch arrived oldest-first; ring is newest-first.
      const merged = [...batch].reverse().concat(prev)
      return merged.length > RING_CAPACITY ? merged.slice(0, RING_CAPACITY) : merged
    })
    setTotalCount((prev) => prev + batch.length)
  }, [])

  const scheduleFlush = React.useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  React.useEffect(() => {
    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (cancelled) return
      setConnectionState("connecting")
      socket = new WebSocket(inspectorStreamUrl())

      socket.onopen = () => {
        if (!cancelled) setConnectionState("open")
      }

      socket.onmessage = (message) => {
        if (cancelled || pausedRef.current) return
        let parsed: ApiTraceEvent
        try {
          parsed = JSON.parse(message.data as string) as ApiTraceEvent
        } catch {
          return // malformed frame — ignore rather than crash the stream
        }
        pendingRef.current.push({ ...parsed, id: nextIdRef.current++ })
        rateTimestampsRef.current.push(Date.now())
        scheduleFlush()
      }

      socket.onclose = () => {
        if (cancelled) return
        setConnectionState("closed")
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }

      socket.onerror = () => {
        // onclose always follows onerror for a WebSocket — reconnect is scheduled there.
        socket?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      socket?.close()
    }
  }, [scheduleFlush])

  // Live rate ticker — independent of the message-driven flush so the indicator visibly decays back
  // to 0 when the stream goes quiet, not just when a new message happens to arrive.
  React.useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - RATE_WINDOW_MS
      const stamps = rateTimestampsRef.current.filter((t) => t >= cutoff)
      rateTimestampsRef.current = stamps
      setEventsPerSecond(stamps.length / (RATE_WINDOW_MS / 1000))
    }, RATE_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const clear = React.useCallback(() => {
    pendingRef.current = []
    rateTimestampsRef.current = []
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setEvents([])
    setTotalCount(0)
    setEventsPerSecond(0)
  }, [])

  return { events, totalCount, eventsPerSecond, connectionState, paused, setPaused, clear }
}
