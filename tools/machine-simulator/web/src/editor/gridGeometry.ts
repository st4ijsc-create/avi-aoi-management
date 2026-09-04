/**
 * WS-HMI-2 Task 9 — the PIXEL ↔ GRID-CELL arithmetic behind selection, dragging, resizing and
 * snapping on the editor's canvas.
 *
 * Plain `.ts`, NO JSX, NO React, NO DOM — the same reason `hmi-runtime/gridLayout.ts`,
 * `hmi-runtime/widgets/shared.ts` and `editor/editorState.ts` are plain: Node's native loader strips
 * TYPE syntax but cannot parse JSX at all, so a `.tsx` can never be `import()`-ed under `node --test`
 * (measured in WS-HMI-1 Task 2 — `runtime-tests/widgetRegistry.test.mjs`'s header carries the probe).
 * Everything below is arithmetic over numbers; nothing about it needs a renderer, a pointer event or
 * an element. That is what lets `runtime-tests/editorGeometry.test.mjs` EXECUTE it rather than read it.
 *
 * ── WHY SNAPPING IS A SEPARATE STEP FROM CLAMPING, AND WHY BOTH RUN BEFORE `applyEdit` ───────────
 * `editorState.ts`'s `applyEdit` REFUSES an edit whose result would break `contracts/hmi-screen.schema
 * .json` — it never repairs one (that module's header states this at length). So a drag that leaves
 * the grid must arrive at `applyEdit` already legal, or it arrives as a refusal the user cannot act
 * on: the widget would simply not move and nothing would say why. Clamping is therefore this layer's
 * job, on the way IN.
 *
 * The two steps are genuinely different and are kept apart on purpose:
 *
 *   * `snapToCells` turns a PIXEL delta into a CELL delta. It is the step that makes a drop between
 *     two cells land on an integer coordinate — `Math.round(px / pitch)`, nearest cell, never
 *     truncation. An implementation that skipped it and rounded the PIXEL offset instead would write
 *     `col: 352` for a ≈351 px drag and then be clamped to the far edge, which is why
 *     `tests/38-editor-drag.spec.ts` drags by a deliberately NON-INTEGER multiple of the pitch and
 *     asserts the exact cell, not merely "an integer". (🔴 FIX ROUND 1, task-9-review.md F6 — the
 *     figures here said `col: 359` for a 358.1 px drag; the measured pitch is 103.164 px, not ≈105.)
 *   * `movedRect`/`resizedRect` turn a CELL delta into a rect that fits inside `layout`. A move keeps
 *     the widget's SIZE and stops its top-left corner at `cols - colSpan` / `rows - rowSpan`; a resize
 *     keeps the widget's CORNER and stops its span at `cols - col` / `rows - row`, never below 1.
 *
 * ── THE RELATIONSHIP TO `clampRectToLayout`, STATED PRECISELY ────────────────────────────────────
 * The runtime's `hmi-runtime/gridLayout.ts` already clamps at RENDER time, and this module does NOT
 * replace it, duplicate it, or wrap it. The two answer different questions, and the difference is
 * visible in one case: for `{col: 20, colSpan: 4}` on a 12-column grid the RENDERER answers
 * `{col: 11, colSpan: 1}` — pin the corner inside the grid, then shrink the span — which is right for
 * "draw this document, whatever it says", and wrong for "the engineer dragged this widget rightwards",
 * where the widget must keep its size and stop at `col: 8`.
 *
 * What IS pinned, in `runtime-tests/editorGeometry.test.mjs`, is that the two never disagree about
 * LEGALITY: `clampRectToLayout` is a no-op on every rect this module returns, over a corpus that
 * includes the out-of-range and structurally-malformed inputs. That is a two-way check against the
 * runtime's own rule rather than a second copy of it — the same device `editorState.ts` uses against
 * `validate.mjs`, and the reason `trackCount` below is asserted to agree with the span
 * `clampRectToLayout` grants at column 0 rather than merely being written to look similar.
 */
import type { ScreenLayout, WidgetRect } from "../contracts/hmiScreen.ts"

/** A pointer displacement in CSS pixels — `clientX/clientY` now minus `clientX/clientY` at pointerdown. */
export type PixelDelta = { readonly x: number; readonly y: number }

/** The same displacement expressed in whole grid cells, after snapping. */
export type CellDelta = { readonly dCol: number; readonly dRow: number }

/**
 * The distance between the LEFT edges of two horizontally adjacent cells, and between the TOP edges of
 * two vertically adjacent ones — i.e. one track plus one gap. This, not the track width, is what a
 * pointer delta divides by: moving a widget one column to the right moves it by a track AND a gap.
 */
export type GridPitch = { readonly x: number; readonly y: number }

/** A DOM-free view of the box the grid occupies. `DOMRect` satisfies it structurally, so a caller
 * hands `getBoundingClientRect()` straight in without this module importing a DOM type. */
export type GridBox = { readonly width: number; readonly height: number }

function finiteOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback
}

/**
 * How many tracks `layout` declares on one axis.
 *
 * Deliberately the SAME rule as `gridLayout.ts`'s `clampedSize(raw, 1)` — a positive finite number
 * floored, anything else 1 — because a document that has reached this layer is not guaranteed to
 * match its declared TypeScript shape (it arrived as JSON over HTTP; schema validation happens at
 * authoring/publish time). The agreement is not asserted by this comment: `editorGeometry.test.mjs`
 * runs a corpus of layouts through both this function and `clampRectToLayout`, and reddens if the
 * track count here ever differs from the span the runtime grants a widget at column 0.
 */
export function trackCount(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
}

/** A rect field that names a CELL OFFSET (`col`, `row`) — floored, never negative in the output of
 * the two rect functions below, and 0 for anything that is not a finite number. */
function coordOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0
}

/** A rect field that names a CELL COUNT (`colSpan`, `rowSpan`) — at least 1, same fallback as
 * `gridLayout.ts`, because `$defs/rect` declares `minimum: 1` and a zero-span widget is not a smaller
 * widget, it is an invisible one. */
function spanOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
}

/** A CELL delta is already whole by construction when it comes from `snapToCells`; this guards the
 * case where a caller synthesises one (a keyboard nudge, a future test) with a fractional or
 * non-finite value. */
function stepOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 0
}

function clampInt(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * The cell pitch of a `layout`-shaped CSS grid occupying `box` with gutters `gap`.
 *
 * `box.width = cols * track + (cols - 1) * gap`, so `track + gap === (width + gap) / cols`. Written
 * this way rather than as `track = (width - (cols - 1) * gap) / cols` followed by `track + gap`
 * because the single division has no intermediate to round and no special case at `cols === 1` (where
 * there is no gutter at all and the identity still holds: `(width + gap) / 1` is a pitch no drag can
 * ever consume more than one of, since a 1-column grid clamps every horizontal move to column 0).
 *
 * `gap` is MEASURED from the live element (`getComputedStyle(...).columnGap`), not assumed from the
 * Tailwind class the overlay carries: the overlay's gutters must match `ScreenRenderer`'s or the
 * pitch is wrong by a fraction of a cell per column, and a measured value cannot drift from what is
 * on screen the way a copied constant can. `tests/38-editor-drag.spec.ts` additionally compares the
 * overlay's computed gaps and track counts against the renderer's own, so the mirror is pinned rather
 * than trusted.
 */
export function gridPitch(box: GridBox, layout: ScreenLayout, gap: PixelDelta): GridPitch {
  const cols = trackCount(layout?.cols)
  const rows = trackCount(layout?.rows)
  const gapX = finiteOr(gap?.x, 0)
  const gapY = finiteOr(gap?.y, 0)
  return {
    x: (finiteOr(box?.width, 0) + gapX) / cols,
    y: (finiteOr(box?.height, 0) + gapY) / rows,
  }
}

/**
 * THE SNAP. A pixel displacement becomes a whole number of cells, to the NEAREST cell.
 *
 * `Math.round`, not `Math.trunc`/`Math.floor`: a drop three and a half cells to the right belongs in
 * the fourth cell, not the third, and an engineer who lets go 4 px past a boundary means the cell
 * they crossed into. (JavaScript's `Math.round` breaks exact `.5` ties toward `+∞`, so a drop on the
 * precise midpoint of two cells resolves to the right/lower one — an arbitrary but fixed choice, and
 * one a real pointer essentially never lands on.)
 *
 * A pitch that is not a positive finite number yields NO movement rather than `NaN`/`Infinity` cells:
 * a zero-width canvas (a collapsed flex parent, a hidden tab) must make a drag inert, not corrupt the
 * document with a rect nobody can see.
 */
export function snapToCells(delta: PixelDelta, pitch: GridPitch): CellDelta {
  const usable = (span: unknown): span is number => typeof span === "number" && Number.isFinite(span) && span > 0
  // `Math.round(-19 / 40)` is NEGATIVE zero, and `assert.deepEqual({dRow: -0}, {dRow: 0})` fails —
  // caught by `editorGeometry.test.mjs`'s sub-cell-jiggle case on its first run. It is harmless
  // arithmetically (every consumer adds it to an integer) but it is a value that compares unequal to
  // the zero every caller means, so it is normalised at the boundary rather than tolerated at each
  // call site. `|| 0` is exactly this normalisation: `-0` is falsy, every other integer is not.
  const cells = (pixels: number, span: number) => Math.round(pixels / span) || 0
  return {
    dCol: usable(pitch?.x) ? cells(finiteOr(delta?.x, 0), pitch.x) : 0,
    dRow: usable(pitch?.y) ? cells(finiteOr(delta?.y, 0), pitch.y) : 0,
  }
}

/**
 * Where a widget of `base`'s SIZE lands when dragged by `delta` cells — clamped so its far edge
 * cannot pass `layout`'s far edge and its near edge cannot go negative.
 *
 * The span is preserved (capped only by the grid's own size, for the degenerate case of a widget
 * wider than its layout): dragging a 4-wide widget off the right edge of a 12-column grid parks it at
 * `col: 8`, still 4 wide. Shrinking it instead — which is what the RENDERER's clamp does to an
 * out-of-range document — would silently resize a widget the engineer only meant to move.
 */
export function movedRect(base: WidgetRect, delta: CellDelta, layout: ScreenLayout): WidgetRect {
  const cols = trackCount(layout?.cols)
  const rows = trackCount(layout?.rows)
  const colSpan = Math.min(spanOf(base?.colSpan), cols)
  const rowSpan = Math.min(spanOf(base?.rowSpan), rows)
  return {
    col: clampInt(coordOf(base?.col) + stepOf(delta?.dCol), 0, cols - colSpan),
    row: clampInt(coordOf(base?.row) + stepOf(delta?.dRow), 0, rows - rowSpan),
    colSpan,
    rowSpan,
  }
}

/**
 * What a widget's SPAN becomes when its bottom-right resize handle is dragged by `delta` cells — the
 * top-left corner stays put, the span never drops below 1 (`$defs/rect`'s own `minimum`) and never
 * reaches past the grid.
 *
 * The corner is clamped into the grid first so that `cols - col` is at least 1 — a widget whose
 * document rect starts outside the layout still gets a legal, visible result rather than a span of
 * zero or a negative one.
 */
export function resizedRect(base: WidgetRect, delta: CellDelta, layout: ScreenLayout): WidgetRect {
  const cols = trackCount(layout?.cols)
  const rows = trackCount(layout?.rows)
  const col = clampInt(coordOf(base?.col), 0, cols - 1)
  const row = clampInt(coordOf(base?.row), 0, rows - 1)
  return {
    col,
    row,
    colSpan: clampInt(spanOf(base?.colSpan) + stepOf(delta?.dCol), 1, cols - col),
    rowSpan: clampInt(spanOf(base?.rowSpan) + stepOf(delta?.dRow), 1, rows - row),
  }
}
