import { expect, type APIRequestContext } from "@playwright/test"

import { HISTORIAN_ROWS_MS } from "./deadlines"

/**
 * Direct HTTP calls against `St4i.EngineApi` (bypassing the UI) so every spec can establish its own
 * precondition — "fleet running", "scenario at its normal preset" — without depending on what an
 * earlier spec file happened to leave behind. `FleetHost` (the engine's composition root) is a
 * process-lifetime singleton shared by every test in this run (see `playwright.config.ts`'s
 * `workers: 1` remarks), so being explicit here is what keeps specs independently re-runnable.
 */
export const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:5199"

/** `FleetHost.Start()`/`Stop()` are both no-ops if the fleet is already in the requested state, so
 * this is safe to call unconditionally at the top of any spec that needs live cycle data. */
export async function setFleetRunning(request: APIRequestContext, running: boolean): Promise<void> {
  const path = running ? "/v1/fleet/start" : "/v1/fleet/stop"
  const res = await request.post(`${ENGINE_URL}${path}`)
  if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()}`)
}

/** C-2 — clears the engine-owned HALT latch (`FleetHost.ResetEstop`; SM-4: a supervisory software
 * latch, not a safety device — see README §1), idempotent (a no-op if nothing is latched).
 * `StartLocked` refuses to start the fleet while latched (defense in depth, see `FleetHost.cs`), so
 * any spec that engages HALT MUST clear it before `setFleetRunning(true)` can work again — used
 * defensively in `afterEach` hooks for that reason. */
export async function resetEstop(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${ENGINE_URL}/v1/fleet/estop/reset`)
  if (!res.ok()) throw new Error(`POST /v1/fleet/estop/reset failed: ${res.status()}`)
}

/** Resets the shared scenario config back to the "normal" preset — used defensively at the start/end
 * of specs that apply a different preset, so a Scenario-screen assertion elsewhere in the suite (or a
 * re-run) doesn't inherit an unexpected active preset. */
export async function resetScenarioToNormal(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${ENGINE_URL}/v1/scenario/preset`, { data: { name: "normal" } })
  if (!res.ok()) throw new Error(`reset scenario to normal failed: ${res.status()}`)
}

/** Applies any named scenario preset (`FleetHost.ListPresets()`'s own vocabulary — "normal",
 * "high-defect", "sensor-drift", "network-outage", "hotfolder-aoi") — the same call
 * `06-scenario.spec.ts`'s UI click makes, exposed here for specs that need a real, elevated defect
 * rate (e.g. WS3-T3's living-twin NG-coverage test in `11-hmi.spec.ts`) without going through the
 * Scenario screen's own UI. */
export async function applyScenarioPreset(request: APIRequestContext, name: string): Promise<void> {
  const res = await request.post(`${ENGINE_URL}/v1/scenario/preset`, { data: { name } })
  if (!res.ok()) throw new Error(`apply scenario preset "${name}" failed: ${res.status()}`)
}

/**
 * Sets the shared scenario's raw knobs directly (`POST /v1/scenario {cycleRate,defectRate,faultRate,
 * networkOutage}` — the same endpoint the Scenario screen's own sliders drive), for the cases where a
 * named preset is not extreme enough to make a test cheap and deterministic.
 *
 * `cycleRate` is a MULTIPLIER on every simulator's cycle interval (`SimulatorBase.CycleRateMultiplier`
 * divides the interval; the shipped `sensor-drift` preset already uses 5.0), so raising it makes the
 * engine produce the same verdicts faster — it changes the CLOCK, never the behaviour. `defectRate`
 * and `faultRate` are combined server-side into one injected-failure probability per reading
 * (`ScenarioAwareDriver`: `1 - (1-defect)(1-fault)`).
 *
 * Anything that calls this MUST undo it — `resetScenarioToNormal` in a `finally` or an `afterEach`,
 * both of which Playwright still runs when a test hits its own timeout (verified, task-2-report.md
 * §2). This is a process-lifetime singleton shared with every other spec in the run.
 */
export async function applyScenario(
  request: APIRequestContext,
  scenario: { cycleRate?: number; defectRate?: number; faultRate?: number; networkOutage?: boolean }
): Promise<void> {
  const res = await request.post(`${ENGINE_URL}/v1/scenario`, {
    data: { cycleRate: 1.0, defectRate: 0.0, faultRate: 0.0, networkOutage: false, ...scenario },
  })
  if (!res.ok()) throw new Error(`apply scenario ${JSON.stringify(scenario)} failed: ${res.status()}`)
}

/**
 * Sets one machine operating-configuration parameter directly
 * (`PUT /v1/machines/{code}/settings/{key}`) — the API half of `resetMachineSetting`, for specs that
 * need a machine driven into a known operating regime without going through its edit dialog.
 *
 * The simulators read these on every cycle, so this is the deterministic way to make a rare outcome
 * common: `AoiInspectorSim` calls a point NG whenever `matchScore < matchThreshold` with
 * `matchScore ~ N(0.93, 0.05)`, so raising `matchThreshold` raises the per-point NG rate
 * monotonically and by construction (see that sim's own header). Undo it with `resetMachineSetting`.
 */
export async function setMachineSetting(
  request: APIRequestContext,
  machineCode: string,
  key: string,
  value: number,
  scope: "machine" | "product",
  product?: string
): Promise<void> {
  const res = await request.put(
    `${ENGINE_URL}/v1/machines/${encodeURIComponent(machineCode)}/settings/${encodeURIComponent(key)}`,
    { data: product ? { value, scope, product } : { value, scope } }
  )
  if (!res.ok()) throw new Error(`set machine setting ${machineCode}/${key} = ${value} (${scope}) failed: ${res.status()}`)
}

/**
 * Waits until the historian has real cycle rows on file — the precondition `/historian` and `/reports`
 * both need before they can render anything at all.
 *
 * Lived as a BYTE-IDENTICAL copy in `15-historian.spec.ts` and `16-reports.spec.ts`, both called from
 * a `beforeEach`, both declaring 30 000 ms. Two copies of a bound is two places to get it wrong and
 * one of them to be missed; it belongs here beside the other "establish your own precondition"
 * helpers. See `HISTORIAN_ROWS_MS` for what the bound is measured against.
 */
export async function waitForHistorianRows(request: APIRequestContext, minRows = 5): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${ENGINE_URL}/v1/historian/results?limit=1`)
        if (!res.ok()) return -1
        const body = (await res.json()) as { total: number }
        return body.total
      },
      { timeout: HISTORIAN_ROWS_MS, message: "waiting for the historian to record real cycle rows" }
    )
    .toBeGreaterThanOrEqual(minRows)
}

/** Resets the engine-stored `settings.language` back to Vietnamese — the Settings functional spec
 * flips it while exercising the language selector; this undoes that so nothing downstream (including
 * a re-run of the pristine visual pass) sees an unexpected default. */
export async function resetSettingsLanguage(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/settings`, { data: { language: "vi" } })
  if (!res.ok()) throw new Error(`reset settings language failed: ${res.status()}`)
}

/** SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md) — restores
 * the engine's transport mode to Demo and `Settings.serverUrl` to its honest built-in default
 * (`FleetHost.DefaultServerUrl`, now `""` — SM-3 killed the old `http://localhost:5000` placeholder, see
 * that constant's own doc comment) — undoes what `14-ecosystem-connect.spec.ts` deliberately flips to
 * Live + a configured-but-unreachable URL to exercise the "failed" ecosystem status, so nothing
 * downstream (including a re-run of the pristine visual pass, which assumes the webServer's own
 * `ST4I_DEMO_ENABLED=true` Demo-mode boot state) inherits it. */
export async function resetEcosystemMode(request: APIRequestContext): Promise<void> {
  const modeRes = await request.put(`${ENGINE_URL}/v1/mode`, { data: { mode: "Demo" } })
  if (!modeRes.ok()) throw new Error(`reset mode to Demo failed: ${modeRes.status()}`)
  const settingsRes = await request.put(`${ENGINE_URL}/v1/settings`, { data: { serverUrl: "" } })
  if (!settingsRes.ok()) throw new Error(`reset serverUrl failed: ${settingsRes.status()}`)
}

/**
 * Branch-review I-15 — pulls `productCode`'s config onto `machineCode`'s LOCAL `ProductConfigStore`
 * (`POST /v1/machines/{code}/config/pull`, the same call `02-machine-detail.spec.ts`'s "Pull" button
 * click makes). Idempotent — re-running against an already-in-sync product still reports success,
 * just 0 changes — so any spec that needs a DETERMINISTIC point set for a product (not "whatever
 * `08`/`02`/`09` happened to leave it at") can call this itself instead of depending on file order.
 * `11-hmi.spec.ts` uses this so its AOI schematic/visual baselines hold whether the full suite ran
 * first or the file is run standalone.
 */
export async function pullMachineConfig(request: APIRequestContext, machineCode: string, productCode: string): Promise<void> {
  const res = await request.post(`${ENGINE_URL}/v1/machines/${encodeURIComponent(machineCode)}/config/pull`, {
    data: { productCode },
  })
  if (!res.ok()) throw new Error(`pull config for ${machineCode}/${productCode} failed: ${res.status()}`)
}

/**
 * Task 4/5 (docs/plans/2026-07-21-machine-config.md) — resets one machine operating-configuration
 * parameter (`/v1/machines/{code}/settings/{key}`) straight back to its schema default, bypassing the
 * UI. Used defensively in `beforeEach`/`afterEach` so a spec that edits a setting (the tolerance→NG
 * demo, scope-semantics proof) doesn't leak an adjustment into a later "pristine" run — the same
 * "establish your own precondition" idiom `resetEstop`/`resetScenarioToNormal` already use.
 * `scope: "machine" | "product"` — the query-string wire vocabulary (case-insensitive server-side,
 * see `MachineSettingsEndpoints.TryParseScope`'s own doc comment), NOT the C# enum member casing.
 * A 404 (nothing to reset — the key never had an adjustment) is swallowed; any other non-2xx throws.
 */
export async function resetMachineSetting(
  request: APIRequestContext,
  machineCode: string,
  key: string,
  scope: "machine" | "product",
  product?: string
): Promise<void> {
  const query = new URLSearchParams({ scope })
  if (product) query.set("product", product)
  const res = await request.delete(
    `${ENGINE_URL}/v1/machines/${encodeURIComponent(machineCode)}/settings/${encodeURIComponent(key)}?${query.toString()}`
  )
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`reset machine setting ${machineCode}/${key} (${scope}) failed: ${res.status()}`)
  }
}
