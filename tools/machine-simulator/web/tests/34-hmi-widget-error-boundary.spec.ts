import { expect, test } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { gotoHmi } from "./support/screens"
import { resetTrackedScreenFixtures } from "./support/screenFixtures"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-1 whole-branch review, finding M2 — `ScreenRenderer.tsx:75`'s own doc comment states the
 * proposition plainly: "One misconfigured widget must not take the kiosk page down... Real proof that
 * one widget's crash leaves its siblings alive is Task 4/5's Playwright job." Both tasks shipped without
 * it. Everything that existed before this file was STRUCTURAL — `bindings.test.mjs` reads
 * `ScreenRenderer.tsx`'s source text for `getDerivedStateFromError`/`componentDidCatch` and for
 * `widgets.map` — never a real crash, never a real DOM.
 *
 * The reviewer's own probe (whole-branch-review.md) proved the CURRENT behaviour correct by hand: patch
 * a widget to throw, add it to a document, run a throwaway spec, delete it. This file is that probe made
 * PERMANENT: `widgets/label.tsx` carries a narrowly-scoped, permanent hook
 * (`props.__testOnlyThrow === true`) instead of a one-off source patch, so the exact same proof runs on
 * every `test:e2e` from here on rather than needing to be re-invented by hand each time someone asks
 * "does this still hold."
 *
 * **The concrete regression this guards against** (named in the finding): moving `<WidgetErrorBoundary>`
 * from inside `ScreenRenderer`'s `widgets.map()` to around the whole grid. `bindings.test.mjs`'s own
 * `/widgets\.map/` structural check would still pass (the map is still there) — only a REAL crash,
 * observed in a REAL DOM, can tell "one boundary per widget" apart from "one boundary around all of
 * them." That is exactly what this spec drives.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SCREENS_DIR = join(HERE, "..", "screens")
const AUTOMATION_PATH = join(SCREENS_DIR, "automation-overview.json")

const CRASHING_WIDGET = {
  id: "probe-crash",
  kind: "label",
  rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
  props: { __testOnlyThrow: true },
}

test.describe("HMI widget error boundary — one crashing widget must not take the kiosk page down", () => {
  // whole-branch-review.md L4 — self-heals a prior interrupted run's leftover fixture mutation before
  // this test builds its own. See `support/screenFixtures.ts`'s own doc comment.
  test.beforeAll(() => {
    resetTrackedScreenFixtures(AUTOMATION_PATH)
  })

  test("a widget that throws while rendering degrades to a named placeholder; every sibling, and the page, survive", async ({ page }) => {
    const original = readFileSync(AUTOMATION_PATH, "utf8")
    const doc = JSON.parse(original)
    // The crashing widget shares the grid with the ORIGINAL faceplate widget — the exact "one
    // misconfigured widget beside a working one" shape the plan's own acceptance line names.
    doc.widgets = [...doc.widgets, CRASHING_WIDGET]

    const pageErrors: string[] = []
    page.on("pageerror", (err) => pageErrors.push(err.message))

    try {
      writeFileSync(AUTOMATION_PATH, JSON.stringify(doc, null, 2))
      await gotoHmi(page, "SCRW-01")

      // The crashing widget itself: a NAMED placeholder, not a blank tile and not a page crash.
      const placeholder = page.locator('[data-hmi-widget-error="probe-crash"]')
      await expect(placeholder).toBeVisible()
      await expect(placeholder).toHaveAttribute("role", "alert")
      await expect(placeholder).toContainText("crashed while rendering")
      await expect(placeholder).toContainText("PROBE: deliberate widget crash")

      // The sibling faceplate — BOTH halves (schematic identity AND readout heading) — still renders,
      // fully, beside the crashed tile. Same locators `32-hmi-screen-wiring.spec.ts` already
      // establishes for "the schematic identity" and "the readout panel's own heading".
      await expect(page.getByRole("img", { name: /AUTOMATION \/ SCREWDRIVE CELL/ })).toBeVisible()
      await expect(page.getByRole("heading", { name: viDict.hmi.readoutPanel.title })).toBeVisible()

      // The page itself survives — the kiosk's own machine-identity heading, not just "some DOM".
      await expect(page.getByRole("heading", { name: "SCRW-01", level: 1 })).toBeVisible()

      // Nothing escaped the boundary to the window — a boundary that "catches" but the framework still
      // reports as an uncaught error would leave the operator's console (or a real crash reporter) with
      // a signal indistinguishable from a real unhandled failure.
      expect(pageErrors).toEqual([])
    } finally {
      writeFileSync(AUTOMATION_PATH, original)
      await gotoHmi(page, "SCRW-01")
      await expect(page.locator('[data-hmi-widget-error="probe-crash"]')).toHaveCount(0)
    }
  })
})
