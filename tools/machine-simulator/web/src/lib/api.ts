/**
 * Task 4 — typed EngineApi client + TanStack Query hooks.
 *
 * Base URL: `VITE_ENGINE_URL` env var if set, overriding everything below.
 *
 * Without that override, the default depends on how this bundle is being served (Task 9):
 *  - Vite dev server (`import.meta.env.DEV`, port 5173) — the engine is a separate process on its own
 *    fixed port, so this defaults to `http://localhost:5199` (Task 3's fixed dev port), same as before.
 *  - A production build (`npm run build` → `dist/`) — Task 9 has `St4i.EngineApi` serve that same
 *    `dist/` bundle itself (static files + SPA fallback) on whatever port it's listening on, so the API
 *    lives at the SAME origin the page was loaded from. Defaulting to `""` here makes every `fetch()`
 *    call below a relative path (`/v1/...`), which resolves against that origin automatically — no
 *    hardcoded port, works whether the desktop shell's engine child process ends up on 5199 or (rare,
 *    e.g. port already taken) whatever it fell back to.
 *
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

const BASE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:5199" : "")

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
  /** M-3: true server-truth of whether the fleet is currently running (`FleetHost.IsRunning`, mirrored
   * onto `FleetSnapshotDto`) — used only to SEED the client-tracked run-state context below on first
   * load/reload; day-to-day the Start/Stop mutations remain the source of truth for that context. */
  isRunning: boolean
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
// GET/PUT /v1/settings, POST /v1/settings/probe — Task 7. Wire shapes mirror `Fleet/Dtos.cs`'s
// `SettingsDto`/`SettingsUpdateRequest`/`ProbeRequest` and `St4i.EdgeCore.Infrastructure.ResilienceProbe`'s
// `ProbeResult`.
// ─────────────────────────────────────────────────────────────────────────

export interface Settings {
  serverUrl: string
  verifyTls: boolean
  language: string
  /** The machine code whose stored `mk_` credential is used when Live/Auto mode (re)builds the live
   * transport — see `FleetHost.UpdateSettings`'s `CredentialStore.Load(_machineCode)`. */
  machineCode: string
  mode: TransportMode
}

/** All fields optional — mirrors `SettingsUpdateRequest`: an omitted field leaves that setting
 * unchanged server-side. */
export interface SettingsUpdateInput {
  serverUrl?: string
  verifyTls?: boolean
  language?: string
  machineCode?: string
}

/** `ResilienceProbe.ProbeAsync` result — bounded to a 5s server-side HttpClient timeout, so this never
 * hangs the caller regardless of whether `serverUrl` is unreachable/refused/DNS-fails (`reachable:
 * false, status: 0` instead of a thrown error). */
export interface ProbeResult {
  reachable: boolean
  status: number
  paths: string[]
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/scenario, /v1/scenario/preset, /v1/scenario/burst, GET /v1/scenario — Task 7. Wire shapes
// mirror `Fleet/Dtos.cs`'s `ScenarioDto`/`ScenarioRequest`/`ScenarioPresetInfo` and
// `St4i.EdgeCore.Engine.ScenarioConfig`.
// ─────────────────────────────────────────────────────────────────────────

/** `ScenarioDto` — the currently-active scenario. Field names deliberately differ from
 * `ScenarioPresetConfig` below (`cycleRate` vs. `cycleRateMultiplier`, etc.) because that's what the two
 * underlying C# records (`ScenarioRequest`/`ScenarioDto` vs. `ScenarioConfig`) actually name them. */
export interface Scenario {
  cycleRate: number
  defectRate: number
  faultRate: number
  networkOutage: boolean
  /** Kebab-case preset key ("normal", "high-defect", …), `"custom"` after a manual slider edit, or
   * `"burst"` while a Burst spike is active. */
  activePreset: string
  /** Pre-formatted human-readable summary — safe to render directly. */
  statusLine: string
}

export interface ScenarioInput {
  cycleRate: number
  defectRate: number
  faultRate: number
  networkOutage: boolean
}

/** `ScenarioConfig`'s own wire shape, as nested inside `ScenarioPreset.config` below. */
export interface ScenarioPresetConfig {
  cycleRateMultiplier: number
  extraDefectRate: number
  faultRate: number
  networkOutage: boolean
}

export interface ScenarioPreset {
  name: string
  description: string
  config: ScenarioPresetConfig
  /** True only for the hot-folder-AOI preset — a one-shot demo (write+ingest a sample doc-28 file), not
   * a persistent config, so applying it also returns a `hotFolderStatus` string (see
   * `ScenarioPresetResult`). */
  triggersHotFolderDemo: boolean
}

export interface ScenarioSnapshot {
  current: Scenario
  presets: ScenarioPreset[]
}

export interface ScenarioPresetResult {
  scenario: Scenario
  hotFolderStatus: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/onboarding/{register|poll|claim|enroll|paste-key} — Task 7. Wire shapes mirror
// `Fleet/Dtos.cs`'s `Onboarding*Request`/`OnboardingStepResult`. `isDemo` defaults to `true` server-side
// when omitted (fabricates the whole flow instantly, no live ST4I server needed) — every input type
// below marks it optional for the same reason.
// ─────────────────────────────────────────────────────────────────────────

/** `OnboardingStepResult.Step` — open string (mirrors the server's own untyped `string`): `"Idle" |
 * "Pending" | "Approved" | "Claimed" | "Enrolled"` in this build, but not narrowed to a union so an
 * unrecognized token still renders instead of failing to type-check. */
export interface OnboardingResult {
  step: string
  machineCode: string | null
  mkKey: string | null
  isApproved: boolean
  message: string
}

export interface OnboardingRegisterInput {
  serialNumber: string
  name?: string
  machineType?: string
  isDemo?: boolean
  serverUrl?: string
}

export interface OnboardingPollInput {
  serialNumber: string
  isDemo?: boolean
  serverUrl?: string
}

export interface OnboardingClaimInput {
  serialNumber: string
  claimToken?: string
  isDemo?: boolean
  serverUrl?: string
  /** E2 (`Fleet/Dtos.cs`'s `OnboardingClaimRequest`): the fleet-join glue on the engine's endpoint
   * layer builds the joined machine's simulator profile from these — omitting them still joins the
   * fleet, just as a generic Automation profile at a default cycle rate. */
  name?: string
  machineType?: string
}

export interface OnboardingEnrollInput {
  serialNumber: string
  enrollToken?: string
  name?: string
  machineType?: string
  isDemo?: boolean
  serverUrl?: string
}

export interface OnboardingPasteKeyInput {
  machineCode: string
  mkKey: string
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

  settings: () => request<Settings>("/v1/settings"),
  updateSettings: (input: SettingsUpdateInput) =>
    request<Settings>("/v1/settings", { method: "PUT", body: JSON.stringify(input) }),
  probeSettings: (serverUrl: string) =>
    request<ProbeResult>("/v1/settings/probe", { method: "POST", body: JSON.stringify({ serverUrl }) }),

  scenario: () => request<ScenarioSnapshot>("/v1/scenario"),
  applyScenario: (input: ScenarioInput) =>
    request<Scenario>("/v1/scenario", { method: "POST", body: JSON.stringify(input) }),
  applyScenarioPreset: (name: string) =>
    request<ScenarioPresetResult>("/v1/scenario/preset", { method: "POST", body: JSON.stringify({ name }) }),
  burstScenario: () => request<Scenario>("/v1/scenario/burst", { method: "POST" }),

  onboardingRegister: (input: OnboardingRegisterInput) =>
    request<OnboardingResult>("/v1/onboarding/register", { method: "POST", body: JSON.stringify(input) }),
  onboardingPoll: (input: OnboardingPollInput) =>
    request<OnboardingResult>("/v1/onboarding/poll", { method: "POST", body: JSON.stringify(input) }),
  onboardingClaim: (input: OnboardingClaimInput) =>
    request<OnboardingResult>("/v1/onboarding/claim", { method: "POST", body: JSON.stringify(input) }),
  onboardingEnroll: (input: OnboardingEnrollInput) =>
    request<OnboardingResult>("/v1/onboarding/enroll", { method: "POST", body: JSON.stringify(input) }),
  onboardingPasteKey: (input: OnboardingPasteKeyInput) =>
    request<OnboardingResult>("/v1/onboarding/paste-key", { method: "POST", body: JSON.stringify(input) }),
}

// ─────────────────────────────────────────────────────────────────────────
// Fleet runtime context — day-to-day "is the fleet actively running" is
// tracked client-side as plain shell-scoped state (set from the start/stop
// mutations' own results) rather than shoehorned into the query cache.
// Dashboard's empty state and the TopBar Start/Stop buttons both read it;
// starting/stopping the fleet is meaningful from ANY route, not just
// Dashboard, so it lives above the router in App.tsx.
//
// M-3 (final-review): that client state used to start every session at
// `false` regardless of server truth, so a page reload while a fleet was
// genuinely running left the TopBar Stop button disabled until Start was
// clicked once (a no-op server-side, since FleetHost.Start()/Stop() are
// both idempotent — it "self-healed" but only after an extra, confusing
// click). `FleetSnapshotDto.isRunning` now round-trips server truth on
// GET /v1/fleet, so the provider below seeds its state from the FIRST
// snapshot it observes each mount, then leaves the mutations in charge
// exactly as before.
// ─────────────────────────────────────────────────────────────────────────

interface FleetRuntimeValue {
  isRunning: boolean
  setIsRunning: (value: boolean) => void
}

const FleetRuntimeContext = React.createContext<FleetRuntimeValue | null>(null)

export function FleetRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [isRunning, setIsRunning] = React.useState(false)
  const seededRef = React.useRef(false)

  // Same query key `useFleet()` polls (~1s) — this just adds another observer onto that SAME shared
  // cache entry (TanStack Query dedupes by key), not a second network poll.
  const { data } = useQuery({
    queryKey: QUERY_KEYS.fleet,
    queryFn: endpoints.fleet,
    refetchInterval: 1000,
  })

  React.useEffect(() => {
    if (seededRef.current || data === undefined) return
    seededRef.current = true
    setIsRunning(data.isRunning)
  }, [data])

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
  settings: ["settings"] as const,
  scenario: ["scenario"] as const,
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

// ─────────────────────────────────────────────────────────────────────────
// Settings — Task 7
// ─────────────────────────────────────────────────────────────────────────

/** One-shot fetch (not polled) — settings only change via this same client's own `PUT`, so there's
 * nothing external to catch up with the way `useFleet`/`useMachine` do. */
export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: QUERY_KEYS.settings,
    queryFn: endpoints.settings,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: endpoints.updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.settings, data)
    },
  })
}

/** `POST /v1/settings/probe` — deliberately NOT written into the `settings` query cache: probing is a
 * point-in-time connectivity check against whatever URL the caller passes (typically the Settings
 * form's current, possibly-unsaved input), not a settings mutation. The component reads the result off
 * this mutation's own `data`/`isPending`/`isError`. */
export function useProbeSettings() {
  return useMutation({
    mutationFn: (serverUrl: string) => endpoints.probeSettings(serverUrl),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario — Task 7
// ─────────────────────────────────────────────────────────────────────────

/** Polled at ~1s, same cadence as `useFleet` — needed so a Burst spike's automatic revert (server-side
 * timer, ~4s after the call) and any other client's scenario change echo back into this screen's
 * sliders/status line on their own, the same way the WPF reference app's `FleetService.ScenarioChanged`
 * subscription does. */
export function useScenario(): UseQueryResult<ScenarioSnapshot> {
  return useQuery({
    queryKey: QUERY_KEYS.scenario,
    queryFn: endpoints.scenario,
    refetchInterval: 1000,
  })
}

function setScenarioCurrent(queryClient: ReturnType<typeof useQueryClient>, current: Scenario) {
  queryClient.setQueryData(QUERY_KEYS.scenario, (old: ScenarioSnapshot | undefined) =>
    old ? { ...old, current } : old
  )
}

export function useApplyScenario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: endpoints.applyScenario,
    onSuccess: (data) => setScenarioCurrent(queryClient, data),
  })
}

export function useApplyScenarioPreset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: endpoints.applyScenarioPreset,
    onSuccess: (data) => setScenarioCurrent(queryClient, data.scenario),
  })
}

export function useBurstScenario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: endpoints.burstScenario,
    onSuccess: (data) => setScenarioCurrent(queryClient, data),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Onboarding — Task 7. Each step is its own plain mutation (no shared query cache entry) — the wizard
// keeps step/result state locally (see `routes/Onboarding.tsx`), since there's no `GET` to read
// onboarding progress back from and each step's result only matters to the screen that just called it.
// ─────────────────────────────────────────────────────────────────────────

export function useOnboardingRegister() {
  return useMutation({ mutationFn: endpoints.onboardingRegister })
}

export function useOnboardingPoll() {
  return useMutation({ mutationFn: endpoints.onboardingPoll })
}

export function useOnboardingClaim() {
  return useMutation({ mutationFn: endpoints.onboardingClaim })
}

export function useOnboardingEnroll() {
  return useMutation({ mutationFn: endpoints.onboardingEnroll })
}

export function useOnboardingPasteKey() {
  return useMutation({ mutationFn: endpoints.onboardingPasteKey })
}
