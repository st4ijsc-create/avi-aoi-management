import type { ReactNode } from "react"

import type { ScreenBreakpoint } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import { SCREEN_BREAKPOINT_WIDTHS } from "@/lib/hmiScreens"
import { SCREEN_BREAKPOINT_VALUES, type EditorEdit } from "./editorState"

/**
 * WS-HMI-2 Task 12 — the breakpoint chooser, and the frame that draws the canvas at the width the
 * chosen breakpoint stands for.
 *
 * ── 🔴 ONE CLICK CHANGES TWO THINGS, AND THAT IS THE DESIGN ──────────────────────────────────────
 * Choosing `phone` emits `{ kind: "set-breakpoint", breakpoint: "phone" }` — a real edit on the real
 * document, undoable with `Ctrl+Z` like every other — AND narrows this frame to
 * `SCREEN_BREAKPOINT_WIDTHS.phone`. Not one or the other:
 *
 *   * a chooser that only narrowed the preview would let an engineer lay a screen out at 1 280 px and
 *     publish it declaring `phone`, because `layout.breakpoint` is a REQUIRED field of the frozen
 *     document (`$defs/layout`) and nothing else in the editor writes it;
 *   * a chooser that only rewrote the field would change a word in a document and show the engineer
 *     nothing, which is a setting, not a preview.
 *
 * ── WHERE EACH HALF'S VOCABULARY COMES FROM, AND WHY THEY ARE TWO MODULES ────────────────────────
 * The NAMES come from `editorState.ts`'s `SCREEN_BREAKPOINT_VALUES` — `Object.keys` of the very
 * record `applyEdit` checks membership against — so this chooser cannot offer a value the edit would
 * refuse, and cannot fail to offer one it would take. The WIDTHS come from `lib/hmiScreens.ts`'s
 * `SCREEN_BREAKPOINT_WIDTHS`. Two modules because they are two different kinds of fact: the names are
 * frozen contract (`scripts/check-contracts.mjs` holds `ScreenBreakpoint` equal to the schema's enum,
 * and `tests/42-editor-publish.spec.ts` compares what this chooser RENDERS against the same schema
 * file read from disk), while the widths are a design-time choice this repository has nothing to
 * derive from and states with its reasoning instead. Both are `Record<ScreenBreakpoint, …>`, so
 * neither can lose a member without tsc saying so.
 *
 * ── WHAT THE FRAME DOES NOT DO ───────────────────────────────────────────────────────────────────
 * It is a `max-width`, never a fixed width: at `panel` (1 280 px, the default of every shipped
 * document) it is wider than any canvas the editor can hand it inside a 1 280 px browser window, so
 * the frame is INERT there and the canvas keeps every pixel it had before this task. That is what
 * lets `37-editor-canvas.spec.ts`'s renderer-identity differential and `38-editor-drag.spec.ts`'s
 * overlay-alignment measurement — both taken at `panel` — stay exactly as they were.
 *
 * It also does not scale, zoom, or transform. A CSS transform would make the renderer lay out at one
 * size and paint at another, so every pixel the drag layer measures off the grid would be a lie; the
 * frame simply gives the renderer a narrower box and lets the fluid grid do what it does on a real
 * device.
 */
export function BreakpointPreview({
  breakpoint,
  readOnly,
  onEdit,
  children,
}: {
  /** The document's own `layout.breakpoint` — read, never stored here. This component holds NO state:
   * the chosen breakpoint is a field of the document, and a second copy of it in a `useState` would
   * be a second answer to "which breakpoint is this screen for". */
  breakpoint: ScreenBreakpoint
  /**
   * 🔴 FIX ROUND 1, task-12-review.md M1 (found while falsifying it) — TRUE WHILE A PAST VERSION IS
   * PREVIEWED, and then this chooser must not act.
   *
   * The review named four live surfaces; this was a fifth it did not list and the mutation round found:
   * choosing a breakpoint emits `set-breakpoint`, a real edit on the SESSION's document, and pressing
   * it while version 3 is on screen would rewrite a document the engineer is not looking at — the same
   * defect, at a control whose whole subject is what is on screen.
   *
   * `disabled` rather than unmounted, unlike the layer tree and the property panel: those two carry
   * per-widget labels that would be describing widgets that are not on screen, whereas this control's
   * three labels stay true of the previewed document. A disabled view control that says why is honest;
   * a hidden one would make the preview look like it had no breakpoint at all.
   */
  readOnly: boolean
  onEdit: (edit: EditorEdit) => void
  children: ReactNode
}) {
  const t = useT()
  const width = SCREEN_BREAKPOINT_WIDTHS[breakpoint]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div
        data-editor-breakpoint-bar
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border border-border-strong bg-surface-muted px-2 py-1.5"
      >
        <span className="hmi-micro">{t("editor.breakpoint.label")}</span>
        {/*
          A radio GROUP, not a `<select>`: three mutually exclusive views an engineer flips between
          while judging a layout, which is what a radio group is for, and it puts all three widths one
          click apart instead of behind a menu. `role="radiogroup"` + `aria-checked` on `<button>`s
          rather than `<input type="radio">` because these are toolbar buttons visually; the semantics
          are the same to assistive tech and the keyboard reaches each one as an ordinary button.
        */}
        <div role="radiogroup" aria-label={t("editor.breakpoint.label")} className="flex items-center gap-1">
          {SCREEN_BREAKPOINT_VALUES.map((value) => {
            const active = value === breakpoint
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                data-editor-breakpoint-choice={value}
                data-editor-breakpoint-selected={active ? "true" : "false"}
                disabled={readOnly}
                title={readOnly ? t("editor.publish.readOnlyChooser") : undefined}
                // 🔴 The label names the breakpoint AND its width, because "tablet" alone does not tell
                // an engineer what they are about to be shown. The width is interpolated from the same
                // table the frame below uses — never retyped into a dictionary, where it would be a
                // second copy in two languages that no pin could reach (the defect Task 11 fix round 1
                // closed for the widget-id pattern hint, at LOW-4).
                aria-label={t("editor.breakpoint.choice", {
                  breakpoint: value,
                  width: SCREEN_BREAKPOINT_WIDTHS[value],
                })}
                className={
                  "border px-2 py-0.5 text-xs disabled:opacity-40 " +
                  (active
                    ? "border-[var(--focus)] bg-[color-mix(in_srgb,var(--focus)_18%,transparent)] text-text-strong"
                    : "border-border-strong bg-surface-subtle text-text-muted")
                }
                onClick={() => onEdit({ kind: "set-breakpoint", breakpoint: value })}
              >
                {value}
              </button>
            )
          })}
        </div>
        {/* What the frame is actually doing, in pixels, so the preview is not a claim the engineer has
            to take on trust. `data-editor-preview-width` carries the same number for the spec, which
            ALSO measures the rendered box — a caption and a measurement, not a caption alone. */}
        <span data-editor-preview-width={width} className="hmi-micro normal-case text-text-muted">
          {t("editor.breakpoint.width", { width })}
        </span>
      </div>

      {/*
        The frame. `mx-auto` so a narrowed preview sits centred in the space it left behind rather than
        pinned to one edge — which is where a device sits in a designer's field of view, and which
        makes the width change legible instead of looking like the canvas moved.
      */}
      <div
        data-editor-breakpoint={breakpoint}
        style={{ maxWidth: `${width}px` }}
        className="mx-auto h-full min-h-0 w-full min-w-0"
      >
        {children}
      </div>
    </div>
  )
}
