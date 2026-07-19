import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { setFleetRunning } from "./support/engine"
import { gotoInspector } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/** `stream.totalCount` from the page's own subtitle ("… — {N} đã ghi nhận trong phiên này.") — the
 * cumulative, session-lifetime count of every WS frame received, frozen while paused (see
 * `useInspectorStream`'s `onmessage` guard) and reset by Clear. Deliberately NOT `page.getByRole
 * ("row").count()` for "did new events arrive" checks: `TraceTable` is virtualized
 * (`@tanstack/react-virtual`), so the DOM row count plateaus once the scrollable list fills the
 * viewport — it stops growing well before the underlying ring does, which made an earlier version
 * of this test time out waiting for a row count that was never going to increase further. */
async function totalCaptured(page: Page): Promise<number> {
  const text = (await page.locator("p", { hasText: "đã ghi nhận trong phiên này" }).textContent()) ?? ""
  const match = /([\d.,]+)\s*đã ghi nhận/.exec(text)
  return match ? Number(match[1].replace(/[.,]/g, "")) : Number.NaN
}

/**
 * API Inspector happy path: the WS stream (`WS /v1/inspector/stream`) delivers real, live trace
 * events into the table, and Pause/Resume/Filter/Clear/Export all do what they claim against that
 * real stream — no mocked WebSocket anywhere in this file.
 */
test.describe("api inspector — live WS trace stream", () => {
  test.beforeAll(async ({ request }) => {
    await setFleetRunning(request, true)
  })

  test("receives live events; pause freezes the ring, filter narrows it, export downloads it, clear empties it", async ({
    page,
  }) => {
    await gotoInspector(page)

    await expect(page.getByText(viDict.inspector.status.live, { exact: true })).toBeVisible({ timeout: 15_000 })
    // Header row + at least one live data row (virtualization-safe — this only needs "more than
    // just the header", not an exact/growing count).
    await expect.poll(() => page.getByRole("row").count(), { timeout: 20_000 }).toBeGreaterThan(1)

    // ── Pause: stream keeps running server-side, but the ring stops accepting new frames.
    await page.getByRole("button", { name: viDict.inspector.pause }).click()
    await expect(page.getByText(viDict.inspector.status.paused)).toBeVisible()
    const pausedTotal = await totalCaptured(page)
    expect(Number.isFinite(pausedTotal)).toBe(true)
    // No positive "did not change" signal exists to await here — this is the one deliberate fixed
    // wait in the suite, specifically to observe an absence of change while the engine (proven above
    // to be actively producing events) keeps running underneath.
    await page.waitForTimeout(1500)
    expect(await totalCaptured(page)).toBe(pausedTotal)

    // ── Resume: new frames start landing again.
    await page.getByRole("button", { name: viDict.inspector.resume }).click()
    await expect(page.getByText(viDict.inspector.status.live, { exact: true })).toBeVisible()
    await expect.poll(() => totalCaptured(page), { timeout: 20_000 }).toBeGreaterThan(pausedTotal)

    // ── Filter: narrowing to one machine code shows the "of N buffered" qualifier and at least one
    // matching row; every rendered cell in the machine column matches the filter.
    await page.getByLabel(viDict.inspector.filters.machine).selectOption("SCRW-01")
    await expect(page.getByText(/trên \d+ đã lưu/)).toBeVisible()
    await expect(page.getByRole("cell", { name: "SCRW-01", exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await page.getByLabel(viDict.inspector.filters.machine).selectOption({ label: viDict.inspector.filters.all })

    await assertNoSeriousA11yViolations(page)

    // ── Export: downloads the current ring as JSON, doc-28-style filename.
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: viDict.inspector.export }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^api-trace-\d{8}-\d{6}\.json$/)
    await expect(page.getByText(/Đã xuất \d+ sự kiện ra tệp/)).toBeVisible()

    // ── Clear: paused first, so the still-live stream can't immediately refill the ring before the
    // assertion below gets to observe it — makes the resulting empty state actually stable to check
    // (a real signal: "paused" blocks every incoming frame, per useInspectorStream's onmessage
    // guard) rather than a race against the next WS frame arriving a few ms after Clear.
    await page.getByRole("button", { name: viDict.inspector.pause }).click()
    await expect(page.getByText(viDict.inspector.status.paused)).toBeVisible()
    await page.getByRole("button", { name: viDict.inspector.clear }).click()
    await expect(page.getByText(viDict.inspector.emptyNoTraffic)).toBeVisible()
    await expect(page.getByRole("row")).toHaveCount(1) // header only
  })
})
