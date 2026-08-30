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
  /** Set exactly when the input `rect` did NOT already fit inside `layout` — `undefined` for a rect
   * that was already in bounds (the common case; most screens never trigger this). The caller
   * (`ScreenRenderer.tsx`) both `console.warn`s this and can surface it visibly on the placed widget
   * (e.g. a `title` tooltip), per this task's "clamped and warned, never silently dropped, never left to
   * overflow" rule. */
  warning?: string
}

function clampedSize(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function clampedCoord(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0
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
 *
 * `widgetId` is used ONLY to name the widget in the emitted warning — it plays no part in the math.
 */
export function clampRectToLayout(rect: WidgetRect, layout: ScreenLayout, widgetId: string): ClampResult {
  const cols = clampedSize(layout?.cols, 1)
  const rows = clampedSize(layout?.rows, 1)

  const rawCol = clampedCoord(rect?.col)
  const rawRow = clampedCoord(rect?.row)
  const rawColSpan = clampedSize(rect?.colSpan, 1)
  const rawRowSpan = clampedSize(rect?.rowSpan, 1)

  // Pin the top-left corner inside the grid first ...
  const col = Math.min(Math.max(rawCol, 0), cols - 1)
  const row = Math.min(Math.max(rawRow, 0), rows - 1)
  // ... then shrink the span so the FAR edge cannot run past `cols`/`rows` either. `cols - col` (resp.
  // `rows - row`) is always >= 1 here, since `col <= cols - 1` (resp. `row <= rows - 1`) was just
  // established above — the widget always keeps at least its one anchor cell, never shrinks to nothing.
  const colSpan = Math.min(rawColSpan, cols - col)
  const rowSpan = Math.min(rawRowSpan, rows - row)

  const clamped: WidgetRect = { col, row, colSpan, rowSpan }
  const changed = col !== rawCol || row !== rawRow || colSpan !== rawColSpan || rowSpan !== rawRowSpan
  if (!changed) return { rect: clamped }

  const warning =
    `widget "${widgetId}": rect {col:${rawCol}, row:${rawRow}, colSpan:${rawColSpan}, rowSpan:${rawRowSpan}} ` +
    `exceeds layout {cols:${cols}, rows:${rows}} — clamped to ` +
    `{col:${col}, row:${row}, colSpan:${colSpan}, rowSpan:${rowSpan}}`
  console.warn(`[hmi-runtime] ${warning}`)
  return { rect: clamped, warning }
}
