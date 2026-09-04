import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

/**
 * WS-HMI-2 Task 6 — every `kind` in `widgetRegistry` is DRAWN somewhere in the product, not merely
 * registered.
 *
 * Counted before this task, rather than asserted: exactly TWO of the fifteen kinds were drawn by a
 * document the product ships — `faceplate` (one per `web/screens/*-overview.json`) and `readout`
 * (Task 5's `screens/demo/component-demo.json`). TWO more had been rendered by a browser only inside a
 * temporary fixture written onto a shipped document and removed again in the same test:
 * `command-button` and `setpoint-input`, both gate branches, `33-hmi-policy-gate.spec.ts`. `label` had
 * been mounted by `34-hmi-widget-error-boundary.spec.ts` but ONLY with `props.__testOnlyThrow: true` —
 * its throw path, never its ordinary render. That leaves ELEVEN kinds whose ordinary render path no
 * browser had ever executed — `status-lamp`, `gauge`, `trend`, `alarm-banner`, `alarm-list`, `log`,
 * `label`, `sheet`, `kpi-tile`, `state-badge`, `line-state` — code that type-checks, lints and is
 * imported, pinned only by source-text tests. This file closes that by asserting the property against
 * the REGISTRY, so a kind added later without a demo instance goes red here rather than shipping
 * undrawn.
 *
 * -- Where the kind list comes from, and why not `window.__widgetKinds` --------------------------
 * The brief's sketch had `widgetRegistry.ts` publish `Object.keys(widgetRegistry)` onto
 * `window.__widgetKinds` in dev builds. Not done, by controller ruling and for a reason this file can
 * state plainly: a test-only global in shipped source is a second surface that can drift from the
 * registry (published once, then a later entry added below the publish line), it only exists in the
 * build the flag selects — so the pin would measure a DIFFERENT artefact than the one that ships — and
 * it puts a test's needs into production code for something already readable without it.
 *
 * The list is extracted from `widgetRegistry.ts`'s OWN SOURCE TEXT instead, exactly as
 * `runtime-tests/widgetRegistry.test.mjs` already does (and `contract-tests/contracts.test.mjs` before
 * it), for the reason those files measured rather than assumed: `widgetRegistry.ts` imports fifteen
 * `.tsx` widgets, and nothing in this tree can `import()` a `.tsx` outside the bundler. Reading the
 * text needs no bundler and no browser, and it reads the same file the app itself imports.
 *
 * 🔴 That technique's known weakness is that a broken extraction returns an EMPTY list, every loop
 * below then iterates nothing, and the suite goes green while measuring nothing — this repository's
 * signature defect, found four separate times in the last day. `assertExtractionIsAlive()` is the
 * floor: it cross-checks the extracted key count against a SECOND, independent count over the same
 * file (one `./widgets/…` import per registry entry — a different regex reading different lines) and
 * fails if either side is zero, so "both sides agree on nothing" cannot pass. Every test below calls
 * it FIRST, so no single test in this file can go green vacuously.
 *
 * FALSIFIED, not assumed: with the key regex `/^\s*"([^"]+)":/gm` replaced by one that matches nothing,
 * all three tests below go RED — "extracted 0 quoted kind keys …" — rather than green. Re-measured on
 * this tree; the literal output is in `task-6-report.md`.
 *
 * -- What this file measures, and what it does NOT -----------------------------------------------
 * MEASURED, in a real browser, on the real route:
 *   1. Every registry kind is declared by at least one widget in the demo document.
 *   2. That widget's grid cell is on screen and has DRAWN something into it (a rendered element, not
 *      an empty placed div).
 *   3. NOTHING on that screen degraded to `ScreenRenderer`'s named error placeholder — so "the cell is
 *      there" cannot be satisfied by an unregistered kind or a widget that threw, both of which render
 *      a visible `[data-hmi-widget-error]` box in the same cell.
 *   4. Every widget the document declares was actually placed (cell count === document widget count).
 *
 * NOT MEASURED HERE: that any widget draws the RIGHT thing — correct value, correct tone, correct
 * pixels, correct a11y tree. This is a coverage pin, not a per-widget acceptance test; `11-hmi.spec.ts`
 * and `00-visual-and-a11y.spec.ts` own pixels and axe for the three shipped screens, and the demo
 * screen deliberately has no baseline of its own (adding one would make an engineering scratch pad a
 * pixel contract). Also not measured: that `policyAction` means anything server-side — see
 * `task-6-report.md` for what the client-side gate does with an action it does not recognise.
 *
 * -- The demo document's widget ids ---------------------------------------------------------------
 * The 14 widgets this task added are named `kind-<kind>` as a READABILITY convention, so a failure
 * message names something a reader can find by eye. It is NOT the contract and nothing below depends
 * on it: the kind -> widget mapping is derived from each widget's own `kind` FIELD (which is what
 * `ScreenRenderer` dispatches on), which is why `readout` resolves to Task 5's `probe-a` rather than to
 * a redundant sixteenth widget added to satisfy a naming rule.
 */

// web/tests → web
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))

const DEMO_ROUTE = "/hmi/demo/component-demo"

/** 🔴 CRLF: same reason every source-text pin in this tree states — `core.autocrlf=true` with no
 * `.gitattributes`, so a fresh checkout holds `\r\n` while every pattern below hard-codes `\n`. */
const readNormalized = (...parts: string[]): string =>
  readFileSync(join(WEB, ...parts), "utf8").replace(/\r\n/g, "\n")

const REGISTRY_SOURCE = readNormalized("src", "hmi-runtime", "widgetRegistry.ts")

type DemoWidget = { id: string; kind: string }
type DemoDocument = { widgets: DemoWidget[] }

const DEMO_DOCUMENT = JSON.parse(
  readFileSync(join(WEB, "screens", "demo", "component-demo.json"), "utf8")
) as DemoDocument

/** The registry's own keys. Identical technique (and identical quoted-key constraint) to
 * `runtime-tests/widgetRegistry.test.mjs`'s `readRegisteredKinds` — see `widgetRegistry.ts`'s own
 * header for why all fifteen keys must stay quoted for this to see them. */
function registeredKinds(source: string): string[] {
  const body = /export const widgetRegistry:[^\n]*=\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!body) return []
  return [...body[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1])
}

/** The SECOND, independent count the floor compares against: one `import … from "./widgets/<file>"`
 * per registry entry. A different regex, over different lines of the same file, counting a different
 * token — so a defect in the key extraction alone cannot move both numbers together. */
function widgetModuleImports(source: string): string[] {
  return [...source.matchAll(/^import \{[^}]*\} from "\.\/widgets\/([^"]+)"$/gm)].map((m) => m[1])
}

/**
 * The floor. Returns the kind list only after proving the extraction actually read something and that
 * two independent readings of the registry agree — an empty list, or two readings that disagree, is a
 * broken pin, and a broken pin must be LOUD rather than an empty loop.
 */
function assertExtractionIsAlive(): string[] {
  const kinds = registeredKinds(REGISTRY_SOURCE)
  const imports = widgetModuleImports(REGISTRY_SOURCE)

  expect(
    kinds.length,
    "extracted 0 quoted kind keys from src/hmi-runtime/widgetRegistry.ts — the extraction is broken " +
      "(the object literal moved/renamed, or a key lost its quotes), and every loop in this file would " +
      "otherwise iterate nothing and pass while measuring nothing"
  ).toBeGreaterThan(0)
  expect(
    imports.length,
    "extracted 0 `./widgets/…` imports from src/hmi-runtime/widgetRegistry.ts — the cross-check this " +
      "floor depends on is itself broken, so `kinds.length === imports.length` below would compare two " +
      "numbers that mean nothing"
  ).toBeGreaterThan(0)
  expect(
    kinds.length,
    `widgetRegistry.ts declares ${imports.length} widget imports but ${kinds.length} quoted kind keys ` +
      `(keys: ${kinds.join(", ") || "(none)"}) — either an entry was added without its import (or vice ` +
      `versa), or one of the two extractions has stopped seeing what it reads`
  ).toBe(imports.length)
  expect(new Set(kinds).size, `duplicate kind keys in widgetRegistry.ts: ${kinds.join(", ")}`).toBe(kinds.length)

  return kinds
}

/** kind -> the id of the FIRST widget declaring it in the demo document. Derived from the `kind` field
 * `ScreenRenderer` itself dispatches on, never from the id's spelling. */
function firstWidgetIdPerKind(): Map<string, string> {
  const byKind = new Map<string, string>()
  for (const widget of DEMO_DOCUMENT.widgets) {
    if (!byKind.has(widget.kind)) byKind.set(widget.kind, widget.id)
  }
  return byKind
}

test.describe("every registered widget kind is drawn in the product, pinned against the registry itself", () => {
  test("the kind list is derived from widgetRegistry.ts, and an extraction that finds nothing is loud", () => {
    // The floor itself, asserted as its own test so a failure NAMES the extraction rather than
    // surfacing as a confusing coverage failure two tests down.
    const kinds = assertExtractionIsAlive()

    // Deliberately NOT a hardcoded 15 here: `runtime-tests/widgetRegistry.test.mjs` already owns the
    // "exactly 15 today" pin against the frozen `WidgetKind` union, and a second copy of that number
    // is a second thing to forget. What this file needs is only that the number is real and non-zero,
    // which the floor establishes; the brief's own title says "fourteen" and the registry has fifteen,
    // which is precisely why nothing here counts by hand.
    expect(kinds).toContain("readout")
  })

  test("every widget kind in the registry is declared at least once on the demo screen document", () => {
    const kinds = assertExtractionIsAlive()
    expect(
      DEMO_DOCUMENT.widgets.length,
      "screens/demo/component-demo.json declares no widgets — the browser test below would then have " +
        "nothing to look for and this file would measure nothing"
    ).toBeGreaterThan(0)

    const declared = new Set(DEMO_DOCUMENT.widgets.map((w) => w.kind))
    const undrawn = kinds.filter((kind) => !declared.has(kind)).sort()
    expect(
      undrawn,
      `registered but not on any demo screen: ${undrawn.join(", ")} — add an instance to ` +
        `web/screens/demo/component-demo.json; a kind nothing ever renders is a kind nothing ever ran`
    ).toEqual([])
  })

  test("every widget kind in the registry actually draws on the demo screen, and none degrades to a placeholder", async ({
    page,
  }) => {
    const kinds = assertExtractionIsAlive()
    const idOfKind = firstWidgetIdPerKind()

    await page.goto(DEMO_ROUTE)
    await expect(page.locator('[data-hmi-screen="component-demo"]')).toBeVisible()

    for (const kind of kinds) {
      const id = idOfKind.get(kind)
      expect(id, `kind "${kind}" has no widget on the demo screen document`).toBeTruthy()

      const cell = page.locator(`[data-hmi-widget="${id}"]`)
      await expect(cell, `kind "${kind}" (widget "${id}") is not on screen at ${DEMO_ROUTE}`).toBeVisible()
      // …and the cell is not merely PLACED. `ScreenRenderer` emits a positioned <div> for every widget
      // in the document whether or not the widget inside it renders anything, so cell visibility alone
      // would be satisfied by a widget that returned null. This asserts something was actually drawn
      // inside it.
      await expect(
        cell.locator("*").first(),
        `kind "${kind}" (widget "${id}") has a grid cell but drew nothing into it`
      ).toBeVisible()
    }

    // The half that makes "the cell is there" mean "the widget ran": an unknown kind, and a widget that
    // threw while rendering, BOTH degrade to `WidgetPlaceholder` — a visible box in the very same cell.
    // Without this, a kind whose component crashed on every render would satisfy every assertion above.
    await expect(
      page.locator("[data-hmi-widget-error]"),
      "a widget on the demo screen degraded to ScreenRenderer's named placeholder — an unknown kind, or " +
        "a widget that threw while rendering; the loop above cannot tell that apart from a real render"
    ).toHaveCount(0)

    // Every widget the document declares was placed — catches a document/renderer mismatch that drops
    // widgets the loop above happens not to sample (the loop only visits the FIRST widget of each kind).
    await expect(page.locator("[data-hmi-widget]")).toHaveCount(DEMO_DOCUMENT.widgets.length)
  })
})
