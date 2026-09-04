import { useState, type ReactNode } from "react"

import type { PolicyAction } from "@/contracts/tagNamespace"
import type { ScreenWidget, WidgetKind, WidgetRect } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import {
  POLICY_ACTION_VALUES,
  POLICY_REQUIRED_WIDGET_KINDS,
  WIDGET_FIELD_NAMES,
  WIDGET_KIND_VALUES,
  type EditorEdit,
  type EditorRefusal,
} from "./editorState"
import { TagPicker } from "./TagPicker"

/**
 * WS-HMI-2 Task 10 — the property panel: the surface where an engineer stops needing to know JSON.
 *
 * ── 🔴 THE §5 GATE, WHICH IS THE POINT OF THIS FILE ──────────────────────────────────────────────
 * Choosing `setpoint-input` or `command-button` for a widget that has no recognised `policyAction`
 * does NOT change the kind. The choice is HELD (`pendingKind`), the action picker is revealed with a
 * named sentence saying why, and only once an action is chosen does one edit go out carrying BOTH.
 * There is no ordering of clicks that produces a write widget with no gate, and there is no free-text
 * path to the field: the action control is a native `<select>` whose options come from
 * `POLICY_ACTION_VALUES`, i.e. from the very `Record<PolicyAction, true>` `editorState.ts`'s guards
 * enforce. A native select cannot accept typed text at all, which is why it is one instead of a
 * popup listbox — the property being claimed is about what the control CANNOT do.
 *
 * The panel is not the only thing standing there. `applyEdit` refuses the same edit independently
 * (`policy-action-required`), and `runtime-tests/editorState.test.mjs` measures that the document
 * such an edit would produce is one the frozen schema itself rejects. So a future panel bug cannot
 * write an ungated write widget through this vocabulary either.
 *
 * 🔴 FIX ROUND 1, task-10-review.md F1 — THE PARAGRAPH THAT STOOD HERE IS RETRACTED, KEPT VERBATIM:
 * *"SAVING IS TASK 12's. This file makes no claim about what reaches disk. The measurable claim today
 * is the one above: the panel cannot PRODUCE such a widget, and `applyEdit` refuses it if the panel
 * is bypassed."* The first sentence conflated "the EDITOR has no save button" with "the property is
 * unmeasurable", and the reviewer disproved it by measuring the write door directly:
 * `PUT /v1/screens/{id}` answers **400** — `widget 'b1': kind='command-button' nhưng thiếu
 * policyAction — §5 cấm đường ghi không gác` — for an ungated write widget and **200** for its gated
 * twin. `tests/39-editor-properties.spec.ts` now pins BOTH halves, so §5's outermost layer is joined
 * to the panel's.
 *
 * What IS still Task 12's is the editor's own save BUTTON and the version/conflict handling around it.
 * The layers this file is part of are, outermost first: the write door (400), `applyEdit`
 * (`policy-action-required`), `widgetRefusal` (`invalid-widget`), and the panel's hold.
 *
 * ── 🔴 S-6, AND WHAT REMAINS OPEN ────────────────────────────────────────────────────────────────
 * Two things here could be read as "this action is permitted", and both fail closed:
 *   * a `policyAction` already on the document that is NOT a member of the frozen vocabulary is never
 *     shown as the select's current value. The select shows its placeholder and a named warning
 *     quotes the offending value — the same posture `policyGate` took when it moved from a truthiness
 *     check to a membership check, applied at authoring time instead of at kiosk time;
 *   * `TagPicker` renders a tag's declared action only when it is a member, and says "declares".
 *
 * What this panel does NOT do is RESOLVE whether an action is permitted. It cannot: the engine's gate
 * speaks `machine.setpoint.write` / `machine.command.invoke` (`Policy/MachineWriteGate.cs`), a set
 * disjoint from the screen contract's with no translation layer in the tree, and the web tier cannot
 * see it. `editor.panel.policyNotResolved` says exactly that in the panel's own chrome. S-6 is
 * therefore NOT closed by this task, and the report says so rather than letting a picker that merely
 * chooses read as a picker that authorises.
 *
 * ── WHAT IS DELIBERATELY NOT EDITABLE, AND WHY EACH ONE IS SAID OUT LOUD ─────────────────────────
 *   * `id` — it is the ADDRESS every edit uses to name a widget. There is no `set-id` edit, and one
 *     would need a uniqueness guard plus a rule for what happens to the selection, the undo history
 *     and any `component` reference mid-rename. Shown read-only with that sentence, rather than as a
 *     field that silently does nothing. 🔴 CONTROLLER RULING, 2026-09-04 (task-10-review.md F4):
 *     this stays read-only HERE, and RENAME MOVES TO TASK 11 — renaming is naming, and naming belongs
 *     with the layer tree. It is a scope decision on the record, not an undisclosed limit.
 *   * `component` — no edit kind reaches it either. It is shown because `TagPicker`'s `{component}/…`
 *     section depends on it, so an engineer needs to see what it says.
 *   * a `props` entry that is nested, an array, a boolean, or whose key shares a widget field's name
 *     (`set-prop` refuses such a path by design — `out-of-scope-path`) or contains a `.` (which
 *     `set-prop` reads as a path separator). Shown read-only; a control that could only ever be
 *     refused is worse than a value you can read. 🔴 CONTROLLER RULING, 2026-09-04
 *     (task-10-review.md F4): nested and non-scalar props stay OUT OF THIS PLAN entirely. The panel
 *     saying so on screen is the honest treatment, and `editor.panel.propReadOnly` is that sentence.
 *
 * ── WHY EVERY FIELD COMMITS ON BLUR/ENTER RATHER THAN ON EVERY KEYSTROKE ─────────────────────────
 * `editorState.ts`'s undo stack is bounded at 100 whole documents. A text field that emitted an edit
 * per keystroke would spend that budget rewriting one binding path, and `Ctrl+Z` would then walk back
 * through it one character at a time. `CommitField` below therefore holds the typing locally and
 * emits once, and it is re-keyed on the committed value so an insertion made by the tag picker
 * replaces what is in the box.
 *
 * 🔴 FIX ROUND 1, task-10-review.md F2 — A COMMIT CAN NOW BE DECLINED, AND THE BOX SNAPS BACK. The
 * round-0 comment beside `commitRect` claimed an emptied box "keeps what it had until it says
 * something legal". It did not: `Number("") === 0` and `Number.isInteger(0)` is `true`, so clearing
 * the Column box and pressing Enter wrote `col: 0` — measured by the reviewer as a widget jumping
 * from `grid-column-start: 4` to `1`, with no refusal shown anywhere, and a `max: 500` prop silently
 * becoming `0`. `onCommit` therefore RETURNS whether it emitted an edit, and `CommitField` restores
 * the last committed value when it did not — which is what makes that sentence true on screen rather
 * than only in a comment.
 */

export type PropertyPanelProps = {
  /** The widget currently selected on the canvas, or `undefined` for none. */
  widget: ScreenWidget | undefined
  /** Applies an edit through the canvas's single `editorState` session. The panel never keeps a
   * document of its own — there is one history, and it is `editorState.ts`'s. */
  onEdit: (edit: EditorEdit) => void
  /** A refusal worth SHOWING. `EditorCanvas` filters its own `HARMLESS_REFUSALS` out before passing
   * one, so the set of codes that are ordinary rather than wrong stays in one place. */
  refusal: EditorRefusal | undefined
}

/** A text/number field that commits ONCE — on blur, or on Enter — instead of on every keystroke. See
 * the header for why. `Escape` abandons the edit, which is what a field with a delayed commit owes
 * the person typing in it. */
function CommitField({
  value,
  type,
  hook,
  label,
  onCommit,
}: {
  value: string
  type: "text" | "number"
  hook: Record<string, string>
  label: string
  /** Returns TRUE when it emitted an edit. FALSE means "I could not honestly write that" — the box
   * then snaps back to the last committed value rather than leaving a number on screen that the
   * document does not carry. See the header's F2 note. */
  onCommit: (raw: string) => boolean
}) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      {...hook}
      type={type}
      aria-label={label}
      className="h-7 w-full min-w-0 border border-border-strong bg-surface-muted px-1.5 text-sm"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!onCommit(draft)) setDraft(value)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          if (!onCommit(draft)) setDraft(value)
        } else if (event.key === "Escape") {
          event.preventDefault()
          setDraft(value)
        }
      }}
    />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-strong pt-2">
      <h3 className="hmi-micro text-text-strong">{title}</h3>
      <div className="mt-1 flex flex-col gap-1">{children}</div>
    </section>
  )
}

function isRecognisedAction(value: unknown): value is PolicyAction {
  return typeof value === "string" && POLICY_ACTION_VALUES.some((known) => known === value)
}

function requiresAction(kind: unknown): boolean {
  return typeof kind === "string" && POLICY_REQUIRED_WIDGET_KINDS.some((known) => known === kind)
}

const RECT_FIELDS: readonly { field: keyof WidgetRect; labelKey: string }[] = [
  { field: "col", labelKey: "editor.panel.rectCol" },
  { field: "row", labelKey: "editor.panel.rectRow" },
  { field: "colSpan", labelKey: "editor.panel.rectColSpan" },
  { field: "rowSpan", labelKey: "editor.panel.rectRowSpan" },
]

export function PropertyPanel({ widget, onEdit, refusal }: PropertyPanelProps) {
  const t = useT()
  // React's own "adjust state when a prop changes" pattern — the same one `EditorCanvas` uses for a
  // changed `screenId`, and for the same reason: a held kind, an open picker or a half-typed binding
  // name belongs to ONE widget and must not survive a click on another.
  const [forWidgetId, setForWidgetId] = useState<string | undefined>(widget?.id)
  const [pendingKind, setPendingKind] = useState<WidgetKind | undefined>(undefined)
  const [pickerFor, setPickerFor] = useState<string | undefined>(undefined)
  const [newBindingName, setNewBindingName] = useState("")
  /** The name "Add binding" was pressed with that already exists — see the F3 note at the button. */
  const [duplicateName, setDuplicateName] = useState<string | undefined>(undefined)
  // NOT reset with the selection: an engineer laying out a screen is working against one machine, and
  // re-choosing it for every widget would make the picker useless.
  const [machineCode, setMachineCode] = useState("")

  if (forWidgetId !== widget?.id) {
    setForWidgetId(widget?.id)
    setPendingKind(undefined)
    setPickerFor(undefined)
    setNewBindingName("")
    setDuplicateName(undefined)
  }

  if (!widget) {
    return (
      <aside data-property-panel className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border border-border-strong bg-surface-subtle p-2">
        <h2 className="font-heading text-sm font-semibold text-text-strong">{t("editor.panel.title")}</h2>
        <p data-panel-empty className="text-xs text-text-muted">
          {t("editor.panel.empty")}
        </p>
      </aside>
    )
  }

  const effectiveKind = pendingKind ?? widget.kind
  const storedAction = widget.policyAction
  const actionRecognised = isRecognisedAction(storedAction)
  const needsAction = requiresAction(effectiveKind)
  // True whenever something on screen would otherwise imply a gate exists when none does — either the
  // engineer just picked a write kind, or the document declares an action outside the vocabulary.
  const gateMissing = needsAction && !actionRecognised
  const bindings: Record<string, string> = widget.bindings ?? {}
  const props: Record<string, unknown> = widget.props ?? {}

  function chooseKind(next: string) {
    if (!widget) return
    if (requiresAction(next) && !actionRecognised) {
      // 🔴 §5 — HELD, not applied. The document is untouched until an action is chosen.
      setPendingKind(next as WidgetKind)
      return
    }
    setPendingKind(undefined)
    onEdit({ kind: "set-kind", widgetId: widget.id, widgetKind: next as WidgetKind })
  }

  function chooseAction(next: string) {
    if (!widget) return
    // 🔴 FIX ROUND 1, task-10-review.md F12 — A CAST IS NOT A CHECK. Round 0 did `next as PolicyAction`
    // after an emptiness test, and leaned on "a native select can only emit an option value" plus
    // `applyEdit`'s own enum check. Both are true and neither is this function's own guard; the panel's
    // fail-closed posture rested at that one line on somebody else. `isRecognisedAction` is the
    // membership helper this file already has, and it NARROWS, so there is no cast left to make.
    if (!isRecognisedAction(next)) return
    const action = next
    if (pendingKind !== undefined) {
      const held = pendingKind
      setPendingKind(undefined)
      // ONE edit carrying both, so no intermediate document ever exists in which the widget is a
      // write kind without a gate — not even for a render.
      onEdit({ kind: "set-kind", widgetId: widget.id, widgetKind: held, policyAction: action })
      return
    }
    onEdit({ kind: "set-policy-action", widgetId: widget.id, policyAction: action })
  }

  function commitRect(field: keyof WidgetRect, raw: string): boolean {
    if (!widget) return false
    // 🔴 FIX ROUND 1, task-10-review.md F2 — THE BLANK CHECK MUST COME FIRST, BECAUSE `Number("")` IS
    // `0` AND `Number.isInteger(0)` IS `true`. Without this line an emptied Column box committed
    // `col: 0` — a legal edit nobody asked for, with no refusal anywhere to show for it. `trim()`
    // rather than `length`, so a box holding only spaces is the same case.
    if (raw.trim().length === 0) return false
    const value = Number(raw)
    // Still refuses a half-typed box (`"1.5"`, `"-"`, `"1e"`) rather than sending an edit `applyEdit`
    // would refuse. Returning `false` snaps the field back to the last committed value.
    if (!Number.isInteger(value)) return false
    const base = widget.rect
    onEdit({
      kind: "move",
      widgetId: widget.id,
      rect: {
        col: field === "col" ? value : base.col,
        row: field === "row" ? value : base.row,
        colSpan: field === "colSpan" ? value : base.colSpan,
        rowSpan: field === "rowSpan" ? value : base.rowSpan,
      },
    })
    return true
  }

  function commitProp(key: string, raw: string, wasNumber: boolean): boolean {
    if (!widget) return false
    if (!wasNumber) {
      // A STRING prop may legitimately be emptied — `props.label = ""` is a real authored value the
      // schema accepts. Only the NUMBER branch has a blank to refuse.
      onEdit({ kind: "set-prop", widgetId: widget.id, path: key, value: raw })
      return true
    }
    // 🔴 FIX ROUND 1, task-10-review.md F2 — same defect as `commitRect`, measured on a `max: 500`
    // prop silently becoming `0`. A number prop whose box is emptied is not a zero; it is an
    // unfinished edit, and turning a scale limit into 0 is exactly the kind of silent write a design
    // surface must not make.
    if (raw.trim().length === 0) return false
    const value = Number(raw)
    if (!Number.isFinite(value)) return false
    onEdit({ kind: "set-prop", widgetId: widget.id, path: key, value })
    return true
  }

  return (
    <aside
      data-property-panel
      className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border border-border-strong bg-surface-subtle p-2"
    >
      <h2 className="font-heading text-sm font-semibold text-text-strong">{t("editor.panel.title")}</h2>

      {refusal ? (
        <p data-panel-refusal role="alert" className="border border-border-strong px-1.5 py-1 text-xs text-text-body">
          {t("editor.panel.refusal", { code: refusal.code, message: refusal.message })}
        </p>
      ) : null}

      <Section title={t("editor.panel.idLabel")}>
        <span data-panel-widget-id className="font-mono text-sm text-text-strong">
          {widget.id}
        </span>
        <span className="hmi-micro normal-case text-text-muted">{t("editor.panel.idReadOnly")}</span>
      </Section>

      <Section title={t("editor.panel.kindLabel")}>
        <select
          data-panel-kind
          aria-label={t("editor.panel.kindLabel")}
          className="h-7 w-full border border-border-strong bg-surface-muted px-1.5 text-sm"
          value={effectiveKind}
          onChange={(event) => chooseKind(event.target.value)}
        >
          {/* A `kind` the document carries that the frozen enum does not know (the write door accepts
              one — see `tests/37-editor-canvas.spec.ts` on `probe-kind`) would otherwise leave this
              select showing an unrelated option. It is listed, marked, and cannot be re-chosen. */}
          {WIDGET_KIND_VALUES.some((known) => known === widget.kind) ? null : (
            <option value={widget.kind} disabled data-panel-kind-unknown>
              {widget.kind}
            </option>
          )}
          {WIDGET_KIND_VALUES.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Section>

      {needsAction || storedAction !== undefined ? (
        <Section title={t("editor.panel.policyLabel")}>
          {storedAction !== undefined && !actionRecognised ? (
            // Fail-closed (S-6): the offending value is NAMED, and it is not the select's value.
            <p data-panel-policy-unrecognised role="alert" className="text-xs text-text-body">
              {t("editor.panel.policyUnrecognised", { value: JSON.stringify(storedAction) })}
            </p>
          ) : null}
          {gateMissing ? (
            <p data-panel-policy-required role="alert" className="text-xs text-text-body">
              {t("editor.panel.policyRequired", { kind: effectiveKind })}
            </p>
          ) : null}
          <select
            data-panel-policy-action
            aria-label={t("editor.panel.policyLabel")}
            aria-invalid={gateMissing}
            className="h-7 w-full border border-border-strong bg-surface-muted px-1.5 text-sm"
            value={actionRecognised && pendingKind === undefined ? storedAction : ""}
            onChange={(event) => chooseAction(event.target.value)}
          >
            {/* `disabled`, so there is no way back to "no action" through this control. */}
            <option value="" disabled>
              {t("editor.panel.policyChoose")}
            </option>
            {POLICY_ACTION_VALUES.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <span data-panel-policy-not-resolved className="hmi-micro normal-case text-text-muted">
            {t("editor.panel.policyNotResolved")}
          </span>
        </Section>
      ) : null}

      <Section title={t("editor.panel.rectLabel")}>
        <div className="grid grid-cols-2 gap-1">
          {RECT_FIELDS.map(({ field, labelKey }) => (
            <label key={field} className="flex items-center gap-1">
              <span className="hmi-micro w-12 shrink-0">{t(labelKey)}</span>
              <CommitField
                key={`${widget.id}:${field}:${String(widget.rect?.[field])}`}
                type="number"
                hook={{ "data-panel-rect": field }}
                label={t(labelKey)}
                value={String(widget.rect?.[field] ?? "")}
                onCommit={(raw) => commitRect(field, raw)}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title={t("editor.panel.componentLabel")}>
        <span data-panel-component className="font-mono text-sm text-text-strong">
          {widget.component ?? t("editor.panel.componentNone")}
        </span>
        <span className="hmi-micro normal-case text-text-muted">{t("editor.panel.componentReadOnly")}</span>
      </Section>

      <Section title={t("editor.panel.bindingsLabel")}>
        {Object.keys(bindings).length === 0 ? (
          <p data-panel-bindings-empty className="text-xs text-text-muted">
            {t("editor.panel.bindingsEmpty")}
          </p>
        ) : null}
        {Object.keys(bindings).map((name) => (
          <div key={name} data-panel-binding-row={name} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="hmi-micro w-16 shrink-0 truncate">{name}</span>
              <CommitField
                key={`${widget.id}:${name}:${bindings[name]}`}
                type="text"
                hook={{ "data-panel-binding-path": name }}
                label={name}
                value={String(bindings[name])}
                onCommit={(raw) => {
                  // Always emitted: `$defs/widget` constrains a binding's VALUE only by type, so `""`
                  // is a legal path an author may deliberately clear to. `applyEdit` refuses a
                  // re-write of the same value as a no-op, which is the right place for that rule.
                  onEdit({ kind: "set-binding", widgetId: widget.id, name, path: raw })
                  return true
                }}
              />
              <button
                type="button"
                data-panel-binding-pick={name}
                aria-label={t("editor.panel.bindingPick", { name })}
                className="shrink-0 border border-border-strong px-1.5 py-0.5 text-xs"
                onClick={() => setPickerFor((open) => (open === name ? undefined : name))}
              >
                …
              </button>
              <button
                type="button"
                data-panel-binding-remove={name}
                aria-label={t("editor.panel.bindingRemove", { name })}
                className="shrink-0 border border-border-strong px-1.5 py-0.5 text-xs"
                onClick={() => onEdit({ kind: "set-binding", widgetId: widget.id, name })}
              >
                ×
              </button>
            </div>
            {pickerFor === name ? (
              <TagPicker
                machineCode={machineCode}
                onMachineCodeChange={setMachineCode}
                componentId={widget.component}
                bindingName={name}
                onInsert={(path) => onEdit({ kind: "set-binding", widgetId: widget.id, name, path })}
                onClose={() => setPickerFor(undefined)}
              />
            ) : null}
          </div>
        ))}
        <div className="flex items-center gap-1">
          <input
            data-panel-binding-new-name
            aria-label={t("editor.panel.bindingNewNameLabel")}
            className="h-7 w-full min-w-0 border border-border-strong bg-surface-muted px-1.5 text-sm"
            value={newBindingName}
            onChange={(event) => setNewBindingName(event.target.value)}
          />
          <button
            type="button"
            data-panel-binding-add
            className="shrink-0 border border-border-strong px-1.5 py-0.5 text-xs"
            onClick={() => {
              const name = newBindingName
              // `trim()`, matching `applyEdit`'s own `bad-binding-name` rule — a button that builds an
              // edit the guard refuses is a control that can only ever fail.
              if (name.trim().length === 0) return
              // 🔴 FIX ROUND 1, task-10-review.md F3 — A BUTTON LABELLED "ADD" MUST NOT DELETE. Round 0
              // ran the `set-binding path: ""` line unconditionally, so typing the name of an EXISTING
              // binding and pressing Add wiped that binding's authored path to `""` with no warning
              // (measured: `bindings.value` "cycles" → ""). The ruling taken here is EDIT, NOT CREATE:
              // the existing row is opened for editing and its path is left exactly as authored, with
              // a named notice saying which of the two things just happened. Refusing outright was the
              // alternative; this one is the same click count and destroys nothing either way.
              if (Object.hasOwn(bindings, name)) {
                setDuplicateName(name)
                setNewBindingName("")
                setPickerFor(name)
                return
              }
              setDuplicateName(undefined)
              setNewBindingName("")
              setPickerFor(name)
              // Created EMPTY on purpose: the row has to exist before the picker can fill it in, and
              // `""` is a value `$defs/widget` accepts (`bindings` constrains the values' TYPE only).
              onEdit({ kind: "set-binding", widgetId: widget.id, name, path: "" })
            }}
          >
            {t("editor.panel.bindingAdd")}
          </button>
        </div>
        {duplicateName === undefined ? null : (
          <p data-panel-binding-duplicate role="status" className="text-xs text-text-body">
            {t("editor.panel.bindingDuplicate", { name: duplicateName })}
          </p>
        )}
      </Section>

      <Section title={t("editor.panel.propsLabel")}>
        {Object.keys(props).length === 0 ? (
          <p data-panel-props-empty className="text-xs text-text-muted">
            {t("editor.panel.propsEmpty")}
          </p>
        ) : null}
        {Object.entries(props).map(([key, value]) => {
          const isNumber = typeof value === "number" && Number.isFinite(value)
          const editable =
            !key.includes(".") && !WIDGET_FIELD_NAMES.includes(key) && (typeof value === "string" || isNumber)
          return (
            <label key={key} className="flex items-center gap-1">
              <span className="hmi-micro w-16 shrink-0 truncate">{key}</span>
              {editable ? (
                <CommitField
                  key={`${widget.id}:${key}:${String(value)}`}
                  type={isNumber ? "number" : "text"}
                  hook={{ "data-panel-prop": key }}
                  label={key}
                  value={String(value)}
                  onCommit={(raw) => commitProp(key, raw, isNumber)}
                />
              ) : (
                <span data-panel-prop-readonly={key} className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
                  {JSON.stringify(value)}
                </span>
              )}
            </label>
          )
        })}
        <span className="hmi-micro normal-case text-text-muted">{t("editor.panel.propReadOnly")}</span>
      </Section>
    </aside>
  )
}
