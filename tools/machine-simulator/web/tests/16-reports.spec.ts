import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL, setFleetRunning, waitForHistorianRows } from "./support/engine"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Task 13 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/reports`, the per-machine OEE
 * screen: Availability/Performance/Quality/OEE tiles, the honest 3-bucket loss chart, an editable
 * Targets panel (with inline 400 handling), and a PDF export link. `useOee`/`useOeeSettings` are
 * one-shot (no `refetchInterval`, same "browse over already-settled history" reasoning
 * `15-historian.spec.ts` documents for `useHistorianResults`), so this spec establishes its OWN
 * precondition — real historian rows on file — via a direct API wait before navigating, same idiom
 * that file already uses.
 *
 * `oee-settings.json` lives under `OeeSettingsStore`'s own root, alongside `historian.db` —
 * task-7 (whole-batch review, CRITICAL) isolated that whole directory under `ST4I_HISTORIAN_DIR`
 * (`web/.e2e-data/historian`), which `scripts/reset-engine-state.mjs` now wipes before every
 * `webServer` boot, same as every other isolated store — so, unlike before that fix, OEE targets no
 * longer persist across Playwright sessions on this machine either. Every test below still sets its
 * OWN known starting values via a direct `PUT` before asserting anything about "overridden"/effective
 * values, rather than assuming a pristine "never touched" baseline — that discipline no longer
 * depends on cross-session persistence to matter, but stays exactly as written since it is still the
 * correct, self-contained way to establish a precondition regardless of what an earlier run left.
 */

async function firstFleetMachine(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${ENGINE_URL}/v1/fleet`)
  const body = (await res.json()) as { machines: { code: string }[] }
  expect(body.machines.length).toBeGreaterThan(0)
  return body.machines[0].code
}

async function putOeeSettings(
  request: APIRequestContext,
  machine: string,
  body: { idealCycleSecondsOverride?: number; plannedProductionRatio?: number }
): Promise<{ idealCycleSeconds: number; isOverridden: boolean; plannedProductionRatio: number }> {
  const res = await request.put(`${ENGINE_URL}/v1/historian/oee/settings?machine=${encodeURIComponent(machine)}`, { data: body })
  if (!res.ok()) throw new Error(`PUT oee/settings for ${machine} failed: ${res.status()}`)
  return (await res.json()) as { idealCycleSeconds: number; isOverridden: boolean; plannedProductionRatio: number }
}

async function gotoReports(page: Page): Promise<void> {
  await page.goto("/reports")
  await expect(page.getByRole("heading", { name: viDict.reports.title, level: 1 })).toBeVisible()
  await expect(page.getByRole("combobox", { name: viDict.reports.filters.machine })).toBeVisible()
  // Past the Targets panel's own loading skeleton — a real numeric value only populates the Ideal
  // Cycle field once `useOeeSettings` has resolved at least once (same "wait on a real field value"
  // idiom `gotoSettings`'s own `#settings-server-url` wait uses).
  await expect(page.locator("#reports-ideal-cycle")).toHaveValue(/\d/)
}

test.describe("reports — OEE tiles, honest 3-bucket loss chart, editable targets, PDF export", () => {
  let machine = ""

  test.beforeEach(async ({ request }) => {
    await setFleetRunning(request, true)
    await waitForHistorianRows(request)
    machine = await firstFleetMachine(request)
    // Known starting values, independent of whatever an earlier session left on disk.
    await putOeeSettings(request, machine, { idealCycleSecondsOverride: 5, plannedProductionRatio: 0.8 })
  })

  test.afterEach(async ({ request }) => {
    if (machine) await putOeeSettings(request, machine, { idealCycleSecondsOverride: 5, plannedProductionRatio: 0.8 })
  })

  test("A/P/Q/OEE tiles, the 3 honestly-labeled loss buckets, and the Targets panel all render for the selected machine", async ({
    page,
  }) => {
    await gotoReports(page)

    // The 4 KPI tiles — `exact: true` so "OEE" doesn't ambiguously match the loss chart's own
    // "Tổn thất OEE (3 nhóm)" panel title, which contains the same substring.
    await expect(page.getByText(viDict.reports.kpi.availability, { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.reports.kpi.performance, { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.reports.kpi.quality, { exact: true })).toBeVisible()
    // `.first()` — "OEE" is the one KPI label whose bilingual gloss is the SAME word in both
    // dictionaries (an abbreviation, not translated — like "ST4I" itself), so `Readout` renders it
    // twice (primary label span + gloss span), unlike the other 3 tiles' distinct vi/en text.
    await expect(page.getByText(viDict.reports.kpi.oee, { exact: true }).first()).toBeVisible()
    // Real percentages, not a raw NaN/undefined leak — one "%" unit span per KPI tile (the OEE
    // gauge's own donut label renders a rounded integer with no '%' suffix, so this counts exactly
    // the 4 KPI tiles, never double-counting the gauge).
    expect(await page.getByText("%", { exact: true }).count()).toBeGreaterThanOrEqual(4)

    // Exactly the 3 honest buckets — never a "six big losses" framing anywhere on this screen.
    await expect(page.getByText(viDict.reports.lossChart.downtime, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(viDict.reports.lossChart.speed, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(viDict.reports.lossChart.quality, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/six big losses/i)).toHaveCount(0)

    // Targets panel — reflects the known starting values this test's `beforeEach` just set, and the
    // "overridden" provenance badge (this API always sends a concrete override, so it's always true).
    await expect(page.locator("#reports-ideal-cycle")).toHaveValue("5")
    await expect(page.locator("#reports-ratio")).toHaveValue("0.8")
    await expect(page.getByText(viDict.reports.targets.overridden, { exact: true })).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("Export PDF is a real, scoped download link that carries the selected machine and date filters", async ({ page, request }) => {
    await gotoReports(page)

    const exportLink = page.getByRole("link", { name: viDict.reports.export.pdf })
    expect(await exportLink.getAttribute("download")).not.toBeNull()

    const href = await exportLink.getAttribute("href")
    expect(href).toContain("/v1/historian/report.pdf")
    expect(href).toContain(`machine=${machine}`)

    // A real, fetchable endpoint — resolves a genuine PDF, not a placeholder link.
    const pdfRes = await request.get(href!)
    expect(pdfRes.ok()).toBe(true)
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf")
  })

  test("Targets round trip: a valid Save persists new values; an out-of-range ratio surfaces the server's own 400 wording inline, without crashing, and leaves the stored value untouched", async ({
    page,
    request,
  }) => {
    await gotoReports(page)

    // Valid round trip — change both fields and Save.
    await page.locator("#reports-ideal-cycle").fill("6")
    await page.locator("#reports-ratio").fill("0.65")
    await page.getByRole("button", { name: viDict.reports.targets.save }).click()
    await expect(page.getByText(viDict.toast.oeeTargetsSaved)).toBeVisible()
    await expect(page.locator("#reports-ideal-cycle")).toHaveValue("6")
    await expect(page.locator("#reports-ratio")).toHaveValue("0.65")

    // Confirm it actually round-tripped through the real API, not just local component state.
    const afterValid = await (await request.get(`${ENGINE_URL}/v1/historian/oee/settings?machine=${encodeURIComponent(machine)}`)).json()
    expect(afterValid.plannedProductionRatio).toBeCloseTo(0.65)

    // Out-of-range ratio — the UI does not block submission client-side (the brief's contract: the
    // SERVER rejects this, and the panel's job is to surface that honestly) — never a raw crash, an
    // unhandled promise rejection, or a silently-clamped value.
    await page.locator("#reports-ratio").fill("1.5")
    await page.getByRole("button", { name: viDict.reports.targets.save }).click()

    const error = page.getByRole("alert").filter({ hasText: "plannedProductionRatio" })
    await expect(error).toBeVisible()
    // The success toast from the FIRST save must not reappear/linger as a false positive here.
    await expect(page.getByText(viDict.toast.oeeTargetsSaveFailed)).toBeVisible()

    // The heading is still there — a thrown mutation error never took down the screen.
    await expect(page.getByRole("heading", { name: viDict.reports.title, level: 1 })).toBeVisible()

    // The rejected write left the STORED value exactly as the valid save left it (never clamped to
    // 1.0, never partially applied).
    const afterRejected = await (
      await request.get(`${ENGINE_URL}/v1/historian/oee/settings?machine=${encodeURIComponent(machine)}`)
    ).json()
    expect(afterRejected.plannedProductionRatio).toBeCloseTo(0.65)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/reports")
    await expect(page.getByRole("heading", { name: en.reports.title, level: 1 })).toBeVisible()
    await expect(page.locator("#reports-ideal-cycle")).toHaveValue(/\d/)

    await expect(page.getByText(en.reports.kpi.oee, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: en.reports.export.pdf })).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string — generic regex to catch a typo in ANY
    // key on this screen (same idiom `15-historian.spec.ts`'s own English-strings test uses).
    await expect(page.getByText(/reports\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
