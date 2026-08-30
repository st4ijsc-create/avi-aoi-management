/**
 * WS-HMI-1 Task 3 — grid-placement math for `ScreenRenderer.tsx`, factored into its own JSX-FREE plain
 * `.ts` module for the exact reason `web/src/hmi-runtime/widgets/shared.ts` (Task 2) already
 * established: Node's native `.ts` loader strips TYPE syntax but cannot parse JSX at all
 * (`ERR_UNKNOWN_FILE_EXTENSION` for any `.tsx`, measured in Task 2 — see `widgetRegistry.test.mjs`'s
 * header for the exact probe), so `ScreenRenderer.tsx` itself can never be `import()`-ed under
 * `node --test`. The clamp math below is pure arithmetic over `WidgetRect`/`ScreenLayout` — nothing
 * about it needs a renderer — so pulling it out of `ScreenRenderer.tsx` is what makes it possible to pin
 * with a REAL executed test (`web/runtime-tests/bindings.test.mjs`) instead of a source-text check.
 *
 * Not one of the two files the task brief names (`bindings.ts`, `ScreenRenderer.tsx`) — added for the
 * same reason Task 2 added `widgets/shared.ts` beyond its own listed 15 widget files: the constraint
 * that forces the split isn't visible until you actually try to test the thing.
 */
import type { ScreenLayout, WidgetRect } from "../contracts/hmiScreen.ts"

export type ClampResult = {
  rect: WidgetRect
  /** Set exactly when the returned `rect` differs from the ORIGINAL `rect` argument in ANY field —
   * `undefined` for a rect that was already valid and in bounds (the common case; most screens never
   * trigger this). The caller (`ScreenRenderer.tsx`) both `console.warn`s this and can surface it
   * visibly on the placed widget (e.g. a `title` tooltip), per this task's "clamped and warned, never
   * silently dropped, never left to overflow" rule.
   *
   * 🔴 Fix round 1, Finding 1: this must compare against the TRUE original input, not against an
   * already-type-coerced intermediate. An earlier version of this function computed its "raw" values by
   * applying the very same fallback defaults used for range-clamping (`0`/`1`) BEFORE comparing — so a
   * structurally malformed field (wrong type, `null`, `NaN`, `Infinity`, missing) that happened to
   * coerce to an already-in-range fallback produced `changed === false` and NO warning at all, even
   * though the widget's placement silently changed from whatever nonsense the document contained to
   * `(0,0)` at `1×1`. That is exactly "a screen that looks fine and is wrong" — the failure mode
   * proposition 4 exists to rule out. Fixed by comparing the FINAL clamped values against `rect`'s own
   * raw fields directly (see `clampRectToLayout` below), so type coercion is treated as a change exactly
   * like range clamping is. */
  warning?: string
}

function clampedSize(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function clampedCoord(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0
}

/** Renders an arbitrary raw (possibly non-numeric, possibly missing) field for the warning message —
 * `String(x)` alone mangles `undefined`/`null`/strings inconsistently (e.g. a bare `x` reads as if it
 * were a bareword, not a string), so this makes the ACTUAL type of a malformed value legible in the
 * warning rather than just its coerced replacement. */
function describeRaw(raw: unknown): string {
  if (raw === undefined) return "undefined"
  if (raw === null) return "null"
  if (typeof raw === "number") return String(raw) // includes "NaN", "Infinity"
  return JSON.stringify(raw)
}

/**
 * Clamps a widget's `rect` so it fits entirely inside `layout`'s declared `[0, cols)` x `[0, rows)`
 * grid — the widget is NEVER dropped and NEVER allowed to overflow. `col`/`row` are 0-indexed grid-cell
 * offsets, `colSpan`/`rowSpan` cell counts — `contracts/fixtures/valid/screen-screwdrive-full.json`'s
 * widgets already assume this (its "torque-trend" widget sits at `col: 7, colSpan: 5` against
 * `layout.cols: 12`, flush against the right edge: `7 + 5 === 12`).
 *
 * Also defensive against a rect that is not merely out of range but structurally wrong — `layout.cols`/
 * `rows` fall back to `1`, `rect.col`/`row` fall back to `0`, and `rect.colSpan`/`rowSpan` fall back to
 * `1` whenever the actual value is missing, non-numeric, non-finite, or non-positive. A JSON document is
 * not guaranteed to match its declared TS shape at runtime — schema validation happens at authoring/
 * publish time, not here (plan §5-bis: no screen is a valid state for this renderer to fail hard on).
 * Type coercion of a malformed field is treated as a CHANGE (and therefore warned), exactly the same as
 * range-clamping a well-typed but out-of-bounds one — see `ClampResult.warning`'s doc comment for the
 * bug this fixes and why the distinction matters.
 *
 * `widgetId` is used ONLY to name the widget in the emitted warning — it plays no part in the math.
 */
export function clampRectToLayout(rect: WidgetRect, layout: ScreenLayout, widgetId: string): ClampResult {
  const cols = clampedSize(layout?.cols, 1)
  const rows = clampedSize(layout?.rows, 1)

  const coercedCol = clampedCoord(rect?.col)
  const coercedRow = clampedCoord(rect?.row)
  const coercedColSpan = clampedSize(rect?.colSpan, 1)
  const coercedRowSpan = clampedSize(rect?.rowSpan, 1)

  // Pin the top-left corner inside the grid first ...
  const col = Math.min(Math.max(coercedCol, 0), cols - 1)
  const row = Math.min(Math.max(coercedRow, 0), rows - 1)
  // ... then shrink the span so the FAR edge cannot run past `cols`/`rows` either. `cols - col` (resp.
  // `rows - row`) is always >= 1 here, since `col <= cols - 1` (resp. `row <= rows - 1`) was just
  // established above — the widget always keeps at least its one anchor cell, never shrinks to nothing.
  const colSpan = Math.min(coercedColSpan, cols - col)
  const rowSpan = Math.min(coercedRowSpan, rows - row)

  const clamped: WidgetRect = { col, row, colSpan, rowSpan }

  // 🔴 Fix round 1, Finding 1: compare against `rect`'s OWN raw fields, not against `coercedCol`/etc.
  // Comparing coerced-vs-final only ever catches RANGE clamping (a valid number that was out of bounds).
  // Comparing the TRUE raw input vs final catches BOTH range clamping AND type coercion (wrong type,
  // `null`, `NaN`, `Infinity`, a missing field) — a malformed field whose fallback happens to already be
  // in-range must still be reported as a change, because the document's actual content was ignored.
  const changed =
    rect?.col !== col || rect?.row !== row || rect?.colSpan !== colSpan || rect?.rowSpan !== rowSpan
  if (!changed) return { rect: clamped }

  const warning =
    `widget "${widgetId}": rect {col:${describeRaw(rect?.col)}, row:${describeRaw(rect?.row)}, ` +
    `colSpan:${describeRaw(rect?.colSpan)}, rowSpan:${describeRaw(rect?.rowSpan)}} does not fit layout ` +
    `{cols:${cols}, rows:${rows}} — clamped to {col:${col}, row:${row}, colSpan:${colSpan}, rowSpan:${rowSpan}}`
  console.warn(`[hmi-runtime] ${warning}`)
  return { rect: clamped, warning }
}
