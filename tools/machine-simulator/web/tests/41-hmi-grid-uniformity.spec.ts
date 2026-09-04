import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"

/**
 * WS-HMI-2 Task 11, fix round 2 — THE HMI GRID IS UNIFORM, and this is the only place that says so.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────────────────────────
 * `contracts/hmi-screen.schema.json` describes a screen as `layout.cols × layout.rows` cells, and
 * every widget's `rect` names cells in that grid. The word the whole model rests on is EQUAL: an
 * author placing a widget at `col: 6` expects the sixth of twelve equal columns, and an operator
 * reading the screen expects the tile they were shown in commissioning.
 *
 * `ScreenRenderer` declared `repeat(n, 1fr)`, which is `minmax(auto, 1fr)`. That `auto` floor is a
 * track's largest item MIN-CONTENT, so a widget whose content cannot break — a long unhyphenated
 * caption, a wide reading — silently WIDENED ITS OWN TRACK and narrowed every other one to pay for
 * it. Measured before the fix, at this suite's own 1280×720 viewport: a probe document with a
 * 40-character unbreakable label in column 0 laid out as `[300, 22, 22, 22, …]` px, and
 * `screens/demo/component-demo.json` — a document that SHIPS — had a **478 px** spread between its
 * tallest and shortest row. The operator sees one fat cell and a row of crowded neighbours, on the
 * machine's own screen, with nothing on the page to say why.
 *
 * It surfaced sideways: `38-editor-drag.spec.ts`'s overlay-alignment assertion started failing once a
 * rail squeezed the editor's canvas, and the first diagnosis blamed the overlay. The track arrays
 * settled it the other way — the overlay was the uniform one, the renderer was not. Fixed at the
 * source with `minmax(0, 1fr)`, on both axes, in `ScreenRenderer.tsx`.
 *
 * ── WHY THE PIN AND NOT THE FIX IS THE DELIVERABLE ───────────────────────────────────────────────
 * The fix is one token per axis. What was missing for the whole life of the renderer is anything that
 * would have NOTICED: no test in this tree asserted that two tracks are the same width, so `1fr` could
 * come back in a refactor and every existing test would stay green. That is why this file exists, and
 * why its subject is the RENDERER rather than the editor — the defect is a kiosk defect that the
 * editor merely made visible.
 *
 * ── WHAT MAKES IT FALSIFIABLE RATHER THAN DECORATIVE ─────────────────────────────────────────────
 * A uniformity assertion passes trivially against content that happens to fit. So the hostile test
 * below FIRST proves the pressure is real — the widget's own content is measured to be more than
 * twice a track wide, i.e. `minmax(auto, 1fr)` would certainly have inflated its track — and only then
 * asserts that every track is nonetheless equal. Restore `1fr` and it reddens on the spread; delete
 * the content floor and the test would pass against a probe that never tested anything.
 *
 * ── THE TOLERANCE, AND WHY IT IS NOT ARBITRARY ───────────────────────────────────────────────────
 * Tracks are compared with a spread of **under 1 CSS pixel**. A browser distributes `1fr` tracks in
 * fractional pixels, so a twelve-column grid legitimately shows e.g. `68.3281` beside `68.3438` — a
 * 0.016 px difference nobody can see. The defect this file guards produced 278 px on columns and 478 px
 * on rows: four orders of magnitude away. One pixel is the smallest difference an operator could
 * possibly perceive, which is the honest place to draw the line.
 *
 * ── WHAT THIS FILE DOES NOT MEASURE ──────────────────────────────────────────────────────────────
 * Anything about what a cell does with content that does not fit. `minmax(0, 1fr)` makes such content
 * overflow its own cell instead of moving everybody else's; whether it should be clipped, wrapped or
 * ellipsised is a per-widget presentation decision and not one this file is entitled to make. The
 * claim here is narrower and is the one the contract makes: the GRID is uniform.
 */

/** `web/tests` → `web`. */
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * A spread of under one CSS pixel counts as "equal". See the header for why this number and not zero.
 */
const SPREAD_TOLERANCE_PX = 1

type Tracks = {
  cols: number[]
  rows: number[]
  colSpread: number
  rowSpread: number
  columnGap: number
  /** What one column is worth if the grid is uniform - see `tracksOf`. */
  fairShare: number
}

/**
 * The USED track sizes of a rendered screen, read off `getComputedStyle`.
 *
 * Deliberately the computed value and not the declared one: a test that read
 * `style.gridTemplateColumns` back would be checking that the string this task wrote is the string
 * this task wrote. `getComputedStyle` reports what the browser actually laid out, which is the only
 * thing an operator can see.
 */
function tracksOf(page: Page, screenId: string): Promise<Tracks> {
  return page.evaluate((id) => {
    const root = document.querySelector(`[data-hmi-screen="${id}"]`)
    if (!root) throw new Error(`no [data-hmi-screen="${id}"] on this page`)
    const cs = getComputedStyle(root)
    const parse = (s: string) => s.split(" ").filter(Boolean).map((t) => Number.parseFloat(t))
    const cols = parse(cs.gridTemplateColumns)
    const rows = parse(cs.gridTemplateRows)
    const spread = (a: number[]) => (a.length === 0 ? Number.NaN : Math.max(...a) - Math.min(...a))
    const gap = Number.parseFloat(cs.columnGap)
    return {
      cols,
      rows,
      colSpread: spread(cols),
      rowSpread: spread(rows),
      columnGap: gap,
      // What ONE column is worth if the grid really is `cols` equal tracks separated by `cols - 1`
      // gutters - derived from the container the browser laid out and its own computed gap, NOT from
      // the renderer's declaration. This is the arithmetic the CONTRACT means by a `cols x rows` grid,
      // and having it independently is what lets the hostile test tell "my probe text is too narrow"
      // apart from "the track grew to meet the content", which one measurement alone cannot do.
      fairShare: (root.clientWidth - (cols.length - 1) * gap) / Math.max(1, cols.length),
    }
  }, screenId)
}

/** Asserts one screen's grid is uniform on both axes, against the layout its DOCUMENT declares. */
function expectUniform(tracks: Tracks, layout: { cols: number; rows: number }, where: string): void {
  // The floor first: a grid with no tracks, or with the wrong number of them, would make "every track
  // is the same width" true and meaningless. Compared against the document's own declared counts, read
  // from disk by the caller — not against whatever the page happened to render.
  expect(tracks.cols.length, `${where}: rendered ${tracks.cols.length} columns, the document declares ${layout.cols}`).toBe(
    layout.cols
  )
  expect(tracks.rows.length, `${where}: rendered ${tracks.rows.length} rows, the document declares ${layout.rows}`).toBe(
    layout.rows
  )
  expect(
    tracks.colSpread,
    `${where}: the columns are NOT equal — widest minus narrowest is ${tracks.colSpread.toFixed(3)} px. A widget's ` +
      `content is widening its own track and narrowing its neighbours, which is the grid the document ` +
      `declares no longer being the grid on screen. Columns: ${JSON.stringify(tracks.cols)}`
  ).toBeLessThan(SPREAD_TOLERANCE_PX)
  expect(
    tracks.rowSpread,
    `${where}: the rows are NOT equal — tallest minus shortest is ${tracks.rowSpread.toFixed(3)} px. Same defect on ` +
      `the other axis. Rows: ${JSON.stringify(tracks.rows)}`
  ).toBeLessThan(SPREAD_TOLERANCE_PX)
}

/** A shipped screen document, read from disk so the expected track COUNTS come from the document
 * rather than from the page being measured. */
function shippedLayout(...pathParts: string[]): { cols: number; rows: number } {
  const doc = JSON.parse(readFileSync(join(WEB, "screens", ...pathParts), "utf8")) as {
    layout: { cols: number; rows: number }
  }
  return doc.layout
}

/**
 * The kiosk screens this suite already carries visual baselines for, plus the engineering demo.
 *
 * The three overview screens were measured UNIFORM before the fix as well (spread 0 on both axes),
 * which is why none of the 31 visual baselines moved — they are here as the regression floor, not as
 * the subject. `component-demo` IS a subject: it is the document whose rows spread by 478 px, and it
 * is the row-axis half of this file's evidence that the defect reached shipped content.
 */
const KIOSK_CASES: { where: string; route: string; screenId: string; layout: { cols: number; rows: number } }[] = [
  { where: "kiosk AOI-01", route: "/hmi/AOI-01", screenId: "aoi-overview", layout: shippedLayout("aoi-overview.json") },
  {
    where: "kiosk SCRW-01",
    route: "/hmi/SCRW-01",
    screenId: "automation-overview",
    layout: shippedLayout("automation-overview.json"),
  },
  { where: "kiosk IOT-01", route: "/hmi/IOT-01", screenId: "iot-overview", layout: shippedLayout("iot-overview.json") },
  {
    where: "kiosk demo component-demo",
    route: "/hmi/demo/component-demo",
    screenId: "component-demo",
    layout: shippedLayout("demo", "component-demo.json"),
  },
]

// ── the hostile document ─────────────────────────────────────────────────────────────────────────

const HOSTILE_ID = "grid-uniformity-probe"
const HOSTILE_ROUTE = `/editor/${HOSTILE_ID}`

/**
 * 40 unbroken `A`s. Unbreakable is the whole point: a string with spaces wraps, and a wrapped string's
 * min-content is one word wide, which would not press on the track at all. This is the shape of a real
 * authored caption that goes wrong — a part number, a machine code, a URL.
 */
const UNBREAKABLE = "A".repeat(40)

const HOSTILE_DOC = {
  schemaVersion: 1 as const,
  screenId: HOSTILE_ID,
  title: "Grid uniformity probe",
  theme: "isa101",
  layout: { cols: 12, rows: 4, breakpoint: "panel" },
  widgets: [
    // ONE cell wide, in the FIRST column, so an inflated track is unmistakably this widget's own and
    // not a distributed effect of a wide span.
    { id: "wide-one", kind: "label", rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, props: { text: UNBREAKABLE } },
    // An ordinary neighbour elsewhere on the grid — the one that PAYS for the inflation, and the one
    // an operator would see crowded.
    { id: "neighbour", kind: "label", rect: { col: 6, row: 2, colSpan: 2, rowSpan: 1 }, props: { text: "NEIGHBOUR" } },
  ],
}

async function putScreen(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${HOSTILE_ID}`, { data: HOSTILE_DOC })
  if (!res.ok()) throw new Error(`PUT /v1/screens/${HOSTILE_ID} failed: ${res.status()} ${await res.text()}`)
}

test.describe("the HMI grid is uniform — every track the same size, whatever a widget holds", () => {
  test("every SHIPPED screen renders the equal grid its document declares", async ({ page }) => {
    expect(KIOSK_CASES.length, "no screens to check — this test would pass over nothing").toBeGreaterThan(3)
    for (const { where, route, screenId, layout } of KIOSK_CASES) {
      await page.goto(route)
      await expect(page.locator(`[data-hmi-screen="${screenId}"]`)).toBeVisible()
      expectUniform(await tracksOf(page, screenId), layout, where)
    }
  })

  test("🔴 a widget whose content cannot break does NOT widen its own column at its neighbours' expense", async ({
    page,
    request,
  }) => {
    await putScreen(request)
    await page.goto(HOSTILE_ROUTE)
    // Reached through `/editor/:screenId` because the kiosk's demo route resolves documents from a
    // static map and cannot be handed an arbitrary one. It is the SAME `<ScreenRenderer>` either way —
    // that identity is `37-editor-canvas.spec.ts`'s differential, not an assumption made here — and
    // every assertion below reads the renderer's own root, never the editor's overlay.
    await expect(page.locator(`[data-hmi-screen="${HOSTILE_ID}"]`)).toBeVisible()

    const tracks = await tracksOf(page, HOSTILE_ID)

    const cell = await page.locator(`[data-hmi-widget="wide-one"]`).evaluate((el) => ({
      content: el.scrollWidth,
      box: el.clientWidth,
    }))

    // 🔴 FLOOR 1 - THE PRESSURE IS REAL. Uniformity is trivially true of content that fits, so it is
    // measured before it is claimed to be resisted. Compared against `fairShare`, which is what a
    // column is worth on a uniform grid, and NOT against the track actually rendered: under the old
    // `minmax(auto, 1fr)` the rendered track had already grown to meet the content, so comparing
    // against it would fail here and blame the probe text for the very defect this test is hunting.
    // This assertion holds in BOTH implementations; only a genuinely too-narrow probe breaks it.
    expect(
      cell.content,
      `the probe widget's content is ${cell.content} px where a uniform column is worth ` +
        `${tracks.fairShare.toFixed(1)} px, so it would not press on its track at all and every assertion ` +
        `below would pass against any implementation. Widen the ${UNBREAKABLE.length}-character probe text.`
    ).toBeGreaterThan(tracks.fairShare * 2)

    // 🔴 THE CLAIM. With that pressure real and present, every track is still the same size.
    expectUniform(tracks, HOSTILE_DOC.layout, "hostile document")

    // FLOOR 2 - and the content is OVERFLOWING its cell rather than having pushed the cell wider.
    // `scrollWidth` is what the content needs, `clientWidth` what the cell gives it; equal means the
    // track grew to meet the content, which is the defect stated from the widget's own side.
    expect(
      cell.content,
      `the cell grew to fit its content (${cell.content} px of content in a ${cell.box} px box) instead of ` +
        `letting it overflow - the minmax(auto, 1fr) track floor is back`
    ).toBeGreaterThan(cell.box)

    // The neighbour is drawn at a full two tracks, not squeezed into the remainder - the
    // operator-visible half of the same claim, read off the neighbour's own box rather than off the
    // track list, with the gutter taken from the container's own computed style.
    const neighbour = await page
      .locator(`[data-hmi-widget="neighbour"]`)
      .evaluate((el) => el.getBoundingClientRect().width)
    const expected = tracks.fairShare * 2 + tracks.columnGap
    expect(
      Math.abs(neighbour - expected),
      `the neighbour spans 2 columns but is ${neighbour.toFixed(1)} px where two uniform tracks plus a ` +
        `${tracks.columnGap} px gutter is ${expected.toFixed(1)} px - it is paying for someone else's content`
    ).toBeLessThan(SPREAD_TOLERANCE_PX)
  })
})
