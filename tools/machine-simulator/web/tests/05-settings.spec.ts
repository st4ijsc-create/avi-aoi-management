import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { SERVER_BOUNDED_OP_MS } from "./support/deadlines"
import { resetSettingsLanguage } from "./support/engine"
import { gotoSettings } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/** Settings happy path: dirty-tracking + Save round-trips through the real `PUT /v1/settings`, the
 * language selector flips the WHOLE app's live UI language immediately (not gated behind Save), and
 * the connectivity probe reports both a reachable and an unreachable target correctly. */
test.describe("settings", () => {
  test("editing the server URL enables Save; saving persists and clears the dirty flag", async ({ page }) => {
    await gotoSettings(page)

    const urlField = page.locator("#settings-server-url")
    const original = await urlField.inputValue()
    const saveButton = page.getByRole("button", { name: viDict.settings.save })

    await expect(page.getByText(viDict.settings.clean)).toBeVisible()
    await expect(saveButton).toBeDisabled()

    await urlField.fill("http://localhost:5099")
    await expect(page.getByText(viDict.settings.dirty)).toBeVisible()
    await expect(saveButton).toBeEnabled()

    await saveButton.click()
    await expect(page.getByText(viDict.toast.settingsSaved)).toBeVisible()
    await expect(page.getByText(viDict.settings.clean)).toBeVisible()
    await expect(saveButton).toBeDisabled()
    await expect(urlField).toHaveValue("http://localhost:5099")

    // Restore — keeps this spec independently re-runnable and leaves no stray state for anything
    // that reads `/v1/settings` afterward.
    await urlField.fill(original)
    await saveButton.click()
    await expect(page.getByText(viDict.settings.clean)).toBeVisible()
  })

  test("connection probe reports a reachable target and an unreachable one", async ({ page }) => {
    await gotoSettings(page)
    const urlField = page.locator("#settings-server-url")
    const checkButton = page.getByRole("button", { name: viDict.settings.connection.check })

    // Reachable: the engine's own HTTP listener answers something (its `/api/v1/openapi.json` route
    // doesn't exist, but ResilienceProbe.ProbeAsync counts ANY HTTP response as reachable, by design
    // — a 404 still proves the socket/TLS/DNS layer works, which is the actual thing being checked).
    await urlField.fill("http://localhost:5199")
    await checkButton.click()
    await expect(page.getByText(/Kết nối được/)).toBeVisible({ timeout: SERVER_BOUNDED_OP_MS })

    // Unreachable: nothing listens on this port — a fast connection-refused, not the 5s timeout path.
    await urlField.fill("http://127.0.0.1:1")
    await checkButton.click()
    await expect(page.getByText(viDict.settings.connection.unreachable)).toBeVisible({ timeout: SERVER_BOUNDED_OP_MS })
  })

  test("language selector flips the whole app's live UI language immediately, without Save", async ({ page }) => {
    await gotoSettings(page)

    await expect(page.getByRole("heading", { name: viDict.settings.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: viDict.shell.nav.dashboard })).toBeVisible()

    await page.getByLabel(viDict.settings.language.label).click()
    await page.getByRole("option", { name: en.settings.language.en }).click()

    // Global effect (not scoped to this screen) — the sidebar nav label changes too.
    await expect(page.getByRole("heading", { name: en.settings.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: en.shell.nav.dashboard })).toBeVisible()
    await expect(page.getByRole("button", { name: en.settings.save })).toBeVisible()

    await assertNoSeriousA11yViolations(page)

    // Switch back — a fresh page/context on the next test would default to vi anyway, but this keeps
    // mid-test state readable if this test is ever extended.
    await page.getByLabel(en.settings.language.label).click()
    await page.getByRole("option", { name: viDict.settings.language.vi }).click()
    await expect(page.getByRole("heading", { name: viDict.settings.title, level: 1 })).toBeVisible()
  })

  test.afterAll(async ({ request }) => {
    await resetSettingsLanguage(request)
  })
})
