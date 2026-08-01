import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoAlarmCenter } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * GĐ3 sub-4 LC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/
 * task-4-brief.md`) — `/alarms` (`routes/AlarmCenter.tsx`), the operator UI over LC-1/2's ISA-18.2
 * alarm backbone. Runs against the shared demo engine (`ST4I_DEMO_ENABLED=true` — see
 * `playwright.config.ts`).
 *
 * The brief's own expectation is "empty state in the demo env — no alarms unless a DENY happened", but
 * a REAL run against this repo's shared/reused engine process (`webServer`'s `reuseExistingServer:
 * !process.env.CI`, same statefulness `00-visual-and-a11y.spec.ts`'s own WS3-T3 doc comment describes
 * for `FleetHost`) surfaced a genuine carried-over alarm: a `SAFETY_BLOCKED` Critical Policy alarm from
 * an earlier session's HALT-engaged Start attempt was still active. So this spec asserts on WHICHEVER
 * of the two states is actually true (past the loading skeleton either way) rather than assuming a
 * pristine engine — the same "establish what you can actually prove, don't assume an ordering/history
 * you don't control" discipline that file's own fix already applies.
 *
 * Kept intentionally minimal per the brief ("Playwright best-effort... keep it minimal and
 * deterministic") — asserts the Active/History tab toggle renders and each tab is past its loading
 * skeleton (empty OR populated, either is a valid pass), plus the usual English-gloss no-leaked-key
 * check every other screen's own spec ends on.
 */

test.describe("alarms — alarm center active table + history", () => {
  test("the Active and History tabs both render past their loading skeleton", async ({ page }) => {
    await gotoAlarmCenter(page)

    // Either genuinely no active alarms (the calm empty state) or a real carried-over one (at least
    // one table row) — either is a legitimate "loaded" state, never a stuck skeleton.
    await expect(page.getByText(viDict.alarms.table.empty).or(page.locator("tbody tr").first())).toBeVisible()

    await page.getByRole("radio", { name: viDict.alarms.tabs.history }).click()
    await expect(
      page.getByText(viDict.alarms.history.table.empty).or(page.locator("tbody tr").first())
    ).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/alarms")
    await expect(page.getByRole("heading", { name: en.alarms.title, level: 1 })).toBeVisible()
    await expect(page.getByText(en.alarms.table.empty).or(page.locator("tbody tr").first())).toBeVisible()

    await expect(page.getByText(/alarms\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
