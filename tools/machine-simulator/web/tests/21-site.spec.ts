import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoSite } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * GĐ3 EC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-ecosystem-connect-blueprint/task-4-brief.md`) —
 * `/site` (`routes/Site.tsx`), the web page over EC-3's `/v1/site*` endpoints. Runs against the shared
 * demo engine (`ST4I_DEMO_ENABLED=true` — see `playwright.config.ts`), which leaves `ST4I_UNS_ENABLED`
 * at its own default (unset → `true`, `UnsOptions.FromEnvironment`), so `SiteBridgeManager` IS
 * registered and `GET /v1/site` returns a real (not the `mgr is null` "disabled" fallback) status —
 * `bridgeState: "Disabled"` since no Site link is configured for the demo profile.
 *
 * Kept intentionally minimal, same "best-effort, minimal and deterministic" brief `20-assets.spec.ts`
 * already documents — asserts the device fingerprint renders (real data, not a loading skeleton), the
 * bridge-status badge renders, and the shared demo engine's `demo-admin` (`Roles.Admin`) sees the
 * Engineer-gated Save control (Admin satisfies this screen's Engineer+ gate same as Engineer would,
 * same reasoning `20-assets.spec.ts`'s own comment gives for its lifecycle-transition control), plus
 * the usual English-gloss no-leaked-key check every other screen's own spec ends on.
 */

test.describe("site — device identity + Site-link form + bridge status", () => {
  test("device identity, bridge status badge, and the Engineer-gated Site-link form all render", async ({
    page,
  }) => {
    await gotoSite(page)

    // Real fingerprint value from `useSiteIdentity()`, not a placeholder/skeleton.
    await expect(page.locator("#site-device-fingerprint")).toHaveValue(/\S/)

    // The bridge-status badge — `bridgeState: "Disabled"` for a fresh demo profile with no Site link.
    await expect(page.getByText(viDict.site.status.Disabled, { exact: true })).toBeVisible({ timeout: 15_000 })

    // demo-admin (Roles.Admin) satisfies this screen's Engineer+ Site-link gate, so the form + Save
    // control render (not the read-only host/port/enabled summary).
    await expect(page.getByLabel(viDict.site.form.hostLabel)).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.site.form.save })).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/site")
    await expect(page.getByRole("heading", { name: en.site.title, level: 1 })).toBeVisible()
    await expect(page.locator("#site-device-fingerprint")).toHaveValue(/\S/, { timeout: 15_000 })

    await expect(page.getByText(/site\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
