import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { setFleetRunning } from "./support/engine"
import { gotoMachineDetail } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Machine Detail happy path across the 3 device classes the fleet roster spans (`fleet.json`):
 * SCRW-01 (Automation → SPC), AOI-01 (AoiAvi → Board), IOT-01 (Iot → Telemetry). Real, populated
 * chart/board data is asserted via DOM/role content rather than a masked pixel snapshot — see
 * `00-visual-and-a11y.spec.ts`'s top comment for why (this screen's charts/log/board are the exact
 * kind of inherently-live region the task brief says to prefer DOM assertions for once masking would
 * leave little of the region actually verified).
 */
test.describe("machine detail", () => {
  test.beforeAll(async ({ request }) => {
    await setFleetRunning(request, true)
  })

  test("Automation machine (SCRW-01): overview + SPC tab render real cycle data", async ({ page }) => {
    await gotoMachineDetail(page, "SCRW-01")

    // Overview tab (default) — driver is deterministic regardless of live cycles.
    await expect(page.getByText(viDict.driverKind.Simulated).first()).toBeVisible()

    // SPC is this class's primary tab — switch to it and wait for real data past the "needs ≥2
    // judged readings" placeholder (SCRW-01 cycles every 0.8s, so this clears quickly once running).
    await page.getByRole("tab", { name: viDict.machineDetail.tabs.spc }).click()
    await expect(page.getByText(viDict.spcChart.waiting)).toHaveCount(0, { timeout: 30_000 })
    // `.first()` — "Trung bình" legitimately appears twice (the summary stat readout AND the chart
    // legend use the same i18n string for two different pieces of UI).
    await expect(page.getByText(viDict.spcChart.mean).first()).toBeVisible()
    await expect(page.locator(".recharts-surface").first()).toBeVisible()

    // Config tab — Task C7's real per-machine config-sync panel. SCRW-01 is Automation (System A,
    // recipe) — the engine auto-resolves SCREWDRIVE-M4 by machine type (`ConfigSyncEngine.CheckAsync`),
    // Pull applies it, and the pull result panel renders a real applied version.
    await page.getByRole("tab", { name: viDict.machineDetail.tabs.config }).click()
    await expect(page.getByRole("button", { name: viDict.configSyncPanel.recipe.pullBtn })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: viDict.configSyncPanel.recipe.pullBtn }).click()
    await expect(page.getByText(viDict.configSyncPanel.pullResult.title)).toBeVisible({ timeout: 10_000 })
    // Recipe machines don't get a push affordance from this panel (server: recipes are human-authored
    // in SYNAPSE) — the honest "not available here" note plus a link to the Demo-only authoring page.
    await expect(page.getByText(viDict.configSyncPanel.recipe.pushUnavailable)).toBeVisible()

    // Log tab — real cycle rows, newest first (header row + at least one data row).
    await page.getByRole("tab", { name: viDict.machineDetail.tabs.log }).click()
    await expect.poll(() => page.getByRole("row").count(), { timeout: 15_000 }).toBeGreaterThan(1)

    await assertNoSeriousA11yViolations(page)
  })

  test("AOI/AVI machine (AOI-01): Board tab renders inspected points", async ({ page }) => {
    await gotoMachineDetail(page, "AOI-01")
    await page.getByRole("tab", { name: viDict.machineDetail.tabs.board }).click()
    await expect(page.getByText(viDict.boardView.waiting)).toHaveCount(0, { timeout: 30_000 })
    // Not `getByRole` — BoardView.tsx's <svg> is `role="img"` for a clean board but `role="group"`
    // once it has real, individually-focusable defect points (BoardView.tsx's own comment explains
    // why); either is correct depending on whether AOI-01 has produced an NG yet, so this matches on
    // the shared aria-label instead of pinning one specific role.
    await expect(page.locator('[aria-label*="Sơ đồ bo mạch"]')).toBeVisible()
    await assertNoSeriousA11yViolations(page)
  })

  test("AOI/AVI machine (AOI-01): Config tab — diff, pull, push (guarded) and sync history render real data", async ({
    page,
  }) => {
    await gotoMachineDetail(page, "AOI-01")
    await page.getByRole("tab", { name: viDict.machineDetail.tabs.config }).click()

    // Products-drift overview (every product the ecosystem knows — an AOI/AVI machine doesn't own a
    // single fixed product, see `ConfigSyncEngine.CheckAsync`'s own doc comment) renders past its
    // skeleton and auto-selects one product into the detail panel below, which fetches a real
    // field-level diff BEFORE anything is applied.
    await expect(page.getByRole("heading", { name: viDict.configSyncPanel.products.title, level: 3 })).toBeVisible({
      timeout: 15_000,
    })
    // Not `getByText` — the panel's own description paragraph contains this same phrase as a
    // substring ("...xem khác biệt trước khi áp dụng..."), which makes a plain text locator ambiguous
    // (strict-mode violation); the diff section's own `<h4>` heading is unambiguous.
    await expect(page.getByRole("heading", { name: viDict.configSyncPanel.diff.title, level: 4 })).toBeVisible({
      timeout: 15_000,
    })

    // Pull applies whatever the ecosystem currently holds for the selected product — idempotent to
    // re-run (a pull on an already-in-sync product still reports `applied: true`, just 0 changes).
    await page.getByRole("button", { name: viDict.configSyncPanel.detail.pullBtn }).click()
    await expect(page.getByText(viDict.configSyncPanel.pullResult.title)).toBeVisible({ timeout: 10_000 })

    // Push opens the guarded confirm dialog — Demo mode by default (no live-server warning) — then,
    // once confirmed, surfaces a real result panel (never a silent no-op).
    await page.getByRole("button", { name: viDict.configSyncPanel.detail.pushBtn }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(viDict.configSyncPanel.pushConfirm.demoNote)).toBeVisible()
    await dialog.getByRole("button", { name: viDict.configSyncPanel.pushConfirm.submit }).click()
    await expect(page.getByText(viDict.configSyncPanel.pushResult.title)).toBeVisible({ timeout: 10_000 })

    // Sync history — the audit trail — gains rows for both operations just performed.
    await expect(page.getByText(viDict.configSyncPanel.history.title)).toBeVisible()
    await expect.poll(() => page.getByRole("row").count(), { timeout: 10_000 }).toBeGreaterThan(1)

    await assertNoSeriousA11yViolations(page)
  })

  test("IoT machine (IOT-01): Telemetry tab renders sensor series, pass rate reads N/A", async ({ page }) => {
    await gotoMachineDetail(page, "IOT-01")

    // IoT devices never carry a judged pass-rate ("MachineState.PassRate excludes Telemetry
    // readings entirely" — see MachineCard.tsx's PassRateRing doc comment) — the Overview tab's
    // "Tỷ lệ đạt" tile reads "—", never a 0%, which would misrepresent a healthy sensor as failing.
    // Located via its label paragraph's sibling (both are plain <p>s with no shared accessible
    // name), not a generic "—" text search — several other dashes can legitimately appear on this
    // page (unsynced config state, etc).
    const passRateValue = page
      .locator("p.text-xs.text-text-muted", { hasText: viDict.machineDetail.overview.passRate })
      .locator("xpath=following-sibling::p[1]")
    await expect(passRateValue).toHaveText("—")

    await page.getByRole("tab", { name: viDict.machineDetail.tabs.telemetry }).click()
    await expect(page.getByText(viDict.telemetryChart.noSamples)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.locator(".recharts-surface").first()).toBeVisible()
    await assertNoSeriousA11yViolations(page)
  })

  test("unknown machine code renders the not-found state, not a crash", async ({ page }) => {
    // Not `gotoMachineDetail` — that helper waits for an <h1> matching the machine CODE, which a
    // 404 response never renders (the not-found card's own heading is a fixed i18n string instead).
    await page.goto("/machines/DOES-NOT-EXIST")
    await expect(page.getByRole("heading", { name: viDict.machineDetail.notFoundState.title })).toBeVisible({
      timeout: 15_000,
    })
  })
})
