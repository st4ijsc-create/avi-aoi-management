import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { resetScenarioToNormal } from "./support/engine"
import { gotoScenario } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/** Scenario happy path: applying a demo preset really mutates the running fleet's live config
 * (`POST /v1/scenario/preset`), reflected back into this screen's sliders/active-preset badge, and
 * Burst really spikes the cycle rate. */
test.describe("scenario", () => {
  test.beforeEach(async ({ request }) => {
    await resetScenarioToNormal(request)
  })

  test.afterEach(async ({ request }) => {
    await resetScenarioToNormal(request)
  })

  test("applying the high-defect preset updates the active card + sliders; Burst spikes the rate", async ({
    page,
  }) => {
    await gotoScenario(page)

    const normalCard = page.getByRole("button", { name: /Ca bình thường/ })
    const highDefectCard = page.getByRole("button", { name: /Lô lỗi cao/ })
    await expect(normalCard).toHaveAttribute("aria-pressed", "true")

    await highDefectCard.click()
    await expect(page.getByText(viDict.toast.scenarioPresetApplied({ name: viDict.scenario.presets.highDefect.label }))).toBeVisible()
    await expect(highDefectCard).toHaveAttribute("aria-pressed", "true")
    await expect(normalCard).toHaveAttribute("aria-pressed", "false")
    // ScenarioConfig for "high-defect" sets defectRate=0.35 — real value round-tripped from the
    // engine, rendered via formatPercent (`Math.round(n * 100)}%`, no space — distinct from the
    // current-state status line's "defect=35 %" (space before the sign), so this stays unambiguous.
    await expect(page.getByText("35%", { exact: true })).toBeVisible()

    await assertNoSeriousA11yViolations(page)

    // Burst: 6x cycle-rate spike, auto-reverts ~4s later (not asserted here — this only checks the
    // immediate, real effect of the click).
    await page.getByRole("button", { name: viDict.scenario.burst }).click()
    await expect(page.getByText(viDict.toast.scenarioBurstApplied)).toBeVisible()
    // `exact: true` — the current-state status line ("burst — cycleRate=6.00x, …") contains this
    // same substring.
    await expect(page.getByText("6.00x", { exact: true })).toBeVisible()
    // `activePreset` badge — a raw server-side token, intentionally not translated (Scenario.tsx).
    await expect(page.getByText("burst", { exact: true })).toBeVisible()
  })
})
