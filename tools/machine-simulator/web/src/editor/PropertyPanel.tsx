import { useState, type ReactNode } from "react"

import type { PolicyAction } from "@/contracts/tagNamespace"
import type { ScreenWidget, WidgetKind, WidgetRect } from "@/contracts/hmiScreen"
import { useT } from "@/i18n"
import { useMachineComponents } from "@/lib/api"
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
 *   * `id` — it is the ADDRESS every edit uses to name a widget. 🔴 CONTROLLER RULING, 2026-09-04
 *     (task-10-review.md F4): this stays read-only HERE, and RENAME MOVES TO TASK 11 — renaming is
 *     naming, and naming belongs with the layer tree. It is a scope decision on the record, not an
 *     undisclosed limit.
 *
 *     🔴 TASK 11 HAS LANDED, AND THE SENTENCE THAT STOOD HERE IS RETRACTED, KEPT VERBATIM:
 *     *"There is no `set-id` edit, and one would need a uniqueness guard plus a rule for what happens
 *     to the selection, the undo history and any `component` reference mid-rename."* There IS one now
 *     (`rename`), it carries exactly that uniqueness guard beside the frozen id pattern, and the two
 *     open questions were answered rather than inherited: the selection follows the widget
 *     (`EditorCanvas` re-points it), the undo history is the same single one every other edit pushes
 *     onto, and there is no `component` reference to fix because `component` names a node of the
 *     MACHINE's component model, never another widget. What is unchanged is where the control lives:
 *     the panel still shows `id` read-only and `editor.panel.idReadOnly` now says where to rename it,
 *     rather than presenting a second box for the same field.
 *   * `component` — no edit kind reaches it either. It is shown because `TagPicker`'s `{component}/…`
 *     section depends on it, so an engineer needs to see what it says.
 *
 *     🔴 RETRACTED, WS-HMI-2 TASK 13, KEPT VERBATIM ABOVE. There IS an edit kind now
 *     (`set-component`) and this panel renders its control. The retraction matters more than the
 *     feature: the sentence above described the state as a considered scope decision, and it was
 *     actually the hole through which the whole of §3.3 fell out of the product. `TagPicker`'s
 *     `{component}` section renders only for a widget that already declares a component, and nothing
 *     in this application could write that field — so indirect binding was authorable only by
 *     hand-editing JSON somewhere else, while every surface around it was pinned green. Task 13's
 *     acceptance criterion ("an engineer builds a screen without writing a line of code") is what
 *     found it, which is the argument for having an end-to-end acceptance pass at all.
 *
 *     What did NOT change: no id-resolution claim is made. The chooser lists what one MACHINE
 *     declares because a screen document names no machine; `set-component` deliberately does not
 *     check that an id resolves anywhere, and the renderer keeps naming an unresolved one per widget.
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
 * the person typing in it.
 *
 * 🔴 EXPORTED for WS-HMI-2 Task 11's `LayerTree`, whose rename box owes the engineer the same three
 * behaviours for the same reasons — one edit per committed name rather than per keystroke (the undo
 * stack is bounded at 100 whole documents), `Escape` abandons, and a REFUSED commit snaps the box
 * back rather than leaving a name on screen the document does not carry. Re-typing those thirty lines
 * beside the tree would be a second implementation of the F2 snap-back rule, which is the shape of
 * duplication this tree has been paying for all week. Callers re-key it on the committed value so an
 * accepted commit reloads the box. */
export function CommitField({
  value,
  type,
  hook,
  label,
  reset,
  onCommit,
}: {
  value: string
  type: "text" | "number"
  hook: Record<string, string>
  label: string
  /**
   * 🔴 WS-HMI-2 TASK 11 FIX ROUND 1 (task-11-review.md LOW-5) — an OPTIONAL counter a caller bumps
   * when it wants the box reloaded from `value` WITHOUT remounting it.
   *
   * It exists because there are two ways a committed value can fail to reach the document and only
   * one of them is `onCommit` returning false. A commit that was EMITTED and then refused downstream
   * (the layer tree's rename, refused by `applyEdit` for a duplicate id or an illegal name) returns
   * true — it really did emit — yet the box must still show what the document says. The tree's first
   * fix for that re-keyed the field, which remounts it and therefore destroys the caret, so
   * correcting a refused name meant clicking back into the box. Bumping this instead keeps the same
   * DOM node: the value snaps back AND the focus survives.
   *
   * React's own "adjust state when a prop changes" pattern, during render, no effect — the same
   * device `EditorCanvas` uses for a changed `screenId` and `PropertyPanel` for a changed selection.
   * Callers that do not pass it are unaffected: `undefined !== undefined` is false, so the branch
   * never fires.
   */
  reset?: number
  /** Returns TRUE when it emitted an edit. FALSE means "I could not honestly write that" — the box
   * then snaps back to the last committed value rather than leaving a number on screen that the
   * document does not carry. See the header's F2 note. */
  onCommit: (raw: string) => boolean
}) {
  const [draft, setDraft] = useState(value)
  const [syncedTo, setSyncedTo] = useState(reset)
  if (reset !== syncedTo) {
    setSyncedTo(reset)
    setDraft(value)
  }
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
  // WS-HMI-2 Task 13 — the component model the `component` chooser lists. Mounted unconditionally
  // (hooks cannot sit behind the `!widget` return below) and gated on a NON-BLANK code the same way
  // `TagPicker`'s own call is, so no request is made until a machine is chosen. Same hook, same key,
  // same cache entry as the picker's — one fetch serves both surfaces.
  const components = useMachineComponents(machineCode.length > 0 ? machineCode : undefined)

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
  /**
   * WS-HMI-2 Task 13 — the component ids the CHOSEN MACHINE declares, for the chooser below.
   *
   * Read through the same `useMachineComponents` hook `TagPicker` already mounts for the same
   * `machineCode`, so the two share ONE TanStack cache entry and this adds no request. `?? []` rather
   * than a pending/error branch: "no model declared" and "not read yet" both mean the same thing to a
   * chooser — there is nothing to offer — and §5-bis says a machine that has declared nothing is a
   * valid product state, not a failure. The two states are told apart on screen by the note under the
   * select, not by hiding the control.
   */
  const declaredComponentIds: string[] = Array.isArray(components.data?.components)
    ? components.data.components.map((node) => node.id).filter((id): id is string => typeof id === "string")
    : []

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

      {/*
        WS-HMI-2 Task 13 — `component` STOPPED BEING READ-ONLY, and the sentence that used to sit here
        (`editor.panel.componentReadOnly`: "the component field has no edit of its own in this task")
        is deleted rather than softened, because the field now has one.

        🔴 WHY THIS WAS THE LAST GAP AND NOT A MISSING NICETY. `TagPicker`'s `{component}` section
        renders only for a widget that ALREADY declares a component, and nothing in the editor could
        write that field — so indirect binding, the mechanism design §3.3 calls the reason Ignition
        scales, was reachable only by hand-editing JSON outside this application. Task 13's acceptance
        pass is an engineer building a two-instance screen without writing a line of code; this select
        is what makes that sentence true rather than aspirational.

        The list is the MACHINE's declared component model — the same `machineCode` the tag picker is
        pointed at, which is why the chooser only appears once one is chosen. That is not a step
        ordering imposed for its own sake: a screen document carries no machine (the frozen contract
        has no such field), so "which components exist" has no answer until somebody names a machine,
        and offering a free-text box instead would let a typo look exactly like a component that is
        simply not declared yet.
      */}
      <Section title={t("editor.panel.componentLabel")}>
        <span data-panel-component className="font-mono text-sm text-text-strong">
          {widget.component ?? t("editor.panel.componentNone")}
        </span>
        {machineCode.length === 0 ? (
          <span data-panel-component-no-machine className="hmi-micro normal-case text-text-muted">
            {t("editor.panel.componentNoMachine")}
          </span>
        ) : (
          <>
            <select
              data-panel-component-choose
              aria-label={t("editor.panel.componentLabel")}
              className="h-7 w-full border border-border-strong bg-surface-muted px-1.5 text-sm"
              value={widget.component ?? ""}
              onChange={(event) =>
                onEdit({
                  kind: "set-component",
                  widgetId: widget.id,
                  // `""` is the "(none)" option. `set-component` normalises a blank to REMOVAL, so
                  // this passes it through rather than deciding the same thing a second time here.
                  componentId: event.target.value === "" ? undefined : event.target.value,
                })
              }
            >
              <option value="">{t("editor.panel.componentNoneOption")}</option>
              {/* A component id the DOCUMENT carries that this machine's model does not declare —
                  a widget authored against a different machine, or a stale reference. Listed so the
                  select's value is the document's own, marked, and not re-choosable; the same idiom
                  the kind select above uses for a kind outside the frozen enum. It is NOT an error:
                  a screen document is not bound to a machine, so "not declared HERE" is an ordinary
                  state, and the renderer names it per widget at draw time. */}
              {widget.component !== undefined && !declaredComponentIds.includes(widget.component) ? (
                <option value={widget.component} disabled data-panel-component-unknown>
                  {widget.component}
                </option>
              ) : null}
              {declaredComponentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {components.data === undefined ? (
              <span data-panel-component-nomodel className="hmi-micro normal-case text-text-muted">
                {t("editor.panel.componentNoModel", { machine: machineCode })}
              </span>
            ) : (
              <span className="hmi-micro normal-case text-text-muted">
                {t("editor.panel.componentHint", { machine: machineCode })}
              </span>
            )}
          </>
        )}
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
