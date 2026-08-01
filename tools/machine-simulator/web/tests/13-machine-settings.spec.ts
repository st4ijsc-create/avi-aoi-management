import { expect, test, type Locator, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { pullMachineConfig, resetEstop, resetMachineSetting, setFleetRunning } from "./support/engine"
import { gotoHmi, gotoMachineDetailSettings } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/** Same idiom `09-points-editor.spec.ts` already established for the `Select` primitive (a
 * `role="combobox"` trigger button, not a native `<select>` — Playwright's `selectOption()` only
 * works on the latter). */
async function chooseSelectOption(page: Page, comboboxName: string, optionLabel: string): Promise<void> {
  await page.getByRole("combobox", { name: comboboxName }).click()
  await page.getByRole("option", { name: optionLabel }).click()
}

/** `MachineSettingsPanel.tsx`'s `ParameterRow` carries `data-machine-setting-row={key}` on its root —
 * scopes every assertion below to ONE parameter's row instead of matching text against the whole
 * table (several parameters share values like "0" or a common unit). */
function settingRow(page: Page, key: string): Locator {
  return page.locator(`[data-machine-setting-row="${key}"]`)
}

/**
 * Task 4/5 (docs/plans/2026-07-21-machine-config.md) — the machine operating-configuration feature:
 * the HMI's CÀI ĐẶT/SETTINGS tab (`TabRail.tsx`/`SettingsTab.tsx`) and the machine detail screen's own
 * settings tab (`MachineSettingsPanel.tsx`, shared by both). Design doc: server baseline is a
 * recommendation; the machine's own adjustment (scoped to the machine, or to one machine×product pair)
 * is what actually runs, with an honest provenance indicator on every row.
 */
test.describe("Machine settings — HMI tab + machine detail panel", () => {
  test.beforeEach(async ({ request }) => {
    await resetEstop(request)
    await setFleetRunning(request, true)
    await pullMachineConfig(request, "AOI-01", "MODEL-A")
    // Defensive — undo any adjustment a PREVIOUS failed run of this file's own tests left behind, so
    // every test here starts from a known pristine baseline regardless of run order/failures.
    await resetMachineSetting(request, "SCRW-01", "torqueTolerance", "machine")
    await resetMachineSetting(request, "AOI-01", "gain", "machine")
    await resetMachineSetting(request, "AOI-01", "matchThreshold", "product", "MODEL-A")
  })
  test.afterEach(async ({ request }) => {
    await resetMachineSetting(request, "SCRW-01", "torqueTolerance", "machine")
    await resetMachineSetting(request, "AOI-01", "gain", "machine")
    await resetMachineSetting(request, "AOI-01", "matchThreshold", "product", "MODEL-A")
    await resetEstop(request)
    await setFleetRunning(request, true)
  })

  test("tab rail: two tabs, arrow-key navigation moves both focus and selection", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    const operationTab = page.getByRole("tab", { name: viDict.hmi.tabs.operation })
    const settingsTab = page.getByRole("tab", { name: viDict.hmi.tabs.settings })

    await expect(operationTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: viDict.hmi.tabs.operation })).toBeVisible()

    await operationTab.focus()
    await page.keyboard.press("ArrowRight")
    await expect(settingsTab).toBeFocused()
    await expect(settingsTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: viDict.hmi.tabs.settings })).toBeVisible()

    await page.keyboard.press("ArrowLeft")
    await expect(operationTab).toBeFocused()
    await expect(operationTab).toHaveAttribute("aria-selected", "true")

    // Home/End jump to the first/last tab regardless of current position.
    await page.keyboard.press("End")
    await expect(settingsTab).toBeFocused()
    await page.keyboard.press("Home")
    await expect(operationTab).toBeFocused()
  })

  test("settings tab: SCRW-01 shows screw_program parameters — label, effective value, range, recommendation, provenance", async ({
    page,
  }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()

    const row = settingRow(page, "torqueTolerance")
    await expect(row).toBeVisible()
    await expect(row).toContainText("Dung sai mô-men")
    await expect(row).toContainText("0.15")
    await expect(row).toContainText("0.00–5.00 Nm")
    await expect(row).toContainText(viDict.machineSettings.provenance.baseline)
    // Nothing adjusted yet — reset is a no-op action and stays disabled.
    await expect(row.getByRole("button", { name: /Đặt lại/ })).toBeDisabled()
  })

  test("settings tab: AOI-01 shows the aoi_inspection parameters (new vocabulary, no server equivalent)", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
    for (const key of ["exposureUs", "gain", "lightIntensity", "conveyorSpeed", "fiducialTolerance", "matchThreshold"]) {
      await expect(settingRow(page, key)).toBeVisible()
    }
  })

  test("out-of-range value is blocked at the field, stating the allowed range — never silently clamped", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
    await settingRow(page, "torqueTolerance")
      .getByRole("button", { name: /^Sửa/ })
      .click()

    const input = page.getByRole("spinbutton", { name: viDict.machineSettings.editDialog.valueLabel })
    await input.fill("999")

    const error = page.getByRole("alert")
    await expect(error).toContainText("0.00")
    await expect(error).toContainText("5.00")
    await expect(error).toContainText("999")
    await expect(page.getByRole("button", { name: viDict.machineSettings.editDialog.save })).toBeDisabled()

    // Cancel — an out-of-range draft must never reach the server.
    await page.getByRole("button", { name: viDict.machineSettings.editDialog.cancel }).click()
    await expect(settingRow(page, "torqueTolerance")).toContainText(viDict.machineSettings.provenance.baseline)
  })

  test("edit (machine scope) then reset to default: provenance flips machine→baseline, effective value follows", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
    const row = settingRow(page, "torqueTolerance")

    await row.getByRole("button", { name: /^Sửa/ }).click()
    await page.getByRole("spinbutton", { name: viDict.machineSettings.editDialog.valueLabel }).fill("0.02")
    await page.getByRole("button", { name: viDict.machineSettings.editDialog.save }).click()

    await expect(row).toContainText(viDict.machineSettings.provenance.machine)
    await expect(row).toContainText("0.02")
    await expect(row.getByRole("button", { name: /Đặt lại/ })).toBeEnabled()

    await row.getByRole("button", { name: /Đặt lại/ }).click()
    await expect(row).toContainText(viDict.machineSettings.provenance.baseline)
    await expect(row).toContainText("0.15")
    await expect(row.getByRole("button", { name: /Đặt lại/ })).toBeDisabled()
  })

  test("end-to-end: tightening torqueTolerance visibly raises the NG rate on the Operation tab; resetting brings it back", async ({
    page,
    request,
  }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
    await settingRow(page, "torqueTolerance")
      .getByRole("button", { name: /^Sửa/ })
      .click()
    await page.getByRole("spinbutton", { name: viDict.machineSettings.editDialog.valueLabel }).fill("0.02")
    await page.getByRole("button", { name: viDict.machineSettings.editDialog.save }).click()
    await expect(settingRow(page, "torqueTolerance")).toContainText(viDict.machineSettings.provenance.machine)

    // Poll the LIVE fleet's own cycle log (not the UI) so this assertion is about the simulated
    // BEHAVIOUR (Task 3's own contract), not a UI-rendering nuance — the UI's own NG count is proven
    // separately by the machine-detail/HMI screenshots taken during manual verification.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${process.env.ENGINE_URL ?? "http://localhost:5199"}/v1/machines/SCRW-01`)
          const body = (await res.json()) as { cycleLog: { verdict: string }[] }
          const recent = body.cycleLog.slice(-20)
          return recent.length > 0 ? recent.filter((r) => r.verdict === "Fail").length / recent.length : 0
        },
        { timeout: 20_000, intervals: [1000] }
      )
      .toBeGreaterThan(0.15)

    await settingRow(page, "torqueTolerance")
      .getByRole("button", { name: /Đặt lại/ })
      .click()
    await expect(settingRow(page, "torqueTolerance")).toContainText(viDict.machineSettings.provenance.baseline)

    await expect
      .poll(
        async () => {
          const res = await request.get(`${process.env.ENGINE_URL ?? "http://localhost:5199"}/v1/machines/SCRW-01`)
          const body = (await res.json()) as { cycleLog: { verdict: string }[] }
          const recent = body.cycleLog.slice(-15)
          return recent.length >= 15 ? recent.filter((r) => r.verdict === "Fail").length / recent.length : 1
        },
        { timeout: 20_000, intervals: [1000] }
      )
      .toBeLessThan(0.15)
  })

  test("IoT machine hides the product dimension entirely — no selector, no scope choice when editing", async ({ page }) => {
    await gotoHmi(page, "IOT-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()

    await expect(page.getByRole("combobox", { name: viDict.machineSettings.productSelectAria })).toHaveCount(0)
    await expect(page.getByText(viDict.machineSettings.iotHint)).toBeVisible()

    await settingRow(page, "sampleRateHz")
      .getByRole("button", { name: /^Sửa/ })
      .click()
    await expect(page.getByRole("group", { name: viDict.machineSettings.editDialog.scopeLabel })).toHaveCount(0)
  })

  test("scope semantics: a machine-scoped change applies to every product; a product-scoped change applies only to the one it was set on", async ({
    page,
  }) => {
    await gotoHmi(page, "AOI-01")
    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()

    // Machine scope (the default radio) on `gain`.
    await settingRow(page, "gain")
      .getByRole("button", { name: /^Sửa/ })
      .click()
    await page.getByRole("spinbutton", { name: viDict.machineSettings.editDialog.valueLabel }).fill("3.5")
    await page.getByRole("button", { name: viDict.machineSettings.editDialog.save }).click()
    await expect(settingRow(page, "gain")).toContainText(viDict.machineSettings.provenance.machine)

    // Product scope on `matchThreshold`, explicitly for MODEL-A (the pre-selected product).
    await settingRow(page, "matchThreshold")
      .getByRole("button", { name: /^Sửa/ })
      .click()
    await page.getByRole("radio", { name: /Chỉ sản phẩm đang chọn/ }).click()
    await page.getByRole("spinbutton", { name: viDict.machineSettings.editDialog.valueLabel }).fill("0.60")
    await page.getByRole("button", { name: viDict.machineSettings.editDialog.save }).click()
    await expect(settingRow(page, "matchThreshold")).toContainText(viDict.machineSettings.provenance.machineProduct)
    await expect(settingRow(page, "matchThreshold")).toContainText("0.60")

    await chooseSelectOption(page, viDict.machineSettings.productSelectAria, "MODEL-B")

    // Machine-scoped `gain` carries over to MODEL-B...
    await expect(settingRow(page, "gain")).toContainText("3.5")
    await expect(settingRow(page, "gain")).toContainText(viDict.machineSettings.provenance.machine)
    // ...but the product-scoped `matchThreshold` (set for MODEL-A only) does NOT — MODEL-B still sees
    // the plain recommendation.
    await expect(settingRow(page, "matchThreshold")).toContainText("0.85")
    await expect(settingRow(page, "matchThreshold")).toContainText(viDict.machineSettings.provenance.baseline)
  })

  test("safety rail holds on the settings tab: control rail never scrolls, HALT position identical to the operation tab, even latched", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await gotoHmi(page, "SCRW-01")

    const measure = () =>
      page.evaluate(() => {
        // M-5 (mc-feature-review.md) — was `document.querySelectorAll(".hmi-scroll")[1]` (positional):
        // `MachineSettingsPanel` renders its OWN `.hmi-scroll` on the Settings tab, so index [1] could
        // point at a different element than intended depending on the active tab. `data-testid`
        // (ControlColumn.tsx) selects the control rail directly, regardless of how many other
        // `.hmi-scroll` regions exist on the page.
        const controlRail = document.querySelector('[data-testid="control-rail"]')!
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("HALT"))
        const r = btn?.getBoundingClientRect()
        return {
          scrollHeight: controlRail.scrollHeight,
          clientHeight: controlRail.clientHeight,
          estopRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        }
      })

    const operationState = await measure()
    expect(operationState.scrollHeight, "control rail scrollHeight on the Operation tab").toBeLessThanOrEqual(
      operationState.clientHeight
    )

    await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
    // Wait for the settings QUERY to actually resolve before measuring — until then the panel renders
    // a skeleton with no `.hmi-scroll` wrapper of its own, which shifts `document.querySelectorAll(
    // ".hmi-scroll")[1]` off the control rail and onto the system log instead (a real flake this test
    // itself hit once: the log's own scrollHeight, swollen by a shared engine's accumulated history,
    // read back as a false "980px overflow" that had nothing to do with the control rail at all).
    await expect(settingRow(page, "torqueTolerance")).toBeVisible()
    const settingsState = await measure()
    expect(settingsState.scrollHeight, "control rail scrollHeight on the Settings tab").toBeLessThanOrEqual(
      settingsState.clientHeight
    )
    // The whole point of the safety invariant — switching tabs must not move HALT by a single pixel.
    expect(settingsState.estopRect, "HALT rect: Settings tab vs Operation tab").toEqual(operationState.estopRect)

    // Latch HALT WHILE on the settings tab — banner + RESET both present, the tallest the rail ever
    // gets (spec §8.3) — must still not scroll or move, on this tab too.
    // Scoped to the physical-controls panel itself — "ĐẶT LẠI" (RESET's own accessible name is
    // "ĐẶT LẠI RESET", the label + its own English gloss) is otherwise a substring match against
    // every per-parameter "Đặt lại {key} về khuyến nghị" reset button this same settings table renders.
    const controlsPanel = page.locator(".sheet", { has: page.getByRole("heading", { name: viDict.hmi.controls.title }) })
    await controlsPanel.getByRole("button", { name: viDict.hmi.controls.estop }).click()
    const resetBtn = controlsPanel.getByRole("button", { name: viDict.hmi.controls.reset })
    await expect(resetBtn).toBeVisible()
    const latchedState = await measure()
    expect(latchedState.scrollHeight, "control rail scrollHeight while latched, on the Settings tab").toBeLessThanOrEqual(
      latchedState.clientHeight
    )
    expect(latchedState.estopRect, "HALT rect: latched vs unlatched, on the Settings tab").toEqual(settingsState.estopRect)

    const pageScrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)
    expect(pageScrolls, "page scrolls while HALT is latched, on the Settings tab").toBe(false)

    await resetBtn.click()
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
  })

  test("machine detail panel: same data source as the HMI tab", async ({ page }) => {
    await gotoMachineDetailSettings(page, "SCRW-01")
    const row = settingRow(page, "torqueTarget")
    await expect(row).toContainText("1.35")
    await expect(row).toContainText(viDict.machineSettings.provenance.baseline)
  })

  // WS1 — no pixel-baseline cost here (axe only), so run all 3 real themes rather than pinning to
  // Glass, same reasoning as `12-hmi-safety-rail.spec.ts`'s own THEMES.
  const THEMES: Theme[] = ["glass", "console", "warmth"]
  for (const theme of THEMES) {
    test(`a11y (axe, wcag2a/2aa/21aa) — HMI settings tab — ${theme}`, async ({ page }) => {
      await primeAppStorage(page, { theme })
      await gotoHmi(page, "SCRW-01")
      await page.getByRole("tab", { name: viDict.hmi.tabs.settings }).click()
      await expect(page.getByRole("tabpanel", { name: viDict.hmi.tabs.settings })).toBeVisible()
      await assertNoSeriousA11yViolations(page)
    })

    test(`a11y (axe, wcag2a/2aa/21aa) — HMI operation tab with tab rail present — ${theme}`, async ({ page }) => {
      await primeAppStorage(page, { theme })
      await gotoHmi(page, "SCRW-01")
      await assertNoSeriousA11yViolations(page)
    })

    test(`a11y (axe, wcag2a/2aa/21aa) — machine detail settings panel — ${theme}`, async ({ page }) => {
      await primeAppStorage(page, { theme })
      await gotoMachineDetailSettings(page, "SCRW-01")
      await assertNoSeriousA11yViolations(page)
    })
  }
})
