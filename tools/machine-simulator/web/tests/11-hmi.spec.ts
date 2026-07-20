import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { setFleetRunning } from "./support/engine"
import { gotoHmi } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/**
 * H2 — the HMI operator panel (`/hmi/:code`, docs/HMI_DESIGN_SPEC.md). Runs LAST (numeric `11-`
 * prefix, after `00`'s pristine baselines and every functional spec that starts the fleet) — by the
 * time this file runs the shared `FleetHost` singleton (see `playwright.config.ts`'s top comment) has
 * real, non-zero cycle history from every spec before it, which is exactly the live state this screen
 * needs to prove itself against (a genuinely idle/pristine HMI wouldn't exercise the schematic
 * animation, the readout grid, or the live log at all).
 *
 * `beforeEach` unconditionally (re-)starts the fleet so every test in this file gets real live data
 * regardless of what the immediately-preceding test left behind (the E-STOP test below stops it);
 * `afterEach` restores that same running state so this file leaves the shared engine exactly as it
 * found it.
 */
test.describe("HMI operator panel", () => {
  test.beforeEach(async ({ request }) => {
    await setFleetRunning(request, true)
  })
  test.afterEach(async ({ request }) => {
    await setFleetRunning(request, true)
  })

  test("nameplate renders machine identity, status lamp, and clock", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    await expect(page.getByRole("heading", { name: "SCRW-01", level: 1 })).toBeVisible()
    // Scoped to the page's one `<header>` (the Nameplate) — "Automation" alone is ambiguous against
    // the schematic panel's own "FIG. 01 — AUTOMATION / SCREWDRIVE CELL" caption.
    await expect(page.locator("header").getByText(viDict.deviceClass.Automation)).toBeVisible()
    // Live HH:MM:SS clock — scoped to the header (the system log's own per-row timestamps match the
    // same `HH:MM:SS` shape, which would otherwise make this ambiguous).
    await expect(page.locator("header").getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeVisible()
    // "Back to machine detail" — the obvious way back the brief asks for.
    await expect(page.getByRole("link", { name: viDict.hmi.back })).toBeVisible()
  })

  test("physical controls: Start/Pause/E-STOP present and reflect real fleet state", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    const start = page.getByRole("button", { name: viDict.hmi.controls.start })
    const pause = page.getByRole("button", { name: viDict.hmi.controls.pause })
    const estop = page.getByRole("button", { name: viDict.hmi.controls.estop })
    await expect(start).toBeVisible()
    await expect(pause).toBeVisible()
    await expect(estop).toBeVisible()
    // Fleet is running (beforeEach) — START is the currently-inert one, PAUSE is live.
    await expect(start).toBeDisabled()
    await expect(pause).toBeEnabled()
    await expect(estop).toBeEnabled()
    // No RESET affordance while nothing is latched (spec §6: "plus RESET when latched").
    await expect(page.getByRole("button", { name: viDict.hmi.controls.reset })).toHaveCount(0)
  })

  test("system log fills with live trace rows for this machine", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    await expect(page.getByText(viDict.hmi.log.empty)).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => page.getByRole("listitem").count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("AOI schematic plots real product measurement points", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    const schematic = page.getByRole("img", { name: /FIG\. 01/ })
    await expect(schematic).toBeVisible()
    // Real `MeasurementPoint`s from the product config, plotted as circles carrying their own code
    // as an accessible `<title>` — not the engine's generic simulator point codes (see
    // `AoiSchematic.tsx`'s header comment on the positional-correspondence disclosure).
    await expect.poll(() => schematic.locator("circle title").count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("E-STOP latches a real fault: stops the fleet, locks controls, freezes the schematic; RESET clears it", async ({
    page,
    request,
  }) => {
    await gotoHmi(page, "SCRW-01")
    const schematicGroup = page.locator('svg[role="img"] > g').first()
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)

    await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()

    // The whole panel visibly goes to fault.
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    // `exact: true` — "DỪNG KHẨN CẤP" (the StatusLamp label) is otherwise a substring match against
    // the estop banner's own "ĐANG DỪNG KHẨN CẤP" text (`getByText` substring-matches by default).
    await expect(page.getByText(viDict.hmi.status.estop, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.estop })).toBeDisabled()
    // Schematic root loses its running class — idle/static, not merely paused mid-frame.
    await expect(schematicGroup).not.toHaveClass(/hmi-schematic-run/)
    // A real stop, not a cosmetic one — the engine's own fleet state agrees.
    await expect
      .poll(async () => (await (await request.get(`${process.env.ENGINE_URL ?? "http://localhost:5199"}/v1/fleet`)).json()).isRunning)
      .toBe(false)
    // The fault is logged, bilingual, at ERROR level.
    await expect(page.getByText(viDict.hmi.log.estopEngaged)).toBeVisible()

    const reset = page.getByRole("button", { name: viDict.hmi.controls.reset })
    await expect(reset).toBeVisible()
    await reset.click()

    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
    await expect(reset).toHaveCount(0)
    // RESET clears the latch but does NOT auto-restart the fleet (honest, explicit design) — START is
    // enabled again, PAUSE is not.
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()
    await expect(page.getByText(viDict.hmi.log.estopReset)).toBeVisible()
  })

  test("keyboard: every control is reachable and visibly focused", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    const pause = page.getByRole("button", { name: viDict.hmi.controls.pause })
    await pause.focus()
    await expect(pause).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: viDict.hmi.controls.estop })).toBeFocused()
  })

  const THEMES: Theme[] = ["light", "dark"]
  for (const theme of THEMES) {
    test(`visual — ${theme}`, async ({ page }) => {
      await primeAppStorage(page, { theme })
      await gotoHmi(page, "AOI-01")
      // Live regions (readout numerals, the schematic's plotted points/caption, the scrolling log) are
      // masked — same reasoning `00-visual-and-a11y.spec.ts`'s header comment gives for why inherently
      // live regions get DOM assertions instead of raw pixel comparison elsewhere in this suite: masking
      // is the middle ground for a screen this task brief explicitly wants a screenshot baseline for,
      // keeping the assertion on the STRUCTURAL chrome (nameplate, registration corners, control
      // column, footer bar) that a real regression should actually be caught on.
      await expect(page).toHaveScreenshot(`hmi-aoi-${theme}.png`, {
        mask: [
          page.locator(".hmi-clock"),
          page.locator(".hmi-graph-paper"),
          page.locator(".hmi-readout-grid"),
          page.getByRole("log"),
          page.locator(".hmi-production-progress"),
        ],
      })
    })

    test(`a11y (axe, wcag2a/2aa/21aa) — ${theme}`, async ({ page }) => {
      await primeAppStorage(page, { theme })
      await gotoHmi(page, "AOI-01")
      await assertNoSeriousA11yViolations(page)
    })
  }
})
