/**
 * Task 4 — typed EngineApi client + TanStack Query hooks.
 *
 * Base URL: `VITE_ENGINE_URL` env var, default `http://localhost:5199` (Task 3's fixed dev port).
 * Wire shapes mirror `St4i.EngineApi.Fleet.Dtos` exactly (`Fleet/Dtos.cs`) — ASP.NET's minimal-API
 * default JSON options camelCase property names (`ConfigureHttpJsonOptions` uses
 * `JsonSerializerDefaults.Web`) but leave enum VALUES as their literal C# member name via the
 * explicit `JsonStringEnumConverter()` registered in `Program.cs` — so `mode` comes back as
 * `"Live" | "Demo" | "Auto"`, not lower-cased.
 *
 * Only the surface Shell/Dashboard (Task 4) actually consume lives here — `GET /v1/machines/{code}`
 * and the WS inspector stream are Task 5/6's concern and intentionally not added yet (YAGNI).
 */
import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"

const BASE_URL = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://localhost:5199"

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with Fleet/Dtos.cs
// ─────────────────────────────────────────────────────────────────────────

export type DeviceClass = "Automation" | "Iot" | "AoiAvi"
export type DriverKind = "Simulated" | "HotFolderAoi" | "Mqtt"
export type TransportMode = "Live" | "Demo" | "Auto"

export interface FleetTile {
  code: string
  deviceClass: DeviceClass
  driverKind: DriverKind
  statusText: string
  passRate: number
  cycles: number
  lastCycleSummary: string
  spark: number[]
}

export interface FleetKpis {
  online: number
  totalCycles: number
  fpy: number
}

export interface FleetSnapshot {
  machines: FleetTile[]
  kpis: FleetKpis
}

export interface FleetActionResult {
  running: boolean
  mode: string
}

export interface ModeState {
  mode: TransportMode
}

export interface Health {
  ok: boolean
  mode: TransportMode
}

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/machines/{code} — Task 6. Wire shapes mirror `Fleet/Dtos.cs`'s
// `MachineDetailDto` and `Fleet/MachineState.cs`'s `SpcSummaryDto` /
// `TelemetrySeriesDto` / `BoardPointDto` / `CycleLogEntry`, plus
// `St4i.EdgeCore.Models.Bbox` for the board point's bounding box.
// ─────────────────────────────────────────────────────────────────────────

/** I-MR-style SPC summary — `values` is the raw recent-cycles window (oldest→newest), `mean`/`ucl`/
 * `lcl` computed server-side over that same window (mean ± 3·sample-stdev). */
export interface SpcSummary {
  values: number[]
  mean: number
  ucl: number
  lcl: number
}

/** One telemetry metric's recent value window (oldest→newest) — IoT machines report one of these per
 * distinct metric name reported so far this session. */
export interface TelemetrySeries {
  metric: string
  values: number[]
}

/** Pixel bounding box in `AoiInspectorSim`'s own coordinate space — see `BOARD_WIDTH`/`BOARD_HEIGHT`
 * in `BoardView.tsx` (1600×1200, matching the simulator's `BoardWidthPx`/`BoardHeightPx` consts and
 * the WPF app's `Controls/BoardView.xaml` defaults). */
export interface Bbox {
  x: number
  y: number
  w: number
  h: number
}

/** `MeasurementResult.Result` — doc-28's 3-token vocabulary. */
export type BoardResult = "OK" | "NG" | "NTF"

/** One inspected board point. Only NG points carry a `bbox` in this build's simulator (OK points have
 * no defect to localize) — `bbox` is `null`/absent for everything else, by design, not a data gap. */
export interface BoardPoint {
  pointCode: string
  result: BoardResult
  bbox?: Bbox | null
  defectCode?: string | null
}

/** One row of a machine's cycle log, newest-last (server appends, capped at 200 rows). */
export interface CycleLogRow {
  time: string
  serial: string
  verdict: string
  keyMetric: string
}

export interface MachineDetail {
  code: string
  /** Named `class` on the wire (`MachineDetailDto.Class`) — same `DeviceClass` enum as the fleet tile. */
  class: DeviceClass
  driverKind: DriverKind
  statusText: string
  passRate: number
  cycles: number
  spc: SpcSummary
  telemetry: TelemetrySeries[]
  boardPoints: BoardPoint[]
  cycleLog: CycleLogRow[]
  /** Human-readable outcome of the last `sync-config` call this session — "—" until one has run. */
  driftState: string
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/machines/{code}/sync-config
// ─────────────────────────────────────────────────────────────────────────

export interface SyncConfigResult {
  code: string
  changed: boolean
  version: string | null
  /** Raw drift token from the transport — `"synced" | "none" | "error"` in this build (`DemoTransport`/
   * `LiveTransport`), but treated as an open string since a real ST4I server could add more. */
  driftState: string | null
  applied: boolean
  /** Same value `MachineDetail.driftState` will read after this call — `"{driftState} · v{version} ·
   * applied={applied}"`, pre-formatted server-side so the client never has to reassemble it. */
  driftStateText: string
}

// ─────────────────────────────────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────────────────────────────────

export class EngineApiError extends Error {
  method: string
  path: string
  status: number

  constructor(method: string, path: string, status: number) {
    super(`${method} ${path} failed: ${status}`)
    this.name = "EngineApiError"
    this.method = method
    this.path = path
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET"
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw new EngineApiError(method, path, res.status)
  return (await res.json()) as T
}

const endpoints = {
  fleet: () => request<FleetSnapshot>("/v1/fleet"),
  mode: () => request<ModeState>("/v1/mode"),
  setMode: (mode: TransportMode) =>
    request<ModeState>("/v1/mode", { method: "PUT", body: JSON.stringify({ mode }) }),
  startFleet: () => request<FleetActionResult>("/v1/fleet/start", { method: "POST" }),
  stopFleet: () => request<FleetActionResult>("/v1/fleet/stop", { method: "POST" }),
  health: () => request<Health>("/v1/health"),
  machineDetail: (code: string) => request<MachineDetail>(`/v1/machines/${encodeURIComponent(code)}`),
  syncConfig: (code: string) =>
    request<SyncConfigResult>(`/v1/machines/${encodeURIComponent(code)}/sync-config`, { method: "POST" }),
}

// ─────────────────────────────────────────────────────────────────────────
// Fleet runtime context — "is the fleet actively running" is only ever
// reported back by the start/stop actions themselves (no field on
// GET /v1/fleet or GET /v1/health says so), so it's tracked client-side as
// plain shell-scoped state rather than shoehorned into the query cache.
// Dashboard's empty state and the TopBar Start/Stop buttons both read it;
// starting/stopping the fleet is meaningful from ANY route, not just
// Dashboard, so it lives above the router in App.tsx.
// ─────────────────────────────────────────────────────────────────────────

interface FleetRuntimeValue {
  isRunning: boolean
  setIsRunning: (value: boolean) => void
}

const FleetRuntimeContext = React.createContext<FleetRuntimeValue | null>(null)

export function FleetRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [isRunning, setIsRunning] = React.useState(false)
  const value = React.useMemo(() => ({ isRunning, setIsRunning }), [isRunning])
  return React.createElement(FleetRuntimeContext.Provider, { value }, children)
}

function useFleetRuntime(): FleetRuntimeValue {
  const ctx = React.useContext(FleetRuntimeContext)
  if (!ctx) throw new Error("useFleetRuntime must be used within <FleetRuntimeProvider>")
  return ctx
}

/** Whether the fleet is currently believed to be running (client-tracked, see remarks above). */
export function useFleetIsRunning(): boolean {
  return useFleetRuntime().isRunning
}

// ─────────────────────────────────────────────────────────────────────────
// Query hooks
// ─────────────────────────────────────────────────────────────────────────

const QUERY_KEYS = {
  fleet: ["fleet"] as const,
  mode: ["mode"] as const,
  health: ["health"] as const,
  machine: (code: string) => ["machine", code] as const,
}

/**
 * Polls `GET /v1/fleet` at ~1s so dashboard tiles animate live. Deliberately polls continuously
 * whenever a consumer is mounted (not gated on `isRunning`) rather than pausing while stopped —
 * cheap for a local engine, and it means a page reload after the fleet was left running in a
 * previous session self-heals (the grid repopulates from real cycle counts even though the
 * client-side `isRunning` flag reset to false on reload).
 */
export function useFleet(): UseQueryResult<FleetSnapshot> {
  return useQuery({
    queryKey: QUERY_KEYS.fleet,
    queryFn: endpoints.fleet,
    refetchInterval: 1000,
  })
}

export function useMode(): UseQueryResult<ModeState> {
  return useQuery({
    queryKey: QUERY_KEYS.mode,
    queryFn: endpoints.mode,
    refetchInterval: 5000,
  })
}

export function useSetMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: endpoints.setMode,
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.mode, data)
    },
  })
}

export function useStartFleet() {
  const queryClient = useQueryClient()
  const { setIsRunning } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.startFleet,
    onSuccess: (data) => {
      setIsRunning(data.running)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleet })
    },
  })
}

export function useStopFleet() {
  const { setIsRunning } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.stopFleet,
    onSuccess: (data) => {
      setIsRunning(data.running)
    },
  })
}

/**
 * Polled slowly, mainly to drive the TopBar server-status dot. `HealthDto.ok` is hardcoded `true`
 * server-side whenever the request succeeds at all — a failed fetch (network error / engine down)
 * is what actually signals "offline" here, via TanStack Query's `isError`.
 */
export function useHealth(): UseQueryResult<Health> {
  return useQuery({
    queryKey: QUERY_KEYS.health,
    queryFn: endpoints.health,
    refetchInterval: 5000,
    retry: 1,
  })
}

/**
 * Polls `GET /v1/machines/{code}` at ~1s — same live-tick cadence as `useFleet`, so a machine's SPC/
 * telemetry/board/log all advance in lockstep with the dashboard tile the user clicked in from.
 * `enabled: false` while `code` is falsy lets the route mount unconditionally (e.g. mid-navigation)
 * without firing a request against `/v1/machines/undefined`.
 */
export function useMachine(code: string | undefined): UseQueryResult<MachineDetail> {
  return useQuery({
    queryKey: QUERY_KEYS.machine(code ?? ""),
    queryFn: () => endpoints.machineDetail(code as string),
    enabled: code !== undefined && code.length > 0,
    // A confirmed 404 ("this code isn't in the fleet roster") is not going to start existing a second
    // later — polling it forever would just spam the network tab/console once a second indefinitely on
    // the not-found screen. Any other error (engine restarting, transient network blip) keeps polling,
    // same as every other live query in this file, so the page self-heals once the engine comes back.
    refetchInterval: (query) =>
      query.state.error instanceof EngineApiError && query.state.error.status === 404 ? false : 1000,
    retry: (failureCount, error) =>
      error instanceof EngineApiError && error.status === 404 ? false : failureCount < 2,
  })
}

/** `POST /v1/machines/{code}/sync-config` — refetches the machine detail on success so the header's
 * `driftState` (and the Config tab's own copy of it) catch up to what the panel already shows from the
 * mutation result itself. */
export function useSyncConfig(code: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => endpoints.syncConfig(code as string),
    onSuccess: () => {
      if (code) queryClient.invalidateQueries({ queryKey: QUERY_KEYS.machine(code) })
    },
  })
}
