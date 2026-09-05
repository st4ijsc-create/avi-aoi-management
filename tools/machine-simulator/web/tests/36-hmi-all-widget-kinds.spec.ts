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
 * floor: it cross-checks the extracted key SET against a SECOND, independent reading of the same file
 * (one `./widgets/…` import per registry entry — a different regex reading different lines), fails if
 * either side is empty, and reports the symmetric difference BY NAME so "both sides agree on nothing"
 * cannot pass and a real mismatch names the kind (task-6-review.md LOW-3 — it compared counts until
 * fix round 1, which a compensating pair of mutations could have walked through). The one test below
 * calls it FIRST, so this file cannot go green vacuously.
 *
 * FALSIFIED, not assumed: with the key regex `/^\s*"([^"]+)":/gm` replaced by one that matches nothing,
 * the test below goes RED — "extracted 0 quoted kind keys …" — rather than green. Re-measured on this
 * tree after every fix-round-1 change; the literal output is in `task-6-report.md`.
 *
 * -- What this file measures, and what it does NOT -----------------------------------------------
 * 🔴 task-6-review.md LOW-4 — the DECLARATION half of this pin no longer lives here. "Every registry
 * kind is declared at least once on the demo document" needs no browser at all, and behind a 10–13
 * minute suite it told an author about a missing demo instance far too late. It moved to
 * `runtime-tests/widgetRegistry.test.mjs` (the file that already reads `widgetRegistry.ts` with the
 * same regex), where it runs in the 0.2-second gate, together with the same set-level floor. What is
 * left here is the half that genuinely needs a page.
 *
 * MEASURED, in a real browser, on the real route:
 *   1. Each registry kind's widget cell is on screen and has DRAWN something into it (a rendered
 *      element, not an empty placed div).
 *   2. NOTHING on that screen degraded to `ScreenRenderer`'s named error placeholder — so "the cell is
 *      there" cannot be satisfied by an unregistered kind or a widget that threw, both of which render
 *      a visible `[data-hmi-widget-error]` box in the same cell. These two assertions are NOT
 *      redundant: the reviewer made a real widget throw and watched (1) still pass — `WidgetPlaceholder`
 *      is itself an element in that same cell — while (2) caught it.
 *   3. Every widget the document declares was actually placed (cell count === document widget count).
 *
 * NOT MEASURED HERE, and the bar is deliberately low: that any widget draws the RIGHT thing — correct
 * value, correct tone, correct pixels, correct a11y tree. A widget rendering only its `NO_DATA`
 * em-dash skeleton counts as drawn, and with the fleet stopped six of the fifteen do exactly that
 * (measured by the reviewer). The honest summary of this file is EXECUTED WITHOUT DEGRADING, not
 * DISPLAYING LIVE DATA. It is a coverage pin, not a per-widget acceptance test; `11-hmi.spec.ts` and
 * `00-visual-and-a11y.spec.ts` own pixels and axe for the three shipped screens, and the demo screen
 * deliberately has no baseline of its own (adding one would make an engineering scratch pad a pixel
 * contract). Also not measured: that `policyAction` means anything server-side — see
 * `task-6-report.md` for what the client-side gate does with an action it does not recognise, and
 * `shared.ts`'s own note on why the two vocabularies are disjoint today.
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
 *
 * 🔴 task-6-review.md LOW-3 — this compared the two COUNTS until fix round 1. Every single-sided
 * defect the reviewer constructed went red on counts alone (eight mutations, all named in that
 * review), but a COMPENSATING PAIR would not: one key dropping out of the key extraction while a
 * spurious `./widgets/…` import line appears elsewhere leaves both numbers at 15 and the kind set
 * wrong by one. It compares the two SETS now and reports the symmetric difference, so a mismatch
 * names the kind instead of a number.
 *
 * That makes this floor depend on a real constraint the registry already satisfies: each widget's
 * MODULE BASENAME equals its kind string (`"gauge": GaugeWidget` imported from `./widgets/gauge`),
 * true for all fifteen entries today. This is the same category of constraint `widgetRegistry.ts`'s
 * own header already imposes for a test's sake (every key stays quoted, or the extraction silently
 * stops seeing it) — deliberate, and stated so a rename does not look like a mysterious failure. The
 * message below names the convention, so a legitimate rename is a two-minute fix with a clear cause
 * rather than a puzzle.
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
      "floor depends on is itself broken, so the set comparison below would compare a real set against " +
      "an empty one and report every kind as missing for the wrong reason"
  ).toBeGreaterThan(0)

  // Symmetric difference, both directions named separately — "these keys have no module" and "these
  // modules have no key" are different defects and a single merged list would make the reader guess.
  const importSet = new Set(imports)
  const keySet = new Set(kinds)
  const keysWithoutModule = kinds.filter((k) => !importSet.has(k)).sort()
  const modulesWithoutKey = imports.filter((m) => !keySet.has(m)).sort()
  expect(
    { keysWithoutModule, modulesWithoutKey },
    `the two independent readings of widgetRegistry.ts name DIFFERENT kinds. Quoted keys with no ` +
      `matching ./widgets/<kind> import: ${keysWithoutModule.join(", ") || "(none)"}. Imports with no ` +
      `matching key: ${modulesWithoutKey.join(", ") || "(none)"}. Either an entry was added without ` +
      `its import (or vice versa), or one extraction has stopped seeing what it reads, or a widget ` +
      `module was renamed away from its kind string — this floor depends on those matching`
  ).toEqual({ keysWithoutModule: [], modulesWithoutKey: [] })
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

  test("🔴 the DEMO route makes NO published-screen request — a URL that NAMES a document is not answered with a different one", async ({
    page,
  }) => {
    /**
     * PERIMETER SWEEP ROW W22, closed. `scripts/delete-and-redden-web.sh`'s W22 deletes the demo
     * route's exclusion from the machine-panel lookup in `routes/Hmi.tsx`:
     *
     *     const kioskScreenId = screenId === undefined ? machineScreenId(code) : undefined
     *                        → const kioskScreenId = machineScreenId(code)
     *
     * That line's own comment calls the exclusion deliberate and says why: `/hmi/demo/{screenId}`
     * NAMES a document, and answering a URL that named one document with a different one is the exact
     * defect `35-hmi-indirect-binding.spec.ts`'s third test exists to prevent. It is excluded AT THE
     * FETCH, not merely at the render, so the demo route makes no request it would then ignore.
     *
     * 🔴 THE POSITIVE HALF OF THAT CLAIM IS PINNED IN THREE PLACES AND THE NEGATIVE HALF WAS PINNED IN
     * NONE — which is why the mutation was green. Of the four specs that visit `/hmi/demo/` (35, 36,
     * 37, 41), not one asserted that the route issues no `/v1/screens/` request; and
     * `43-editor-acceptance.spec.ts`, the spec that owns the "the kiosk really did ask the store"
     * assertion, never visits the demo route at all. Asserting that a document RENDERS cannot see this:
     * `demoScreen` is still FIRST in `kioskDoc`'s `??` chain, so under the mutation the right document
     * is still drawn. What changes is invisible to every existing assertion — the route fires a doomed
     * `GET /v1/screens/machine-iot-01` and gates its first paint on `publishedScreen.isPending`.
     *
     * So this test asserts the ABSENCE, which is the half nobody held. The id is not derived here at
     * all — the assertion is that NO `/v1/screens/` path is requested, which is stronger than naming
     * one and cannot be satisfied by a build that merely spells the doomed id differently.
     * `DEMO_MACHINE_CODE` is `IOT-01` (`src/lib/hmiScreens.ts`), so the request the exclusion prevents
     * is the one for `machine-iot-01`.
     */
    const asked: string[] = []
    page.on("request", (req) => {
      const path = new URL(req.url()).pathname
      if (path.startsWith("/v1/screens/")) asked.push(path)
    })

    await page.goto(DEMO_ROUTE)

    // The demo document is on screen — so the route really did run, and an empty `asked` below means
    // "asked nothing", not "rendered nothing".
    await expect(page.locator('[data-hmi-screen="component-demo"]')).toBeVisible()
    await expect(page.locator("[data-hmi-widget]")).toHaveCount(DEMO_DOCUMENT.widgets.length)

    /**
     * 🔴 READ AFTER A SETTLE, NOT AT FIRST PAINT. There is no positive signal for "a request was never
     * made", so this is a real sleep — the same idiom as `43-editor-acceptance.spec.ts`'s
     * `SCREEN_HOLD_MS` and `deadlines.ts`'s `TONE_SETTLE_MS`. Without it a build that DOES fire the
     * doomed GET could be counted before the request left, which is a false green. It cannot produce a
     * false red: a route that issues no request issues none however long anybody waits.
     */
    await page.waitForTimeout(1000)

    expect(
      asked,
      `${DEMO_ROUTE} requested ${JSON.stringify(asked)} from the published-screen store. The demo route ` +
        `NAMES the document it wants; a machine-panel lookup here can answer that URL with a different ` +
        `document, and it gates the demo screen's first paint on a request it never asked for. See ` +
        `kioskScreenId in src/routes/Hmi.tsx.`
    ).toEqual([])

    page.removeAllListeners("request")
  })
})
