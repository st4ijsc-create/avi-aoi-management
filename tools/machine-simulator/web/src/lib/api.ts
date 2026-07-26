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

/**
 * Branch-review I-11 — ONE shared transport-mode→tone map. Before this, `ConfigSyncPanel.tsx` and
 * `TraceTable.tsx` each invented their own (`MODE_BADGE`/`MODE_TONE`) and disagreed with each other:
 * `Live → warn` in one, `Live → info` in the other; `Auto` the reverse. Transport mode is a
 * CONFIGURATION fact (which backend a machine talks to), not a machine STATE (spec §2's status ramp),
 * so neither variant belongs on `warn`/`fault`/`ok` — every caller now renders it `info` (Live/Auto —
 * "worth noting, talking to a real/adaptive backend") or `neutral` (Demo — the default, nothing to
 * flag), never the safety-ramp colours.
 */
export const TRANSPORT_MODE_TONE: Record<TransportMode, "info" | "neutral"> = {
  Live: "info",
  Demo: "neutral",
  Auto: "info",
}

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
  /** M-3/C-1: server-truth of whether the fleet is currently running (`FleetHost.IsRunning`, mirrored
   * onto `FleetSnapshotDto`) — the SOURCE OF TRUTH for `useFleetIsRunning()` on every poll, not just the
   * first one (branch-review C-1: seeding once and then trusting only this tab's own Start/Stop results
   * let the panel keep asserting "stopped" while the machine ran on, e.g. after another panel/tab/the
   * REST API changed fleet state). */
  isRunning: boolean
  /** C-2: server-owned E-STOP latch (`FleetHost.EstopEngaged`) — shared across every panel/tab that
   * polls this same snapshot and survives a reload, replacing the old component-local React state a
   * second panel or an F5 could silently forget. */
  estopEngaged: boolean
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

/**
 * WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — `GET /v1/capabilities`. `demoEnabled` mirrors the
 * engine's `ST4I_DEMO_ENABLED` env var, read ONCE at process startup (`DemoModeGate`) — fixed for the
 * whole process lifetime, never flips mid-session. The shell reads this BEFORE deciding whether to
 * render the DEMO option on the topbar/Settings mode selectors, instead of discovering it only from a
 * rejected `PUT /v1/mode`.
 */
export interface Capabilities {
  demoEnabled: boolean
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

/**
 * WS3-T1/WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2) — one ordered step within a single cycle's
 * `CyclePlan`, mirroring `St4i.EdgeCore.Models.CyclePlanStep` exactly. `result` is `"OK"`/`"NG"` for a
 * class with a pass/fail concept (AOI/SCREWDRIVE) or `null` for one without (IOT_SENSOR telemetry —
 * mirrors `Verdict.Skip`'s own convention). The living twin (`cycleTwin.ts`) is the sole consumer of
 * `normalizedX/Y` — never fabricated, always the SAME real point/target the engine's own simulator
 * drew this step's `result`/`metricValue` from.
 */
export interface CyclePlanStep {
  index: number
  pointCode: string
  normalizedX: number
  normalizedY: number
  result: "OK" | "NG" | null
  metricValue: number | null
  unit: string | null
}

/** WS3-T1/WS3-T2 — the ordered list of steps ONE cycle visits, plus the wall-clock start and real
 * cadence a web twin paces its OWN local `requestAnimationFrame` interpolation against (`cycleTwin.ts`)
 * — no per-frame socket traffic needed. Mirrors `St4i.EdgeCore.Models.CyclePlan`. */
export interface CyclePlan {
  cycleCounter: number
  startedAt: string
  durationSeconds: number
  steps: CyclePlanStep[]
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
  /** WS3-T1 — the latest cycle's living-twin plan, or `null` whenever the fleet isn't running ("idle
   * machine = no active plan", `MachineState.ToDetail`'s own gate) or this machine's simulator doesn't
   * wire one (WELDER/DISPENSING/ASSEMBLY/LEAK_TEST/FUNCTIONAL_TEST — out of WS3's scope). */
  plan: CyclePlan | null
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
// GET /v1/historian/results, /v1/historian/serial/{serial}, /v1/historian/results/export.csv —
// Task 12 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md). Wire shapes mirror
// `St4i.EngineApi.Endpoints.HistorianDtos`'s `HistorianResultDto`/`HistorianResultsPageDto` exactly
// (camelCase, same fields) — the read-only browse/export surface over the durable per-cycle result
// log Tasks 8/10 of that same workstream already wrote (`HistorianEndpoints.cs`). Telemetry/
// genealogy/measurements JSON blobs are deliberately absent here, same as the DTO itself — a client
// wanting those hits a different endpoint (out of this task's scope).
// ─────────────────────────────────────────────────────────────────────────

/** One durable result row — `HistorianResultDto`. `recipeCode`/`recipeVersion`/`keyMetric*` are
 * `null` whenever the underlying reading never carried one (e.g. an IoT telemetry row has no
 * recipe/key-metric the way an AOI/AVI or Automation ProcessResult row does). */
export interface HistorianResultDto {
  id: number
  machineCode: string
  deviceClass: string
  machineType: string
  /** `ReadingKind.ToString()` — `"ProcessResult" | "Telemetry" | "Inspection"` in this build. */
  readingKind: string
  cycleCounter: number
  serialNumber: string
  /** `Verdict.ToString()` — the SAME `"Pass" | "Warn" | "Fail" | "Skip"` vocabulary `CycleLogRow`'s
   * own `verdict` field already uses, so `CycleLogTable`'s exported `verdictMeta`/`StatusBadge`
   * apply here unchanged (no second verdict→tone map). */
  verdict: string
  recipeCode: string | null
  recipeVersion: string | null
  keyMetricName: string | null
  keyMetricValue: number | null
  keyMetricUnit: string | null
  ngCount: number
  pointCount: number
  ackSuccess: boolean
  ackDuplicate: boolean
  ackQueued: boolean
  eventTimeUtc: string
  ingestedAtUtc: string
}

/** `HistorianResultsPageDto` — one page of `QueryResultsAsync`'s frozen paginated result. */
export interface HistorianResultsPageDto {
  items: HistorianResultDto[]
  total: number
  limit: number
  offset: number
}

/** `GET /v1/historian/results`'s own query-string vocabulary (`HistorianEndpoints.GetResultsAsync`)
 * — every field optional/omittable, same as the server's own `string?`/`int?` parameters. `limit`/
 * `offset` drive `useHistorianResults`'s pagination; `buildHistorianExportCsvUrl` below always
 * drops them regardless of what's set here — the CSV endpoint takes the SAME machine/from/to/
 * serial/verdict/kind filters but no limit/offset (it exports the full filtered set, never one page
 * of it — see `HistorianEndpoints.BuildExportCsvAsync`). */
export interface HistorianResultsFilter {
  machine?: string
  /** ISO 8601 — anything `DateTimeOffset.TryParse` (`DateTimeStyles.RoundtripKind`) accepts
   * server-side; a plain `YYYY-MM-DD` (an HTML `<input type="date">`'s own value shape) parses fine. */
  from?: string
  to?: string
  serial?: string
  verdict?: string
  kind?: string
  limit?: number
  offset?: number
}

function buildHistorianQueryString(filter: HistorianResultsFilter): string {
  const params = new URLSearchParams()
  if (filter.machine) params.set("machine", filter.machine)
  if (filter.from) params.set("from", filter.from)
  if (filter.to) params.set("to", filter.to)
  if (filter.serial) params.set("serial", filter.serial)
  if (filter.verdict) params.set("verdict", filter.verdict)
  if (filter.kind) params.set("kind", filter.kind)
  if (filter.limit !== undefined) params.set("limit", String(filter.limit))
  if (filter.offset !== undefined) params.set("offset", String(filter.offset))
  return params.toString()
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
  capabilities: () => request<Capabilities>("/v1/capabilities"),
  startFleet: () => request<FleetActionResult>("/v1/fleet/start", { method: "POST" }),
  stopFleet: () => request<FleetActionResult>("/v1/fleet/stop", { method: "POST" }),
  // C-2/C-3 — both return the FULL fleet snapshot (not the smaller action-result shape /start and
  // /stop use): the response IS the confirmation the machine actually stopped/latch actually
  // changed (C-3 — no more fire-and-forget), and it's authoritative enough to seed the shared
  // fleet-runtime state directly instead of waiting up to 1s for the next poll to catch up.
  estopFleet: () => request<FleetSnapshot>("/v1/fleet/estop", { method: "POST" }),
  resetEstop: () => request<FleetSnapshot>("/v1/fleet/estop/reset", { method: "POST" }),
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

  historianResults: (filter: HistorianResultsFilter) =>
    request<HistorianResultsPageDto>(`/v1/historian/results?${buildHistorianQueryString(filter)}`),
  historianBySerial: (serial: string) =>
    request<HistorianResultDto[]>(`/v1/historian/serial/${encodeURIComponent(serial)}`),
}

// ─────────────────────────────────────────────────────────────────────────
// Fleet runtime context — "is the fleet actively running" / "is E-STOP
// latched" are shared, shell-scoped state (not shoehorned into per-route
// component state) so every consumer — Dashboard's empty state, the TopBar
// Start/Stop buttons, every `/hmi/:code` panel — agrees, regardless of
// route. Starting/stopping/E-STOPping the fleet is meaningful from ANY
// route, so this lives above the router in App.tsx.
//
// Branch-review C-1 — this used to seed `isRunning` from only the FIRST
// polled `/v1/fleet` snapshot and hand control to the Start/Stop mutations'
// own results for the rest of the page's life: a fleet-state change from
// ANYWHERE ELSE (another HMI panel, another tab, the REST API, the engine
// itself) was silently ignored forever — reproduced live as an HMI panel
// insisting a machine was stopped while its cycle counter kept climbing.
// The polled snapshot (`data.isRunning`/`data.estopEngaged`) is now the
// SOLE source of truth on every tick; a mutation's own result is applied
// only as a short-lived OPTIMISTIC override (so Start/Pause/E-STOP/RESET
// still feel instant) that the very next poll — at most ~1s later —
// supersedes, exactly the "optimistic until the next poll lands" contract
// the review asked for.
// ─────────────────────────────────────────────────────────────────────────

interface FleetRuntimeValue {
  isRunning: boolean
  estopEngaged: boolean
  /** Applies a mutation's own result immediately; overwritten by the next real poll. */
  setOptimisticIsRunning: (value: boolean) => void
  setOptimisticEstopEngaged: (value: boolean) => void
}

const FleetRuntimeContext = React.createContext<FleetRuntimeValue | null>(null)

export function FleetRuntimeProvider({ children }: { children: React.ReactNode }) {
  // Same query key `useFleet()` polls (~1s) — this just adds another observer onto that SAME shared
  // cache entry (TanStack Query dedupes by key), not a second network poll.
  const { data } = useQuery({
    queryKey: QUERY_KEYS.fleet,
    queryFn: endpoints.fleet,
    refetchInterval: 1000,
  })

  const [optimistic, setOptimistic] = React.useState<{ isRunning?: boolean; estopEngaged?: boolean }>({})

  // Every successful fetch (poll OR a mutation's `queryClient.setQueryData`) produces a brand-new
  // `data` object reference — cleared the optimistic override as soon as ANY fresh snapshot lands, so
  // it never outlives "until the next poll", never masks a real server-side change indefinitely.
  const seenDataRef = React.useRef(data)
  if (data !== seenDataRef.current) {
    seenDataRef.current = data
    if (optimistic.isRunning !== undefined || optimistic.estopEngaged !== undefined) {
      setOptimistic({})
    }
  }

  const isRunning = optimistic.isRunning ?? data?.isRunning ?? false
  const estopEngaged = optimistic.estopEngaged ?? data?.estopEngaged ?? false

  const setOptimisticIsRunning = React.useCallback((value: boolean) => {
    setOptimistic((prev) => ({ ...prev, isRunning: value }))
  }, [])
  const setOptimisticEstopEngaged = React.useCallback((value: boolean) => {
    setOptimistic((prev) => ({ ...prev, estopEngaged: value }))
  }, [])

  const value = React.useMemo(
    () => ({ isRunning, estopEngaged, setOptimisticIsRunning, setOptimisticEstopEngaged }),
    [isRunning, estopEngaged, setOptimisticIsRunning, setOptimisticEstopEngaged]
  )
  return React.createElement(FleetRuntimeContext.Provider, { value }, children)
}

function useFleetRuntime(): FleetRuntimeValue {
  const ctx = React.useContext(FleetRuntimeContext)
  if (!ctx) throw new Error("useFleetRuntime must be used within <FleetRuntimeProvider>")
  return ctx
}

/** Whether the fleet is currently running — server-truth on every poll (see remarks above), not just
 * seeded once. */
export function useFleetIsRunning(): boolean {
  return useFleetRuntime().isRunning
}

/** C-2 — whether E-STOP is currently latched, server-owned and shared across every panel/tab. */
export function useFleetEstopEngaged(): boolean {
  return useFleetRuntime().estopEngaged
}

// ─────────────────────────────────────────────────────────────────────────
// Query hooks
// ─────────────────────────────────────────────────────────────────────────

const QUERY_KEYS = {
  fleet: ["fleet"] as const,
  mode: ["mode"] as const,
  capabilities: ["capabilities"] as const,
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

/** WS2-T1 — `demoEnabled` is read once at engine startup and fixed for the process lifetime (see
 * `Capabilities`'s own doc comment), so this deliberately does NOT poll like `useMode`/`useHealth` —
 * one fetch on mount is enough for the whole session. */
export function useCapabilities(): UseQueryResult<Capabilities> {
  return useQuery({
    queryKey: QUERY_KEYS.capabilities,
    queryFn: endpoints.capabilities,
  })
}

export function useStartFleet() {
  const queryClient = useQueryClient()
  const { setOptimisticIsRunning } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.startFleet,
    onSuccess: (data) => {
      setOptimisticIsRunning(data.running)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleet })
    },
  })
}

export function useStopFleet() {
  const queryClient = useQueryClient()
  const { setOptimisticIsRunning } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.stopFleet,
    onSuccess: (data) => {
      setOptimisticIsRunning(data.running)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleet })
    },
  })
}

/**
 * C-2/C-3 — the E-STOP command. Unlike the old component-local `estopEngaged` React state, the latch
 * this seeds (`useFleetEstopEngaged`) is server-owned and mirrored on every `/v1/fleet` poll, so it's
 * shared across every panel/tab and survives a reload. `mutationFn` calls `FleetHost.Estop()`, which
 * tears the pipeline down BEFORE returning — so `onSuccess` firing is itself the confirmation the
 * machine actually stopped (C-3: the old code latched and logged a success banner on a fire-and-forget
 * POST with no `onError`, which could still fail silently). The full fleet snapshot the endpoint
 * returns is written straight into the query cache so every consumer (readouts, other panels) sees the
 * post-E-STOP state immediately, not after the next 1s poll.
 */
export function useEstopFleet() {
  const queryClient = useQueryClient()
  const { setOptimisticIsRunning, setOptimisticEstopEngaged } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.estopFleet,
    onSuccess: (data) => {
      setOptimisticIsRunning(data.isRunning)
      setOptimisticEstopEngaged(data.estopEngaged)
      queryClient.setQueryData(QUERY_KEYS.fleet, data)
    },
  })
}

/** Clears the E-STOP latch server-side. Does NOT restart the fleet (spec/C-2: an explicit, separate
 * transition) — START is enabled again but stays inert until pressed. */
export function useResetEstop() {
  const queryClient = useQueryClient()
  const { setOptimisticEstopEngaged } = useFleetRuntime()
  return useMutation({
    mutationFn: endpoints.resetEstop,
    onSuccess: (data) => {
      setOptimisticEstopEngaged(data.estopEngaged)
      queryClient.setQueryData(QUERY_KEYS.fleet, data)
    },
  })
}

/**
 * Polled slowly, mainly to drive the TopBar server-status dot. A failed fetch (network error / engine
 * process down) signals "offline" via TanStack Query's `isError` — that's the common case. E1 also made
 * `HealthDto.ok` real server-truth (`FleetHost.LastError is null`, `FleetEndpoints.cs`): a request that
 * SUCCEEDS can still come back `ok: false` if the fleet pipeline itself faulted (see
 * `FleetHost.StartLocked`'s catch), which `isError` alone would miss — TopBar's `ServerStatusDot` only
 * covers connectivity; the separate faulted-engine badge next to the page title is what surfaces `.ok`.
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
// WS2-T2 (docs/PRODUCTION_UI_DESIGN.md §2.4) — ecosystem connect gate. WS2-T1 flipped the engine's
// default to Live with nothing configured, so a fresh product install's fleet-dependent screens
// (Dashboard/Machines) have nothing meaningful to show until this machine actually reaches a real
// ST4I ecosystem. Rather than render an empty/meaningless local fleet grid, those screens gate their
// normal content behind `useEcosystemConnection().needsConnect` and show `EcosystemConnectPanel`
// instead — this hook is the single source of truth both for THAT decision and for the panel's own
// live status readout.
// ─────────────────────────────────────────────────────────────────────────

const ECOSYSTEM_PROBE_INTERVAL_MS = 8000

export type EcosystemConnectionStatus = "idle" | "testing" | "connected" | "failed"

export interface EcosystemConnectionState {
  /** False until `/v1/mode` AND `/v1/settings` have both resolved at least once — a caller should keep
   * showing its OWN existing loading state until this flips true, rather than flash the connect gate
   * open only to close it again the instant the real mode/URL are known. */
  loaded: boolean
  mode: TransportMode
  /** The currently-saved `Settings.serverUrl`, trimmed. */
  serverUrl: string
  status: EcosystemConnectionStatus
  /** True whenever a fleet-dependent screen should show the connect gate instead of its normal
   * content — Live mode with no configured URL, or configured but not currently reachable. Always
   * false outside Live: Demo's fabricated fleet is legitimately populated, nothing to connect to. */
  needsConnect: boolean
  /** True while a probe triggered by `retry()` (or the background poll) is in flight — distinct from
   * `status === "testing"` (the FIRST probe, before any result has ever landed), so a retry click can
   * show its own pending spinner without the whole panel reverting to the "never tested" copy. */
  isRetrying: boolean
  /** Re-runs the reachability probe against the current `serverUrl` immediately, instead of waiting
   * for the next background poll tick. */
  retry: () => void
}

/** Polls `POST /v1/settings/probe` against the CURRENTLY SAVED `serverUrl` while in Live mode — the
 * exact same connectivity check (`ResilienceProbe`) Settings' own "Check connection" button triggers
 * manually, reused here as the automatic signal deciding whether `needsConnect` is true. Never probes
 * in Demo mode or with an empty URL (`enabled` below), so the gate itself never activates outside the
 * one case it's meant for. */
export function useEcosystemConnection(): EcosystemConnectionState {
  const modeQuery = useMode()
  const settingsQuery = useSettings()
  const mode = modeQuery.data?.mode ?? "Live"
  const serverUrl = (settingsQuery.data?.serverUrl ?? "").trim()
  const loaded = modeQuery.data !== undefined && settingsQuery.data !== undefined
  const probeEnabled = loaded && mode === "Live" && serverUrl.length > 0

  const probeQuery = useQuery({
    queryKey: ["ecosystem-connect-probe", serverUrl],
    queryFn: () => endpoints.probeSettings(serverUrl),
    enabled: probeEnabled,
    refetchInterval: ECOSYSTEM_PROBE_INTERVAL_MS,
    retry: false,
  })

  const retry = React.useCallback(() => {
    void probeQuery.refetch()
  }, [probeQuery])

  const base = { loaded, mode, serverUrl, isRetrying: probeQuery.isFetching, retry }

  if (!loaded || mode !== "Live") {
    return { ...base, status: "idle", needsConnect: false }
  }
  if (!serverUrl) {
    return { ...base, status: "idle", needsConnect: true }
  }
  if (probeQuery.isPending) {
    return { ...base, status: "testing", needsConnect: true }
  }
  if (probeQuery.data?.reachable) {
    return { ...base, status: "connected", needsConnect: false }
  }
  return { ...base, status: "failed", needsConnect: true }
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

// ─────────────────────────────────────────────────────────────────────────
// Historian — Task 12 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md). Read-only browse
// surface over the durable per-cycle result log `St4i.EdgeCore.Historian` already writes
// (`HistorianEndpoints.cs`, Tasks 8/10 of the same workstream) — `/historian` (`Historian.tsx`) is
// the sole consumer. Deliberately ONE-SHOT (no `refetchInterval`, unlike `useFleet`/`useMachine`):
// this is a browse/audit screen over already-settled history, not a live tick.
// ─────────────────────────────────────────────────────────────────────────

/** `GET /v1/historian/results?…` — the filter object IS the query key, so any change to any filter
 * field (including `offset`, i.e. a page turn) naturally refetches with no manual invalidation. */
export function useHistorianResults(filter: HistorianResultsFilter): UseQueryResult<HistorianResultsPageDto> {
  return useQuery({
    queryKey: ["historian-results", filter] as const,
    queryFn: () => endpoints.historianResults(filter),
  })
}

/** `GET /v1/historian/serial/{serial}` — every row (any machine) recorded against one serial
 * number, the genealogy view a result row's "View genealogy" action opens in a `dialog.tsx` popup.
 * `enabled: !!serial` lets the dialog mount before a serial is chosen without firing a request
 * against `/v1/historian/serial/undefined`. */
export function useHistorianBySerial(serial: string | undefined): UseQueryResult<HistorianResultDto[]> {
  return useQuery({
    queryKey: ["historian-by-serial", serial ?? ""] as const,
    queryFn: () => endpoints.historianBySerial(serial as string),
    enabled: !!serial,
  })
}

/** Builds the `export.csv` URL for a plain `<a download href>` — brief: no fetch/blob code, the
 * browser downloads it directly. Same machine/from/to/serial/verdict/kind filters
 * `useHistorianResults` takes, but ALWAYS drops `limit`/`offset` even if the passed-in filter carries
 * them (the export endpoint has no pagination concept — see `HistorianResultsFilter`'s own doc
 * comment) — so a caller can hand this the exact same filter object it queries the page with. */
export function buildHistorianExportCsvUrl(filter: HistorianResultsFilter): string {
  const qs = buildHistorianQueryString({
    machine: filter.machine,
    from: filter.from,
    to: filter.to,
    serial: filter.serial,
    verdict: filter.verdict,
    kind: filter.kind,
  })
  return `${BASE_URL}/v1/historian/results/export.csv${qs ? `?${qs}` : ""}`
}
