import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { setFleetRunning } from "./support/engine"
import { gotoMachines } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Machine List (W2) happy path — the last of the 7 screens to move off `PlaceholderScreen`. Every
 * row comes straight from the real, polled `GET /v1/fleet` (same query `Dashboard.tsx`/
 * `FleetRuntimeProvider` share), so this spec proves the table is genuinely live (Start/Stop Fleet
 * move real statuses/cycles through it), not a static mock of the roster.
 *
 * Roster size is read at runtime, NOT hardcoded to 11: `FleetHost` is a process-lifetime singleton
 * shared by the whole suite (`playwright.config.ts`'s own top comment), and `04-onboarding.spec.ts`
 * runs before this file (numeric prefix order) and genuinely joins 2 extra machines into that SAME
 * fleet via the real `/v1/onboarding/claim` round trip — so by the time this spec runs the roster is
 * demonstrably >11. Assertions below either read the current total first or use facts that hold
 * regardless of extra onboarded machines (their codes are all `SIM-*`, never `SCRW-*`/`AOI-*`/`IOT-*`,
 * and they always join as Automation — `Onboarding.tsx`'s `machineType` state default, untouched by
 * those flows).
 */
test.describe("machines — list, filter/search, live updates, row → detail", () => {
  test.beforeEach(async ({ request }) => {
    // Defensive — makes this spec independently re-runnable regardless of what an earlier spec left
    // the shared engine process in (same rationale as 01-dashboard.spec.ts's own beforeEach).
    await setFleetRunning(request, false)
  })

  test("lists the full roster; Start Fleet moves real rows off Idle, Stop Fleet returns every row to Idle without resetting cycles", async ({
    page,
  }) => {
    await gotoMachines(page)

    // Header row + every current machine row — at least the 11 from fleet.json's checked-in roster.
    const totalRows = await page.getByRole("row").count()
    expect(totalRows).toBeGreaterThanOrEqual(12)
    const rosterSize = totalRows - 1

    await expect(page.getByRole("cell", { name: "SCRW-01", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "AOI-01", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "IOT-01", exact: true })).toBeVisible()

    // Stopped: every row reads Idle (E1), header badge reads 0 / {rosterSize} online. Scoped to
    // <tbody> — the Status filter's own dropdown also renders an "Idle" <option> once the fleet is
    // all-idle, which would otherwise double-count against a page-wide text search.
    const tbody = page.locator("tbody")
    await expect(tbody.getByText(viDict.status.idle)).toHaveCount(rosterSize)
    await expect(page.getByText(viDict.machines.onlineCount({ online: 0, total: rosterSize }))).toBeVisible()

    // Start — via the TopBar (same control 01-dashboard.spec.ts exercises).
    await page.getByRole("banner").getByRole("button", { name: viDict.shell.topBar.startFleet }).click()
    await expect(page.getByText(viDict.toast.fleetStarted)).toBeVisible()

    // Real cycles land — at least one row leaves Idle for a real verdict.
    await expect.poll(() => tbody.getByText(viDict.status.idle).count(), { timeout: 20_000 }).toBeLessThan(rosterSize)

    // SCRW-01 cycles every 0.8s — its Cycles cell (6th column) climbs off zero for real.
    const scrwRow = page.getByRole("row", { name: "SCRW-01" })
    const scrwCycles = scrwRow.locator("td").nth(5)
    await expect
      .poll(async () => Number((await scrwCycles.textContent())?.replace(/[^\d]/g, "")), { timeout: 20_000 })
      .toBeGreaterThan(0)

    await assertNoSeriousA11yViolations(page)

    // Stop — statuses revert to Idle everywhere, but the cycle count already reached stays put
    // (frozen, not reset to 0) — the same "stopped ≠ reset" contract 01-dashboard.spec.ts proves for
    // the card grid.
    await page.getByRole("banner").getByRole("button", { name: viDict.shell.topBar.stop }).click()
    await expect(page.getByText(viDict.toast.fleetStopped)).toBeVisible()
    await expect(tbody.getByText(viDict.status.idle)).toHaveCount(rosterSize)
    expect(Number((await scrwCycles.textContent())?.replace(/[^\d]/g, ""))).toBeGreaterThan(0)
  })

  test("search narrows by code, a type filter and a status filter each narrow the roster, they combine, and Clear filters resets everything", async ({
    page,
  }) => {
    await gotoMachines(page)
    const initialRows = await page.getByRole("row").count()

    const searchInput = page.getByLabel(viDict.machines.search.label)
    await searchInput.fill("SCRW")
    // Only SCRW-01/SCRW-02 ever carry that code prefix — stable regardless of how many extra `SIM-*`
    // machines earlier specs joined into the shared fleet.
    await expect(page.getByRole("row")).toHaveCount(3) // header + SCRW-01 + SCRW-02
    await expect(page.getByText(`2 ${viDict.machines.shownLabel}`)).toBeVisible()
    await expect(page.getByText(viDict.machines.ofTotal({ count: initialRows - 1 }))).toBeVisible()

    await page.getByRole("button", { name: viDict.machines.filters.clear }).click()
    await expect(searchInput).toHaveValue("")
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    // Type filter — every row left standing must read "IoT" in its Type column, and the two known
    // IoT machines are among them (count itself isn't pinned — extra onboarded machines always join
    // as Automation, but asserting that structurally here rather than via a hardcoded total is the
    // more robust check).
    await page.getByLabel(viDict.machines.filters.type).selectOption({ label: viDict.deviceClass.Iot })
    const typeCells = page.locator("tbody tr td:nth-child(2)")
    const iotCount = await typeCells.count()
    expect(iotCount).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < iotCount; i++) {
      await expect(typeCells.nth(i)).toHaveText(viDict.deviceClass.Iot)
    }
    await expect(page.getByRole("cell", { name: "IOT-01", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "SCRW-01", exact: true })).toHaveCount(0)

    // Combines with search — no IoT machine has a code starting "SCRW", so this narrows to nothing
    // and the friendly "no match" empty state (not a blank table) renders instead.
    await searchInput.fill("SCRW")
    await expect(page.getByText(viDict.machines.empty.noMatchTitle)).toBeVisible()
    await expect(page.getByRole("row")).toHaveCount(0)

    await page.getByRole("button", { name: viDict.machines.filters.clear }).click()
    await expect(page.getByRole("row")).toHaveCount(initialRows)
    await expect(page.getByText(viDict.machines.empty.noMatchTitle)).toHaveCount(0)

    // Status filter — while stopped every machine is Idle, so this is a same-set narrow, proving the
    // control is wired without depending on the fleet being started for this test.
    await page.getByLabel(viDict.machines.filters.status).selectOption({ label: viDict.status.idle })
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    await assertNoSeriousA11yViolations(page)
  })

  test("clicking a row navigates to that machine's detail page", async ({ page }) => {
    await gotoMachines(page)
    await page.getByRole("row", { name: "AOI-01" }).click()
    await expect(page.getByRole("heading", { name: "AOI-01", level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test("a row is keyboard-activatable with Enter", async ({ page }) => {
    await gotoMachines(page)
    const row = page.getByRole("row", { name: "SCRW-02" })
    await row.focus()
    await row.press("Enter")
    await expect(page.getByRole("heading", { name: "SCRW-02", level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    // Primed via localStorage before first paint — same technique as 04-onboarding.spec.ts's own
    // language test, not a live click through Settings' selector (that flow is already covered by
    // 05-settings.spec.ts).
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/machines")
    await expect(page.getByRole("heading", { name: en.machines.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.machines.table.code })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("columnheader", { name: en.machines.table.passRate })).toBeVisible()
    await expect(page.getByLabel(en.machines.filters.type)).toBeVisible()

    const rosterSize = (await page.getByRole("row").count()) - 1
    await expect(page.getByText(en.machines.onlineCount({ online: 0, total: rosterSize }))).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string (e.g. "machines.table.code") — this
    // regex is deliberately generic so it would catch a typo in ANY key on this screen.
    await expect(page.getByText(/machines\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
