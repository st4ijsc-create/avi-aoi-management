import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"

/**
 * WS-HMI-2 Task 9 — selection, dragging, resizing and GRID SNAPPING on the editor's canvas. The first
 * task at which the editor actually edits.
 *
 * ── WHAT THIS FILE MEASURES THAT NOTHING ELSE CAN ────────────────────────────────────────────────
 * `runtime-tests/editorGeometry.test.mjs` executes the pixel→cell arithmetic directly, over a corpus
 * of hostile inputs, and it is the cheaper and wider of the two instruments. It cannot tell a canvas
 * that CALLS that arithmetic from one that computes its own rect and ignores it, because nothing in it
 * dispatches a pointer event or lays out a grid. Everything below happens in a real browser, against
 * the real `ScreenRenderer` output, driven by real mouse input, and every assertion reads the CSS grid
 * lines the runtime renderer drew from the document under edit — see `rectOnScreen`.
 *
 * ── THE ONE ASSERTION THIS TASK EXISTS FOR, AND HOW IT IS MADE FALSIFIABLE ───────────────────────
 * "Snapping" is trivially satisfiable by an implementation that never snaps: any drag that happens to
 * end near a cell boundary lands on an integer coordinate whatever the code does, and a test that
 * dragged by a whole number of cells and asserted a whole number of cells back would measure NOTHING.
 *
 * So every drag below is by a deliberately NON-INTEGER multiple of the cell pitch — 3.4 cells, 2.6
 * cells, 2.4 cells — and each case records, in place, the number a pixel-rounding implementation with
 * no grid would have written instead. Those numbers are MEASURED, not derived: on this suite's
 * 1280×720 viewport (`devices["Desktop Chrome"]` overrides the config's top-level 1440×900) the
 * overlay box is 1230×576 and the pitch is 103.164 × 97.332 px. (🔴 FIX ROUND 1, task-9-review.md F6 —
 * round 0 wrote "≈105 px off a 1256 px overlay", arrived at by arithmetic and presented as a
 * measurement. Nothing in the argument depended on it, which is exactly why it went unchecked.)
 *
 * So "drag `drag-me` right by 3.4 cells" is a ≈351 px displacement, and an implementation that wrote
 * `col: base + Math.round(dx)` would produce `col: 352` — clamped to the far edge at `col: 8`, four
 * visible cells away from the `col: 4` asserted here. That is not a prediction: with `snapToCells`
 * reduced to `Math.round(px)` the mid-drag ghost reports `grid-column-start: "9"` where `"5"` is
 * expected. The assertion also discriminates a WRONG pitch, not merely a missing one — swapping the
 * pitch for the bare track width (one gutter short per cell) puts the ghost at `"6"`.
 *
 * ── AND THE PITCH ITSELF IS NOT TAKEN FROM THE IMPLEMENTATION ────────────────────────────────────
 * `gridGeometry.ts` computes the pitch as `(width + gap) / cols`. If this file computed its drag
 * distances the same way, a bug in that formula would move the widget and move the expectation with
 * it, and every assertion would stay green. So the pitch here is MEASURED off two reference widgets
 * the probe document places a known number of cells apart, through the RENDERER's own placed cells:
 * `(left(ref-b) − left(ref-a)) / 6`. That derivation owes nothing to the code under test — it reads
 * the grid the browser actually laid out.
 *
 * ── THE OVERLAY-ALIGNMENT TEST, AND WHY IT IS NOT DECORATION ─────────────────────────────────────
 * Task 8 pinned that the canvas IS the runtime renderer. Task 9 puts an interactive overlay on top of
 * it, and an overlay is a second CSS grid: mirrored track counts, mirrored gutters. A mirror that
 * drifted — `gap-4` instead of `gap-2`, one track more or fewer — would still produce legal integer
 * rects and would still look like it worked, while snapping every drag near the right of the screen to
 * the wrong cell. `the editor's overlay is laid out on exactly the renderer's grid` compares the two
 * cell by cell, in device pixels, and is the pin that stops that.
 *
 * 🔴 The overlay does NOT weaken Task 8's own instruments and must never be allowed to: it is a
 * SIBLING of `[data-hmi-screen]`, injects nothing into any `[data-hmi-widget]` cell, and emits none of
 * the renderer's DOM hooks — which is why `37-editor-canvas.spec.ts`'s kiosk-vs-editor differential
 * still compares byte for byte with an editing canvas, and why
 * `runtime-tests/editorCanvasSeam.test.mjs`'s §4 asserts this exact shape as a PASS.
 */

const SCREEN_ID = "editor-drag-probe"
const ROUTE = `/editor/${SCREEN_ID}`

/** `layout.cols`/`layout.rows` of the probe document, written out here rather than read off
 * `PROBE_DOC` so a change to that document has to be made in both places deliberately. The clamp
 * assertions below are stated in terms of these. */
const COLS = 12
const ROWS = 6

/** The widget every drag acts on, and its rect as authored. Both spans are > 1 on purpose: a resize
 * that reset a span to 1, and a move that quietly shrank one, are different defects and each has to be
 * visible. */
const DRAG_ID = "drag-me"
const DRAG_RECT = { col: 1, row: 1, colSpan: 4, rowSpan: 2 } as const

/**
 * A widget nothing ever touches. Every test that moves `drag-me` asserts this one did not move, so
 * "the document changed" can never be satisfied by a canvas that rewrites every rect it can reach.
 *
 * 🔴 Its cell is chosen so that it never OVERLAPS any position `drag-me` reaches. Grid cells may
 * overlap — nothing in the schema or the renderer forbids two widgets sharing one — and hit targets
 * are stacked in document order, so a later widget's target sits on top of an earlier one's. The
 * round-0 version of this file put the bystander at `{col: 8, row: 4}`, which is exactly where the
 * bottom-right clamp parks `drag-me`; the next press aimed at `drag-me`'s centre landed on the
 * BYSTANDER instead, and the test reported "the widget did not move" for a reason that had nothing to
 * do with clamping. Measured, not reasoned about — it is why the clamp test now also asserts the
 * bystander stayed put.
 */
const BYSTANDER_ID = "bystander"
const BYSTANDER_RECT = { col: 1, row: 5, colSpan: 3, rowSpan: 1 } as const

/**
 * Three 1×1 widgets at KNOWN cell distances, used only as a ruler.
 *
 * `ref-b` is exactly 6 columns right of `ref-a` and `ref-c` exactly 4 rows below it, so the pitch of
 * the grid the browser actually laid out is `(left(ref-b) − left(ref-a)) / 6` and
 * `(top(ref-c) − top(ref-a)) / 4`. Two points and a known separation — no formula from the
 * implementation, and no dependence on the viewport, the header's height or the canvas padding.
 */
const REF_A = "ref-a"
const REF_B = "ref-b"
const REF_C = "ref-c"
const REF_COLS_APART = 6
const REF_ROWS_APART = 4

type ProbeRect = { col: number; row: number; colSpan: number; rowSpan: number }
type ProbeWidget = { id: string; kind: string; rect: ProbeRect; props?: Record<string, unknown> }
type ProbeDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  theme: string
  layout: { cols: number; rows: number; breakpoint: string }
  widgets: ProbeWidget[]
}

/** Every widget is a binding-free `label`: this file measures GEOMETRY, and a widget that reads the
 * design-time value source would add a reason for a cell's box to change that has nothing to do with
 * dragging. */
const PROBE_DOC: ProbeDocument = {
  schemaVersion: 1,
  screenId: SCREEN_ID,
  title: "Canvas probe — keo tha va snap luoi",
  theme: "isa101",
  layout: { cols: COLS, rows: ROWS, breakpoint: "panel" },
  widgets: [
    { id: REF_A, kind: "label", rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, props: { text: "A" } },
    { id: REF_B, kind: "label", rect: { col: 6, row: 0, colSpan: 1, rowSpan: 1 }, props: { text: "B" } },
    { id: REF_C, kind: "label", rect: { col: 0, row: 4, colSpan: 1, rowSpan: 1 }, props: { text: "C" } },
    { id: DRAG_ID, kind: "label", rect: { ...DRAG_RECT }, props: { text: "KEO TOI" } },
    { id: BYSTANDER_ID, kind: "label", rect: { ...BYSTANDER_RECT }, props: { text: "KHONG DONG VAO" } },
  ],
}

/** `PUT /v1/screens/{screenId}` — appends a version and makes it current. Fails LOUDLY with the
 * engine's own body: a refused document must not look like a canvas that drew nothing. */
async function putScreen(request: APIRequestContext, doc: ProbeDocument): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) throw new Error(`PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}`)
}

/** Opens the editor on the probe document and waits until BOTH halves are on screen — the renderer's
 * root and the editor's overlay. Asserting on either alone would let a half-mounted page through. */
async function openCanvas(page: Page): Promise<void> {
  await page.goto(ROUTE)
  await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()
  await expect(page.locator(`[data-editor-overlay="${SCREEN_ID}"]`)).toBeVisible()
  await expect(page.locator("[data-editor-widget]")).toHaveCount(PROBE_DOC.widgets.length)
}

/** A 1-based CSS grid line back to the 0-based `col`/`row` the document carries. Strict on purpose: a
 * lenient parser turns a computed `"auto"` into `NaN`, and `NaN` compares unequal to everything, so the
 * test would fail with a number nobody can trace instead of naming what it actually read. */
function lineToIndex(value: string, widgetId: string, which: string): number {
  const line = Number.parseInt(value, 10)
  expect(
    Number.isInteger(line) && line >= 1,
    `${which} on "${widgetId}" is not a 1-based grid line: ${JSON.stringify(value)}`
  ).toBe(true)
  return line - 1
}

/** `"span 4"` back to the `colSpan`/`rowSpan` the document carries. Same strictness, same reason. */
function spanToCount(value: string, widgetId: string, which: string): number {
  const match = /^span (\d+)$/.exec(value.trim())
  expect(match, `${which} on "${widgetId}" is not a span: ${JSON.stringify(value)}`).toBeTruthy()
  return Number.parseInt((match as RegExpExecArray)[1], 10)
}

/**
 * The rect the document holds for `widgetId` — READ OFF THE SCREEN, out of the four grid lines the
 * runtime renderer computed from it.
 *
 * ── WHY THIS AND NOT A SERIALISED DOCUMENT, AND WHY THE SCHEMA IS NOT VALIDATED HERE ─────────────
 * 🔴 FIX ROUND 1, task-9-review.md F3 + F4, and a controller ruling that overrides the brief's
 * "run `validate.mjs` after every operation" bullet. Round 0 read the document out of a
 * `data-editor-document` attribute the canvas published on every render, and ran Milestone 0's real
 * `validate.mjs` over it. Both are gone, and the reasoning is worth keeping because the round-0
 * version looked more rigorous than it was:
 *
 *   * **The schema call could not fail for anything this layer can produce.** `applyEdit` already
 *     refuses any edit whose result would break `$defs/rect`, so the document the canvas holds is
 *     schema-valid whatever the drag layer computes; and `$defs/rect` bounds nothing against `layout`
 *     (`col`/`row` are just `{"type": "integer", "minimum": 0}`), so the rect a MISSING clamp actually
 *     produces — `col: 10` on a 12-column grid, or `col: 352` — is schema-*valid* too. Measured, not
 *     reasoned: with `movedRect`'s column clamp deleted, every one of the seven `expectSchemaValid`
 *     calls still returned `[]` and the clamp test reddened on its rect equality instead. A call that
 *     cannot fire is this workstream's signature defect.
 *   * **The property is real and is still pinned, elsewhere and with teeth.** "No edit turns a valid
 *     document invalid" is `applyEdit`'s own contract, executed against the real `validate.mjs` by
 *     `runtime-tests/editorState.test.mjs` over a corpus. Measured: lowering that module's
 *     `RECT_MINIMUM.col` from 0 to −99 so it accepts a negative column reddens five of its tests,
 *     named `move · rect col âm: applyEdit và validate.mjs ĐỒNG Ý về $defs/rect` among them. And every
 *     rect THIS task's geometry can produce is validated against the frozen schema over a 294-case
 *     corpus by `runtime-tests/editorGeometry.test.mjs`, which reddens when either clamp is removed.
 *   * **So the production attribute was carrying a near-vacuous assertion.** An always-on output
 *     serialising the whole authored document into the DOM on every render, for every viewer, with a
 *     test as its only consumer — the same shape as the `window.__widgetKinds` global this programme
 *     already refused, at a different address.
 *
 * ── WHAT MAKES THE SCREEN AN HONEST STAND-IN FOR THE DOCUMENT ────────────────────────────────────
 * The renderer CLAMPS at draw time, so in general "what is drawn" is not "what the document says". The
 * bridge is the assertion below: `clampRectToLayout` sets the cell's `title` exactly when it changed
 * something (and this probe document has no bindings, so the tooltip's other contributor — an
 * unresolved `{component}` warning — cannot appear). **No title therefore means the renderer changed
 * nothing, which means the rect on screen IS the rect in the document.** That check lives here, inside
 * the read, so every assertion in this file carries it rather than the two that remembered to.
 */
async function rectOnScreen(page: Page, widgetId: string): Promise<ProbeRect> {
  const cell = renderedCell(page, widgetId)
  await expect(cell).toBeVisible()
  await expect(
    cell,
    `the renderer had to clamp "${widgetId}" while drawing it — the rect in the document is OUT OF RANGE, ` +
      `so what is on screen is not what the editor wrote`
  ).not.toHaveAttribute("title", /.+/)
  const lines = await cell.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      colStart: style.gridColumnStart,
      colEnd: style.gridColumnEnd,
      rowStart: style.gridRowStart,
      rowEnd: style.gridRowEnd,
    }
  })
  return {
    col: lineToIndex(lines.colStart, widgetId, "grid-column-start"),
    row: lineToIndex(lines.rowStart, widgetId, "grid-row-start"),
    colSpan: spanToCount(lines.colEnd, widgetId, "grid-column-end"),
    rowSpan: spanToCount(lines.rowEnd, widgetId, "grid-row-end"),
  }
}

type Box = { x: number; y: number; width: number; height: number }

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, "an element expected to be laid out has no box").toBeTruthy()
  return box as Box
}

/** The runtime renderer's own cell for a widget. */
function renderedCell(page: Page, widgetId: string): Locator {
  return page.locator(`[data-hmi-widget="${widgetId}"]`)
}

/** The editor overlay's hit target for a widget — what a pointer actually presses. */
function hitTarget(page: Page, widgetId: string): Locator {
  return page.locator(`[data-editor-widget="${widgetId}"]`)
}

type Pitch = { x: number; y: number }

/**
 * One cell of travel, in CSS pixels, MEASURED off the grid the browser laid out.
 *
 * Deliberately not `(width + gap) / cols` — that is the implementation's own formula, and a test that
 * repeated it would move its expectations in lockstep with any bug in it. Two reference widgets a
 * known number of cells apart give the same number by subtraction, from the renderer's placed cells.
 */
async function measurePitch(page: Page): Promise<Pitch> {
  const a = await boxOf(renderedCell(page, REF_A))
  const b = await boxOf(renderedCell(page, REF_B))
  const c = await boxOf(renderedCell(page, REF_C))
  const pitch = { x: (b.x - a.x) / REF_COLS_APART, y: (c.y - a.y) / REF_ROWS_APART }
  // The floor for the ruler itself: a collapsed canvas would give a pitch of 0 and make every drag
  // below a zero-cell drag that passes by doing nothing.
  expect(pitch.x, "the measured column pitch is not a usable positive number").toBeGreaterThan(1)
  expect(pitch.y, "the measured row pitch is not a usable positive number").toBeGreaterThan(1)
  return pitch
}

/** Presses in the middle of `target`, moves by `(dx, dy)` and releases. `steps` makes the browser emit
 * real intermediate `pointermove`s rather than one teleport, which is what a drag actually looks like
 * and what an implementation listening for movement has to cope with. */
async function dragBy(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await boxOf(target)
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 })
  await page.mouse.up()
}

test.describe("HMI screen editor — selecting, dragging, resizing, and snapping to the grid", () => {
  test.beforeEach(async ({ request }) => {
    // Every test re-PUTs the pristine document, so none of them inherits what an earlier one dragged.
    // The canvas holds its edits in memory only (Task 9 adds no save), so this also means a reload is
    // enough to get back to a known state — but the PUT makes that independent of test ORDER too.
    await putScreen(request, PROBE_DOC)
  })

  test("the editor's overlay is laid out on exactly the renderer's grid — same tracks, same gutters, same cells", async ({
    page,
  }) => {
    await openCanvas(page)

    /**
     * 🔴 FIX ROUND 1, task-9-review.md F7 — the comparison runs at TWO viewports, not one.
     *
     * The overlay's grid is a mirror of the renderer's written in a second place, and a mirror can be
     * right at the size it was authored at and wrong at another: a fixed track, a `min-width` floor, a
     * gutter that only collapses when the canvas is narrow. Round 0 measured 1280×720 only. The second
     * size is deliberately narrower and a different aspect ratio, so a horizontal-only or an
     * aspect-dependent divergence has somewhere to show.
     *
     * The limit that REMAINS, stated rather than left unsaid: both passes use the same document, so a
     * divergence that needs a degenerate `layout` (`cols: 0`, a non-integer `cols`, a string) is not
     * covered here — the engine's own `PUT /v1/screens/{id}` refuses such a document, so it cannot be
     * put on screen through this route at all. That arithmetic is covered instead by
     * `runtime-tests/editorGeometry.test.mjs`'s `trackCount` differential against the runtime's own
     * `clampRectToLayout`, over exactly those malformed layouts.
     */
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 900, height: 620 },
    ]) {
      await page.setViewportSize(viewport)
      const where = `${viewport.width}x${viewport.height}`

      // The two containers. Track COUNTS (not widths) and the absolute gutters, exactly the pair
      // `37-editor-canvas.spec.ts`'s differential compares between the kiosk and the editor — the same
      // reasoning, applied to the two grids that must line up inside one page.
      const grids = await page.evaluate(
        ([id]) => {
          const read = (el: Element | null) => {
            if (!el) return null
            const s = getComputedStyle(el)
            return {
              display: s.display,
              columnTracks: s.gridTemplateColumns.split(" ").filter(Boolean).length,
              rowTracks: s.gridTemplateRows.split(" ").filter(Boolean).length,
              columnGap: s.columnGap,
              rowGap: s.rowGap,
            }
          }
          return {
            screen: read(document.querySelector(`[data-hmi-screen="${id}"]`)),
            overlay: read(document.querySelector(`[data-editor-overlay="${id}"]`)),
          }
        },
        [SCREEN_ID] as const
      )

      // A floor on the comparison: two nulls, or two non-grids, would compare equal and prove nothing.
      expect(
        grids.screen?.display,
        `at ${where}: the renderer's root is not a CSS grid — this comparison read the wrong element`
      ).toBe("grid")
      expect(grids.screen?.columnTracks).toBe(COLS)
      expect(grids.screen?.rowTracks).toBe(ROWS)
      expect(
        grids.overlay,
        `at ${where}: the editor's overlay grid does not match the renderer's. A drag layer on a ` +
          "different grid still produces legal integer rects — it just snaps them to the wrong cells."
      ).toEqual(grids.screen)

      // ...and then the thing that actually matters: every hit target sits exactly on top of the cell it
      // stands for, in device pixels. Track counts and gutters agreeing is necessary and not sufficient
      // — an overlay inset by the canvas padding would satisfy them and be a full gutter out of step,
      // and a changed track FUNCTION (`2fr 1fr…` for the same count) is invisible to the first half
      // entirely. This half is the one with teeth against both.
      for (const widget of PROBE_DOC.widgets) {
        const cell = await boxOf(renderedCell(page, widget.id))
        const target = await boxOf(hitTarget(page, widget.id))
        expect(Math.abs(target.x - cell.x), `at ${where}: hit target for "${widget.id}" is off in x`).toBeLessThan(0.5)
        expect(Math.abs(target.y - cell.y), `at ${where}: hit target for "${widget.id}" is off in y`).toBeLessThan(0.5)
        expect(
          Math.abs(target.width - cell.width),
          `at ${where}: hit target for "${widget.id}" is the wrong width`
        ).toBeLessThan(0.5)
        expect(
          Math.abs(target.height - cell.height),
          `at ${where}: hit target for "${widget.id}" is the wrong height`
        ).toBeLessThan(0.5)
      }
    }
  })

  test("the overlay's controls are operable by keyboard — they do what their labels say, through the same edits", async ({
    page,
  }) => {
    // 🔴 FIX ROUND 1, task-9-review.md F1. Round 0 shipped a labelled `<button>` over every widget cell
    // whose only handlers were pointer events: focusable, named, and inert. Nothing in the tree caught
    // it — `00-visual-and-a11y.spec.ts` has no `/editor` entry and no axe pass runs on this route — so
    // the gate is here, stated as behaviour rather than as an attribute.
    await openCanvas(page)

    // Reached the way a keyboard reaches it, and nothing is selected yet.
    await hitTarget(page, DRAG_ID).focus()
    await expect(hitTarget(page, DRAG_ID)).toBeFocused()
    await expect(page.locator('[data-editor-selected="true"]')).toHaveCount(0)

    // The label says "select". Enter must select.
    await page.keyboard.press("Enter")
    await expect(
      hitTarget(page, DRAG_ID),
      "Enter on a focused, labelled \"select widget\" button did nothing"
    ).toHaveAttribute("data-editor-selected", "true")
    await expect(page.locator(`[data-editor-resize="${DRAG_ID}"]`)).toBeVisible()
    expect(await rectOnScreen(page, DRAG_ID), "selecting moved the widget").toEqual(DRAG_RECT)

    // Arrow keys nudge by exactly one cell, in both axes and both directions.
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ ...DRAG_RECT, col: DRAG_RECT.col + 2, row: DRAG_RECT.row + 1 })
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("ArrowUp")
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ ...DRAG_RECT, col: DRAG_RECT.col + 1 })

    // The keyboard path goes through the SAME history — one Ctrl+Z undoes one nudge, not the lot.
    await page.keyboard.press("Control+z")
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ ...DRAG_RECT, col: DRAG_RECT.col + 1, row: DRAG_RECT.row + 1 })

    // ...and the SAME clamp: held against the left edge, the widget stops at col 0 and the refusals
    // that produces are the ordinary no-op kind, announced to nobody.
    for (let i = 0; i < COLS + 3; i += 1) await page.keyboard.press("ArrowLeft")
    for (let i = 0; i < ROWS + 3; i += 1) await page.keyboard.press("ArrowUp")
    expect(await rectOnScreen(page, DRAG_ID), "the keyboard path is not clamped the way the pointer path is").toEqual({
      ...DRAG_RECT,
      col: 0,
      row: 0,
    })
    await expect(page.locator("[role=alert]")).toHaveCount(0)

    // The resize handle carries the other half of the same claim.
    await page.locator(`[data-editor-resize="${DRAG_ID}"]`).focus()
    await expect(page.locator(`[data-editor-resize="${DRAG_ID}"]`)).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    expect(
      await rectOnScreen(page, DRAG_ID),
      "arrow keys on the focused resize handle did not change the span"
    ).toEqual({ col: 0, row: 0, colSpan: DRAG_RECT.colSpan + 1, rowSpan: DRAG_RECT.rowSpan + 1 })

    // Minimum span 1, from the keyboard too.
    for (let i = 0; i < COLS + 3; i += 1) await page.keyboard.press("ArrowLeft")
    for (let i = 0; i < ROWS + 3; i += 1) await page.keyboard.press("ArrowUp")
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 1 })

    expect(await rectOnScreen(page, BYSTANDER_ID)).toEqual(BYSTANDER_RECT)
  })

  test("clicking a widget selects it and draws an outline; clicking the background clears it", async ({ page }) => {
    await openCanvas(page)
    const pitch = await measurePitch(page)
    const anchor = await boxOf(renderedCell(page, REF_A))

    // Nothing is selected on load, and nothing is offering a resize handle.
    await expect(page.locator('[data-editor-selected="true"]')).toHaveCount(0)
    await expect(page.locator("[data-editor-resize]")).toHaveCount(0)

    await hitTarget(page, DRAG_ID).click()

    const selected = hitTarget(page, DRAG_ID)
    await expect(selected).toHaveAttribute("data-editor-selected", "true")
    await expect(selected).toHaveAttribute("aria-pressed", "true")
    // The OUTLINE, not merely the attribute: an editor that recorded a selection and drew nothing has
    // selected nothing as far as the engineer is concerned.
    await expect(selected).toHaveCSS("outline-style", "solid")
    await expect(selected).toHaveCSS("outline-width", "2px")
    // Exactly one, so "selected" can never be satisfied by outlining everything.
    await expect(page.locator('[data-editor-selected="true"]')).toHaveCount(1)
    await expect(page.locator(`[data-editor-resize="${DRAG_ID}"]`)).toBeVisible()

    // Selecting another widget moves the selection rather than adding to it.
    await hitTarget(page, BYSTANDER_ID).click()
    await expect(hitTarget(page, BYSTANDER_ID)).toHaveAttribute("data-editor-selected", "true")
    await expect(hitTarget(page, DRAG_ID)).toHaveAttribute("data-editor-selected", "false")
    await expect(page.locator('[data-editor-selected="true"]')).toHaveCount(1)

    // The background — cell (9, 3) of a 12x6 grid, which the probe document leaves empty (see the
    // widget table at the top: nothing occupies row 3, and the bystander is at columns 1-3). Located
    // from the measured ruler rather than from a hard-coded pixel, so it stays the same CELL at any
    // viewport.
    await page.mouse.click(anchor.x + 9.5 * pitch.x, anchor.y + 3.5 * pitch.y)
    await expect(
      page.locator('[data-editor-selected="true"]'),
      "clicking empty canvas did not clear the selection"
    ).toHaveCount(0)
    await expect(page.locator("[data-editor-resize]")).toHaveCount(0)

    // Selecting is not editing: nothing above may have touched the document.
    expect(await rectOnScreen(page, DRAG_ID)).toEqual(DRAG_RECT)
  })

  test("a drop BETWEEN two cells snaps to whole grid coordinates — not to the pixel it was released on", async ({
    page,
  }) => {
    await openCanvas(page)
    const pitch = await measurePitch(page)

    // ── 3.4 cells to the right. Not 3, not 4: the release point is 40% of a cell past a boundary, so
    // an implementation that snaps at all must choose, and the nearest cell is +3.
    //
    // What a NON-snapping implementation produces here, spelled out: `dx` is 3.4 x 103.164 px ≈ 351 px,
    // so `col = 1 + Math.round(dx)` is 352, which the clamp then parks at the far edge (col 8). Both
    // the rect assertion and the grid-line assertion below would name that.
    const ghost = page.locator(`[data-editor-ghost="${DRAG_ID}"]`)
    const start = await boxOf(hitTarget(page, DRAG_ID))
    const startX = start.x + start.width / 2
    const startY = start.y + start.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 3.4 * pitch.x, startY, { steps: 6 })

    // Mid-drag: the ghost already shows the snapped destination while the pointer is between two
    // cells. `grid-column-start` is 1-based; col 4 is line 5.
    await expect(ghost, "no drag ghost while a drag is in progress").toBeVisible()
    await expect(ghost).toHaveCSS("grid-column-start", "5")
    await expect(ghost).toHaveCSS("grid-column-end", "span 4")
    await page.mouse.up()

    let rect = await rectOnScreen(page, DRAG_ID)
    expect(rect, "a 3.4-cell drag did not land on col 4 with its size intact").toEqual({
      col: 4,
      row: DRAG_RECT.row,
      colSpan: DRAG_RECT.colSpan,
      rowSpan: DRAG_RECT.rowSpan,
    })
    expect(Number.isInteger(rect.col) && Number.isInteger(rect.row)).toBe(true)
    // ...and the runtime renderer redrew it there, so this is a real placement and not a number in a
    // hidden attribute.
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-start", "5")
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-row-start", "2")

    // ── 2.6 cells, which rounds the OTHER way. Truncation would give +2 and leave the widget at col 6;
    // snapping to the nearest cell gives +3 and col 7. One case cannot distinguish rounding from
    // flooring; these two together can.
    await dragBy(page, hitTarget(page, DRAG_ID), 2.6 * pitch.x, 0)
    rect = await rectOnScreen(page, DRAG_ID)
    expect(rect.col, "2.6 cells was truncated to 2 instead of snapped to the nearest cell").toBe(7)
    expect(rect.row).toBe(DRAG_RECT.row)

    // ── and vertically, at a different pitch, so a snap that divided by the wrong axis would show.
    await dragBy(page, hitTarget(page, DRAG_ID), 0, 2.4 * pitch.y)
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ col: 7, row: DRAG_RECT.row + 2, colSpan: 4, rowSpan: 2 })

    // Nothing else moved.
    expect(await rectOnScreen(page, BYSTANDER_ID)).toEqual(BYSTANDER_RECT)
  })

  test("a drag past the edge is CLAMPED to a legal rect — never a negative col, never past layout.cols", async ({
    page,
  }) => {
    await openCanvas(page)

    const pitch = await measurePitch(page)
    const viewport = page.viewportSize()
    expect(viewport, "no viewport size — the overshoot below cannot be aimed").toBeTruthy()
    const { width: vw, height: vh } = viewport as { width: number; height: number }

    // ── off the bottom-right. A move keeps the widget's SIZE, so the far edge of the grid stops its
    // top-left corner at `cols - colSpan` / `rows - rowSpan`, not at `cols - 1` / `rows - 1`.
    const maxCol = COLS - DRAG_RECT.colSpan
    const maxRow = ROWS - DRAG_RECT.rowSpan
    let start = await boxOf(hitTarget(page, DRAG_ID))
    let fromX = start.x + start.width / 2
    let fromY = start.y + start.height / 2
    let requestedCol = DRAG_RECT.col + Math.round((vw - 2 - fromX) / pitch.x)
    let requestedRow = DRAG_RECT.row + Math.round((vh - 2 - fromY) / pitch.y)
    // Asserted, not assumed: if the viewport ever changed so that this drag no longer left the grid,
    // the clamp would not be exercised at all and every assertion below would pass vacuously.
    expect(requestedCol, "this drag no longer overshoots the right edge — it measures no clamp").toBeGreaterThan(maxCol)
    expect(requestedRow, "this drag no longer overshoots the bottom edge — it measures no clamp").toBeGreaterThan(maxRow)

    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(vw - 2, vh - 2, { steps: 8 })
    await page.mouse.up()

    // 🔴 FIX ROUND 1, task-9-review.md F5 — the BYSTANDER is asserted FIRST, and the ordering is the
    // whole point. Round 0 put it after the `drag-me` assertion, so in the one scenario it was added
    // for — the press being taken by another widget's hit target — the run still stopped at "the widget
    // did not move" and this line was never reached. The reviewer had to delete the `drag-me`
    // assertion before it could fire. Reached first, it names the real failure.
    expect(
      await rectOnScreen(page, BYSTANDER_ID),
      "the BYSTANDER moved — the press was taken by the wrong widget's hit target, so nothing below is " +
        "measuring the clamp at all"
    ).toEqual(BYSTANDER_RECT)
    expect(await rectOnScreen(page, DRAG_ID), "a drag past the bottom-right corner did not clamp to the far edge").toEqual({
      col: maxCol,
      row: maxRow,
      colSpan: DRAG_RECT.colSpan,
      rowSpan: DRAG_RECT.rowSpan,
    })
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-start", `${maxCol + 1}`)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-end", `span ${DRAG_RECT.colSpan}`)

    // ── and off the top-left, where the failure would be a NEGATIVE coordinate: schema-invalid, and
    // the one this task's brief names first.
    start = await boxOf(hitTarget(page, DRAG_ID))
    fromX = start.x + start.width / 2
    fromY = start.y + start.height / 2
    requestedCol = maxCol + Math.round((2 - fromX) / pitch.x)
    requestedRow = maxRow + Math.round((2 - fromY) / pitch.y)
    expect(requestedCol, "this drag no longer overshoots the left edge — it measures no clamp").toBeLessThan(0)
    expect(requestedRow, "this drag no longer overshoots the top edge — it measures no clamp").toBeLessThan(0)

    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(2, 2, { steps: 8 })
    await page.mouse.up()

    // Bystander first here too, for the same reason.
    expect(
      await rectOnScreen(page, BYSTANDER_ID),
      "the BYSTANDER moved — the press was taken by the wrong widget's hit target"
    ).toEqual(BYSTANDER_RECT)
    const rect = await rectOnScreen(page, DRAG_ID)
    expect(rect).toEqual({ col: 0, row: 0, colSpan: DRAG_RECT.colSpan, rowSpan: DRAG_RECT.rowSpan })
    expect(rect.col, "col went negative").toBeGreaterThanOrEqual(0)
    expect(rect.row, "row went negative").toBeGreaterThanOrEqual(0)
    expect(rect.col + rect.colSpan, "the widget runs past layout.cols").toBeLessThanOrEqual(COLS)
    expect(rect.row + rect.rowSpan, "the widget runs past layout.rows").toBeLessThanOrEqual(ROWS)
  })

  test("the resize handle changes colSpan/rowSpan, keeps the corner, and never goes below 1", async ({ page }) => {
    await openCanvas(page)
    const pitch = await measurePitch(page)

    await hitTarget(page, DRAG_ID).click()
    const handle = page.locator(`[data-editor-resize="${DRAG_ID}"]`)
    await expect(handle).toBeVisible()

    // ── +2.4 columns and +0.6 rows. Both fractional, for the same reason every other drag here is.
    await dragBy(page, handle, 2.4 * pitch.x, 0.6 * pitch.y)
    expect(
      await rectOnScreen(page, DRAG_ID),
      "a resize moved the widget's corner instead of changing its span"
    ).toEqual({
      col: DRAG_RECT.col,
      row: DRAG_RECT.row,
      colSpan: DRAG_RECT.colSpan + 2,
      rowSpan: DRAG_RECT.rowSpan + 1,
    })
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-end", `span ${DRAG_RECT.colSpan + 2}`)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-row-end", `span ${DRAG_RECT.rowSpan + 1}`)

    // ── dragged inside-out, all the way to the top-left of the viewport. `$defs/rect` declares
    // `minimum: 1` on both spans; 0 is not a smaller widget, it is an invisible one, and a negative
    // span is a document the schema refuses.
    await dragBy(page, page.locator(`[data-editor-resize="${DRAG_ID}"]`), -1e4, -1e4)
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ col: DRAG_RECT.col, row: DRAG_RECT.row, colSpan: 1, rowSpan: 1 })

    // ── and grown past the far edge, where the ceiling is the grid rather than the pointer.
    await dragBy(page, page.locator(`[data-editor-resize="${DRAG_ID}"]`), 1e4, 1e4)
    const rect = await rectOnScreen(page, DRAG_ID)
    expect(rect).toEqual({
      col: DRAG_RECT.col,
      row: DRAG_RECT.row,
      colSpan: COLS - DRAG_RECT.col,
      rowSpan: ROWS - DRAG_RECT.row,
    })
    expect(rect.col + rect.colSpan).toBeLessThanOrEqual(COLS)
    expect(rect.row + rect.rowSpan).toBeLessThanOrEqual(ROWS)

    expect(await rectOnScreen(page, BYSTANDER_ID)).toEqual(BYSTANDER_RECT)
  })

  test("Ctrl+Z steps back through the real history — one undo per accepted edit, exact rects restored", async ({
    page,
  }) => {
    await openCanvas(page)
    const pitch = await measurePitch(page)

    // Two DIFFERENT edits, so a single `Ctrl+Z` that merely restored the document the page loaded with
    // cannot pass: after one undo the widget must be at the MOVED position with its ORIGINAL span.
    await dragBy(page, hitTarget(page, DRAG_ID), 3.4 * pitch.x, 0)
    const moved = { col: 4, row: DRAG_RECT.row, colSpan: DRAG_RECT.colSpan, rowSpan: DRAG_RECT.rowSpan }
    expect(await rectOnScreen(page, DRAG_ID)).toEqual(moved)

    await hitTarget(page, DRAG_ID).click()
    await dragBy(page, page.locator(`[data-editor-resize="${DRAG_ID}"]`), 2.4 * pitch.x, 0)
    expect(await rectOnScreen(page, DRAG_ID)).toEqual({ ...moved, colSpan: moved.colSpan + 2 })

    await page.keyboard.press("Control+z")
    expect(
      await rectOnScreen(page, DRAG_ID),
      "one Ctrl+Z did not land on the state between the two edits — either it undid both, or it reset to the load"
    ).toEqual(moved)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-end", `span ${DRAG_RECT.colSpan}`)

    await page.keyboard.press("Control+z")
    expect(
      await rectOnScreen(page, DRAG_ID),
      "two Ctrl+Z did not restore the EXACT rect the document was authored with"
    ).toEqual(DRAG_RECT)
    // All four fields, and the renderer agrees.
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-start", `${DRAG_RECT.col + 1}`)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-row-start", `${DRAG_RECT.row + 1}`)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-column-end", `span ${DRAG_RECT.colSpan}`)
    await expect(renderedCell(page, DRAG_ID)).toHaveCSS("grid-row-end", `span ${DRAG_RECT.rowSpan}`)

    // Past the bottom of the stack: an ordinary boundary, not an error, and not a document that
    // silently keeps changing.
    await page.keyboard.press("Control+z")
    expect(await rectOnScreen(page, DRAG_ID)).toEqual(DRAG_RECT)
    await expect(page.locator("[role=alert]")).toHaveCount(0)
  })

  test("a drop where the drag started is a refused NO-OP — nothing announced, and no undo step spent", async ({
    page,
  }) => {
    await openCanvas(page)
    const pitch = await measurePitch(page)

    // One real edit …
    await dragBy(page, hitTarget(page, DRAG_ID), 3.4 * pitch.x, 0)
    const moved = { col: 4, row: DRAG_RECT.row, colSpan: DRAG_RECT.colSpan, rowSpan: DRAG_RECT.rowSpan }
    expect(await rectOnScreen(page, DRAG_ID)).toEqual(moved)

    // … then two drags that go nowhere: a press-and-release, and a shake that never crosses a cell
    // boundary. `applyEdit` refuses both with `code: "no-op"`, and this layer swallows exactly that
    // code rather than string-matching a sentence (`EditorCanvas.tsx`'s `HARMLESS_REFUSALS`).
    await dragBy(page, hitTarget(page, DRAG_ID), 0, 0)
    await dragBy(page, hitTarget(page, DRAG_ID), 0.3 * pitch.x, -0.4 * pitch.y)
    expect(
      await rectOnScreen(page, DRAG_ID),
      "a sub-cell drag moved the widget"
    ).toEqual(moved)

    // NOT announced as a failure. Putting a widget back where it came from is the most ordinary thing
    // an engineer does with a mouse, and `editorState.ts` refuses it for a reason that is about the
    // undo stack, not about the user having done something wrong.
    await expect(
      page.locator("[role=alert]"),
      "a refused no-op surfaced to the engineer as an error"
    ).toHaveCount(0)

    // The load-bearing half: ONE Ctrl+Z reaches the original rect. If either no-op had pushed a step
    // — which is what an editor keeping its own history alongside `editorState.ts`'s would do, pushing
    // on every pointerup — this would still be sitting at `moved`.
    await page.keyboard.press("Control+z")
    expect(
      await rectOnScreen(page, DRAG_ID),
      "a no-op drag consumed a step of the undo history"
    ).toEqual(DRAG_RECT)
  })
})
