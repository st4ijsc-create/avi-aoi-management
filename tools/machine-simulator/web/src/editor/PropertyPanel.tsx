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
 * 🔴 SAVING IS TASK 12's. This file makes no claim about what reaches disk. The measurable claim
 * today is the one above: the panel cannot PRODUCE such a widget, and `applyEdit` refuses it if the
 * panel is bypassed.
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
 *     field that silently does nothing.
 *   * `component` — no edit kind reaches it either. It is shown because `TagPicker`'s `{component}/…`
 *     section depends on it, so an engineer needs to see what it says.
 *   * a `props` entry that is nested, an array, a boolean, or whose key shares a widget field's name
 *     (`set-prop` refuses such a path by design — `out-of-scope-path`) or contains a `.` (which
 *     `set-prop` reads as a path separator). Shown read-only; a control that could only ever be
 *     refused is worse than a value you can read.
 *
 * ── WHY EVERY FIELD COMMITS ON BLUR/ENTER RATHER THAN ON EVERY KEYSTROKE ─────────────────────────
 * `editorState.ts`'s undo stack is bounded at 100 whole documents. A text field that emitted an edit
 * per keystroke would spend that budget rewriting one binding path, and `Ctrl+Z` would then walk back
 * through it one character at a time. `CommitField` below therefore holds the typing locally and
 * emits once, and it is re-keyed on the committed value so an insertion made by the tag picker
 * replaces what is in the box.
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
  onCommit: (raw: string) => void
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
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          onCommit(draft)
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
  // NOT reset with the selection: an engineer laying out a screen is working against one machine, and
  // re-choosing it for every widget would make the picker useless.
  const [machineCode, setMachineCode] = useState("")

  if (forWidgetId !== widget?.id) {
    setForWidgetId(widget?.id)
    setPendingKind(undefined)
    setPickerFor(undefined)
    setNewBindingName("")
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
    if (!widget || next.length === 0) return
    const action = next as PolicyAction
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

  function commitRect(field: keyof WidgetRect, raw: string) {
    if (!widget) return
    const value = Number(raw)
    // Refuse to build an edit out of a half-typed or emptied box rather than sending one `applyEdit`
    // will refuse: the field simply keeps what it had until it says something legal.
    if (!Number.isInteger(value)) return
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
  }

  function commitProp(key: string, raw: string, wasNumber: boolean) {
    if (!widget) return
    if (!wasNumber) {
      onEdit({ kind: "set-prop", widgetId: widget.id, path: key, value: raw })
      return
    }
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    onEdit({ kind: "set-prop", widgetId: widget.id, path: key, value })
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
                onCommit={(raw) => onEdit({ kind: "set-binding", widgetId: widget.id, name, path: raw })}
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
              if (name.length === 0) return
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
