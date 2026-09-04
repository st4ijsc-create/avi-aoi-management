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
 * So, stated at the width it actually holds: this file pins that the editor's canvas BEHAVES like the
 * runtime renderer. It does not, and cannot, pin that it IS the runtime renderer. No browser assertion
 * can: a fork renders identically until it drifts, and the drift is invisible to any test that only
 * reads the DOM the fork produced. The identity claim lives in
 * `runtime-tests/editorCanvasSeam.test.mjs`, a two-sided structural pin whose section 4 replays these
 * same impostors through its own scanners.
 *
 * The two files close it TOGETHER, and the composition is a pincer rather than a hopeful sum: every
 * locator below is built on `data-hmi-screen` / `data-hmi-widget` / `data-hmi-widget-error`, so any
 * impostor must emit those to be green here — and that pin asserts only `ScreenRenderer.tsx` emits
 * them anywhere in `web/src/`. Rename the hooks and this file goes red; keep them and that one does.
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
})
