import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-2 Task 8 — `/editor/{screenId}`: the editor shell, the read-only canvas, and the one
 * proposition the plan calls the most expensive of Phase 3 — **the canvas is the runtime
 * `ScreenRenderer`, not a second renderer.**
 *
 * ── 🔴 WHERE THE IDENTITY CLAIM ACTUALLY LIVES, AND WHY IT IS NOT IN THIS FILE ────────────────────
 * FIX ROUND 1, task-8-review.md findings 1 and 2. The round-0 header claimed the five assertions below
 * were chosen so that a reimplementation would fail them, and gave two reasons that are FALSE. Both are
 * corrected in place rather than deleted, because they are the exact reasoning a later reader would
 * otherwise repeat:
 *
 *   * "A second renderer would have to re-import the industrial primitive AND re-wire the binding seam
 *     to fake this, at which point it is not a second renderer" — WRONG. It costs one
 *     `import { widgetRegistry }` and one `resolveBinding(b, undefined)`. The reviewer wrote it; it is
 *     unambiguously a second renderer; assertion 2 passed against it.
 *   * "A hand-rolled canvas never mounts `LabelWidget`, so nothing throws and nothing is caught — this
 *     assertion cannot be satisfied accidentally by anything" — WRONG. A canvas that dispatches through
 *     `widgetRegistry` mounts the REAL `LabelWidget`, which really throws, and any boundary of its own
 *     really catches. The reviewer's impostor emitted `role="alert"` and
 *     `data-hmi-widget-error="probe-crash"` and differed only in the message TEXT.
 *
 * Measured, not argued — three impostors, all recorded in `runtime-tests/editorCanvasSeam.test.mjs`'s
 * header: a second renderer with its own wording failed ONE assertion, on a string comparison; the same
 * renderer with the runtime's two degrade sentences copied (two one-line edits) PASSED ALL THREE tests
 * in this file; and a verbatim FORK of `ScreenRenderer.tsx` under `src/editor/`, with
 * `clampRectToLayout` deleted and the grid gap changed — a canvas that provably lays screens out
 * differently from the kiosk — ALSO PASSED ALL THREE.
 *
 * ── 🔴 FIX ROUND 2 — TWO MORE SENTENCES FROM ROUND 1, RETRACTED HERE, QUOTED IN FULL ─────────────
 * task-8-re-review.md §6. Round 1 corrected two false claims and introduced two more in the
 * correction. Both stood in this header and both are quoted below before being replaced, because a
 * paragraph rewritten for overstating is the last place a new overstatement should hide — and this
 * workstream has now produced one three times running.
 *
 *   * RETRACTED: *"No browser assertion can [pin that it IS the runtime renderer]: a fork renders
 *     identically until it drifts, and the drift is invisible to any test that only reads the DOM the
 *     fork produced."* Over-broad, and it was the stated reason round 1 added no browser test. A
 *     DIFFERENTIAL browser assertion — the same document through the kiosk route and through the
 *     editor route, outputs compared — catches a fork the moment it drifts, which is the only moment
 *     a fork can hurt anyone. The defensible sentence is: *no browser assertion can catch a fork that
 *     has not yet drifted.* That test now exists, at the bottom of this file, and it is the PRIMARY
 *     instrument for the identity claim.
 *   * RETRACTED: *"The two files close it TOGETHER, and the composition is a pincer … every locator
 *     below is built on `data-hmi-screen` / `data-hmi-widget` / `data-hmi-widget-error`, so any
 *     impostor must emit those to be green here — and that pin asserts only `ScreenRenderer.tsx`
 *     emits them anywhere in `web/src/`. Rename the hooks and this file goes red; keep them and that
 *     one does."* **Measured false.** The reviewer's impostor C kept all three hooks and the
 *     structural pin stayed green: it attached them by spreading `{...widgetHook(id)}` from a helper
 *     holding a `"data-hmi-widget"` constant, which the round-1 pin's substring scan could not see —
 *     and a single space, `data-hmi-screen ={x}`, was enough on its own. The second half of the
 *     "pincer" was simply not true of the code that existed.
 *
 * **No replacement general claim is offered.** What is true is narrower and is stated per test, below
 * and at the differential's own header: this file's first five assertions are a behavioural floor; the
 * differential compares the editor's output against the runtime's own output for the same document;
 * `runtime-tests/editorCanvasSeam.test.mjs` is a cheap early warning that runs in under a second. Each
 * one says what it catches and what it does not.
 *
 * ── WHAT THE FIVE ASSERTIONS DO PIN, EACH AT ITS REAL WIDTH ───────────────────────────────────────
 * They are a BEHAVIOURAL FLOOR — the set of runtime behaviours the canvas must exhibit, each one
 * genuinely reachable only by running the runtime's own machinery, none of them evidence of WHICH copy
 * of that machinery ran. Every one is falsified by a real mutation recorded in `task-8-report.md`.
 *
 *   1. `props.text` reaches the screen (`probe-label`) — so `widgetRegistry` dispatch into
 *      `widgets/label.tsx` happened. Discriminates against a canvas that draws its own boxes (F1);
 *      does NOT discriminate against one that reuses the registry.
 *   2. A bound value reaches the screen (`probe-readout`), asserted on `.hmi-readout-value` —
 *      `Readout.tsx`'s own class on its own row — carrying a number that exists only if
 *      `bindings.value` → `resolve()` → `TagValueSource.get()` → `formatValue` → `formatMetric` all
 *      ran. Discriminates against a canvas with no binding seam (F1b) and against a source that
 *      answers nothing (F4); does NOT discriminate against a second renderer that calls
 *      `resolveBinding` itself.
 *   3. A `kind` naming nothing degrades to `unknown widget kind "…"`, `role="alert"` (`probe-kind`).
 *      Discriminates against an editor that filters unknown kinds out before drawing (F5); does NOT
 *      discriminate against a renderer that copies the sentence — that is precisely what took the
 *      reviewer's impostor A to A2.
 *   4. A widget that THROWS is caught per-widget while its siblings keep drawing (`probe-crash`).
 *      Discriminates against an editor that strips the props that cause it (F7) and against a canvas
 *      that never mounts the real widget at all; does NOT discriminate against a second renderer with
 *      its own boundary and the message copied.
 *   5. A moved `rect` produces `col + 1 / span colSpan` on both axes. Discriminates against a canvas
 *      that re-lays widgets out itself (F6a); does NOT discriminate against anything that copies eight
 *      lines of arithmetic — the reviewer's impostor replicated it and every grid assertion passed.
 *
 * Assertion 5's admission was the only one round 0 made. Rows 1-4 now say the same thing, because it
 * was equally true of them.
 *
 * ── THE DOCUMENT COMES OVER HTTP, AND THAT IS ASSERTED, NOT ASSUMED ───────────────────────────────
 * `/hmi/demo/:screenId` (Task 5) resolves its document from a STATIC map bundled into the JS
 * (`lib/hmiScreens.ts`), and `Hmi.tsx`'s own header names that as the reason "an engineer at the
 * factory must be able to fix the screen without rebuilding the app" is still unmet there. The editor
 * route must not inherit that: the first test below records every response the page receives and
 * asserts a real `200` for `GET /v1/screens/{screenId}`. A canvas fed from a static import would draw
 * the same widgets and fail exactly that assertion.
 *
 * ── ON `probe-kind`, WHICH IS DELIBERATELY SCHEMA-INVALID ─────────────────────────────────────────
 * `DOC_V2`'s `probe-kind` widget declares `kind: "no-such-widget-kind"`, which
 * `contracts/hmi-screen.schema.json` does NOT allow (`kind` is a closed 15-member enum). It is stored
 * anyway, and that is a measured property of the write door rather than an accident here:
 * `ContractInvariants.Validate(HmiScreenDocument)` — the gate `HmiScreenStore.PutAsync` calls first —
 * checks `Kind` only for null/whitespace and for the §5 writable-kind rule, never against the enum, so
 * `PUT /v1/screens/{id}` accepts it. That is precisely the situation `ScreenRenderer.tsx` already says
 * it is built for ("a JSON document is not guaranteed to match the `WidgetKind` TYPE at runtime —
 * schema validation happens at authoring/publish time, not here"), and assertion 3 above is what
 * proves the EDITOR inherits that degrade instead of re-deciding it. Named here so a reader does not
 * mistake a deliberate probe for a document nobody checked.
 *
 * ── WHAT THIS FILE DOES NOT MEASURE ───────────────────────────────────────────────────────────────
 * Nothing about pixels: the editor route deliberately has no visual baseline (`00-visual-and-a11y`'s
 * `SCREENS` list is untouched), for the same reason the demo screen has none — a design surface under
 * active construction is not a pixel contract. Nothing about editing: at this task the canvas is
 * read-only and every document change below arrives over HTTP, because there is no editing UI to make
 * one with until Task 9. And nothing about `faceplate`: the design-time source names no machine on
 * purpose (`EditorCanvas.tsx`'s `DESIGN_TIME_SNAPSHOT.code === ""`), so a `faceplate` widget draws an
 * empty cell in the editor — a stated limit of this task, not something a document here hides by
 * avoiding the kind.
 */

const SCREEN_ID = "editor-canvas-probe"
const ROUTE = `/editor/${SCREEN_ID}`

/** A screen id nothing in this suite ever PUTs, so `GET /v1/screens/{id}` genuinely answers 404. The
 * test that uses it asserts that 404 against the engine FIRST, so "the not-found state rendered"
 * cannot be satisfied by a screen that merely failed to load for some other reason. */
const UNDECLARED_SCREEN_ID = "editor-screen-nobody-authored"

// The sentinels. ASCII, unmistakable, and different in every position that matters — a value that
// happened to appear for an unrelated reason would be a coincidence nobody could construct.
const LABEL_TEXT_V1 = "ALPHA-LABEL-BEFORE-EDIT"
const LABEL_TEXT_V2 = "BRAVO-LABEL-AFTER-EDIT"
const READOUT_LABEL_V1 = "ALPHA-READOUT-BEFORE-EDIT"
const READOUT_LABEL_V2 = "BRAVO-READOUT-AFTER-EDIT"
const READOUT_UNIT_V2 = "rpm"
const UNKNOWN_KIND = "no-such-widget-kind"

/**
 * What `probe-readout` must show, and why it is written out as a LITERAL here rather than imported
 * from `EditorCanvas.tsx`.
 *
 * `bindings.value = "cycles"` resolves through the design-time source, which is
 * `createMachineDetailSource(DESIGN_TIME_SNAPSHOT)` — the RUNTIME adapter over a frozen fabricated
 * snapshot whose `cycles` is 128 — and `shared.ts`'s `formatValue` hands a number to `formatMetric`,
 * which renders `abs >= 100` with one decimal. So "128.0" is the whole pipeline's output, not a
 * constant either side can read from the other.
 *
 * Importing the snapshot to compute this would make the assertion pass at ANY value the canvas
 * happened to show — the one-directional-pin defect this tree has been caught by repeatedly (see
 * `editorState.ts`'s note on `UNDO_DEPTH_LIMIT`). The duplication is deliberate: changing the
 * design-time snapshot SHOULD redden this test, because "what the editor's canvas displays for a
 * bound value" is the thing being pinned.
 */
const READOUT_VALUE = "128.0"

/**
 * ── THE DIFFERENTIAL: THE PRIMARY INSTRUMENT FOR THE CANVAS-IDENTITY CLAIM ───────────────────────
 * WS-HMI-2 Task 8, fix round 2, task-8-re-review.md §9.
 *
 * Everything above measures the editor's canvas against a DESCRIPTION of the runtime's behaviour, and
 * the re-review proved that is not enough: a second renderer that reuses `widgetRegistry` satisfies
 * every such description, and a FORK satisfies them by construction. What no impostor can satisfy is a
 * comparison against the runtime ITSELF.
 *
 * So: the SAME document is rendered through the kiosk route (`/hmi/demo/:screenId` →
 * `routes/Hmi.tsx` → `<ScreenRenderer>` with a live `MachineDetail` source) and through the editor
 * route (`/editor/:screenId` → `EditorCanvas` → `<ScreenRenderer>` with the design-time source), and
 * what the RENDERER produced is compared.
 *
 * ── WHAT IS COMPARED, AND WHY IT IS THIS AND NOT A SCREENSHOT ────────────────────────────────────
 * `ScreenRenderer`'s own output is a container plus one placed cell per widget. That is exactly the
 * part that must not drift, and exactly the part that is independent of live values:
 *   * the container: `data-theme`, `display`, the NUMBER of grid tracks on each axis, and the gaps;
 *   * each cell, in document order: its id, its `title` (where the clamp and unresolved-`{component}`
 *     warnings surface), and its four computed grid lines.
 * Track COUNTS rather than track widths, because the two pages give the grid different physical widths
 * — a kiosk tabpanel beside a control rail versus the editor's full-width frame — and a pixel
 * comparison would fail for a reason that has nothing to do with the renderer. Gaps are absolute and
 * are compared as computed pixels, which is what catches a fork that changed `gap-2` to `gap-6`.
 *
 * Widget SUBTREES are compared only for widgets the document gives no bindings and that are not
 * `faceplate` — for those, both pages must produce the identical element/class tree. Bound widgets
 * legitimately differ (live machine values on one side, the fabricated design-time snapshot on the
 * other) and `faceplate` deliberately renders nothing in the editor (`EditorCanvas.tsx`'s
 * `DESIGN_TIME_SNAPSHOT.code === ""`). Comparing their text would be measuring the value source, not
 * the renderer.
 *
 * ── THE TWO PRECONDITIONS, AND WHY EACH IS NECESSARY ─────────────────────────────────────────────
 *  1. `IOT-01` is given an EMPTY component model first. The demo document binds `{component}` on two
 *     widgets; the kiosk resolves those through `GET /v1/components/IOT-01` while the editor has no
 *     machine and passes `components` undefined. With a model declared, the kiosk resolves and the
 *     editor does not, so the two `title` warnings differ — legitimately, and for a reason that is
 *     about the component model rather than the renderer. Emptied, both sides take the identical
 *     `componentTagPrefixOf(… ) === undefined` path (`35-hmi-indirect-binding.spec.ts` establishes
 *     that an emptied tree and a never-declared machine are the same input downstream).
 *  2. The demo document's own bytes are PUT to `/v1/screens/component-demo`, so the document the
 *     editor fetches over HTTP is the document the kiosk imports statically. Read from the file rather
 *     than retyped — a second copy would drift and the comparison would silently become vacuous.
 *
 * ── WHAT THIS CATCHES THAT NOTHING ELSE DID ──────────────────────────────────────────────────────
 * A drifted fork. `task-8-re-review.md`'s impostor B — `ScreenRenderer.tsx` copied into `src/editor/`
 * with `clampRectToLayout` deleted and `gap-2` changed to `gap-6` — passed all three tests above and
 * every check in `runtime-tests/editorCanvasSeam.test.mjs` at the time it was built. Its changed gap
 * is a computed-style difference on the container, and this test reads it.
 *
 * ── AND WHAT IT DOES NOT CATCH, STATED BEFORE ANYONE INFERS OTHERWISE ────────────────────────────
 * A fork that has NOT yet drifted. A byte-identical copy renders byte-identical output, and no
 * comparison of outputs can tell it from the original. That is the honest limit, and it is narrower
 * than it sounds: the copy is caught by this same test on the first day `ScreenRenderer` changes and
 * the copy does not — which is the only day the difference can hurt anyone.
 * `runtime-tests/editorCanvasSeam.test.mjs` is the cheap early warning for the interval before that
 * day; it is not a proof of identity and does not claim to be.
 */
const DEMO_SCREEN_ID = "component-demo"
const DEMO_MACHINE = "IOT-01"

/** The kiosk's own copy, read from disk — the same file `lib/hmiScreens.ts` imports statically. */
const DEMO_DOCUMENT = JSON.parse(
  readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "screens", "demo", "component-demo.json"), "utf8")
) as ProbeDocument & { widgets: (ProbeWidget & { component?: string })[] }

/** §5-bis's state, written explicitly rather than inherited from whatever `35-hmi-indirect-binding`
 * left behind. See precondition 1 above for why the differential needs it. */
const EMPTY_COMPONENT_MODEL = { schemaVersion: 1, machineCode: DEMO_MACHINE, components: [], types: [] }

async function putComponentModel(request: APIRequestContext, doc: unknown): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/components/${DEMO_MACHINE}`, { data: doc })
  if (!res.ok()) throw new Error(`PUT /v1/components/${DEMO_MACHINE} failed: ${res.status()} ${await res.text()}`)
}

/** The widgets whose subtrees are legitimately comparable across the two paths — no bindings (so no
 * live value reaches them) and not `faceplate` (which draws nothing in the editor, by design). */
const STATIC_WIDGET_IDS = DEMO_DOCUMENT.widgets
  .filter((w) => !w.bindings && w.kind !== "faceplate")
  .map((w) => w.id)

type RendererSignature = {
  theme: string | null
  display: string
  columnTracks: number
  rowTracks: number
  columnGap: string
  rowGap: string
  cells: { id: string | null; title: string | null; colStart: string; colEnd: string; rowStart: string; rowEnd: string }[]
  staticSubtrees: Record<string, string>
}

/** Everything `ScreenRenderer` itself is responsible for, read out of a live page. */
async function rendererSignature(page: Page, screenId: string, staticIds: string[]): Promise<RendererSignature> {
  return page.evaluate(
    ([id, ids]) => {
      const root = document.querySelector(`[data-hmi-screen="${id}"]`)
      if (!root) throw new Error(`no [data-hmi-screen="${id}"] on this page`)
      const rootStyle = getComputedStyle(root)
      const structure = (el: Element): string => {
        const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).sort().join(".")
        const kids = Array.from(el.children).map(structure)
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${kids.length ? `(${kids.join(",")})` : ""}`
      }
      const cells = Array.from(root.querySelectorAll("[data-hmi-widget]")).map((el) => {
        const s = getComputedStyle(el)
        return {
          id: el.getAttribute("data-hmi-widget"),
          title: el.getAttribute("title"),
          colStart: s.gridColumnStart,
          colEnd: s.gridColumnEnd,
          rowStart: s.gridRowStart,
          rowEnd: s.gridRowEnd,
        }
      })
      const staticSubtrees: Record<string, string> = {}
      for (const widgetId of ids) {
        const cell = root.querySelector(`[data-hmi-widget="${widgetId}"]`)
        staticSubtrees[widgetId] = cell ? Array.from(cell.children).map(structure).join(",") : "(cell missing)"
      }
      return {
        theme: root.getAttribute("data-theme"),
        display: rootStyle.display,
        // Track COUNTS, not widths — see this block's own header for why a pixel comparison would fail
        // for a reason unrelated to the renderer.
        columnTracks: rootStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
        rowTracks: rootStyle.gridTemplateRows.split(" ").filter(Boolean).length,
        columnGap: rootStyle.columnGap,
        rowGap: rootStyle.rowGap,
        cells,
        staticSubtrees,
      }
    },
    [screenId, staticIds] as const
  )
}

/** A document whose last widget hangs off the right edge and the bottom of its own declared grid —
 * `clampRectToLayout`'s subject. `col + colSpan = 14 > cols = 12` and `row + rowSpan = 6 > rows = 4`. */
const OVERFLOW_SCREEN_ID = "editor-canvas-overflow"
const OVERFLOW_DOC: ProbeDocument = {
  schemaVersion: 1,
  screenId: OVERFLOW_SCREEN_ID,
  title: "Canvas probe — rect ngoai luoi",
  theme: "isa101",
  layout: { cols: 12, rows: 4, breakpoint: "panel" },
  widgets: [
    { id: "fits", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 }, props: { text: "IN-GRID" } },
    { id: "overflows", kind: "label", rect: { col: 10, row: 3, colSpan: 4, rowSpan: 3 }, props: { text: "OUT-OF-GRID" } },
  ],
}

type ProbeWidget = {
  id: string
  kind: string
  rect: { col: number; row: number; colSpan: number; rowSpan: number }
  bindings?: Record<string, string>
  props?: Record<string, unknown>
}

type ProbeDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  theme: string
  layout: { cols: number; rows: number; breakpoint: string }
  widgets: ProbeWidget[]
}

/** Version 1: five widgets, all of registered kinds, nothing degraded. */
const DOC_V1: ProbeDocument = {
  schemaVersion: 1,
  screenId: SCREEN_ID,
  title: "Canvas probe — truoc khi sua",
  theme: "isa101",
  layout: { cols: 12, rows: 4, breakpoint: "panel" },
  widgets: [
    { id: "probe-label", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 }, props: { text: LABEL_TEXT_V1 } },
    {
      id: "probe-readout",
      kind: "readout",
      rect: { col: 4, row: 0, colSpan: 4, rowSpan: 1 },
      bindings: { value: "cycles" },
      props: { label: READOUT_LABEL_V1 },
    },
    {
      id: "probe-moved",
      kind: "gauge",
      rect: { col: 8, row: 0, colSpan: 4, rowSpan: 1 },
      bindings: { value: "telemetry/temperature" },
      props: { label: "Nhiet do", min: 0, max: 60 },
    },
    { id: "probe-removed", kind: "sheet", rect: { col: 0, row: 1, colSpan: 6, rowSpan: 1 }, props: { title: "Khung se bi xoa" } },
    { id: "probe-kind", kind: "sheet", rect: { col: 6, row: 1, colSpan: 6, rowSpan: 1 }, props: { title: "Khung se doi kind" } },
  ],
}

/**
 * Version 2 — the same screen, edited in five independent ways at once, so one page load measures all
 * five. Deliberately keeps the widget COUNT at five (one removed, one added) so a test that only
 * counted cells would see nothing at all change: the id LIST below is what catches it.
 */
const DOC_V2: ProbeDocument = {
  ...DOC_V1,
  title: "Canvas probe — sau khi sua",
  widgets: [
    // (1) a prop edit — the text a `label` widget draws
    { id: "probe-label", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 1 }, props: { text: LABEL_TEXT_V2 } },
    // (2) a prop edit on a widget whose VALUE comes through the binding seam — label and unit change,
    //     the bound reading does not, so the reading is evidence the seam still ran after the edit
    {
      id: "probe-readout",
      kind: "readout",
      rect: { col: 4, row: 0, colSpan: 4, rowSpan: 1 },
      bindings: { value: "cycles" },
      props: { label: READOUT_LABEL_V2, unit: READOUT_UNIT_V2 },
    },
    // (3) a rect edit — same widget, different grid cell and a different span in BOTH axes
    {
      id: "probe-moved",
      kind: "gauge",
      rect: { col: 0, row: 2, colSpan: 3, rowSpan: 2 },
      bindings: { value: "telemetry/temperature" },
      props: { label: "Nhiet do", min: 0, max: 60 },
    },
    // (4) a kind edit to something the registry does not know — see this file's header on why the
    //     write door accepts it
    { id: "probe-kind", kind: UNKNOWN_KIND, rect: { col: 6, row: 1, colSpan: 6, rowSpan: 1 }, props: { title: "Khung se doi kind" } },
    // (5) a widget added, whose real implementation throws — `widgets/label.tsx`'s permanent,
    //     narrowly-scoped `__testOnlyThrow` hook, the same one `34-hmi-widget-error-boundary.spec.ts`
    //     drives on the kiosk. Only a canvas that actually MOUNTS `LabelWidget` can crash here.
    {
      id: "probe-crash",
      kind: "label",
      rect: { col: 9, row: 3, colSpan: 3, rowSpan: 1 },
      props: { text: "never rendered", __testOnlyThrow: true },
    },
    // `probe-removed` is gone.
  ],
}

const IDS_V1 = ["probe-label", "probe-readout", "probe-moved", "probe-removed", "probe-kind"]
const IDS_V2 = ["probe-label", "probe-readout", "probe-moved", "probe-kind", "probe-crash"]

/** `PUT /v1/screens/{screenId}` — appends a version and makes it current. Fails LOUDLY with the
 * engine's own body: a refused document must not look like a canvas that drew nothing. */
async function putScreen(request: APIRequestContext, doc: ProbeDocument): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) {
    throw new Error(`PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}`)
  }
}

/** The widget ids the canvas actually placed, in DOM order — `data-hmi-widget` is `ScreenRenderer`'s
 * own per-widget hook. Order matters: `ScreenRenderer` renders `widgets.map(...)` in document order,
 * which is what Task 11's z-order work will depend on. */
async function placedWidgetIds(page: Page): Promise<(string | null)[]> {
  return page.locator("[data-hmi-widget]").evaluateAll((els) => els.map((el) => el.getAttribute("data-hmi-widget")))
}

test.describe("HMI screen editor — the canvas is the runtime renderer, and the document arrives over HTTP", () => {
  test("/editor/{screenId} loads the document from GET /v1/screens/{screenId} and draws every widget it declares", async ({
    page,
    request,
  }) => {
    await putScreen(request, DOC_V1)

    // Recorded, not waited on — asserting after the canvas is on screen means the response has
    // necessarily already arrived, and a passive listener costs no declared timeout budget.
    const screenResponses: string[] = []
    page.on("response", (res) => {
      const url = new URL(res.url())
      if (url.pathname === `/v1/screens/${SCREEN_ID}`) screenResponses.push(`${res.request().method()} ${res.status()}`)
    })

    await page.goto(ROUTE)

    // The editor's OWN frame — not the kiosk. `EditorCanvas` renders this; `Hmi.tsx` does not.
    await expect(page.locator(`[data-editor-canvas="${SCREEN_ID}"]`)).toBeVisible()

    // `ScreenRenderer`'s own root, carrying the two document fields it surfaces as DOM.
    const root = page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)
    await expect(root).toBeVisible()
    await expect(root).toHaveAttribute("data-theme", DOC_V1.theme)

    await expect(page.locator("[data-hmi-widget]")).toHaveCount(DOC_V1.widgets.length)
    expect(await placedWidgetIds(page)).toEqual(IDS_V1)
    await expect(
      page.locator("[data-hmi-widget-error]"),
      "a widget degraded to ScreenRenderer's named placeholder on a document where every kind is registered"
    ).toHaveCount(0)

    // The document came over the wire. A canvas fed by a static import (the shape `/hmi/demo/:screenId`
    // still has) draws exactly the same widgets and records nothing here.
    expect(
      screenResponses,
      `the page never received GET /v1/screens/${SCREEN_ID} — the document did not come over HTTP`
    ).toContain("GET 200")

    // The fabricated-data disclosure `EditorCanvas.tsx` defers to is actually on screen. The canvas
    // shows sample values with the runtime's own quality tones (deliberately NOT downgraded to make
    // them look synthetic), so this sentence is the only thing standing between an engineer and
    // reading a design surface as a live one.
    await expect(page.locator("[data-editor-design-mode]")).toHaveText(viDict.editor.designMode)
  })

  test("an undeclared screenId is a named not-found state — not a blank page, and not an error page", async ({
    page,
    request,
  }) => {
    // Asserted, not assumed: if this id somehow existed, everything below would be measuring the wrong
    // branch and would say so here instead of failing mysteriously downstream.
    const probe = await request.get(`${ENGINE_URL}/v1/screens/${UNDECLARED_SCREEN_ID}`)
    expect(probe.status(), `GET /v1/screens/${UNDECLARED_SCREEN_ID} must be 404 for this test to mean anything`).toBe(404)

    await page.goto(`/editor/${UNDECLARED_SCREEN_ID}`)

    // NOT a blank page: the editor's own chrome is up, and the id the URL named is echoed back — the
    // one thing a mistyped URL needs to show.
    await expect(page.locator("[data-editor-screen-id]")).toHaveText(UNDECLARED_SCREEN_ID)
    await expect(page.locator("[data-editor-design-mode]")).toBeVisible()

    // The named state itself, with a reason.
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title })).toBeVisible()
    await expect(page.locator("[data-editor-notice]")).toContainText(UNDECLARED_SCREEN_ID)

    // NOT an error page. §5-bis's distinction is the whole point: "nobody has authored this screen"
    // is an ordinary product state, and showing the engine-unreachable apology for it reports a working
    // system as broken.
    await expect(
      page.getByText(viDict.common.connectivityError),
      "the undeclared-screen state rendered the connectivity-failure text — a 404 was treated as a fault"
    ).toHaveCount(0)

    // ...and NOT the app's generic 404 either — the route matched, it just has no document.
    await expect(
      page.getByText(viDict.notFound.title),
      "the app's generic page-not-found screen rendered — /editor/:screenId did not match the route at all"
    ).toHaveCount(0)

    // Nothing was drawn, because there is nothing to draw.
    await expect(page.locator("[data-hmi-screen]")).toHaveCount(0)
  })

  test("editing widgets in the document changes what the canvas draws, in the ways only the runtime renderer produces", async ({
    page,
    request,
  }) => {
    // Nothing may escape a widget's error boundary to the window — a boundary that "catches" while the
    // framework still reports an uncaught error leaves a real crash reporter unable to tell the two
    // apart. Same assertion, same reasoning, as `34-hmi-widget-error-boundary.spec.ts`.
    const pageErrors: string[] = []
    page.on("pageerror", (err) => pageErrors.push(err.message))

    // ── BEFORE ────────────────────────────────────────────────────────────────────────────────────
    await putScreen(request, DOC_V1)
    await page.goto(ROUTE)
    await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()

    const label = page.locator('[data-hmi-widget="probe-label"]')
    const readout = page.locator('[data-hmi-widget="probe-readout"]')
    const moved = page.locator('[data-hmi-widget="probe-moved"]')

    // (1) `props.text`, drawn by the registry's own `label` implementation.
    await expect(label).toHaveText(LABEL_TEXT_V1)
    // (2) the industrial `Readout` primitive's own value row, carrying the design-time source's reading.
    await expect(readout.locator(".hmi-readout-value")).toHaveText(READOUT_VALUE)
    await expect(readout).toContainText(READOUT_LABEL_V1)
    // (5) `ScreenRenderer`'s own 1-based grid arithmetic over the document's 0-based rect.
    await expect(moved).toHaveCSS("grid-column-start", "9")
    await expect(moved).toHaveCSS("grid-column-end", "span 4")
    await expect(moved).toHaveCSS("grid-row-start", "1")
    await expect(moved).toHaveCSS("grid-row-end", "span 1")

    expect(await placedWidgetIds(page)).toEqual(IDS_V1)
    await expect(page.locator("[data-hmi-widget-error]")).toHaveCount(0)

    // ── THE EDIT ──────────────────────────────────────────────────────────────────────────────────
    await putScreen(request, DOC_V2)
    await page.goto(ROUTE)
    await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()

    // (1) the text changed. A canvas labelling boxes by widget id shows "probe-label" both times.
    await expect(label).toHaveText(LABEL_TEXT_V2)
    // (2) the label and unit changed, and the bound reading still came through the seam — the unit is
    //     rendered by `Readout` beside the value in the SAME row, so this one assertion covers both.
    //     No space between them: `Readout.tsx` puts value and unit in two sibling spans separated by a
    //     flex `gap-1.5`, i.e. the space an operator SEES is CSS, not a text node, and `toHaveText`
    //     reads `textContent`. Measured, not guessed — the first green run reported "128.0rpm".
    await expect(readout.locator(".hmi-readout-value")).toHaveText(`${READOUT_VALUE}${READOUT_UNIT_V2}`)
    await expect(readout).toContainText(READOUT_LABEL_V2)
    // (3) the moved widget's placement follows the new rect, in both axes and both spans.
    await expect(moved).toHaveCSS("grid-column-start", "1")
    await expect(moved).toHaveCSS("grid-column-end", "span 3")
    await expect(moved).toHaveCSS("grid-row-start", "3")
    await expect(moved).toHaveCSS("grid-row-end", "span 2")

    // (4) a kind the registry does not know degrades to `ScreenRenderer`'s own named placeholder,
    //     which quotes the offending kind back.
    const unknownKind = page.locator('[data-hmi-widget-error="probe-kind"]')
    await expect(unknownKind).toBeVisible()
    await expect(unknownKind).toHaveAttribute("role", "alert")
    await expect(unknownKind).toContainText(`unknown widget kind "${UNKNOWN_KIND}"`)

    // (5) a widget whose REAL implementation throws is caught by `ScreenRenderer`'s own per-widget
    //     boundary. Nothing but the runtime renderer mounting the real `LabelWidget` can produce this.
    const crashed = page.locator('[data-hmi-widget-error="probe-crash"]')
    await expect(crashed).toBeVisible()
    await expect(crashed).toHaveAttribute("role", "alert")
    await expect(crashed).toContainText("crashed while rendering")
    await expect(crashed).toContainText("PROBE: deliberate widget crash")

    // Exactly two degraded — so the two placeholders above are the ONLY things that degraded, and the
    // widgets asserted alive above really are alive rather than quietly showing a placeholder each.
    await expect(page.locator("[data-hmi-widget-error]")).toHaveCount(2)

    // The removed widget is gone, the added one is present, and document order is preserved. The count
    // is unchanged at five, so this list is the only thing that sees the membership change.
    expect(await placedWidgetIds(page)).toEqual(IDS_V2)
    await expect(page.locator('[data-hmi-widget="probe-removed"]')).toHaveCount(0)

    expect(pageErrors, "an error escaped a widget's boundary to the window").toEqual([])
  })

  test("the kiosk and the editor render the same document identically — the canvas compared against the runtime itself, not against a description of it", async ({
    page,
    request,
  }) => {
    // Precondition 1 — see this block's header: without it the two paths differ in the {component}
    // warning for a reason that is about the component model, not the renderer.
    await putComponentModel(request, EMPTY_COMPONENT_MODEL)
    // Precondition 2 — the editor fetches over HTTP; the kiosk imports statically. Same bytes.
    await putScreen(request, DEMO_DOCUMENT as ProbeDocument)

    // Asserted, not assumed: a broken extraction here would compare two empty widget lists and pass.
    expect(
      STATIC_WIDGET_IDS.length,
      "no widget in the demo document is binding-free — the subtree half of this comparison would measure nothing"
    ).toBeGreaterThan(0)

    await page.goto(`/hmi/demo/${DEMO_SCREEN_ID}`)
    await expect(page.locator(`[data-hmi-screen="${DEMO_SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator("[data-hmi-widget]")).toHaveCount(DEMO_DOCUMENT.widgets.length)
    const kiosk = await rendererSignature(page, DEMO_SCREEN_ID, STATIC_WIDGET_IDS)

    await page.goto(`/editor/${DEMO_SCREEN_ID}`)
    await expect(page.locator(`[data-editor-canvas="${DEMO_SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator(`[data-hmi-screen="${DEMO_SCREEN_ID}"]`)).toBeVisible()
    await expect(page.locator("[data-hmi-widget]")).toHaveCount(DEMO_DOCUMENT.widgets.length)
    const editor = await rendererSignature(page, DEMO_SCREEN_ID, STATIC_WIDGET_IDS)

    // The floor for the comparison itself: a signature that read nothing would compare two empty
    // objects and pass. Both must actually describe the grid this document declares.
    expect(kiosk.display, "the kiosk's screen root is not a CSS grid — the signature read the wrong element").toBe("grid")
    expect(kiosk.columnTracks).toBe(DEMO_DOCUMENT.layout.cols)
    expect(kiosk.rowTracks).toBe(DEMO_DOCUMENT.layout.rows)
    expect(kiosk.cells.length).toBe(DEMO_DOCUMENT.widgets.length)

    expect(
      editor,
      "the editor's canvas and the kiosk produced DIFFERENT output for the same document. Compare the diff " +
        "above: a changed gap, a changed grid line, a missing title warning or a different element tree means " +
        "the two paths are no longer the same renderer — a fork that has drifted, or a second renderer. This " +
        "is the assertion the canvas-identity claim rests on."
    ).toEqual(kiosk)
  })

  test("a rect that overflows its own layout is clamped and says so, on the editor's canvas too", async ({
    page,
    request,
  }) => {
    // `clampRectToLayout` is one of the two behaviours `task-8-re-review.md`'s impostor B deleted from
    // its fork, and the differential above cannot see it: the demo document has no out-of-grid widget,
    // and the kiosk route can only render documents that ship in `lib/hmiScreens.ts`. Measured here on
    // the editor path instead, against the renderer's own documented contract — never dropped, never
    // allowed to overflow, and warned about where an engineer with no devtools open can see it.
    await putScreen(request, OVERFLOW_DOC)
    await page.goto(`/editor/${OVERFLOW_SCREEN_ID}`)
    await expect(page.locator(`[data-hmi-screen="${OVERFLOW_SCREEN_ID}"]`)).toBeVisible()

    const overflowing = page.locator('[data-hmi-widget="overflows"]')
    await expect(overflowing).toBeVisible()
    // cols = 12, rows = 4. `col: 10, colSpan: 4` clamps to `col: 10, colSpan: 2` (lines 11 → span 2);
    // `row: 3, rowSpan: 3` clamps to `row: 3, rowSpan: 1` (line 4 → span 1).
    await expect(overflowing).toHaveCSS("grid-column-start", "11")
    await expect(overflowing).toHaveCSS("grid-column-end", "span 2")
    await expect(overflowing).toHaveCSS("grid-row-start", "4")
    await expect(overflowing).toHaveCSS("grid-row-end", "span 1")
    // ...and the operator-visible half of the same behaviour.
    await expect(overflowing).toHaveAttribute("title", /does not fit layout \{cols:12, rows:4\}/)

    // The in-grid widget is untouched, so "clamped" cannot be satisfied by clamping everything.
    const fits = page.locator('[data-hmi-widget="fits"]')
    await expect(fits).toHaveCSS("grid-column-start", "1")
    await expect(fits).toHaveCSS("grid-column-end", "span 4")
    await expect(fits).not.toHaveAttribute("title", /.+/)
  })

  test("an engine failure is announced assertively; an undeclared screen is not", async ({ page, request }) => {
    // task-8-re-review.md LOW-6 closure. The round-1 fix gave `EditorNotice` a required `role` and
    // passed "alert" for the failure branch, but nothing asserted it, so a revert to "status" was
    // invisible to every gate. `role="status"` is `aria-live="polite"`: a screen reader waits for a
    // pause and may never interrupt. §5-bis's whole argument is that "nobody authored this screen" and
    // "the engine is unreachable" are different in kind, and that difference has to survive into the
    // accessibility tree or it only exists for people who can see the words.
    const probe = await request.get(`${ENGINE_URL}/v1/screens/${UNDECLARED_SCREEN_ID}`)
    expect(probe.status()).toBe(404)

    await page.goto(`/editor/${UNDECLARED_SCREEN_ID}`)
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title })).toBeVisible()
    await expect(
      page.locator("[data-editor-notice]"),
      "an undeclared screen is an ordinary product state and must NOT interrupt as an alert"
    ).toHaveAttribute("role", "status")

    // Now the fault. Fulfilled in the browser rather than by breaking the engine, so this test cannot
    // disturb any other spec in a suite that shares one engine process.
    await page.route(`**/v1/screens/${UNDECLARED_SCREEN_ID}`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"probe"}' })
    )
    await page.goto(`/editor/${UNDECLARED_SCREEN_ID}`)
    await expect(page.getByRole("heading", { name: viDict.common.connectivityError })).toBeVisible()
    await expect(
      page.locator("[data-editor-notice]"),
      "an unreachable engine was announced through a polite live region — a fault is not a status"
    ).toHaveAttribute("role", "alert")
    // ...and it is genuinely the OTHER state, not the not-found one wearing a different role.
    await expect(page.getByRole("heading", { name: viDict.editor.notDeclared.title })).toHaveCount(0)
  })
})
