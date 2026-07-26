import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL, setFleetRunning } from "./support/engine"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Task 12 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/historian`, the durable
 * per-cycle result log browse/filter/genealogy/export screen. Unlike `useFleet`/`useMachine`,
 * `useHistorianResults` deliberately does NOT poll (a browse screen over already-settled history,
 * not a live tick) — every test below establishes its OWN precondition ("the historian already has
 * real rows on file") via a direct API wait BEFORE navigating, the same "don't depend on what an
 * earlier spec file happened to leave behind" idiom `tests/support/engine.ts`'s other helpers already
 * use, rather than trusting the shared, process-lifetime engine's accumulated state from whichever
 * specs ran before this one.
 */

async function waitForHistorianRows(request: APIRequestContext, minRows = 5): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${ENGINE_URL}/v1/historian/results?limit=1`)
        if (!res.ok()) return -1
        const body = (await res.json()) as { total: number }
        return body.total
      },
      { timeout: 30_000, message: "waiting for the historian to record real cycle rows" }
    )
    .toBeGreaterThanOrEqual(minRows)
}

async function gotoHistorian(page: Page): Promise<void> {
  await page.goto("/historian")
  await expect(page.getByRole("heading", { name: viDict.historian.title, level: 1 })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: viDict.historian.table.serial })).toBeVisible()
  // Past the loading skeleton — a real row rendered once `useHistorianResults` resolved.
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
}

/** Same idiom `13-machine-settings.spec.ts` already established for the Base UI `Select` primitive
 * (a `role="combobox"` trigger button, not a native `<select>` — Playwright's `selectOption()` only
 * works on the latter). */
async function chooseSelectOption(page: Page, comboboxName: string, optionLabel: string): Promise<void> {
  await page.getByRole("combobox", { name: comboboxName }).click()
  await page.getByRole("option", { name: optionLabel }).click()
}

test.describe("historian — browse, filter, genealogy dialog, CSV export", () => {
  test.beforeEach(async ({ request }) => {
    // Defensive — makes this spec independently re-runnable regardless of what an earlier spec left
    // the shared engine in (same rationale as 01-dashboard.spec.ts's/07-machines.spec.ts's own
    // beforeEach), and gives the historian fresh rows to record if none exist yet.
    await setFleetRunning(request, true)
    await waitForHistorianRows(request)
  })

  test("lists real historian rows; the machine filter narrows to one machine; Clear filters resets", async ({ page }) => {
    await gotoHistorian(page)

    const initialRows = await page.locator("tbody tr").count()
    expect(initialRows).toBeGreaterThan(0)

    // A real machine code straight off the first rendered row (2nd column) — robust regardless of
    // which machine happened to cycle first in this run.
    const machineCode = ((await page.locator("tbody tr").first().locator("td").nth(1).textContent()) ?? "").trim()
    expect(machineCode.length).toBeGreaterThan(0)

    await chooseSelectOption(page, viDict.historian.filters.machine, machineCode)
    await expect(page.getByRole("button", { name: viDict.historian.filters.clear })).toBeVisible()

    const machineCells = page.locator("tbody tr td:nth-child(2)")
    const narrowedCount = await machineCells.count()
    expect(narrowedCount).toBeGreaterThan(0)
    for (let i = 0; i < narrowedCount; i++) {
      await expect(machineCells.nth(i)).toHaveText(machineCode)
    }

    await page.getByRole("button", { name: viDict.historian.filters.clear }).click()
    await expect(page.getByRole("button", { name: viDict.historian.filters.clear })).toHaveCount(0)
    await expect(page.locator("tbody tr").first()).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("the verdict filter narrows every visible row to that verdict", async ({ page }) => {
    await gotoHistorian(page)

    // "Đạt" (Pass) — overwhelmingly the most common verdict at the default scenario's low defect
    // rate, so it's realistic to expect at least one row already carries it.
    await chooseSelectOption(page, viDict.historian.filters.verdict, viDict.cycleLogTable.verdict.pass)

    const verdictCells = page.locator("tbody tr td:nth-child(4)")
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    const count = await verdictCells.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(verdictCells.nth(i)).toContainText(viDict.cycleLogTable.verdict.pass)
    }
  })

  test("View genealogy opens a dialog listing this serial's own row, and Close dismisses it", async ({ page }) => {
    await gotoHistorian(page)

    const firstRow = page.locator("tbody tr").first()
    const serial = ((await firstRow.locator("td").nth(2).textContent()) ?? "").trim()
    const machineCode = ((await firstRow.locator("td").nth(1).textContent()) ?? "").trim()
    expect(serial.length).toBeGreaterThan(0)

    await firstRow.getByRole("button", { name: viDict.historian.table.genealogyAction }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(serial)).toBeVisible()
    // The row's own machine is always among the genealogy results for its own serial — `.first()`
    // since the same serial can legitimately recur more than once on the same machine (e.g. a
    // ProcessResult reading plus a Telemetry one), so more than one list entry may share this text.
    await expect(dialog.getByText(machineCode, { exact: true }).first()).toBeVisible()

    // `dialog.tsx`'s built-in close button carries a hardcoded, unlocalized "Close" accessible name
    // (every dialog in this app, not something this task changes) — deterministic regardless of the
    // active language.
    await dialog.getByRole("button", { name: "Close" }).click()
    await expect(dialog).not.toBeVisible()
  })

  test("Export CSV is a real, scoped download link — no fetch/blob code, just an <a href>", async ({ page, request }) => {
    await gotoHistorian(page)

    const exportLink = page.getByRole("link", { name: viDict.historian.export.csv })
    expect(await exportLink.getAttribute("download")).not.toBeNull()

    const hrefBefore = await exportLink.getAttribute("href")
    expect(hrefBefore).toContain("/v1/historian/results/export.csv")
    // The brief: the export endpoint takes the SAME filters as the paged results query but no
    // limit/offset — it exports the full filtered set, never one page of it.
    expect(hrefBefore).not.toContain("limit=")
    expect(hrefBefore).not.toContain("offset=")

    const machineCode = ((await page.locator("tbody tr").first().locator("td").nth(1).textContent()) ?? "").trim()
    await chooseSelectOption(page, viDict.historian.filters.machine, machineCode)

    const hrefAfter = await exportLink.getAttribute("href")
    expect(hrefAfter).toContain(`machine=${machineCode}`)

    // A real, fetchable endpoint (not a placeholder link) — resolved the same way a browser's own
    // click-to-download would, and genuinely scoped to that one machine's rows.
    const csvRes = await request.get(hrefAfter!)
    expect(csvRes.ok()).toBe(true)
    expect(csvRes.headers()["content-type"]).toContain("text/csv")
    const csvText = (await csvRes.body()).toString("utf-8")
    const csvLines = csvText.split("\r\n").filter((line) => line.length > 0)
    expect(csvLines[0]).toContain("machineCode") // RFC-4180 header row (HistorianEndpoints.CsvHeaderColumns)
    expect(csvLines.length).toBeGreaterThan(1) // header + at least one real data row
    for (const line of csvLines.slice(1)) {
      expect(line.split(",")[1]).toBe(machineCode) // 2nd column is machineCode, per the same header
    }
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    // Primed via localStorage before first paint — same technique 07-machines.spec.ts's own language
    // test uses, not a live click through Settings' selector (already covered by 05-settings.spec.ts).
    // Deliberately NOT `gotoHistorian` (that helper waits on the Vietnamese heading text specifically).
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/historian")
    await expect(page.getByRole("heading", { name: en.historian.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.historian.table.serial })).toBeVisible({ timeout: 15_000 })
    // Past the loading skeleton — a real row rendered once `useHistorianResults` resolved.
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("link", { name: en.historian.export.csv })).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string (e.g. "historian.table.serial") — this
    // regex is deliberately generic so it would catch a typo in ANY key on this screen.
    await expect(page.getByText(/historian\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
