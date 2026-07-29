import { expect, test, type Page } from "@playwright/test"

import { resetEstop, setFleetRunning } from "./support/engine"
import { gotoHmi } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/**
 * H5c — SAFETY REGRESSION TEST (twice-regressed area, spec §8.6). Two previous passes (H5/H5b) both
 * claimed "the control rail never scrolls" and "HALT never moves between states" and both were
 * WRONG in ways only a real `scrollHeight`/`getBoundingClientRect()`/`elementFromPoint()` measurement
 * catches — a screenshot baseline alone does not: a masked, pixel-diffed screenshot of the HALT
 * button looks IDENTICAL whether the element sits inside a scrolling container or not, and looks
 * IDENTICAL at two different on-screen positions if the mask box happens to cover both. This spec
 * asserts the underlying geometry directly, at the exact floor size this class of bug reproduces at
 * (1280×800), across every machine class this component is shared by. (SM-4: the button's operator-
 * facing label is "HALT"/"NGỪNG", not "E-STOP" — this is a supervisory software latch, not a safety
 * device — see README §1; the button's own `data-testid`/text content used to locate it below is
 * updated accordingly.)
 */
test.describe("HMI safety rail — never scrolls, HALT never moves", () => {
  test.beforeEach(async ({ request }) => {
    await resetEstop(request)
    await setFleetRunning(request, true)
  })
  test.afterEach(async ({ request }) => {
    await resetEstop(request)
    await setFleetRunning(request, true)
  })

  async function measureRail(page: Page) {
    return page.evaluate(() => {
      // `ControlColumn`'s own scrollable wrapper is the SECOND `.hmi-scroll` in DOM order (the
      // readout grid is the first, the system log the third) — see `Hmi.tsx`'s render order. Only
      // THIS one is a safety control; the readout grid and log band are legitimately scrollable.
      const controlRail = document.querySelectorAll(".hmi-scroll")[1]
      const estopBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("HALT"))
      const rect = estopBtn?.getBoundingClientRect()
      return {
        scrollHeight: controlRail.scrollHeight,
        clientHeight: controlRail.clientHeight,
        estopRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      }
    })
  }

  const CLASSES = ["AOI-01", "SCRW-01", "IOT-01"]

  for (const code of CLASSES) {
    test(`${code}: control rail never becomes scrollable, and HALT never moves, across stopped/running/paused/latched at 1280×800`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await gotoHmi(page, code)

      // stopped
      await setFleetRunning(request, false)
      await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
      const stopped = await measureRail(page)

      // running
      await setFleetRunning(request, true)
      await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeEnabled()
      const running = await measureRail(page)

      // paused (fleet stopped again from a running state — same UI state as "stopped" today, measured
      // separately anyway since the spec's own state matrix calls it out as a distinct case)
      await setFleetRunning(request, false)
      await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
      const paused = await measureRail(page)

      // HALT latched — the worst case: banner + RESET both present, the tallest the rail ever gets.
      await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()
      const resetBtn = page.getByRole("button", { name: viDict.hmi.controls.reset })
      await expect(resetBtn).toBeVisible()
      const latched = await measureRail(page)

      const states = { stopped, running, paused, latched }

      // 1) THE control rail — never a scrolling region, in ANY state, including the worst case.
      for (const [name, s] of Object.entries(states)) {
        expect(s.scrollHeight, `control rail scrollHeight in "${name}" state`).toBeLessThanOrEqual(s.clientHeight)
      }

      // 2) HALT's own on-screen box is BYTE-IDENTICAL across all four states — an operator's muscle
      // memory for its position must never be wrong, latched or not.
      const rects = Object.values(states).map((s) => s.estopRect)
      for (const r of rects) expect(r).not.toBeNull()
      const [first, ...rest] = rects
      for (const [i, r] of rest.entries()) {
        expect(r, `HALT rect in state #${i + 1} vs "stopped"`).toEqual(first)
      }

      // 3) Real hit-testing at RESET's centre while latched — not just "present in the DOM."
      const resetHits = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("RESET"))
        if (!btn) return false
        const r = btn.getBoundingClientRect()
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !!el && el.closest("button") === btn
      })
      expect(resetHits, "elementFromPoint at RESET's centre resolves to RESET while latched").toBe(true)

      // 4) The page itself never scrolls, worst case included.
      const pageScrollable = await page.evaluate(() => {
        const html = document.documentElement
        const root = document.querySelector("div.flex.h-svh")
        return html.scrollHeight > html.clientHeight || (root ? root.scrollHeight > root.clientHeight : false)
      })
      expect(pageScrollable, "page/root scrolls while HALT is latched").toBe(false)

      // Clean up: RESET clears the latch so `afterEach`'s own reset isn't the only thing undoing it.
      await resetBtn.click()
      await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
    })
  }

  // WS1 Global Constraints: "12-hmi-safety-rail.spec.ts phải xanh trên mọi theme" — this file has no
  // pixel-baseline cost (pure DOM geometry/hit-testing assertions, no `toHaveScreenshot`), so unlike
  // the visual suites it costs nothing to actually run across all 3 real themes right now instead of
  // pinning to Glass — this is live evidence the HALT/RESET safety rail invariant genuinely holds
  // under Console/Warmth's own layout-affecting tokens (radius, elevation), not just Glass's.
  const THEMES: Theme[] = ["glass", "console", "warmth"]
  const VIEWPORTS = [
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
  ]

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${viewport.width}×${viewport.height} / ${theme}: HALT latched — rail fits with real margin, not flush against the panel edge`, async ({
        page,
        request,
      }) => {
        await primeAppStorage(page, { theme })
        await page.setViewportSize(viewport)
        await gotoHmi(page, "AOI-01")
        await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()
        await expect(page.getByRole("button", { name: viDict.hmi.controls.reset })).toBeVisible()

        const slack = await page.evaluate(() => {
          const controlRail = document.querySelectorAll(".hmi-scroll")[1]
          // `scrollHeight` alone can't tell "just barely fits" from "fits with room to spare" — the
          // inner wrapper is `min-h-full`, so once content is shorter than the container `scrollHeight`
          // clamps UP to `clientHeight` and always reports 0 slack. Measure the two real content
          // blocks' own heights (+ the wrapper's own padding) instead, straight from the DOM.
          const wrapper = controlRail.firstElementChild as HTMLElement
          const cs = getComputedStyle(wrapper)
          const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
          const contentHeight =
            wrapper.children[0].getBoundingClientRect().height +
            wrapper.children[1].getBoundingClientRect().height +
            paddingV
          return controlRail.clientHeight - contentHeight
        })
        // Not just "doesn't overflow" (>= 0) — real breathing room. A previous build measured 5px of
        // slack at 1280×800, which reads as visually clipped; this floor is deliberately higher.
        expect(slack, "control rail slack (clientHeight - scrollHeight) while latched").toBeGreaterThanOrEqual(10)

        await resetEstop(request)
      })
    }
  }
})
