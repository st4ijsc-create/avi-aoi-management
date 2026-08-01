import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { LIVE_CYCLES_MS } from "./support/deadlines"
import { ENGINE_URL, setFleetRunning } from "./support/engine"
import { gotoDashboard } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Dashboard happy path: empty state → Start Fleet → live tiles populate → Stop Fleet.
 *
 * `00-visual-and-a11y.spec.ts` already covers the empty-state screenshot/axe pass pristine; this
 * spec is about BEHAVIOR (the fleet actually starts/stops through the real UI, against the real
 * engine) rather than pixels — the populated grid's per-card numbers/sparklines/status colors are
 * inherently live (see that file's top comment), so this spec verifies them with DOM/role
 * assertions instead of a masked pixel snapshot, per the task brief's own guidance for
 * inherently-non-deterministic regions.
 */
test.describe("dashboard — fleet start/stop", () => {
  test.beforeEach(async ({ request }) => {
    // Defensive — makes this spec independently re-runnable even if it isn't the first to touch the
    // fleet (e.g. run in isolation via --grep).
    await setFleetRunning(request, false)
  })

  test("empty state renders, Start Fleet populates the grid, Stop Fleet freezes it", async ({ page, request }) => {
    // WS3-T3 (visual-determinism-report.md) — this test's first assertion below only holds against a
    // fleet that has NEVER produced a cycle, and `FleetHost` exposes no reset-to-seed endpoint (its
    // cycle counters only ever climb for the lifetime of the engine process, see `FleetHost.cs`) — the
    // ONLY way to reach that state is to be the very first spec to ever call `POST /v1/fleet/start` in
    // this process, which is true for a normal `npm run test:e2e` run (file order: `00-` never starts
    // the fleet, this file is next) but silently false the moment this file runs standalone
    // (`--grep`/`--only`) after any other spec, or against a dev server reused from an earlier dirty
    // session. Asserting the precondition explicitly turns that into a clear, actionable failure here
    // instead of a confusing "empty-state text never appeared" timeout below.
    const preflight = await (await request.get(`${ENGINE_URL}/v1/fleet`)).json()
    expect(
      preflight.kpis.totalCycles,
      "expected a never-started fleet (0 total cycles) — this spec must run first against a fresh engine (`npm run test:e2e`, not this file standalone after others)"
    ).toBe(0)

    await gotoDashboard(page)

    // Empty state: no cycles yet, roster known, fleet not running. (Not `getByRole("heading", …)` —
    // the empty-state title renders as a plain <p>, not an ARIA heading.)
    await expect(page.getByText(viDict.dashboard.empty.title, { exact: true })).toBeVisible()
    const startButton = page.getByRole("banner").getByRole("button", { name: viDict.shell.topBar.startFleet })
    const stopButton = page.getByRole("banner").getByRole("button", { name: viDict.shell.topBar.stop })
    await expect(startButton).toBeEnabled()
    await expect(stopButton).toBeDisabled()

    // Start — via the empty-state's own CTA (a second, equally-real entry point to the same action
    // as the TopBar button exercised by the Stop half of this test below). Scoped to `main` — the
    // TopBar's own Start button (in `<header>`, already bound above as `startButton`) carries the
    // identical label.
    await page.getByRole("main").getByRole("button", { name: viDict.dashboard.empty.cta }).click()
    await expect(page.getByText(viDict.toast.fleetStarted)).toBeVisible()
    await expect(startButton).toBeDisabled()
    await expect(stopButton).toBeEnabled()

    // The grid replaces the empty state once real cycles land — `<main>` holds exactly one `button`
    // per roster machine once populated (the empty-state CTA button it replaces is the only other
    // candidate, and it's gone by construction: Dashboard renders the grid XOR the empty state).
    await expect(page.locator("main").getByRole("button")).toHaveCount(11, { timeout: LIVE_CYCLES_MS })

    // At least one machine has actually cycled — the KPI's "online" count left zero.
    await expect(page.getByText(viDict.dashboard.kpi.onlineNone)).toHaveCount(0, { timeout: LIVE_CYCLES_MS })

    // A representative card rendered with its real identity (deterministic — machine codes come from
    // the checked-in fleet.json roster, not simulated data).
    await expect(page.getByText("SCRW-01", { exact: true })).toBeVisible()
    await expect(page.getByText("AOI-01", { exact: true })).toBeVisible()

    // Real, populated-state a11y pass — color-coded status badges / pass-rate rings / sparklines only
    // exist once live data flows, so this is genuinely additional coverage over the pristine baseline
    // in 00-visual-and-a11y.spec.ts, not a duplicate of it.
    await assertNoSeriousA11yViolations(page)

    // Stop — cycles already happened, so the grid stays populated (frozen), it does not revert to
    // the empty state (`showEmpty` requires zero cycles ever, which is no longer true).
    await stopButton.click()
    await expect(page.getByText(viDict.toast.fleetStopped)).toBeVisible()
    await expect(startButton).toBeEnabled()
    await expect(stopButton).toBeDisabled()
    await expect(page.locator("main").getByRole("button")).toHaveCount(11)
  })
})
