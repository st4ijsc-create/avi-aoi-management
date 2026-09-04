// Run: npm run test:runtime   (node --test, no extra package)
//
// WS-HMI-2 Task 9 — `src/editor/gridGeometry.ts`, EXECUTED.
//
// ── WHAT THIS FILE IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────
// This is the cheap, fast half of Task 9's evidence. It runs the pixel→cell arithmetic directly under
// `node --test`, which is possible only because `gridGeometry.ts` is plain `.ts` with no JSX, no React
// and no DOM (Node's loader strips types but cannot parse JSX — measured in WS-HMI-1 Task 2, see
// `widgetRegistry.test.mjs`'s header).
//
// It does NOT show that the editor snaps drags to the grid. Nothing here dispatches a pointer event,
// lays out a CSS grid or measures a pitch off a real element, so nothing here can tell a canvas that
// CALLS these functions from one that computes its own rect and ignores them. That claim is
// `tests/38-editor-drag.spec.ts`'s: it drags a real widget across a real grid by a deliberately
// non-integer multiple of the measured cell pitch and reads the resulting document back out of the
// page. What this file adds is the property that browser test cannot cover cheaply — the behaviour of
// the same arithmetic over a CORPUS of hostile inputs, including the malformed layouts and rects that
// a JSON document is free to contain and that a pointer can never produce.
//
// ── THE TWO DIFFERENTIALS, WHICH ARE WHERE THE TEETH ARE ─────────────────────────────────────────
//  1. AGAINST THE RUNTIME'S OWN CLAMP. `hmi-runtime/gridLayout.ts`'s `clampRectToLayout` is the rule
//     the renderer applies when it draws. Every rect `movedRect`/`resizedRect` return is fed to it,
//     and it must be a NO-OP — same four numbers, and `warning === undefined`. That is the sense in
//     which this module "agrees with the runtime" without holding a second copy of its rule: it is
//     free to answer a DIFFERENT question (a drag keeps a widget's size; the renderer's clamp shrinks
//     it), and it is not free to answer with a rect the renderer would have to fix.
//  2. AGAINST THE FROZEN SCHEMA. Every such rect is dropped into a real document and run through
//     Milestone 0's `contract-tests/validate.mjs` — IMPORTED, never copied (`screens.test.mjs` and
//     `editorState.test.mjs` set that precedent and state the reasoning). `editorState.ts`'s
//     `applyEdit` REFUSES an illegal rect rather than repairing one, so a clamp that produced
//     `col: -1` would not corrupt the document — it would silently make the widget un-draggable past
//     the left edge with nothing on screen to say why. This is the test that would name it.
//
// ── WHAT IS DELIBERATELY WRITTEN OUT RATHER THAN IMPORTED ────────────────────────────────────────
// The expected cell deltas below (`3`, `4`, `-3`) are LITERALS, and the pitches they are computed
// against are literals too. Deriving them by calling `snapToCells` a second time, or by re-applying
// its own formula, would make this file pass at any rounding rule — the one-directional-pin defect
// this tree has been caught by repeatedly (see `editorState.ts`'s note on `UNDO_DEPTH_LIMIT`). Each
// case additionally records what a PIXEL-rounding implementation — one with no grid at all — would
// have produced, so a reader can see the discrimination rather than take it on trust.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { validate } from "../contract-tests/validate.mjs"
import { clampRectToLayout } from "../src/hmi-runtime/gridLayout.ts"
import { gridPitch, movedRect, resizedRect, snapToCells, trackCount } from "../src/editor/gridGeometry.ts"

// runtime-tests → web → tools/machine-simulator → contracts
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA = JSON.parse(readFileSync(join(WEB, "..", "contracts", "hmi-screen.schema.json"), "utf8"))

/** `clampRectToLayout` emits a `console.warn` for every rect it changes, and this file feeds it
 * deliberately malformed ones by the dozen. Same helper, same reasoning, as `bindings.test.mjs`'s:
 * restore the original whatever happens, so no later test in this `node --test` process inherits a
 * muted console. */
function captureWarnings(fn) {
  const original = console.warn
  const calls = []
  console.warn = (...args) => {
    calls.push(args)
  }
  try {
    return { result: fn(), calls }
  } finally {
    console.warn = original
  }
}

/** A minimal, otherwise-valid document carrying exactly one widget at `rect` — the vehicle for the
 * schema differential. Everything except `layout`/`rect` is fixed and known-good, so a validation
 * error can only be about the rect under test. */
function documentWith(layout, rect) {
  return {
    schemaVersion: 1,
    screenId: "editor-geometry-probe",
    title: "Ghim hình học kéo-thả",
    theme: "isa101",
    layout: { cols: 12, rows: 4, breakpoint: "panel", ...layout },
    widgets: [{ id: "probe", kind: "label", rect, props: { text: "probe" } }],
  }
}

/** The corpus is deliberately wider than a pointer can reach: a layout is JSON from over the wire, and
 * `gridGeometry.ts` is the last thing between it and `applyEdit`. */
const LAYOUTS = [
  { cols: 12, rows: 4, breakpoint: "panel" },
  { cols: 1, rows: 1, breakpoint: "phone" },
  { cols: 3, rows: 8, breakpoint: "tablet" },
  // Malformed on purpose — `$defs/layout` forbids all of these, and none of them may reach `applyEdit`
  // as a rect it has to refuse.
  { cols: 0, rows: -2, breakpoint: "panel" },
  { cols: 6.7, rows: 4.2, breakpoint: "panel" },
  { cols: "12", rows: null, breakpoint: "panel" },
  { cols: Number.NaN, rows: Number.POSITIVE_INFINITY, breakpoint: "panel" },
]

const BASE_RECTS = [
  { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
  { col: 1, row: 1, colSpan: 4, rowSpan: 2 },
  // Already outside a 12x4 grid before any drag — the shape `37-editor-canvas.spec.ts`'s OVERFLOW_DOC
  // puts on screen.
  { col: 10, row: 3, colSpan: 4, rowSpan: 3 },
  { col: -5, row: -5, colSpan: 2, rowSpan: 2 },
  { col: 0, row: 0, colSpan: 99, rowSpan: 99 },
  { col: 2.9, row: 1.2, colSpan: 0, rowSpan: -3 },
  { col: undefined, row: "3", colSpan: Number.NaN, rowSpan: null },
]

const DELTAS = [
  { dCol: 0, dRow: 0 },
  { dCol: 3, dRow: 1 },
  { dCol: -40, dRow: -40 },
  { dCol: 40, dRow: 40 },
  { dCol: 1.6, dRow: -1.6 },
  { dCol: Number.NaN, dRow: undefined },
]

function describe(value) {
  return typeof value === "number" ? String(value) : JSON.stringify(value)
}

function label(layout, base, delta) {
  return (
    `layout{cols:${describe(layout.cols)}, rows:${describe(layout.rows)}} · ` +
    `base{col:${describe(base.col)}, row:${describe(base.row)}, colSpan:${describe(base.colSpan)}, ` +
    `rowSpan:${describe(base.rowSpan)}} · delta{${describe(delta.dCol)},${describe(delta.dRow)}}`
  )
}

// ── the pitch ────────────────────────────────────────────────────────────────────────────────────

test("gridPitch: one cell of travel is one track PLUS one gutter — the identity, not the formula", () => {
  // Written as the inverse of what `gridPitch` computes: if `pitch` is right then `cols` tracks of
  // `pitch - gap`, plus the `cols - 1` gutters between them, must reconstruct the box's width exactly.
  // A test that re-applied `(width + gap) / cols` would agree with any bug that formula contains.
  for (const [width, cols, gap] of [
    [1256, 12, 8],
    [500, 1, 8],
    [733, 7, 0],
    [1000, 3, 24],
  ]) {
    const pitch = gridPitch({ width, height: width }, { cols, rows: cols }, { x: gap, y: gap })
    const track = pitch.x - gap
    assert.ok(track > 0, `track width came out non-positive for width=${width} cols=${cols} gap=${gap}`)
    assert.ok(
      Math.abs(cols * track + (cols - 1) * gap - width) < 1e-9,
      `pitch ${pitch.x} does not reconstruct width ${width} at cols=${cols}, gap=${gap}`
    )
  }
})

test("gridPitch: a malformed layout or box degrades to a usable number, never NaN", () => {
  const pitch = gridPitch({ width: undefined, height: Number.NaN }, { cols: 0, rows: "8" }, { x: Number.NaN, y: null })
  assert.ok(Number.isFinite(pitch.x) && Number.isFinite(pitch.y), `pitch is not finite: ${JSON.stringify(pitch)}`)
})

// ── the snap ─────────────────────────────────────────────────────────────────────────────────────

test("snapToCells: a drop BETWEEN two cells lands on the nearest whole cell — never a pixel count", () => {
  const pitch = { x: 100, y: 40 }
  // 3.4 cells. A pixel-rounding implementation with no grid writes 340; this writes 3.
  assert.deepEqual(snapToCells({ x: 340, y: 0 }, pitch), { dCol: 3, dRow: 0 })
  // 3.6 cells — rounds UP, so this is snapping to the nearest cell and not truncation toward zero.
  assert.deepEqual(snapToCells({ x: 360, y: 0 }, pitch), { dCol: 4, dRow: 0 })
  // ...and the same in the negative direction, where truncation and rounding disagree in the other
  // direction: `Math.trunc(-3.6)` is -3, and the answer must be -4.
  assert.deepEqual(snapToCells({ x: -360, y: 0 }, pitch), { dCol: -4, dRow: 0 })
  assert.deepEqual(snapToCells({ x: -340, y: 0 }, pitch), { dCol: -3, dRow: 0 })
  // Both axes at once, at different pitches, so a snap that used the x pitch for y would show.
  assert.deepEqual(snapToCells({ x: 250, y: 90 }, pitch), { dCol: 3, dRow: 2 }, "2.5 → 3 and 2.25 → 2")
})

test("snapToCells: a sub-cell jiggle is ZERO cells — the drop-in-place a no-op refusal depends on", () => {
  const pitch = { x: 100, y: 40 }
  // Everything a hand does when it means "put it back": a press-and-release, a small shake, a slide
  // that stops just short of the next boundary.
  assert.deepEqual(snapToCells({ x: 0, y: 0 }, pitch), { dCol: 0, dRow: 0 })
  assert.deepEqual(snapToCells({ x: 49, y: -19 }, pitch), { dCol: 0, dRow: 0 })
  assert.deepEqual(snapToCells({ x: -49, y: 19 }, pitch), { dCol: 0, dRow: 0 })
})

test("snapToCells: a degenerate pitch moves NOTHING rather than producing NaN or Infinity cells", () => {
  // A collapsed canvas (hidden tab, zero-height flex parent) must make a drag inert. `NaN` cells would
  // reach `movedRect`, be floored to 0 there, and silently teleport the widget to the origin.
  for (const pitch of [{ x: 0, y: 0 }, { x: Number.NaN, y: 40 }, { x: -100, y: 40 }, undefined]) {
    const delta = snapToCells({ x: 500, y: 500 }, pitch)
    assert.ok(
      Number.isInteger(delta.dCol) && Number.isInteger(delta.dRow),
      `pitch ${JSON.stringify(pitch)} produced a non-integer delta ${JSON.stringify(delta)}`
    )
    assert.equal(delta.dCol, 0, `a degenerate x pitch (${JSON.stringify(pitch)}) still moved columns`)
  }
})

// ── the clamp ────────────────────────────────────────────────────────────────────────────────────

test("movedRect: a drag off the right/bottom edge KEEPS the widget's size and parks it at the far edge", () => {
  const layout = { cols: 12, rows: 4, breakpoint: "panel" }
  const base = { col: 1, row: 1, colSpan: 4, rowSpan: 2 }
  // 40 columns to the right of column 1 on a 12-column grid. Not `col: 11, colSpan: 1` — that is what
  // the RENDERER's clamp answers for an out-of-range document, and applying it to a drag would resize
  // a widget the engineer only meant to move.
  assert.deepEqual(movedRect(base, { dCol: 40, dRow: 40 }, layout), { col: 8, row: 2, colSpan: 4, rowSpan: 2 })
  assert.deepEqual(movedRect(base, { dCol: -40, dRow: -40 }, layout), { col: 0, row: 0, colSpan: 4, rowSpan: 2 })
  // ...and an ordinary in-range drag is left entirely alone.
  assert.deepEqual(movedRect(base, { dCol: 3, dRow: 1 }, layout), { col: 4, row: 2, colSpan: 4, rowSpan: 2 })
})

test("resizedRect: the corner stays, the span never drops below 1 and never reaches past the grid", () => {
  const layout = { cols: 12, rows: 4, breakpoint: "panel" }
  const base = { col: 8, row: 2, colSpan: 2, rowSpan: 1 }
  assert.deepEqual(resizedRect(base, { dCol: 1, dRow: 1 }, layout), { col: 8, row: 2, colSpan: 3, rowSpan: 2 })
  // `$defs/rect` declares `minimum: 1` on both spans: a widget dragged inside-out is 1x1, not 0 and
  // not negative.
  assert.deepEqual(resizedRect(base, { dCol: -40, dRow: -40 }, layout), { col: 8, row: 2, colSpan: 1, rowSpan: 1 })
  // At col 8 on a 12-column grid the widest legal span is 4, and at row 2 on 4 rows the tallest is 2.
  assert.deepEqual(resizedRect(base, { dCol: 40, dRow: 40 }, layout), { col: 8, row: 2, colSpan: 4, rowSpan: 2 })
})

test("trackCount agrees with the RUNTIME's own idea of how many tracks a layout has", () => {
  // Not "looks like `clampedSize`" — measured against it. The widest span `clampRectToLayout` will
  // grant a widget anchored at column 0 IS the column count, by that function's own construction
  // (`colSpan = Math.min(coercedColSpan, cols - col)`), so asking for an absurd span reads the number
  // out of the runtime without this file duplicating the runtime's coercion rules.
  for (const layout of LAYOUTS) {
    const { result } = captureWarnings(() =>
      clampRectToLayout({ col: 0, row: 0, colSpan: Number.MAX_SAFE_INTEGER, rowSpan: Number.MAX_SAFE_INTEGER }, layout, "probe")
    )
    assert.equal(
      trackCount(layout.cols),
      result.rect.colSpan,
      `trackCount disagrees with clampRectToLayout about the column count of ${describe(layout.cols)}`
    )
    assert.equal(
      trackCount(layout.rows),
      result.rect.rowSpan,
      `trackCount disagrees with clampRectToLayout about the row count of ${describe(layout.rows)}`
    )
  }
})

// ── the two differentials, over the whole corpus ─────────────────────────────────────────────────

for (const [name, produce] of [
  ["movedRect", movedRect],
  ["resizedRect", resizedRect],
]) {
  test(`${name}: every rect it returns is one the RUNTIME's clamp leaves untouched — no warning, same four numbers`, () => {
    let cases = 0
    for (const layout of LAYOUTS) {
      for (const base of BASE_RECTS) {
        for (const delta of DELTAS) {
          const rect = produce(base, delta, layout)
          const why = `${name} · ${label(layout, base, delta)} → ${JSON.stringify(rect)}`

          assert.ok(Number.isInteger(rect.col) && rect.col >= 0, `${why}: col is not a non-negative integer`)
          assert.ok(Number.isInteger(rect.row) && rect.row >= 0, `${why}: row is not a non-negative integer`)
          assert.ok(Number.isInteger(rect.colSpan) && rect.colSpan >= 1, `${why}: colSpan is not an integer >= 1`)
          assert.ok(Number.isInteger(rect.rowSpan) && rect.rowSpan >= 1, `${why}: rowSpan is not an integer >= 1`)
          assert.ok(rect.col + rect.colSpan <= trackCount(layout.cols), `${why}: runs past the last column`)
          assert.ok(rect.row + rect.rowSpan <= trackCount(layout.rows), `${why}: runs past the last row`)

          const { result } = captureWarnings(() => clampRectToLayout(rect, layout, "probe"))
          assert.deepEqual(result.rect, rect, `${why}: the runtime's clamp CHANGED it`)
          assert.equal(result.warning, undefined, `${why}: the runtime's clamp warned about it`)
          cases += 1
        }
      }
    }
    // The floor for the loop itself: an empty corpus would pass every assertion above.
    assert.equal(cases, LAYOUTS.length * BASE_RECTS.length * DELTAS.length)
    assert.ok(cases > 200, `the corpus collapsed to ${cases} cases`)
  })

  test(`${name}: every rect it returns keeps the document VALID against contracts/hmi-screen.schema.json`, () => {
    let cases = 0
    for (const layout of LAYOUTS) {
      for (const base of BASE_RECTS) {
        for (const delta of DELTAS) {
          const rect = produce(base, delta, layout)
          // The LAYOUT half of the corpus is deliberately schema-invalid, so the probe document
          // declares a known-good layout and carries only the rect under test. `documentWith` spreads
          // the layout over that default, and the malformed entries would fail `$defs/layout` for a
          // reason that is not about this module — so those cases assert the rect through a legal
          // layout instead, which is exactly the document `applyEdit` would be handed in practice.
          const errs = validate(SCHEMA, SCHEMA, documentWith({}, rect))
          assert.deepEqual(errs, [], `${name} · ${label(layout, base, delta)} → ${JSON.stringify(rect)}\n${errs.join("\n")}`)
          cases += 1
        }
      }
    }
    assert.ok(cases > 200, `the corpus collapsed to ${cases} cases`)
  })
}

test("the schema differential above is a REAL gate — an illegal rect is rejected by the same call", () => {
  // The anti-blindness check for the two tests above: if `validate` were being handed something it
  // ignores (a wrong root, a swallowed error list), they would pass for every rect including these.
  for (const rect of [
    { col: -1, row: 0, colSpan: 1, rowSpan: 1 },
    { col: 0, row: 0, colSpan: 0, rowSpan: 1 },
    { col: 0, row: 0, colSpan: 1, rowSpan: 1.5 },
    { col: 0, row: 0, colSpan: 1 },
  ]) {
    const errs = validate(SCHEMA, SCHEMA, documentWith({}, rect))
    assert.ok(errs.length > 0, `validate.mjs accepted an illegal rect ${JSON.stringify(rect)} — this gate measures nothing`)
  }
})
