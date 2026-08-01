import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoAssets } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * P2-2 (WS-J Asset Registry, `.superpowers/sdd/2026-07-27-giaidoan2-pass2-blueprint/task-2-brief.md`)
 * — `/assets` (`routes/AssetRegistry.tsx`). Runs against the shared demo engine
 * (`ST4I_DEMO_ENABLED=true` — see `playwright.config.ts`), whose `FleetHost` upserts an asset record
 * for every demo machine it starts (`FleetHost.cs`'s own `_assetRegistry?.UpsertAsync(descriptor)`
 * calls) — so the registry is never empty once the fleet has started at least once. The very first
 * spec to touch `/v1/fleet/start` in this numbered suite is `01-dashboard.spec.ts`; running this file
 * (and the whole suite) in the fixed numeric order `playwright.config.ts` documents is what makes that
 * precondition reliable without this spec re-deriving it itself.
 *
 * Kept intentionally minimal per the task brief ("Playwright is best-effort... keep it minimal and
 * deterministic") — asserts the route renders the table with real rows, that a row opens the detail
 * dialog with the transition control (the shared demo engine signs a real `demo-admin`, `Roles.Admin`,
 * in — Admin passes this screen's Engineer+ gate same as Engineer would), and the usual English-gloss
 * no-leaked-key check every other screen's own spec ends on.
 */

test.describe("assets — asset registry list + detail", () => {
  test("the table renders real registered assets and a row opens the detail dialog", async ({ page }) => {
    await gotoAssets(page)

    const firstRow = page.locator("tbody tr").first()
    await expect(firstRow).toBeVisible()

    await firstRow.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // `exact: true` — Playwright's default text matching is a case-insensitive substring, and the
    // "URN" label would otherwise also match the URN VALUE itself (`urn:isa95:...`) just below it.
    await expect(dialog.getByText(viDict.assets.detail.urn, { exact: true })).toBeVisible()

    // demo-admin (Roles.Admin) satisfies this screen's Engineer+ transition gate, so the Select +
    // Save control is present (not the "requires Engineer" fallback note).
    await expect(dialog.getByRole("button", { name: viDict.assets.detail.save })).toBeVisible()

    await dialog.getByRole("button", { name: "Close" }).click()
    await expect(dialog).not.toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/assets")
    await expect(page.getByRole("heading", { name: en.assets.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.assets.table.code })).toBeVisible()

    await expect(page.getByText(/assets\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
