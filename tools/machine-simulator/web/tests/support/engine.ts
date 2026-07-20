import type { APIRequestContext } from "@playwright/test"

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

/** C-2 — clears the engine-owned E-STOP latch (`FleetHost.ResetEstop`), idempotent (a no-op if
 * nothing is latched). `StartLocked` refuses to start the fleet while latched (defense in depth, see
 * `FleetHost.cs`), so any spec that engages E-STOP MUST clear it before `setFleetRunning(true)` can
 * work again — used defensively in `afterEach` hooks for that reason. */
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

/** Resets the engine-stored `settings.language` back to Vietnamese — the Settings functional spec
 * flips it while exercising the language selector; this undoes that so nothing downstream (including
 * a re-run of the pristine visual pass) sees an unexpected default. */
export async function resetSettingsLanguage(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/settings`, { data: { language: "vi" } })
  if (!res.ok()) throw new Error(`reset settings language failed: ${res.status()}`)
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
