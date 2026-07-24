import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL, resetEcosystemMode } from "./support/engine"
import { gotoDashboard, gotoMachines } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS2-T2 (docs/PRODUCTION_UI_DESIGN.md §2.4) — the Live-mode "connect to ecosystem" gate
 * Dashboard/Machines show instead of an empty/meaningless local fleet grid whenever this
 * deployment hasn't reached a real ST4I server yet (`useEcosystemConnection` in `lib/api.ts`).
 *
 * Runs LAST (numeric `14-` prefix, same "file order matters" reasoning `playwright.config.ts`'s top
 * comment documents for `FleetHost` being a process-lifetime singleton): every test here
 * deliberately flips the shared engine's transport mode / `Settings.serverUrl` away from the
 * webServer's own Demo-mode boot default (`ST4I_DEMO_ENABLED=true`), so nothing declared before this
 * file is affected, and this file's own `afterAll` restores both before the run ends.
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

async function gotoConnectGate(page: Page, path: "/" | "/machines"): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole("heading", { name: viDict.ecosystemConnect.title, level: 3 })).toBeVisible({
    timeout: 15_000,
  })
}

test.describe("ecosystem connect gate", () => {
  test("Live mode with an unreachable ecosystem shows the connect screen on Dashboard, not an empty fleet", async ({
    page,
    request,
  }) => {
    await setLiveUnreachable(request)

    await gotoConnectGate(page, "/")
    // The connect gate REPLACES the normal KPI row / machine grid, it doesn't sit alongside it.
    await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).not.toBeVisible()

    // The panel's own status badge settles on "failed" (never "connected") against an address
    // nothing listens on — same reachability contract `05-settings.spec.ts`'s probe test proves.
    await expect(page.getByText(viDict.ecosystemConnect.status.failed)).toBeVisible({ timeout: 15_000 })

    // The register/claim entry point (§2.4's "path to register/claim this machine") really
    // navigates to Onboarding — not just decorative copy.
    await page.getByRole("button", { name: viDict.ecosystemConnect.registerCta }).click()
    await expect(page.getByRole("heading", { name: viDict.onboarding.title, level: 1 })).toBeVisible()
  })

  test("Live mode with an unreachable ecosystem shows the connect screen on Machines, not an empty table", async ({
    page,
    request,
  }) => {
    await setLiveUnreachable(request)

    await gotoConnectGate(page, "/machines")
    await expect(page.getByRole("columnheader", { name: viDict.machines.table.code })).not.toBeVisible()
  })

  test("clears the instant a real fleet is reachable", async ({ page, request }) => {
    await setLiveUnreachable(request)
    await gotoConnectGate(page, "/")

    // Point it at the engine's OWN HTTP listener — reachable (any HTTP response counts, see
    // `ResilienceProbe.ProbeAsync`'s doc comment) without depending on a second real ST4I server
    // existing in this test environment — same technique `05-settings.spec.ts`'s "reachable" case
    // uses. Reuses the SAME server-URL field Settings exposes (§2.4's "wire into this state, don't
    // invent a parallel config surface").
    await page.getByLabel(viDict.settings.connection.serverUrlLabel).fill(ENGINE_URL)
    await page.getByRole("button", { name: viDict.ecosystemConnect.saveAndTestBtn }).click()

    await expect(page.getByRole("heading", { name: viDict.ecosystemConnect.title, level: 3 })).not.toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).toBeVisible()
  })

  test("never shows in Demo mode", async ({ page, request }) => {
    const modeRes = await request.put(`${ENGINE_URL}/v1/mode`, { data: { mode: "Demo" } })
    expect(modeRes.ok()).toBe(true)

    await gotoDashboard(page)
    await expect(page.getByRole("heading", { name: viDict.ecosystemConnect.title, level: 3 })).not.toBeVisible()

    await gotoMachines(page)
    await expect(page.getByRole("heading", { name: viDict.ecosystemConnect.title, level: 3 })).not.toBeVisible()
  })

  const THEMES: Theme[] = ["glass", "console", "warmth"]
  for (const theme of THEMES) {
    test(`a11y (axe, wcag2a/2aa/21aa) — ${theme}`, async ({ page, request }) => {
      await setLiveUnreachable(request)
      await primeAppStorage(page, { theme })
      await gotoConnectGate(page, "/")
      await assertNoSeriousA11yViolations(page)
    })
  }

  test.afterAll(async ({ request }) => {
    await resetEcosystemMode(request)
  })
})
