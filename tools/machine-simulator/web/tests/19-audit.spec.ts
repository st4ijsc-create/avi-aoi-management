import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { applyScenarioPreset } from "./support/engine"
import { gotoAudit } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-D-D8 (.superpowers/sdd/2026-07-26-ws-d-local-security-blueprint/task-8-brief.md) — `/audit`
 * (Admin-only hash-chained audit log viewer, `routes/Audit.tsx`). Runs against the shared demo engine
 * (`ST4I_DEMO_ENABLED=true` — see `playwright.config.ts`), whose `DemoAutoLoginMiddleware` signs a real
 * `demo-admin` (`Roles.Admin`) in on the very first request — same zero-manual-login precondition every
 * other spec in this suite relies on (see `17-auth.spec.ts`'s own top comment).
 *
 * `GET /v1/audit`'s `actor`/`action`/`target` filters are EXACT-match server-side
 * (`SqliteAuditStore.QueryAsync`), so the "known mutation" test below applies a real, audited action
 * directly against the engine (`POST /v1/scenario/preset` — the exact call `06-scenario.spec.ts`'s own
 * preset buttons make) BEFORE navigating, then filters the table down to that one action + the
 * demo-admin actor who performed it — the same "establish your own precondition via a direct API call,
 * don't depend on what an earlier spec left behind" idiom `15-historian.spec.ts` already uses.
 * `ScenarioEndpoints.cs` `await`s `AuditRecorder.RecordAsync` before returning the HTTP response, so the
 * audit row is durably on file by the time this test's own `POST` call resolves — no polling/retry
 * needed before the very next `/v1/audit` read.
 */

test.describe("audit — admin hash-chained audit log viewer", () => {
  test("a known mutation (scenario preset apply) shows a matching row once filtered by actor+action", async ({ page, request }) => {
    await applyScenarioPreset(request, "normal")

    await gotoAudit(page)

    await page.getByLabel(viDict.audit.filters.action).fill("scenario.preset")
    await page.getByLabel(viDict.audit.filters.actor).fill("demo-admin")

    // Past the loading skeleton — a real filtered row rendered once `useAudit(filter)` resolved.
    await expect(page.locator("tbody tr").first()).toBeVisible()

    const actionCells = page.locator("tbody tr td:nth-child(4)")
    const count = await actionCells.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(actionCells.nth(i)).toHaveText("scenario.preset")
    }

    const actorCells = page.locator("tbody tr td:nth-child(3)")
    for (let i = 0; i < count; i++) {
      await expect(actorCells.nth(i)).toContainText("demo-admin")
    }

    await expect(page.getByRole("button", { name: viDict.audit.filters.clear })).toBeVisible()
    await page.getByRole("button", { name: viDict.audit.filters.clear }).click()
    await expect(page.getByRole("button", { name: viDict.audit.filters.clear })).toHaveCount(0)
    await expect(page.locator("tbody tr").first()).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("View detail opens a dialog with the change's full JSON new-value; Close dismisses it", async ({ page, request }) => {
    await applyScenarioPreset(request, "normal")

    await gotoAudit(page)
    await page.getByLabel(viDict.audit.filters.action).fill("scenario.preset")

    const firstRow = page.locator("tbody tr").first()
    await expect(firstRow).toBeVisible()

    // "scenario.preset" always records a non-null new value (`ScenarioEndpoints.cs`'s own
    // `RecordAsync(..., null, new { scenario = applied, hotFolderStatus }, ...)`) — the "view detail"
    // button is only rendered when at least one of old/new is present, so it's always there for this row.
    await firstRow.getByRole("button", { name: viDict.audit.table.viewDetail }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(viDict.audit.detailDialog.newValue)).toBeVisible()
    // The applied preset's own name shows up somewhere inside the pretty-printed JSON new value.
    await expect(dialog.getByText(/"activePreset"/)).toBeVisible()

    // `dialog.tsx`'s built-in close button carries a hardcoded, unlocalized "Close" accessible name,
    // same as every other dialog in this app (`15-historian.spec.ts`'s own genealogy-dialog test).
    await dialog.getByRole("button", { name: "Close" }).click()
    await expect(dialog).not.toBeVisible()
  })

  test("Verify chain integrity shows the green 'chain intact' banner", async ({ page }) => {
    await gotoAudit(page)

    await page.getByRole("button", { name: viDict.audit.verify.button }).click()

    const banner = page.getByRole("status")
    await expect(banner).toBeVisible()
    // "Chuỗi còn nguyên vẹn" — the `audit.verify.intact` string's own fixed prefix, before the
    // interpolated entry count (kept a substring match so this doesn't churn if the exact count does).
    await expect(banner).toContainText("Chuỗi còn nguyên vẹn")
    // Never the broken-chain banner's own role/wording on a healthy shared engine.
    await expect(page.getByRole("alert").filter({ hasText: "Chuỗi bị đứt" })).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    // Primed via localStorage before first paint — same technique 15-historian.spec.ts's own language
    // test uses. Deliberately NOT `gotoAudit` (that helper waits on the Vietnamese heading specifically).
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/audit")
    await expect(page.getByRole("heading", { name: en.audit.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.audit.table.seq })).toBeVisible()
    await expect(page.getByRole("button", { name: en.audit.verify.button })).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string (e.g. "audit.table.seq") — this regex is
    // deliberately generic so it would catch a typo in ANY key on this screen.
    await expect(page.getByText(/audit\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
