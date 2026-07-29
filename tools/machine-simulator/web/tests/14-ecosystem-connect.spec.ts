import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL, resetEcosystemMode } from "./support/engine"
import { gotoDashboard, gotoMachines } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/**
 * SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md) — the
 * ecosystem connection STATUS Dashboard/Machines now show (`useEcosystemConnection` in `lib/api.ts`,
 * `EcosystemStatusWidget` in `EcosystemConnect.tsx`). Formerly (WS2-T2) this file covered a GATE that
 * replaced Dashboard/Machines' entire content whenever `needsConnect` was true — SM-3 removed that gate
 * outright: a customer who never connects to any ecosystem gets a fully working product, not a form.
 * This file now proves the OPPOSITE invariant just as strictly: no server configured, or a server that
 * can't be reached, must NEVER block the real fleet content — only the collapsed status badge changes,
 * and a genuinely failing connection auto-expands so the diagnosis is still immediately visible.
 *
 * Runs LAST (numeric `14-` prefix, same "file order matters" reasoning `playwright.config.ts`'s top
 * comment documents for `FleetHost` being a process-lifetime singleton): every test here deliberately
 * flips the shared engine's transport mode / `Settings.serverUrl` away from the webServer's own
 * Demo-mode boot default (`ST4I_DEMO_ENABLED=true`), so nothing declared before this file is affected,
 * and this file's own `afterAll` restores both before the run ends.
 *
 * Coverage note: this suite's shared engine is seeded with the DEMO 11-machine (fabricated/Simulated)
 * fleet for its entire process lifetime (`FleetHost` never re-loads its roster after startup, and there
 * is no "unregister a machine" endpoint — see `FleetHost.RegisterMachine`'s own remarks: additive only).
 * Flipping `/v1/mode` to Live here exercises "Live mode, an actual registered roster, no/unreachable
 * server" structurally identically to a real product install with a real machine — Dashboard/Machines'
 * own gating logic (`roster.length`) never inspects `DriverKind` — but it CANNOT reach a genuinely
 * EMPTY roster in Live mode (SM-1's "product mode, no server, no machines" case) without a second,
 * separately-launched engine process in product mode. That exact honest-empty-state path
 * (`NoMachinesEmptyState`/`Machines.tsx`'s own `roster.length === 0` branch) was verified manually
 * instead — see task-3-report.md's Playwright section for how and why.
 */

// Fast connection-refused, not the 5s ResilienceProbe timeout — same unreachable target
// `05-settings.spec.ts`'s own probe test uses.
const UNREACHABLE_URL = "http://127.0.0.1:1"

async function setLiveUnreachable(request: APIRequestContext): Promise<void> {
  const settingsRes = await request.put(`${ENGINE_URL}/v1/settings`, { data: { serverUrl: UNREACHABLE_URL } })
  if (!settingsRes.ok()) throw new Error(`set unreachable serverUrl failed: ${settingsRes.status()}`)
  const modeRes = await request.put(`${ENGINE_URL}/v1/mode`, { data: { mode: "Live" } })
  if (!modeRes.ok()) throw new Error(`set mode Live failed: ${modeRes.status()}`)
}

/** SM-3 — Live mode with NO server configured at all: the "standalone" status, a legitimate default,
 * not a failure. `serverUrl: ""` is what `FleetHost.DefaultServerUrl` itself now is. */
async function setLiveStandalone(request: APIRequestContext): Promise<void> {
  const settingsRes = await request.put(`${ENGINE_URL}/v1/settings`, { data: { serverUrl: "" } })
  if (!settingsRes.ok()) throw new Error(`clear serverUrl failed: ${settingsRes.status()}`)
  const modeRes = await request.put(`${ENGINE_URL}/v1/mode`, { data: { mode: "Live" } })
  if (!modeRes.ok()) throw new Error(`set mode Live failed: ${modeRes.status()}`)
}

const ecosystemToggle = (page: Page) => page.getByRole("button", { name: viDict.ecosystemConnect.title })

/** Scoped to WITHIN the toggle button (its status badge), not a bare page-wide `getByText` — the
 * TopBar's own "Đã kết nối engine" ("engine connected") text is ALSO on every one of these screens and
 * genuinely contains the ecosystem "connected" status string ("Đã kết nối") as a substring, so an
 * unscoped locator resolves to 2 elements the instant both are simultaneously true (which they always
 * eventually are, once a probe against a real server succeeds) — a real, reproduced strict-mode
 * violation, not a hypothetical one. */
const ecosystemStatusText = (page: Page, status: string) => ecosystemToggle(page).getByText(status)

test.describe("ecosystem connection status", () => {
  test("standalone (no server configured) — Dashboard renders the fleet, no blocking form", async ({
    page,
    request,
  }) => {
    await setLiveStandalone(request)

    await gotoDashboard(page)
    // gotoDashboard's own wait already requires the KPI row past its skeleton — proof the real content
    // rendered, not a connect form in its place. Re-asserted explicitly here for this test's own intent.
    await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).toBeVisible()

    await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.standalone)).toBeVisible()
    // Unobtrusive: collapsed by default, not a failure demanding attention.
    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "false")
  })

  test("standalone (no server configured) — Machines renders the roster, no blocking form", async ({
    page,
    request,
  }) => {
    await setLiveStandalone(request)

    await gotoMachines(page)
    await expect(page.getByRole("columnheader", { name: viDict.machines.table.code })).toBeVisible()

    await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.standalone)).toBeVisible()
    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "false")
  })

  test("configured but unreachable — Dashboard stays fully usable, failure is visible and auto-expanded", async ({
    page,
    request,
  }) => {
    await setLiveUnreachable(request)

    await gotoDashboard(page)
    // The rest of the page still works — same KPI row, no content replaced.
    await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).toBeVisible()

    await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.failed)).toBeVisible({ timeout: 15_000 })
    // Diagnosable without an extra click — auto-expanded, the server-url field is already visible.
    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByLabel(viDict.settings.connection.serverUrlLabel)).toBeVisible()

    // The register/claim entry point really navigates to Onboarding — not just decorative copy.
    await page.getByRole("button", { name: viDict.ecosystemConnect.registerCta }).click()
    await expect(page.getByRole("heading", { name: viDict.onboarding.title, level: 1 })).toBeVisible()
  })

  test("configured but unreachable — Machines stays fully usable, failure is visible and auto-expanded", async ({
    page,
    request,
  }) => {
    await setLiveUnreachable(request)

    await gotoMachines(page)
    await expect(page.getByRole("columnheader", { name: viDict.machines.table.code })).toBeVisible()

    await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.failed)).toBeVisible({ timeout: 15_000 })
    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "true")
  })

  test("the connect flow is still reachable and works from standalone", async ({ page, request }) => {
    await setLiveStandalone(request)
    await gotoDashboard(page)

    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "false")
    await ecosystemToggle(page).click()
    await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "true")

    // Point it at the engine's OWN HTTP listener — reachable (any HTTP response counts, see
    // `ResilienceProbe.ProbeAsync`'s doc comment) without depending on a second real ST4I server
    // existing in this test environment — same technique `05-settings.spec.ts`'s "reachable" case uses.
    await page.getByLabel(viDict.settings.connection.serverUrlLabel).fill(ENGINE_URL)
    await page.getByRole("button", { name: viDict.ecosystemConnect.saveAndTestBtn }).click()

    await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.connected)).toBeVisible({ timeout: 15_000 })
    // Still no blocking gate — the fleet content was visible the entire time.
    await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).toBeVisible()
  })

  test("never shows in Demo mode", async ({ page, request }) => {
    const modeRes = await request.put(`${ENGINE_URL}/v1/mode`, { data: { mode: "Demo" } })
    expect(modeRes.ok()).toBe(true)

    await gotoDashboard(page)
    await expect(page.getByText(viDict.ecosystemConnect.title)).not.toBeVisible()

    await gotoMachines(page)
    await expect(page.getByText(viDict.ecosystemConnect.title)).not.toBeVisible()
  })

  const THEMES: Theme[] = ["glass", "console", "warmth"]
  for (const theme of THEMES) {
    test(`a11y (axe, wcag2a/2aa/21aa) — failed state, expanded — ${theme}`, async ({ page, request }) => {
      await setLiveUnreachable(request)
      await primeAppStorage(page, { theme })
      await gotoDashboard(page)
      await expect(ecosystemStatusText(page, viDict.ecosystemConnect.status.failed)).toBeVisible({ timeout: 15_000 })
      await expect(ecosystemToggle(page)).toHaveAttribute("aria-expanded", "true")
      await assertNoSeriousA11yViolations(page)
    })
  }

  test.afterAll(async ({ request }) => {
    await resetEcosystemMode(request)
  })
})
