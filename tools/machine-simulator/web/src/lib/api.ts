/**
 * Task 4 — typed EngineApi client + TanStack Query hooks.
 *
 * Base URL: `VITE_ENGINE_URL` env var if set, overriding everything below.
 *
 * Without that override, `BASE_URL` is `""` (a relative path) in BOTH dev and production — every
 * `fetch()` call below resolves against whatever origin the page itself was loaded from:
 *  - Vite dev server (`npm run dev`, port 5173) — WS-D-D6's `vite.config.ts` `server.proxy` forwards
 *    `/v1/*` to the engine's own fixed port (Task 3's `http://localhost:5199`) server-side, so the
 *    browser never sees a cross-origin request at all. See `BASE_URL`'s own doc comment below for why
 *    that (not the old direct cross-port fetch) is required once `/v1/auth/*` cookies are in play.
 *  - A production build (`npm run build` → `dist/`) — Task 9 has `St4i.EngineApi` serve that same
 *    `dist/` bundle itself (static files + SPA fallback) on whatever port it's listening on, so the API
 *    lives at the SAME origin the page was loaded from already, with no proxy needed — no hardcoded
 *    port, works whether the desktop shell's engine child process ends up on 5199 or (rare, e.g. port
 *    already taken) whatever it fell back to.
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

/**
 * WS-D-D6 — dev no longer hardcodes `http://localhost:5199`: `vite.config.ts`'s own dev-server
 * `server.proxy` now forwards `/v1/*` (and its WS upgrades) to that same fixed port, so a relative
 * `""` base here makes every dev-mode request go out on Vite's OWN origin (`http://localhost:5173`)
 * and get proxied server-side — i.e. SAME-ORIGIN from the browser's point of view. That matters now
 * that `/v1/auth/*` sets a `SameSite=Lax` session cookie (D1): a cookie minted by a cross-origin
 * response (the old direct `:5199` fetch, a different origin than the `:5173` page) would never be
 * sent back on the next same-page fetch, breaking login before it could ever work. `VITE_ENGINE_URL`
 * is still checked FIRST and unconditionally wins when set — the Tauri desktop-shell recipe points
 * this at the packaged engine's own (genuinely cross-origin, `tauri://localhost` vs `http://…:5199`)
 * URL and depends on `credentials: "include"` below + `Program.cs`'s CORS `.AllowCredentials()` to
 * carry the cookie across THAT boundary instead.
 */
export const BASE_URL = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? ""

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with Fleet/Dtos.cs
// ─────────────────────────────────────────────────────────────────────────

export type DeviceClass = "Automation" | "Iot" | "AoiAvi"
/**
 * GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — widened from
 * a closed `"Simulated" | "HotFolderAoi" | "Mqtt" | "Modbus" | "OpcUa"` union to a plain `string`: the
 * engine's own `DriverKind` is no longer a closed enum (a third-party connector can report any id), so
 * the web client can no longer assume the wire value is one of a known set either. `KNOWN_DRIVER_KINDS`/
 * `driverKindLabel` (`lib/driverKind.ts`) are what every rendering surface uses to fall back to the raw
 * id readably for anything outside the five built-ins this app has translations for.
 */
export type DriverKind = string
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
  /** SM-2 — true exactly when the current roster mixes at least one fabricated (Simulated) machine with
   * at least one real machine. Whenever true, totalCycles/fpy above already reflect ONLY the real
   * machine(s) — this is the "the UI must not lie" signal a dashboard must render a visible note for,
   * since the tile grid below still lists every fabricated machine too. Optional so an older engine build
   * (pre-SM-2) that omits the field simply never shows the note. */
  hasMixedProvenance?: boolean
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
  /** SM-2 fix round 1 (review IMPORTANT 1b/2) — this row's own data lineage: `true` fabricated
   * (simulated/demo), `false` real, `null` Unknown (written before the server's `is_fabricated` column
   * existed). Every historian read surface (results table, genealogy dialog) must render this — a
   * fabricated or Unknown row that looks identical to a real one is the exact failure mode SM-2 exists to
   * close, and it stays reachable the moment a caller opts into `includeFabricated=true`. Optional so an
   * older engine build (pre-SM-2) that omits the field simply never renders the tag. */
  isFabricated?: boolean | null
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

// WS-D-D6 — module-level unauthorized-handler registry: `auth.ts`'s `AuthProvider` registers ONE
// handler (invalidating its `["auth","me"]` query) so ANY 401 from ANY endpoint below — a session that
// expired, was revoked by a password/role change, or simply never existed — bounces the whole app back
// to the Login screen, not just whichever single query happened to notice. A plain module-level
// variable (not a list) is deliberate: there's exactly one app-wide "you're logged out now" reaction,
// same single-registration shape `onUnauthorized` itself documents at its call site.
let unauthorizedHandler: (() => void) | null = null

/** Registers the app-wide reaction to a 401 from `request<T>` below. Last call wins — `AuthProvider`
 * is mounted exactly once for the life of the app, so there is only ever one real caller. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET"
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    // WS-D-D6 — every mutating/polling call in this file now carries the auth cookie (harmless
    // no-op pre-D1, load-bearing now that `/v1/*` sits behind the default-deny fallback policy).
    // `"include"` (not the `"same-origin"` default) is what also carries it across the Tauri desktop
    // shell's genuinely cross-origin `VITE_ENGINE_URL` case — see `BASE_URL`'s own doc comment.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (res.status === 401) unauthorizedHandler?.()
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
// SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md) — ecosystem
// connection STATUS, no longer a gate. WS2-T2 originally had Dashboard/Machines replace their entire
// content with `EcosystemConnectPanel` whenever `needsConnect` was true — but after SM-1 made an empty
// product roster legitimate and this task killed the `http://localhost:5000` placeholder default, "no
// server configured" is no longer a misconfiguration to nag about: it is what a customer who will never
// connect to any ecosystem sees forever, and that customer must get a COMPLETE product, not a form.
//
// `"standalone"` is the SAME state whether an operator simply hasn't gotten to Settings yet or has
// deliberately decided never to connect — there is no behavioral difference between those two intents
// (both get a fully working product; both can reach the connect flow the same way, whenever they want
// it), so this hook does not try to invent a second bit to distinguish them. The one state that DOES
// need a caller's attention is `"failed"`: a server IS configured but not currently reachable — a real,
// diagnosable problem (a typo, a network outage, a server that's down), surfaced via
// `hasConnectionIssue` so a caller can show a small, visible-but-non-blocking indicator instead of
// hiding the failure the way simply deleting the old gate would have.
// ─────────────────────────────────────────────────────────────────────────

const ECOSYSTEM_PROBE_INTERVAL_MS = 8000

export type EcosystemConnectionStatus = "standalone" | "testing" | "connected" | "failed"

export interface EcosystemConnectionState {
  /** False until `/v1/mode` AND `/v1/settings` have both resolved at least once — a caller should keep
   * showing its OWN existing loading state until this flips true, rather than flash a wrong status. */
  loaded: boolean
  mode: TransportMode
  /** The currently-saved `Settings.serverUrl`, trimmed. Empty means "no ecosystem configured" — a
   * first-class, honest value (see `FleetHost.DefaultServerUrl`), not an empty string that happens to
   * fail a probe. */
  serverUrl: string
  status: EcosystemConnectionStatus
  /** True only for `status === "failed"` — a server IS configured but not currently reachable. This is
   * the one state worth a caller's visible attention; `"standalone"` (no server configured, Live or
   * not) is a legitimate, complete product state and must never read as a problem. */
  hasConnectionIssue: boolean
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
 * manually, reused here as the automatic signal behind `status`/`hasConnectionIssue`. Never probes in
 * Demo mode or with an empty URL (`enabled` below) — Demo's fabricated fleet has nothing to connect to,
 * and an empty `serverUrl` is `"standalone"` by definition, not something to probe against. */
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

  if (!loaded || mode !== "Live" || !serverUrl) {
    return { ...base, status: "standalone", hasConnectionIssue: false }
  }
  if (probeQuery.isPending) {
    return { ...base, status: "testing", hasConnectionIssue: false }
  }
  if (probeQuery.data?.reachable) {
    return { ...base, status: "connected", hasConnectionIssue: false }
  }
  return { ...base, status: "failed", hasConnectionIssue: true }
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

// ─────────────────────────────────────────────────────────────────────────
// OEE — Task 13 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md). `/reports`
// (`routes/Reports.tsx`) — per-machine Availability/Performance/Quality/OEE + an honestly-labeled
// THREE-bucket loss breakdown (Downtime/Speed/Quality — never a finer "six big losses" split, see
// `OeeCalculator.cs`'s own doc comment: reason codes don't exist yet, so this calculator/UI stops at
// the three buckets today's inputs can honestly support) computed server-side over the SAME durable
// per-cycle result log Tasks 8/10 already wrote. Wire shapes mirror
// `St4i.EngineApi.Endpoints.HistorianDtos`'s `OeeResultDto`/`OeeSettingsDto`/
// `OeeSettingsUpdateRequest` exactly.
// ─────────────────────────────────────────────────────────────────────────

/** `OeeResultDto` — `availability`/`performance`/`quality`/`oee` are fractions in `[0, 1]` (multiply
 * by 100 for a percentage display, same convention `dashboard.kpi.fpy` already uses), never NaN/
 * Infinity/over 1 (`OeeCalculator.Calculate` clamps/guards every division). The three loss fields are
 * plain seconds (the underlying C# `TimeSpan`s flattened via `.TotalSeconds`), never negative. */
export interface OeeResult {
  machineCode: string
  from: string
  to: string
  availability: number
  performance: number
  quality: number
  oee: number
  plannedProductionSeconds: number
  runSeconds: number
  downtimeLossSeconds: number
  speedLossSeconds: number
  qualityLossSeconds: number
  totalCount: number
  goodCount: number
  idealCycleSeconds: number
}

/** `OeeSettingsDto` — the RESOLVED/effective settings for one machine: `idealCycleSeconds` is either
 * the stored override or the machine's own baseline cycle time (`isOverridden` tells the two apart),
 * `plannedProductionRatio` always has a real value (defaults to `1.0` server-side for a machine with
 * no stored entry — never `null`). */
export interface OeeSettings {
  machineCode: string
  idealCycleSeconds: number
  isOverridden: boolean
  plannedProductionRatio: number
}

/** `OeeSettingsUpdateRequest` — both fields optional/nullable on the wire: an omitted field leaves
 * that setting unchanged server-side (see `OeeSettingsStore.Set`'s own doc comment). The server
 * REJECTS (never clamps) a `plannedProductionRatio` outside `[0, 1]` or an `idealCycleSecondsOverride`
 * `<= 0` — a 400 with `{ error: "<message>" }`, surfaced via `OeeSettingsApiError` below. */
export interface OeeSettingsUpdateInput {
  idealCycleSecondsOverride?: number
  plannedProductionRatio?: number
}

/** `machine`/`from`/`to` query-string vocabulary shared by `/oee`, `/oee/fleet` (no `machine` there —
 * see `useOeeFleet`) and `/report.pdf`. `from`/`to` are both optional — the server defaults `to` to
 * now and `from` to `to - 24h` when omitted (`HistorianEndpoints.TryResolveRange`), same as
 * `HistorianResultsFilter`'s own from/to. */
export interface OeeFilter {
  machine?: string
  from?: string
  to?: string
}

function buildOeeQueryString(filter: OeeFilter): string {
  const params = new URLSearchParams()
  if (filter.machine) params.set("machine", filter.machine)
  if (filter.from) params.set("from", filter.from)
  if (filter.to) params.set("to", filter.to)
  return params.toString()
}

/** Mirrors `MachineSettingsApiError` (`lib/machineSettingsApi.ts`) — the shared `request<T>`/
 * `EngineApiError` above only carry a status code, not the server's own `ApiErrorDto.Error` text.
 * The Targets panel is the one caller here that needs to show the EXACT 400 wording
 * ("plannedProductionRatio must be in the range [0, 1]." / "idealCycleSecondsOverride must be > 0.")
 * rather than a generic "request failed" — this tiny dedicated error class (and the `putOeeSettings`
 * fetch below it) captures that body instead of changing `request<T>`'s contract for every other
 * endpoint in this file. */
export class OeeSettingsApiError extends Error {
  status: number
  /** The server's own `ApiErrorDto.error` text — undefined only for a genuinely unparseable body
   * (a 500, a network-layer failure a proxy injected, …). */
  serverMessage?: string

  constructor(status: number, serverMessage?: string) {
    super(serverMessage ?? `request failed: ${status}`)
    this.name = "OeeSettingsApiError"
    this.status = status
    this.serverMessage = serverMessage
  }
}

async function putOeeSettings(machine: string, input: OeeSettingsUpdateInput): Promise<OeeSettings> {
  const res = await fetch(`${BASE_URL}/v1/historian/oee/settings?machine=${encodeURIComponent(machine)}`, {
    method: "PUT",
    // WS-D-D6 — this bypasses the shared `request<T>` above (it needs the server's own error BODY,
    // not just a status code), so it carries the same `credentials`/401-handler wiring by hand instead
    // of inheriting it for free.
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (res.status === 401) unauthorizedHandler?.()
  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      serverMessage = body?.error
    } catch {
      // Non-JSON body (rare — a proxy/500 page) — fall back to the generic message.
    }
    throw new OeeSettingsApiError(res.status, serverMessage)
  }
  return (await res.json()) as OeeSettings
}

const oeeEndpoints = {
  oee: (filter: OeeFilter) => request<OeeResult>(`/v1/historian/oee?${buildOeeQueryString(filter)}`),
  // No `machine` — the fleet endpoint always returns one entry per roster machine (see
  // `GetOeeFleetAsync`), so `filter` here is deliberately typed without it.
  oeeFleet: (filter: Omit<OeeFilter, "machine">) => request<OeeResult[]>(`/v1/historian/oee/fleet?${buildOeeQueryString(filter)}`),
  oeeSettings: (machine: string) => request<OeeSettings>(`/v1/historian/oee/settings?machine=${encodeURIComponent(machine)}`),
}

/** `GET /v1/historian/oee?machine=&from=&to=` — on-demand (`enabled: !!machine`): `Reports.tsx`
 * mounts before a machine selection resolves from the fleet roster, so this stays idle rather than
 * firing against `/v1/historian/oee?machine=undefined`. One-shot (no `refetchInterval`), same
 * "browse over already-settled history" reasoning `useHistorianResults` documents — a filter change
 * (including `from`/`to`) naturally refetches since it's part of the query key. */
export function useOee(machine: string | undefined, from?: string, to?: string): UseQueryResult<OeeResult> {
  return useQuery({
    queryKey: ["oee", machine, from, to] as const,
    queryFn: () => oeeEndpoints.oee({ machine, from, to }),
    enabled: !!machine,
  })
}

/** `GET /v1/historian/oee/fleet?from=&to=` — every roster machine's OEE for the same period, in
 * roster order. No `machine` filter (the endpoint doesn't take one). */
export function useOeeFleet(from?: string, to?: string): UseQueryResult<OeeResult[]> {
  return useQuery({
    queryKey: ["oee-fleet", from, to] as const,
    queryFn: () => oeeEndpoints.oeeFleet({ from, to }),
  })
}

/** `GET /v1/historian/oee/settings?machine=` — on-demand, same `enabled: !!machine` gate as
 * `useOee`. */
export function useOeeSettings(machine: string | undefined): UseQueryResult<OeeSettings> {
  return useQuery({
    queryKey: ["oee-settings", machine] as const,
    queryFn: () => oeeEndpoints.oeeSettings(machine as string),
    enabled: !!machine,
  })
}

/** `PUT /v1/historian/oee/settings?machine=` — on success, writes the fresh settings straight into
 * the `["oee-settings", machine]` cache entry (so the Targets panel reflects the resolved value/
 * `isOverridden` flag immediately) AND invalidates `["oee", machine]` (every from/to variant for this
 * machine) since a new ideal-cycle-seconds/planned-ratio changes the Performance/Availability math a
 * subsequent `useOee` read would compute. A rejected (400) call throws `OeeSettingsApiError` and
 * touches neither cache entry — the caller's own `onError`/`mutation.error` is how the Targets panel
 * surfaces that inline instead of crashing. */
export function useUpdateOeeSettings(machine: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OeeSettingsUpdateInput) => putOeeSettings(machine as string, input),
    onSuccess: (data) => {
      if (!machine) return
      queryClient.setQueryData(["oee-settings", machine], data)
      queryClient.invalidateQueries({ queryKey: ["oee", machine] })
    },
  })
}

/** Builds the `report.pdf` URL for a plain `<a download href>` — same brief as
 * `buildHistorianExportCsvUrl`: no fetch/blob code, the browser downloads it directly. Takes the same
 * `machine`/`from`/`to` filter `useOee` reads with, so a caller can hand this the exact same filter
 * object it queries the screen with. */
export function buildOeeReportPdfUrl(filter: OeeFilter): string {
  const qs = buildOeeQueryString(filter)
  return `${BASE_URL}/v1/historian/report.pdf${qs ? `?${qs}` : ""}`
}

// ─────────────────────────────────────────────────────────────────────────
// Users — WS-D-D7 (`routes/Users.tsx`, Admin-only account management). Wire shapes mirror
// `St4i.EngineApi.Auth.UserDtos` exactly. `UserDto` has NO password-hash/security-stamp field at
// all — never redacted client-side, simply never on the wire in the first place (see
// `UserEndpoints.cs`'s own doc comment).
// ─────────────────────────────────────────────────────────────────────────

export interface UserDto {
  id: number
  username: string
  role: string
  displayName: string | null
  disabled: boolean
  lastLoginAtUtc: string | null
}

export interface CreateUserInput {
  username: string
  password: string
  role: string
  displayName?: string
}

/** Mirrors `OeeSettingsApiError` above — the shared `request<T>`/`EngineApiError` only carry a status
 * code, but the Users screen needs the server's EXACT `ApiErrorDto.error` wording for a 409 duplicate
 * username, a 400 weak password/invalid role, or the 400 last-enabled-Admin lock-out guard, rather than
 * a generic "request failed" toast. */
export class UsersApiError extends Error {
  status: number
  /** The server's own `ApiErrorDto.error` text — undefined only for a genuinely unparseable body. */
  serverMessage?: string

  constructor(status: number, serverMessage?: string) {
    super(serverMessage ?? `request failed: ${status}`)
    this.name = "UsersApiError"
    this.status = status
    this.serverMessage = serverMessage
  }
}

async function usersRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (res.status === 401) unauthorizedHandler?.()
  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      serverMessage = body?.error
    } catch {
      // Non-JSON body (rare — a proxy/500 page) — fall back to the generic message.
    }
    throw new UsersApiError(res.status, serverMessage)
  }
  return (await res.json()) as T
}

const usersEndpoints = {
  users: () => usersRequest<UserDto[]>("/v1/users"),
  createUser: (input: CreateUserInput) =>
    usersRequest<UserDto>("/v1/users", { method: "POST", body: JSON.stringify(input) }),
  setUserRole: (id: number, role: string) =>
    usersRequest<UserDto>(`/v1/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
  setUserDisabled: (id: number, disabled: boolean) =>
    usersRequest<UserDto>(`/v1/users/${id}/${disabled ? "disable" : "enable"}`, { method: "POST" }),
  resetUserPassword: (id: number, newPassword: string) =>
    usersRequest<UserDto>(`/v1/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
}

const USERS_QUERY_KEY = ["users"] as const

/** `GET /v1/users` — Admin-only roster. A non-admin never mounts this in the first place
 * (`Users.tsx`'s own `RequireRole` gate), so the 403 a real Operator/Engineer would get back is
 * defense-in-depth here, not the normal path — surfaced the same way every other gated query's
 * rejection is (`isError`), no special-casing needed. */
export function useUsers(): UseQueryResult<UserDto[]> {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: usersEndpoints.users,
  })
}

/** `POST /v1/users` — every caller invalidates (not `setQueryData`s) `["users"]` on success: the
 * roster is small and Admin-only, so a refetch is cheap and keeps `lastLoginAtUtc`/ordering exactly
 * server-authoritative rather than hand-assembling a `UserDto` client-side. */
export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: usersEndpoints.createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  })
}

/** `PUT /v1/users/{id}/role` — rejected (400) with `UsersApiError` when `id` is the last enabled
 * Admin being demoted away from Admin (`UserEndpoints.cs`'s lock-out guard). */
export function useSetUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => usersEndpoints.setUserRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  })
}

/** `POST /v1/users/{id}/disable` or `.../enable` (one hook, `disabled` picks the verb) — rejected
 * (400) with `UsersApiError` when disabling `id` would leave zero enabled Admins. */
export function useSetUserDisabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, disabled }: { id: number; disabled: boolean }) => usersEndpoints.setUserDisabled(id, disabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  })
}

/** `POST /v1/users/{id}/reset-password` — the new password never round-trips back (the response is
 * just the target's `UserDto`), so there's nothing to write into the cache beyond invalidating. */
export function useResetUserPassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      usersEndpoints.resetUserPassword(id, newPassword),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Audit — WS-D-D8 (`routes/Audit.tsx`, Admin-only hash-chained audit log viewer). Wire shapes mirror
// `St4i.EngineApi.Auth.AuditDtos` exactly (`AuditEntryDto`/`AuditPageDto`/`AuditVerifyResultDto`) —
// same flattened-scalar discipline as `HistorianResultDto`/`UserDto` above, so plain `request<T>` (not
// a dedicated error class the way `usersRequest`/`putOeeSettings` need) is enough: neither
// `GET /v1/audit` nor `GET /v1/audit/verify` has a caller-facing 400/409 body whose EXACT wording this
// screen needs to surface the way Users' duplicate-username/last-admin-guard messages do.
// ─────────────────────────────────────────────────────────────────────────

/** `AuditEntryDto` — one row of the hash-chained `audit_log` table. `oldValueJson`/`newValueJson` are
 * raw JSON text (or `null` when a mutation had no meaningful before/after value) — this screen only
 * ever parses them for DISPLAY, never round-trips a parsed object back onto the wire. `prevHash`/
 * `rowHash` are lowercase 64-char hex SHA-256 digests; see `SqliteAuditStore`'s own doc comment (and
 * `audit.limitation.body` in `i18n/vi.ts`/`en.ts`) for the HONEST threat model this chain does and does
 * NOT cover — tamper-evident against casual/accidental/app-level modification only, not against a local
 * actor with direct write access to the `security.db` file itself. */
export interface AuditEntry {
  seq: number
  atUtc: string
  actorUsername: string
  actorRole: string
  action: string
  targetType: string | null
  targetId: string | null
  oldValueJson: string | null
  newValueJson: string | null
  correlationId: string | null
  clientIp: string | null
  prevHash: string
  rowHash: string
}

/** `AuditPageDto` — same paging shape as `HistorianResultsPageDto`: `total` is the FULL filtered count,
 * ignoring `limit`/`offset`, so a caller can page through the whole filtered set. */
export interface AuditPage {
  items: AuditEntry[]
  total: number
  limit: number
  offset: number
}

/** `AuditVerifyResultDto` — `firstBrokenSeq` is `null` whenever `ok` is `true`. `detail` is a plain
 * English diagnostic sentence straight off the server (`SqliteAuditStore.VerifyChainAsync`) — shown
 * verbatim rather than re-localized, same treatment `OeeSettingsApiError`'s/`UsersApiError`'s own
 * `serverMessage` gets elsewhere in this file. */
export interface AuditVerifyResult {
  ok: boolean
  firstBrokenSeq: number | null
  detail: string
}

/** `GET /v1/audit`'s own query-string vocabulary (`AuditEndpoints.GetAuditAsync`) — every field
 * optional/omittable, same discipline as `HistorianResultsFilter`. Unlike historian's `serial` filter,
 * `actor`/`action`/`target` are EXACT-match server-side (`SqliteAuditStore.QueryAsync`'s own
 * `actor_username = @actor`/`action = @action`/`target_id = @target` WHERE clauses, not a `LIKE`) — the
 * screen's own filter inputs don't claim otherwise (no "search" placeholder copy). */
export interface AuditFilter {
  from?: string
  to?: string
  actor?: string
  action?: string
  target?: string
  limit?: number
  offset?: number
}

function buildAuditQueryString(filter: AuditFilter): string {
  const params = new URLSearchParams()
  if (filter.from) params.set("from", filter.from)
  if (filter.to) params.set("to", filter.to)
  if (filter.actor) params.set("actor", filter.actor)
  if (filter.action) params.set("action", filter.action)
  if (filter.target) params.set("target", filter.target)
  if (filter.limit !== undefined) params.set("limit", String(filter.limit))
  if (filter.offset !== undefined) params.set("offset", String(filter.offset))
  return params.toString()
}

const auditEndpoints = {
  audit: (filter: AuditFilter) => request<AuditPage>(`/v1/audit?${buildAuditQueryString(filter)}`),
  auditVerify: () => request<AuditVerifyResult>("/v1/audit/verify"),
}

/** `GET /v1/audit?…` — on-demand (no `refetchInterval`), same "browse over already-settled history"
 * reasoning `useHistorianResults` documents: the filter object IS the query key, so any change
 * (including a page turn) naturally refetches with no manual invalidation. */
export function useAudit(filter: AuditFilter): UseQueryResult<AuditPage> {
  return useQuery({
    queryKey: ["audit", filter] as const,
    queryFn: () => auditEndpoints.audit(filter),
  })
}

/** `GET /v1/audit/verify` — modeled as a lazy `useMutation` rather than a `useQuery` even though the
 * underlying call is a GET: unlike every polled query in this file, "walk the whole chain and recompute
 * every hash" should never run automatically on mount or on an interval — it only ever fires once, the
 * moment `Audit.tsx`'s "Verify chain integrity" button is clicked, same on-demand idiom
 * `useProbeSettings` already established for a GET-shaped, click-triggered check. */
export function useAuditVerify() {
  return useMutation({
    mutationFn: () => auditEndpoints.auditVerify(),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Asset Registry — P2-1/P2-2 (`routes/AssetRegistry.tsx`). Wire shape mirrors
// `St4i.EngineApi.AssetRegistry.AssetRecord` exactly — the app's global JSON options already camelCase
// + enum-as-string every response (same `JsonStringEnumConverter` every other section of this file
// already documents), so `lifecycle` comes back as `"Provisioned" | "Commissioning" | "Active" |
// "Maintenance" | "Decommissioned"`, never a numeric enum value.
// ─────────────────────────────────────────────────────────────────────────

/** `AssetLifecycleState` (`AssetRegistry/AssetLifecycleState.cs`) — ISA-95-flavored asset lifecycle. A
 * machine registers as `"Active"` by default; the other four states are reachable only via an explicit
 * `PUT /v1/assets/{code}/lifecycle`. */
export type AssetLifecycleState = "Provisioned" | "Commissioning" | "Active" | "Maintenance" | "Decommissioned"

/** `AssetRecord` (`AssetRegistry/AssetRecord.cs`). `deviceClass` is kept as plain `string` here (not
 * narrowed to the `DeviceClass` union above) — the registry can already hold a value the web app has no
 * case for yet, and narrowing here would make TypeScript reject a real, valid server value. `driverKind`
 * is plain `string` for the same reason `DriverKind` itself is now (GP-3): the engine's own driver kind
 * is an open id, not a closed set — see `KNOWN_DRIVER_KINDS`/`driverKindLabel` (`lib/driverKind.ts`) for
 * the tolerant-label fallback every rendering surface uses. `configChecksum` is `null` until the asset's
 * descriptor has synced at least once. */
export interface AssetRecord {
  urn: string
  code: string
  deviceClass: string
  driverKind: string
  machineType: string
  lifecycle: AssetLifecycleState
  configChecksum: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

const ASSETS_QUERY_KEY = ["assets"] as const
const assetQueryKey = (code: string) => ["assets", code] as const

const assetEndpoints = {
  assets: () => request<AssetRecord[]>("/v1/assets"),
  asset: (code: string) => request<AssetRecord>(`/v1/assets/${encodeURIComponent(code)}`),
  setAssetLifecycle: (code: string, state: AssetLifecycleState) =>
    request<AssetRecord>(`/v1/assets/${encodeURIComponent(code)}/lifecycle`, {
      method: "PUT",
      body: JSON.stringify({ state }),
    }),
}

/** `GET /v1/assets` (Operator) — the full persisted roster, no paging: unlike `useAudit`'s
 * high-volume hash-chained log, the registry is expected to stay small (one row per provisioned
 * machine), so `AssetRegistry.tsx` renders it as a plain unpaginated list. */
export function useAssets(): UseQueryResult<AssetRecord[]> {
  return useQuery({
    queryKey: ASSETS_QUERY_KEY,
    queryFn: assetEndpoints.assets,
  })
}

/** `GET /v1/assets/{code}` (Operator) — used by the detail dialog so it always shows the server's
 * CURRENT record rather than whatever the list row looked like at the moment it was clicked;
 * `undefined` (no dialog open) disables the query entirely. */
export function useAsset(code: string | undefined): UseQueryResult<AssetRecord> {
  return useQuery({
    queryKey: assetQueryKey(code ?? ""),
    queryFn: () => assetEndpoints.asset(code as string),
    enabled: code !== undefined,
  })
}

/** `PUT /v1/assets/{code}/lifecycle` (Engineer; the client-side `RequireRole` in `AssetRegistry.tsx`
 * is only a UX gate — this is the real enforcement). Writes the returned record straight into this
 * code's own `useAsset` cache entry (so an open detail dialog reflects the new lifecycle immediately)
 * AND invalidates the list query (`["assets"]`) so the table's own chip catches up too — same two-step
 * "setQueryData the specific entry, invalidate the collection" idiom `useSyncConfig`/
 * `useUpdateOeeSettings` use above. Rejected (400 bad state, 404 unknown code) touches neither cache
 * entry — the caller's own `onError` is how the screen surfaces that. */
export function useSetAssetLifecycle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, state }: { code: string; state: AssetLifecycleState }) =>
      assetEndpoints.setAssetLifecycle(code, state),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(assetQueryKey(variables.code), data)
      queryClient.invalidateQueries({ queryKey: ASSETS_QUERY_KEY })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Connectors — GP-7 (`.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-7-brief.md`
// item 1), the web surface over GP-5's `GET /v1/connectors` (`ConnectorEndpoints.cs`). Wire shape
// mirrors `St4i.EngineApi.Fleet.Dtos.ConnectorStatusDto` exactly: every currently-REGISTERED connector
// (built from `connectors.json` or the legacy `ST4I_MODBUS_*`/`ST4I_OPCUA_*` env vars) that failed to
// start on the fleet's most recent start attempt, keyed by its own `id`. An empty array is the healthy
// case — either nothing is registered, or everything registered started fine — rendered in
// `AssetRegistry.tsx` as a calm confirmation, never an empty-state "nothing here" placeholder.
// ─────────────────────────────────────────────────────────────────────────

/** `ConnectorStatusDto` (`Fleet/Dtos.cs`). `error` is a factory's own exception message forwarded
 * verbatim (`FleetHost.GetConfiguredConnectorIssues`) — for the two built-in factories this is always a
 * structural validation message (bad JSON, a missing field), but the type makes no promise beyond
 * "readable text": a future third-party factory's message is UNSANITIZED, so callers must render it as
 * plain untrusted text and never let its length/content affect layout (see `ConnectorIssuesCard`). */
export interface ConnectorStatus {
  id: string
  error: string
}

const CONNECTORS_QUERY_KEY = ["connectors"] as const

const connectorEndpoints = {
  connectors: () => request<ConnectorStatus[]>("/v1/connectors"),
}

/** `GET /v1/connectors` (Operator) — same 5s poll cadence as `useHealth`/`useSite`: this list only
 * changes when the fleet (re)starts (a fixed `connectors.json` typo, or a restart after one is
 * introduced), but polling means an operator watching the page sees it clear on its own once the fleet
 * comes back up, with no manual refresh. */
export function useConnectorIssues(): UseQueryResult<ConnectorStatus[]> {
  return useQuery({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: connectorEndpoints.connectors,
    refetchInterval: 5000,
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Site / Ecosystem — GĐ3 EC-4 (`routes/Site.tsx`). Wire shapes mirror `St4i.EngineApi.Endpoints.
// SiteEndpoints`'s `SiteStatusDto`/`SiteLinkRequest`/`SiteIdentityDto` exactly (EC-3,
// `src/St4i.EngineApi/Endpoints/SiteEndpoints.cs`) — the HTTP surface over EC-2's `SiteBridgeManager`
// (federates this device's local UNS spine to a SYNAPSE Site over MQTT/TLS) + EC-1's `DeviceIdentity`
// (this device's own cert/fingerprint, unconditional regardless of whether a Site link exists).
// ─────────────────────────────────────────────────────────────────────────

/** `St4i.EdgeCore.Site.BridgeStatus.BridgeState` — the northbound bridge's own health ramp. Kept as a
 * plain `string` on `SiteStatusDto.BridgeState` (not narrowed to a TS union) since the server itself
 * only ever emits `.ToString()` of the C# enum — `Site.tsx`'s own status-badge lookup falls back to
 * the raw value verbatim for anything outside these six known names, same "known-value lookup with a
 * verbatim fallback" idiom `deviceClassLabel`/`driverKindLabel` (`AssetRegistry.tsx`) already use.
 * `Faulted` (GĐ3 closeout WI-3) — the spool writer and/or forward loop died in the background while the
 * MQTT clients still look connected; it OUTRANKS `Connected`/`Degraded`/`Connecting` on the server (see
 * `BridgeState.cs`'s own doc comment) precisely so an operator never sees a healthy-looking badge while
 * forwarding has silently stopped — `Site.tsx` must render it in a danger tone, never lumped in with
 * `Disabled`'s neutral one. */
export type BridgeState = "Disabled" | "Connecting" | "Connected" | "Degraded" | "Down" | "Faulted"

/** `SiteStatusDto` — `GET /v1/site` (Operator). `siteTrustPem` never appears here — it's write-only via
 * `SiteLinkRequest` below (see `SiteEndpoints.cs`'s own doc comment); `siteFingerprint` is the PINNED
 * value the bridge actually validated on its last successful handshake instead, `null` until then.
 * `unsEnabled: false` means `SiteBridgeManager` isn't registered at all (`ST4I_UNS_ENABLED` off) —
 * `enabled`/`host`/`port`/`bridgeState` are then fixed placeholders (`false`/`""`/`0`/`"Disabled"`),
 * only `deviceFingerprint` stays a real value.
 *
 * <para>GĐ3 closeout WI-3 — `spoolDepth`/`lastAckedSeq`/`droppedTotal` mirror
 * `BridgeStatusSnapshot`'s own same-named fields verbatim: how many northbound messages are currently
 * backed up on disk, the highest spooled seq ever successfully forwarded+acked, and how many spooled
 * messages have ever been permanently dropped by the spool's own age/byte caps. All three are `0` —
 * never garbage — whenever there's no durable spool at all (UNS disabled, no bridge, or
 * `ST4I_BRIDGE_SPOOL_ENABLED=0`). `droppedTotal > 0` means production data that will NEVER reach the
 * Site — `Site.tsx` treats it as a warning, not a neutral counter. */
export interface SiteStatus {
  enabled: boolean
  host: string
  port: number
  bridgeState: string
  lastError: string | null
  siteFingerprint: string | null
  deviceFingerprint: string
  unsEnabled: boolean
  spoolDepth: number
  lastAckedSeq: number
  droppedTotal: number
}

/** `SiteIdentityDto` — `GET /v1/site/identity` (Operator). This device's own public identity, for an
 * operator to register at a SYNAPSE Site — always real regardless of `unsEnabled`/whether a Site link
 * is configured at all (EC-1's `DeviceIdentity` is generated/loaded once at process startup).
 *
 * <para>GĐ3 closeout WI-4 — `notAfterUtc`/`daysToExpiry` make the certificate's own expiry visible for
 * the first time. `daysToExpiry` can be NEGATIVE for an already-expired certificate (a floor of the day
 * delta, computed fresh at response time, not stored) — `Site.tsx` treats that as "rotate NOW", never
 * clamps it away. */
export interface SiteIdentity {
  deviceFingerprint: string
  deviceCertPem: string
  notAfterUtc: string
  daysToExpiry: number
}

/** `RotateIdentityRequest` — `POST /v1/site/identity/rotate` (Admin) body. `SiteEndpoints.
 * RotateIdentityAsync` requires this to echo the fingerprint `GET /v1/site/identity` currently reports:
 * missing/blank is a 400, a mismatch (someone else already rotated, or the page is just stale) is a
 * 409 — see `useRotateIdentity` below for how `Site.tsx` surfaces each. Deliberately NOT optional on
 * this interface (unlike the server's own nullable DTO) — every call site in this app already holds a
 * real current fingerprint (`useSiteIdentity`'s own data) before it can render the Rotate button at
 * all, so there is never a legitimate reason for this client to send a blank one. */
export interface RotateIdentityRequest {
  currentFingerprint: string
}

/** `SiteLinkRequest` — `PUT /v1/site` (Engineer) body. `host`/`port`/`siteTrustPem` are only
 * validated/required server-side when `enabled` is `true` — disabling the link needs none of them
 * (see `SiteEndpoints.PutSiteAsync`). */
export interface SiteLinkRequest {
  enabled: boolean
  host?: string
  port?: number
  siteTrustPem?: string
}

/**
 * GĐ3 sub-2 SD-2 (`.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-2-brief.md`) —
 * one mDNS-discovered SYNAPSE Site, mirroring SD-1's `St4i.EdgeCore.Site.DiscoveredSite` record exactly
 * (`SiteDiscovery.cs`; camelCase on the wire via `Program.cs`'s `ConfigureHttpJsonOptions`, same as
 * every other DTO in this file). `addresses` legitimately can be empty (the join wizard only needs
 * `host`/`port` to pre-fill the form — `PUT /v1/site` dials by hostname, not a pre-resolved IP);
 * `txt` is the mDNS TXT record's flat key/value properties, possibly `{}`.
 */
export interface DiscoveredSite {
  instanceName: string
  host: string
  port: number
  addresses: string[]
  txt: Record<string, string>
}

const SITE_QUERY_KEY = ["site"] as const
const SITE_IDENTITY_QUERY_KEY = ["site", "identity"] as const

const siteEndpoints = {
  site: () => request<SiteStatus>("/v1/site"),
  siteIdentity: () => request<SiteIdentity>("/v1/site/identity"),
  setSiteLink: (body: SiteLinkRequest) =>
    request<SiteStatus>("/v1/site", { method: "PUT", body: JSON.stringify(body) }),
  /** `GET /v1/site/discover` (Engineer) — a bounded ~4s mDNS LAN browse; an empty array is a legitimate
   * result (no Site advertising on this LAN segment), never a 404/500 (see `SiteEndpoints.DiscoverAsync`). */
  discover: () => request<DiscoveredSite[]>("/v1/site/discover"),
  /** `POST /v1/site/identity/rotate` (Admin) — see `RotateIdentityRequest`'s own doc comment for why
   * `currentFingerprint` is required, not optional, on this client. Returns the SAME `SiteIdentityDto`
   * shape `GET /v1/site/identity` does, now reflecting the freshly-minted certificate. */
  rotateIdentity: (body: RotateIdentityRequest) =>
    request<SiteIdentity>("/v1/site/identity/rotate", { method: "POST", body: JSON.stringify(body) }),
}

/** `GET /v1/site` (Operator) — polled at 3s so the bridge-status badge (`Connecting` →
 * `Connected`/`Degraded`/`Down` + `lastError`) tracks the live handshake without a manual refresh.
 * Slower than `useFleet`/`useMachine`'s 1s tick — a Site link's own health changes far less often than
 * a running cycle does, so 3s is enough to feel live without hammering the endpoint. */
export function useSite(): UseQueryResult<SiteStatus> {
  return useQuery({
    queryKey: SITE_QUERY_KEY,
    queryFn: siteEndpoints.site,
    refetchInterval: 3000,
  })
}

/** `GET /v1/site/identity` (Operator) — one-shot (no `refetchInterval`): this device's own cert/
 * fingerprint never changes for the life of the process, so there's nothing external to poll for. */
export function useSiteIdentity(): UseQueryResult<SiteIdentity> {
  return useQuery({
    queryKey: SITE_IDENTITY_QUERY_KEY,
    queryFn: siteEndpoints.siteIdentity,
  })
}

/** `PUT /v1/site` (Engineer — `Site.tsx`'s own client-side `RequireRole` is only a UX gate; this is the
 * real enforcement). On success, invalidates `["site"]` so the badge/pre-filled form catch up to the
 * new link immediately rather than waiting up to 3s for the next poll. Rejected — 400 (bad host/port/
 * PEM when enabling), 409 (UNS spine disabled), 403 (non-Engineer) — touches the cache not at all; the
 * caller's own `onError` (branching on `EngineApiError.status`) is how the form surfaces that inline. */
export function useSetSiteLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: siteEndpoints.setSiteLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_QUERY_KEY })
    },
  })
}

/** `POST /v1/site/identity/rotate` (Admin — `Site.tsx`'s own client-side `RequireRole role="Admin"` is
 * only a UX gate; the server's `Policies.Admin` is the real enforcement). This is a genuinely
 * destructive action — see `Site.tsx`'s confirmation dialog for why — so unlike every other mutation in
 * this file, the CALLER is expected to have already confirmed with the operator before ever calling
 * `.mutate()`. On success, `setQueryData`s the new identity straight into `["site","identity"]` (same
 * "write the specific entry, then invalidate the wider collection" idiom `useSetAssetLifecycle` uses
 * above) AND invalidates `["site"]` — rotation re-applies the live Site bridge with the new certificate
 * (`RotateIdentityAsync`'s own doc comment), which can flip `bridgeState` (typically toward
 * `Connecting`/`Down`, since the Site still trusts the OLD fingerprint) well before the next 3s poll.
 * Rejected — 400 (blank/missing `currentFingerprint`, shouldn't happen from this client but handled
 * defensively), 409 (the fingerprint changed since the caller read it), 403 (non-Admin) — touches
 * neither cache entry; the caller's own `onError` (branching on `EngineApiError.status`) is how the
 * dialog surfaces each distinctly, in particular turning a 409 into "reload — this changed underneath
 * you" rather than a generic failure. */
export function useRotateIdentity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: siteEndpoints.rotateIdentity,
    onSuccess: (data) => {
      queryClient.setQueryData(SITE_IDENTITY_QUERY_KEY, data)
      queryClient.invalidateQueries({ queryKey: SITE_QUERY_KEY })
    },
  })
}

/**
 * `GET /v1/site/discover` (Engineer) — the mDNS "Discover Sites" scan `Site.tsx`'s Site-link form
 * triggers on click. A `useMutation` (not a polled `useQuery`), same "run-on-click, track pending/data/
 * error" ergonomics `useProbeSettings` above already uses for its own click-triggered connectivity
 * check — this is a read-only LAN browse, not a mutation of server state, so there's no cache to
 * invalidate on success; the caller reads the discovered list straight off this mutation's own `data`.
 */
export function useSiteDiscover() {
  return useMutation({
    mutationFn: siteEndpoints.discover,
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Alarms — GĐ3 sub-4 LC-4 (`routes/AlarmCenter.tsx`). Wire shapes mirror `St4i.EngineApi.Alarms.Alarm`/
// `AlarmHistoryEntry`/`AlarmHistoryPage` exactly (`Alarms/Alarm.cs`, `Alarms/IAlarmStore.cs`) — camelCase
// property names + enum values as their literal PascalCase C# member name via the app's global
// `JsonStringEnumConverter` (`Program.cs`), same discipline every other DTO in this file documents.
// LC-1/2/3 (the alarm backbone, `LineController`, `AlarmEndpoints.cs`/`LineEndpoints.cs`) all already
// landed — this is purely the operator UI over them.
// ─────────────────────────────────────────────────────────────────────────

/** `AlarmSource` (`Alarms/Alarm.cs`) — where an alarm condition originates. `Policy` is every
 * `PolicyResults.DenyAsync` denial (LC-1); `DriverHealth`/`NgRate` are LC-2's periodic evaluator.
 * `Identity` (GĐ3 closeout WI-4) is the same evaluator's certificate-expiry check — raised at `High`
 * (never `Critical`: an expiring cert must never trip LineController's alarm→hold gate, see
 * `AlarmEvaluator.EvaluateIdentityExpiryAsync`'s own doc comment) once `SiteIdentity.daysToExpiry` falls
 * inside the warn window. */
export type AlarmSource = "Policy" | "DriverHealth" | "NgRate" | "Identity"

/** `AlarmPriority` (`Alarms/Alarm.cs`) — ISA-18.2 priority, most-severe first; `ListActiveAsync` sorts
 * by this (descending) then `lastRaisedUtc` (descending). */
export type AlarmPriority = "Critical" | "High" | "Medium" | "Low"

/** `AlarmState` (`Alarms/Alarm.cs`) — `Cleared` never appears in `GET /v1/alarms`'s response (an alarm
 * in that state has already been deleted from the live set); it only ever shows up on the `Alarm` a
 * clearing `ack` call itself returns, or as a "cleared" `AlarmHistoryEntry.event`. */
export type AlarmState = "Active" | "Acked" | "Cleared"

/** `Alarm` (`Alarms/Alarm.cs`) — one active alarm condition. `runbook`/`targetId` are `null` when the
 * raising source didn't attach one; `ackedUtc`/`ackedBy` are `null` until acknowledged. */
export interface Alarm {
  id: number
  key: string
  source: AlarmSource
  code: string
  priority: AlarmPriority
  state: AlarmState
  message: string
  runbook: string | null
  targetId: string | null
  clearOnAck: boolean
  count: number
  firstRaisedUtc: string
  lastRaisedUtc: string
  ackedUtc: string | null
  ackedBy: string | null
}

/** `AlarmHistoryEntry` (`Alarms/IAlarmStore.cs`) — one append-only `alarm_history` row. `event` is a
 * plain (non-enum) string on the wire — `"raised" | "cleared" | "acked"` in this build — and `actor` is
 * `null` for a "raised" event (nobody raises an alarm) or a system-triggered clear. */
export interface AlarmHistoryEntry {
  seq: number
  atUtc: string
  key: string
  event: string
  source: AlarmSource
  code: string
  priority: AlarmPriority
  message: string
  actor: string | null
}

/** `AlarmHistoryPage` — same paging shape as `AuditPage`/`HistorianResultsPageDto`: `total` is the FULL
 * filtered count, ignoring `limit`/`offset`. */
export interface AlarmHistoryPage {
  items: AlarmHistoryEntry[]
  total: number
  limit: number
  offset: number
}

/** `GET /v1/alarms/history`'s own query-string vocabulary (`AlarmEndpoints.GetHistoryAsync`) — every
 * field optional, same discipline as `AuditFilter`/`HistorianResultsFilter`. */
export interface AlarmHistoryFilter {
  source?: AlarmSource
  priority?: AlarmPriority
  from?: string
  to?: string
  limit?: number
  offset?: number
}

function buildAlarmHistoryQueryString(filter: AlarmHistoryFilter): string {
  const params = new URLSearchParams()
  if (filter.source) params.set("source", filter.source)
  if (filter.priority) params.set("priority", filter.priority)
  if (filter.from) params.set("from", filter.from)
  if (filter.to) params.set("to", filter.to)
  if (filter.limit !== undefined) params.set("limit", String(filter.limit))
  if (filter.offset !== undefined) params.set("offset", String(filter.offset))
  return params.toString()
}

const ALARMS_QUERY_KEY = ["alarms"] as const

const alarmEndpoints = {
  alarms: () => request<Alarm[]>("/v1/alarms"),
  history: (filter: AlarmHistoryFilter) =>
    request<AlarmHistoryPage>(`/v1/alarms/history?${buildAlarmHistoryQueryString(filter)}`),
  ack: (id: number) => request<Alarm>(`/v1/alarms/${id}/ack`, { method: "POST" }),
}

/** `GET /v1/alarms` (Operator) — polled at 4s so the active table's priorities/counts/ack state track
 * live without a manual refresh. Slower than `useFleet`/`useMachine`'s 1s tick (an alarm condition
 * doesn't need to feel as instantaneous as a running cycle counter) but fast enough that an Ack from
 * another operator/tab disappears from this table within a few seconds. */
export function useAlarms(): UseQueryResult<Alarm[]> {
  return useQuery({
    queryKey: ALARMS_QUERY_KEY,
    queryFn: alarmEndpoints.alarms,
    refetchInterval: 4000,
  })
}

/** `GET /v1/alarms/history?…` (Operator) — on-demand (no `refetchInterval`), same "browse over
 * already-settled history" reasoning `useAudit`/`useHistorianResults` document: the filter object IS
 * the query key, so a page turn naturally refetches with no manual invalidation. */
export function useAlarmHistory(filter: AlarmHistoryFilter): UseQueryResult<AlarmHistoryPage> {
  return useQuery({
    queryKey: ["alarm-history", filter] as const,
    queryFn: () => alarmEndpoints.history(filter),
  })
}

/** `POST /v1/alarms/{id}/ack` (Operator) — invalidates `["alarms"]` on success so the active table
 * catches up immediately (an event alarm — `clearOnAck` — disappears entirely; a condition alarm's row
 * flips to `Acked`) rather than waiting up to 4s for the next poll. A rejected 404 (unknown id, or
 * already cleared by someone else) touches the cache not at all — the caller's own `onError` toasts
 * that. */
export function useAckAlarm() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => alarmEndpoints.ack(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALARMS_QUERY_KEY })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Line Control — GĐ3 sub-4 LC-4 (`routes/LineControl.tsx`). Wire shape mirrors `St4i.EngineApi.Line.
// LineStatus`/`PackMlState`/`LineCommand` exactly (`Line/LineController.cs`, `Line/PackMlState.cs`) —
// the operator UI over LC-3's supervisory PackML state machine (`GET /v1/line`, `POST /v1/line/
// {command}`).
// ─────────────────────────────────────────────────────────────────────────

/** `PackMlState` (`Line/PackMlState.cs`) — the pragmatic PackML/ISA-88 stable-state subset
 * `LineController` models (see that class's own doc comment for why only stable states, never the
 * transient Starting/Stopping/etc. names a full PackML model has). */
export type PackMlState = "Idle" | "Execute" | "Held" | "Stopped" | "Aborted"

/** The lowercase route-segment form `POST /v1/line/{command}` actually takes (`LineEndpoints.
 * MapLineEndpoints`'s own doc comment: "one per … route segment (lowercased)") — deliberately NOT the
 * PascalCase C# `LineCommand` enum member name (`Line/PackMlState.cs`), since this union only ever
 * builds the request URL, never gets displayed — the UI's own command labels come from `line.commands.*`
 * i18n keys, keyed by this same lowercase form. */
export type LineCommand = "start" | "hold" | "unhold" | "stop" | "abort" | "reset"

/** `LineStatus` (`Line/LineController.cs`) — `holdReason` is non-null only while `state` is `"Held"`;
 * `isRunning`/`estopEngaged` are read straight off `FleetHost` (the actual pipeline truth), never
 * cached, so a caller can always tell the LineController's own COMMANDED state apart from what the
 * fleet is really doing right now. */
export interface LineStatus {
  state: PackMlState
  holdReason: string | null
  isRunning: boolean
  estopEngaged: boolean
}

const LINE_QUERY_KEY = ["line"] as const

/** Mirrors `OeeSettingsApiError`/`UsersApiError` above — the shared `request<T>`/`EngineApiError` only
 * carry a status code, but a rejected line command (409) needs to show the operator the SERVER's own
 * `RejectReason` text (e.g. "critical alarm active", "Cannot Hold from Idle — Hold is only legal from
 * Execute.") rather than a generic "request failed" — `LineEndpoints.ExecuteAsync` always returns that
 * exact text as `ApiErrorDto.error` on a 409. */
export class LineCommandError extends Error {
  status: number
  /** The server's own `ApiErrorDto.error` text — undefined only for a genuinely unparseable body. */
  serverMessage?: string

  constructor(status: number, serverMessage?: string) {
    super(serverMessage ?? `request failed: ${status}`)
    this.name = "LineCommandError"
    this.status = status
    this.serverMessage = serverMessage
  }
}

async function postLineCommand(cmd: LineCommand): Promise<LineStatus> {
  const res = await fetch(`${BASE_URL}/v1/line/${cmd}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  })
  if (res.status === 401) unauthorizedHandler?.()
  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      serverMessage = body?.error
    } catch {
      // Non-JSON body (rare — a proxy/500 page) — fall back to the generic message.
    }
    throw new LineCommandError(res.status, serverMessage)
  }
  return (await res.json()) as LineStatus
}

const lineEndpoints = {
  line: () => request<LineStatus>("/v1/line"),
  command: postLineCommand,
}

/** `GET /v1/line` (Operator) — polled at 3s, same cadence `useSite` uses: the PackML state changes far
 * less often than a running cycle count (only on an operator command or an alarm-gate flip), so 3s is
 * enough to feel live without hammering the endpoint. */
export function useLine(): UseQueryResult<LineStatus> {
  return useQuery({
    queryKey: LINE_QUERY_KEY,
    queryFn: lineEndpoints.line,
    refetchInterval: 3000,
  })
}

/** `POST /v1/line/{command}` (Operator) — invalidates `["line"]` on success so the state badge/command
 * buttons catch up to the new commanded state immediately rather than waiting up to 3s for the next
 * poll. Rejected (409 illegal transition/SAFETY_BLOCKED, 403) throws `LineCommandError` and touches the
 * cache not at all — the caller's own `onError` (reading `.serverMessage`) surfaces that inline. */
export function useLineCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cmd: LineCommand) => lineEndpoints.command(cmd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LINE_QUERY_KEY })
    },
  })
}
