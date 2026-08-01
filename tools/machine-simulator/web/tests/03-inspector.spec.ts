import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { LIVE_STREAM_MS, REQUEST_ROUND_TRIP_MS } from "./support/deadlines"
import { ENGINE_URL, setFleetRunning } from "./support/engine"
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

/** The engine's own lifetime cycle counter, read straight off `GET /v1/fleet` — a signal about the
 * SERVER that is completely independent of anything this page is or is not doing. */
async function engineCycles(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${ENGINE_URL}/v1/fleet`)
  const body = (await res.json()) as { kpis: { totalCycles: number } }
  return body.kpis.totalCycles
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
    request,
  }) => {
    await gotoInspector(page)

    await expect(page.getByText(viDict.inspector.status.live, { exact: true })).toBeVisible()
    // Header row + at least one live data row (virtualization-safe — this only needs "more than
    // just the header", not an exact/growing count).
    await expect.poll(() => page.getByRole("row").count(), { timeout: LIVE_STREAM_MS }).toBeGreaterThan(1)

    // ── Pause: stream keeps running server-side, but the ring stops accepting new frames.
    await page.getByRole("button", { name: viDict.inspector.pause }).click()
    await expect(page.getByText(viDict.inspector.status.paused)).toBeVisible()
    const pausedTotal = await totalCaptured(page)
    expect(Number.isFinite(pausedTotal)).toBe(true)

    // This used to be `await page.waitForTimeout(1500)` — the suite's only hard sleep with no
    // constant of any kind behind it, and the wrong shape for the claim. "Nothing arrived while
    // paused" is only meaningful if something WOULD have arrived, and a fixed sleep only ASSUMES
    // that: had the engine gone quiet, or had the sleep been shorter than one cycle of the fastest
    // machine (0.8 s), the assertion below would have passed for the wrong reason. There IS a
    // positive signal for the premise, just not on this page — the engine's own lifetime cycle
    // counter, read over a separate HTTP client that the paused WebSocket cannot influence. Waiting
    // for THAT to climb makes the premise a measured fact, and the assertion then says what it
    // always meant to: real traffic happened, and this page ignored all of it.
    const cyclesAtPause = await engineCycles(request)
    await expect.poll(() => engineCycles(request), { timeout: LIVE_STREAM_MS }).toBeGreaterThan(cyclesAtPause + 2)
    expect(await totalCaptured(page)).toBe(pausedTotal)

    // ── Resume: new frames start landing again.
    await page.getByRole("button", { name: viDict.inspector.resume }).click()
    await expect(page.getByText(viDict.inspector.status.live, { exact: true })).toBeVisible()
    await expect.poll(() => totalCaptured(page), { timeout: LIVE_STREAM_MS }).toBeGreaterThan(pausedTotal)

    // ── Filter: narrowing to one machine code shows the "of N buffered" qualifier and at least one
    // matching row; every rendered cell in the machine column matches the filter.
    await page.getByLabel(viDict.inspector.filters.machine).selectOption("SCRW-01")
    await expect(page.getByText(/trên \d+ đã lưu/)).toBeVisible()
    await expect(page.getByRole("cell", { name: "SCRW-01", exact: true }).first()).toBeVisible()
    await page.getByLabel(viDict.inspector.filters.machine).selectOption({ label: viDict.inspector.filters.all })

    await assertNoSeriousA11yViolations(page)

    // ── Export: downloads the current ring as JSON, doc-28-style filename.
    const downloadPromise = page.waitForEvent("download", { timeout: REQUEST_ROUND_TRIP_MS })
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
