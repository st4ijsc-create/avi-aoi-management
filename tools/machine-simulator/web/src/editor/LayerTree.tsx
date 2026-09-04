import { useState } from "react"

import type { HmiScreenDocument, ScreenWidget, WidgetKind } from "@/contracts/hmiScreen"
import type { PolicyAction } from "@/contracts/tagNamespace"
import { useT } from "@/i18n"
import { widgetRegistry } from "@/hmi-runtime/widgetRegistry"
import {
  POLICY_ACTION_VALUES,
  POLICY_REQUIRED_WIDGET_KINDS,
  type EditorEdit,
} from "./editorState"
import { CommitField } from "./PropertyPanel"

/**
 * WS-HMI-2 Task 11 — the LAYER TREE: what is on this screen, in the order it is drawn, and the four
 * things an engineer does to that list — add, delete, reorder, rename.
 *
 * ── 🔴 THE ADD MENU IS THE REGISTRY, NOT A SECOND LIST ───────────────────────────────────────────
 * `ADDABLE_KINDS` below is `Object.keys(widgetRegistry)` — the very table `ScreenRenderer` dispatches
 * on. Not `WIDGET_KIND_VALUES` (the frozen union's mirror in `editorState.ts`), and emphatically not
 * an array typed out beside the JSX. The consequence is structural rather than promised: a kind this
 * editor offers is a kind the runtime can actually DRAW, because the same object answers both
 * questions. A hand-written list would be a second place to keep in step — the defect class this
 * branch has spent the week on — and it would be correct on the day it was written, which is exactly
 * why a test that only compared the rendered options against a list of names could not tell the two
 * apart. `tests/40-editor-layers.spec.ts` therefore does BOTH: it compares the rendered option set
 * against the registry file read from disk (with the two-independent-extractions floor Task 6's
 * review settled on, so a broken extraction cannot pass by matching an empty set against an empty
 * set), AND it asserts that no widget-kind string literal appears in THIS FILE at all. Replace the
 * derivation below with a hand-written array that happens to be right today and the second half goes
 * red naming the kind it found.
 *
 * That second half has a stated limit: a hand-written list moved into ANOTHER module and imported
 * here would satisfy it. The set comparison is what catches such a list the day it drifts, and the
 * two together are the honest instrument — the source pin alone would be a text match, and the set
 * comparison alone would be blind to a correct copy.
 *
 * ── 🔴 §5 REACHES THE ADD PATH TOO ───────────────────────────────────────────────────────────────
 * `setpoint-input` and `command-button` are WRITE kinds and the frozen schema requires a
 * `policyAction` on them (invariant §5, `$defs/widget`'s `allOf`/`if`/`then`). The add menu still
 * lists them — filtering them out would be a hand-written exclusion, i.e. the very thing the
 * paragraph above forbids, and an editor that cannot author part of the contract. Instead, choosing
 * one reveals the SAME action `<select>` the property panel uses, built from the same
 * `POLICY_ACTION_VALUES`, and the Add button stays disabled with a named sentence until an action is
 * chosen. There is no ordering of clicks here that builds an ungated write widget, and `applyEdit`
 * refuses one independently if this component is ever bypassed.
 *
 * ── WHAT THIS COMPONENT DOES NOT OWN ─────────────────────────────────────────────────────────────
 * No document and no history. Every button emits one `EditorEdit` through `onEdit`, which is
 * `EditorCanvas`'s single `applyEdit` on its single `editorState` session — the same one the drag
 * layer and the property panel use, so `Ctrl+Z` walks back through all three in the order they
 * happened. Selection is the canvas's too: this component reads `selectedId` and calls `onSelect`.
 *
 * It also does not render a refusal. A refused edit lands in `EditorCanvas`'s `lastRefusal` and is
 * shown by `PropertyPanel` (which is why rename is offered on the SELECTED row: the row whose name is
 * being typed is the row whose panel is open, so the refusal is on screen beside it rather than in a
 * second refusal surface with its own filtering rules).
 */

/**
 * The add menu's vocabulary. `Object.keys` of the runtime's own dispatch table, in the order that
 * table declares — see the header. `widgetRegistry` is typed `Record<WidgetKind, WidgetComponent>`,
 * so the cast asserts nothing tsc could not already prove about its keys.
 */
const ADDABLE_KINDS = Object.keys(widgetRegistry) as WidgetKind[]

/** The rect a newly added widget takes. One cell tall, two wide where the grid allows it, at the
 * top-left corner — a deterministic, always-legal starting point the engineer then drags. It is NOT
 * "somewhere free": finding free space is a packing problem, and a widget that lands where the
 * engineer is looking is easier to find than one placed cleverly out of sight. Overlap is legal (two
 * widgets may share cells; the layer tree is where you see which is on top), so nothing here needs to
 * avoid it. */
function freshRect(doc: HmiScreenDocument) {
  return { col: 0, row: 0, colSpan: Math.min(2, Math.max(1, doc.layout.cols)), rowSpan: 1 }
}

/**
 * A widget id nothing on this document carries, matching the frozen schema's own
 * `^[a-z0-9-]+$` — the pattern is NOT restated here, it is satisfied by construction (a fixed
 * lowercase stem plus a decimal counter) and enforced for real by `applyEdit`'s `rename`/`add`
 * guards, which read the one copy of it in `editorState.ts`.
 */
function freshId(doc: HmiScreenDocument): string {
  const taken = new Set(doc.widgets.map((widget) => widget.id))
  for (let n = 1; ; n++) {
    const candidate = `w-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

function requiresAction(kind: string): boolean {
  return POLICY_REQUIRED_WIDGET_KINDS.some((known) => known === kind)
}

export type LayerTreeProps = {
  /** The document as the editing session currently holds it — the same object `EditorCanvas` hands
   * `<ScreenRenderer>`, so the list and the canvas cannot disagree about what exists or about the
   * order it is drawn in. */
  doc: HmiScreenDocument
  /** The widget selected on the canvas, or `undefined`. Selection is one piece of state living in one
   * place; this component neither keeps a copy nor derives one. */
  selectedId: string | undefined
  onSelect: (widgetId: string | undefined) => void
  /** Applies an edit through the canvas's single `editorState` session. */
  onEdit: (edit: EditorEdit) => void
}

export function LayerTree({ doc, selectedId, onSelect, onEdit }: LayerTreeProps) {
  const t = useT()
  const [kindToAdd, setKindToAdd] = useState("")
  const [actionToAdd, setActionToAdd] = useState("")
  /**
   * How many rename COMMITS have been attempted. It is part of the rename box's `key`, and that is
   * the whole reason it exists.
   *
   * `CommitField` snaps back only when `onCommit` returns FALSE, which means "I did not emit an
   * edit". A rename that IS emitted and is then REFUSED by `applyEdit` (a duplicate id, a name
   * outside the frozen pattern) is not that case — and without this, the box would sit there holding
   * a name the document never took while the panel beside it explained the refusal. Re-keying on
   * every attempt remounts the field from `widget.id`, i.e. from what the DOCUMENT says, which is the
   * right answer in both outcomes: the old name after a refusal, the new one after an acceptance.
   * Measured by `tests/40-editor-layers.spec.ts` — the assertion that caught its absence.
   *
   * The alternative was to make `onEdit` report acceptance back to this component. That would put a
   * return channel on a one-way "here is an edit" seam that `PropertyPanel` and the drag layer share,
   * for one field's benefit; re-reading the document is the same answer with no new seam.
   */
  const [renameAttempts, setRenameAttempts] = useState(0)

  const gateMissing = requiresAction(kindToAdd) && actionToAdd === ""

  function add() {
    if (kindToAdd === "" || gateMissing) return
    const widget: ScreenWidget = {
      id: freshId(doc),
      kind: kindToAdd as WidgetKind,
      rect: freshRect(doc),
    }
    // Written only when the chosen kind needs it. A gate on a kind that does not require one is legal
    // under the schema but is a permission nobody asked for, and this control only appears for the
    // kinds that do — so `actionToAdd` is empty for every other kind and the field never appears.
    if (requiresAction(kindToAdd)) widget.policyAction = actionToAdd as PolicyAction
    onEdit({ kind: "add", widget })
    // The new widget is selected, so the panel opens on it and the rename box on its row is reachable
    // without hunting for the row that just appeared at the bottom of the list.
    onSelect(widget.id)
    setKindToAdd("")
    setActionToAdd("")
  }

  return (
    <aside
      data-layer-tree
      className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border border-border-strong bg-surface-subtle p-2"
    >
      <h2 className="font-heading text-sm font-semibold text-text-strong">{t("editor.layers.title")}</h2>
      <p className="hmi-micro normal-case text-text-muted">{t("editor.layers.drawOrder")}</p>

      {doc.widgets.length === 0 ? (
        <p data-layer-empty className="text-xs text-text-muted">
          {t("editor.layers.empty")}
        </p>
      ) : null}

      {/* The list, in DOCUMENT order — `doc.widgets` itself, not a sorted copy. The renderer places
          cells in this same order and sets no `z-index`, so a later row is painted over an earlier
          one where two cells overlap; that is why "reorder" and "draw order" are the same control
          rather than two. */}
      <ol data-layer-list className="flex flex-col gap-1">
        {doc.widgets.map((widget, index) => {
          const selected = widget.id === selectedId
          return (
            <li
              key={widget.id}
              data-layer-row={widget.id}
              data-layer-index={index}
              data-layer-selected={selected ? "true" : "false"}
              className={`flex flex-col gap-1 border px-1.5 py-1 ${
                selected ? "border-[var(--focus)] bg-surface-muted" : "border-border-strong"
              }`}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-layer-select={widget.id}
                  aria-label={t("editor.layers.selectLayer", { widgetId: widget.id })}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-left"
                  onClick={() => onSelect(widget.id)}
                >
                  <span className="block truncate font-mono text-xs text-text-strong">{widget.id}</span>
                  <span data-layer-kind={widget.id} className="hmi-micro block normal-case text-text-muted">
                    {widget.kind}
                  </span>
                </button>
                <button
                  type="button"
                  data-layer-up={widget.id}
                  aria-label={t("editor.layers.moveUp", { widgetId: widget.id })}
                  disabled={index === 0}
                  className="h-6 w-6 shrink-0 border border-border-strong text-xs disabled:opacity-40"
                  onClick={() => onEdit({ kind: "reorder", widgetId: widget.id, toIndex: index - 1 })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  data-layer-down={widget.id}
                  aria-label={t("editor.layers.moveDown", { widgetId: widget.id })}
                  disabled={index === doc.widgets.length - 1}
                  className="h-6 w-6 shrink-0 border border-border-strong text-xs disabled:opacity-40"
                  onClick={() => onEdit({ kind: "reorder", widgetId: widget.id, toIndex: index + 1 })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  data-layer-remove={widget.id}
                  aria-label={t("editor.layers.remove", { widgetId: widget.id })}
                  className="h-6 w-6 shrink-0 border border-border-strong text-xs"
                  onClick={() => onEdit({ kind: "remove", widgetId: widget.id })}
                >
                  ×
                </button>
              </div>

              {/* Rename is offered on the SELECTED row only — see the header for why (the refusal a
                  duplicate or malformed name earns is rendered by the property panel, which is open
                  on exactly that widget). `key` is the committed id, so an ACCEPTED rename reloads the
                  box with the new name; a REFUSED one is what `CommitField`'s false return snaps
                  back. */}
              {selected ? (
                <>
                  <CommitField
                    key={`${widget.id}:${renameAttempts}`}
                    value={widget.id}
                    type="text"
                    hook={{ "data-layer-rename": widget.id }}
                    label={t("editor.layers.renameLabel", { widgetId: widget.id })}
                    onCommit={(raw) => {
                      // Refused rather than silently trimmed: a name the engineer typed with a stray
                      // space is a name they should see refused, and `applyEdit` is the one place that
                      // decides what a legal id is.
                      if (raw === widget.id) return false
                      setRenameAttempts((n) => n + 1)
                      onEdit({ kind: "rename", widgetId: widget.id, newId: raw })
                      return true
                    }}
                  />
                  <span className="hmi-micro normal-case text-text-muted">{t("editor.layers.renameHint")}</span>
                </>
              ) : null}
            </li>
          )
        })}
      </ol>

      <section data-layer-add-section className="border-t border-border-strong pt-2">
        <h3 className="hmi-micro text-text-strong">{t("editor.layers.addTitle")}</h3>
        <div className="mt-1 flex flex-col gap-1">
          <select
            data-layer-add-kind
            aria-label={t("editor.layers.addKindLabel")}
            className="h-7 w-full border border-border-strong bg-surface-muted px-1 text-sm"
            value={kindToAdd}
            onChange={(event) => {
              setKindToAdd(event.target.value)
              // A held action belongs to the kind it was chosen for; carrying it across would gate a
              // different widget with a decision nobody made about it.
              setActionToAdd("")
            }}
          >
            <option value="">{t("editor.layers.addKindChoose")}</option>
            {ADDABLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>

          {requiresAction(kindToAdd) ? (
            <>
              <p data-layer-add-policy-required role="alert" className="text-xs text-text-body">
                {t("editor.layers.addPolicyRequired", { kind: kindToAdd })}
              </p>
              <select
                data-layer-add-policy
                aria-label={t("editor.panel.policyLabel")}
                className="h-7 w-full border border-border-strong bg-surface-muted px-1 text-sm"
                value={actionToAdd}
                onChange={(event) => setActionToAdd(event.target.value)}
              >
                <option value="">{t("editor.panel.policyChoose")}</option>
                {POLICY_ACTION_VALUES.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <button
            type="button"
            data-layer-add
            disabled={kindToAdd === "" || gateMissing}
            className="h-7 border border-border-strong bg-surface-muted px-2 text-sm disabled:opacity-40"
            onClick={add}
          >
            {t("editor.layers.addButton")}
          </button>
        </div>
      </section>
    </aside>
  )
}
