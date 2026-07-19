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
// Fetchers
// ─────────────────────────────────────────────────────────────────────────

class EngineApiError extends Error {
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
