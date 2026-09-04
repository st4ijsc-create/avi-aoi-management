/**
 * WS-HMI-2 Task 7 — the visual editor's DOCUMENT STATE and UNDO/REDO, as pure functions.
 *
 * Plain `.ts`, NO JSX, NO React, NO DOM — the same reason `hmi-runtime/bindings.ts` and
 * `hmi-runtime/widgets/shared.ts` are plain: it lets `web/runtime-tests/editorState.test.mjs`
 * `import()` and EXECUTE this file directly under `node --test`, so its pins measure real behaviour
 * rather than matching source text. Nothing here reads or writes anything outside its arguments;
 * every exported function returns a NEW `EditorState` and never mutates the one it was given.
 *
 * ── WHAT THIS MODULE PROMISES ABOUT THE FROZEN SCHEMA ────────────────────────────────────────────
 *
 * `applyEdit` never turns a document that is VALID against `contracts/hmi-screen.schema.json` into
 * one that is not. It does NOT promise to make an invalid document valid — `createEditorState` takes
 * whatever it is handed (the caller loaded it from disk or over HTTP, where validation already
 * happened; see `CanonicalScreenStore.cs` and `screens.test.mjs`). The promise is about PRESERVING
 * validity, and it is kept by REFUSING an edit whose result would break the contract, not by
 * repairing or clamping it. A refusal leaves `doc`, `past` and `future` exactly as they were — by
 * identity, not merely by value — and puts a coded, human-readable `EditorRefusal` in `lastRefusal`.
 * Never a silent no-op.
 *
 * The guards below are a hand-written mirror of `$defs/widget` and `$defs/rect`. This repository's
 * standing objection to a second copy of a rule (see `contracts/README.md`, `validate.mjs`'s header,
 * `policyGate`'s doc comment) is answered the same way it is answered for `web/src/contracts/*.ts`
 * itself: by an EXECUTING two-way pin, not by a promise. `editorState.test.mjs` runs a corpus of
 * candidate widgets and rects through BOTH this guard and Milestone 0's real `validate.mjs`, and
 * asserts the two answers agree member by member — so a guard that drifts loose (accepts what the
 * schema rejects) or tight (rejects what the schema accepts) reddens.
 *
 * 🔴 FIX ROUND 1, task-7-review.md §7.1 — THE CORPUS ALONE WAS NOT ENOUGH, AND THE REVIEWER PROVED IT
 * LIVE. Adding `"minLength": 1` to `$defs/widget.properties.component` — an additive, README-legal
 * schema change — left `npm run test:runtime` at 269/269 and the contract gate at 52/52, after which
 * `applyEdit` accepted `component: ""` and returned a document `validate.mjs` REJECTS. The promise
 * three paragraphs up was false, and nothing was red. A differential corpus can only catch a keyword
 * whose boundary some corpus member happens to straddle; a NEW keyword at an existing property has
 * no such member by definition.
 *
 * Closed by `SCHEMA_MIRROR.handledKeywords` below plus its test: the test WALKS `$defs/widget` and
 * `$defs/rect` in the schema file, collects every `(json-pointer, keyword)` pair it finds, and
 * asserts that set equals the set declared here. A keyword this mirror has no code for reddens
 * naming the keyword AND the path. Two sides of genuinely different origin — the schema file, walked;
 * this module, declared — so it is not a constant read from both ends.
 *
 * ── THREE PLACES THIS IS DELIBERATELY STRICTER THAN THE SCHEMA ────────────────────────────────────
 *
 * (1) WIDGET IDS MUST BE UNIQUE. The frozen schema does not say so — `widgets` is a plain array and
 *     two widgets may share an `id` and still validate. But four of this module's five edits ADDRESS
 *     a widget BY id (`move`, `set-prop`, `remove`, `reorder`), so a duplicate id makes those edits
 *     ambiguous and undo/redo unreproducible. `add` therefore refuses an id already on the document.
 *     This is an EDITOR invariant, stated here rather than smuggled in. 🔴 WS-HMI-2 Task 11 —
 *     `rename` is the second edit that can create a duplicate and it is held to the SAME rule, by the
 *     same code (`duplicate-id`), with the widget's own id excluded so renaming a widget to the name
 *     it already carries is an ordinary no-op rather than a collision with itself.
 *
 * (2) EVERY VALUE WRITTEN INTO `props` MUST BE JSON. The schema declares `props` as bare
 *     `{"type": "object"}`, so `validate.mjs` never even descends into it — `props.x = undefined`,
 *     a `Date`, a `Map`, a function, `NaN` all "validate". They do not SURVIVE: `JSON.stringify`
 *     silently drops `undefined` and functions, turns `NaN` into `null`, flattens a `Date` to a
 *     string and a `Map` to `{}`. The in-memory document and the file written back would then
 *     disagree, and an undo stack full of documents that no longer round-trip is worse than a
 *     refused edit.
 *
 * (4) A BINDING NAME MUST BE A NON-BLANK STRING (WS-HMI-2 Task 10). `$defs/widget`'s `bindings` is
 *     `{"type": "object", "additionalProperties": {"type": "string"}}` — it constrains the VALUES and
 *     says nothing about the KEYS, so `{"": "cycles"}` validates. It is still unreachable: every
 *     widget reads its bindings by a name it hardcodes (`bindings.value`, `bindings.series`, …), so
 *     an unnamed binding is a document the renderer can never consult, written by a picker whose
 *     "which field am I filling in?" answer was empty. Refused rather than stored.
 *
 *     🔴 FIX ROUND 1, task-10-review.md F6 — this said "NON-EMPTY" and checked `length === 0`, so
 *     `"   "` was ACCEPTED. Measured by the reviewer: a binding named with three spaces produced a
 *     row. The argument above applies identically to it — no widget hardcodes `bindings["   "]` — so
 *     the rule now reads NON-BLANK and the check is `trim().length === 0`. This module is already
 *     whitespace-aware where it matters most (a whitespace-only `policyAction` is refused, and its
 *     corpus member names the .NET MEDIUM-1 defect class that came from exactly this distinction);
 *     the asymmetry was with this module's own stated rule, not with the schema.
 *     `editorState.test.mjs` measures BOTH sides of this, as it does for (1) and (2): that the
 *     schema really does accept the empty key, and that this module really does not.
 *
 * (3) A `set-prop` PATH WHOSE FIRST SEGMENT NAMES A WIDGET FIELD IS REFUSED — fix round 1,
 *     task-7-review.md §7.5. `path` is rooted at `props` (see the type below), but the natural
 *     assumption is that it is rooted at the WIDGET, because four of the five edits address the
 *     widget. Before this fix, `path: "kind"` was ACCEPTED and quietly wrote `props.kind` — leaving
 *     `widget.kind` untouched, consuming an undo step, and doing nothing the caller intended. That
 *     is schema-valid and therefore invisible to every pin in this file. The boundary is now
 *     enforced, not merely documented, and `editorState.test.mjs` pins it by example.
 *
 * ── WHAT THIS MODULE DOES NOT DO ──────────────────────────────────────────────────────────────────
 *
 * It does NOT check that a widget's `rect` fits inside `doc.layout`. That is not a schema constraint
 * (`$defs/rect` has minimums and no maximums; only `layout.cols`/`layout.rows` are bounded, at 1..48)
 * and it is already handled at render time by `hmi-runtime/gridLayout.ts`'s `clampRectToLayout`,
 * which clamps AND warns. Refusing it here would put a third, differently-shaped rule in a third
 * place. An editor that wants to stop the user dragging a tile off the grid should call
 * `clampRectToLayout` before building the `move` edit; this module's job is the contract, not the
 * viewport.
 *
 * 🔴 WS-HMI-2 TASK 10 — THE PARAGRAPH BELOW IS RETRACTED IN PART, KEPT VERBATIM SO THE REASONING IS
 * READABLE RATHER THAN REWRITTEN AWAY:
 *
 *     "It does not edit `kind`, `bindings`, `component`, `policyAction`, `layout`, `theme`, `title`
 *      or `screenId` — this task's `EditorEdit` union has no edit for them."
 *
 * Three of those names moved: `kind`, `policyAction` and `bindings` are edited now, by
 * `set-kind`, `set-policy-action` and `set-binding`. Task 7's own report named the condition for
 * widening the reach and it is met in the same commit that widens it — each new edit builds the
 * WIDGET IT WOULD PRODUCE and puts it through `widgetRefusal`, i.e. through the SAME hand-written
 * mirror `add` already used, adding no second copy of any schema rule; and
 * `editorState.test.mjs` gained a differential corpus per new edit that re-derives the resulting
 * document independently and compares `applyEdit`'s answer against the real `validate.mjs`'s.
 *
 * `component`, `layout`, `theme`, `title` and `screenId` are still not editable here, and that is
 * still a closed reach rather than a half-open one.
 *
 * WHAT DID NOT CHANGE: every edit still writes only inside `doc.widgets`, which is why
 * `SCHEMA_MIRROR.handledKeywords` needs to cover only `$defs/widget` and `$defs/rect`;
 * `editorState.test.mjs` MEASURES that scope (every other top-level field of the document comes back
 * reference-identical) rather than assuming it, over the new edits too.
 */
import type { HmiScreenDocument, ScreenWidget, WidgetKind, WidgetRect } from "../contracts/hmiScreen.ts"
import type { PolicyAction } from "../contracts/tagNamespace.ts"

/**
 * How many undo steps are kept. Older steps fall off the BOTTOM of the stack — an editor session
 * that runs all day must not grow an unbounded array of whole documents.
 *
 * 🔴 `editorState.test.mjs` pins this bound by writing `100` OUT AS A LITERAL rather than importing
 * this constant. A test that reads the limit from here to decide how many edits to push passes at
 * ANY limit and therefore pins nothing — the one-directional-pin defect this tree has now been
 * caught by six times. The duplication over there is deliberate and is labelled as such.
 */
export const UNDO_DEPTH_LIMIT = 100

/** The edits the visual editor can make. Each is data — serialisable, replayable, and carrying no
 * reference to any React component or DOM node.
 *
 * 🔴 This said "the five edits" through Task 10, which added three, and Task 11, which added a
 * ninth. The count is deleted rather than re-typed for a fourth time: a number written here is a
 * second place to keep in step with the union below it, and `EDITOR_REFUSAL_CODES`'s census plus
 * `editorState.test.mjs`'s `ACCEPTED_EDITS` are where the membership is actually held to account. */
export type EditorEdit =
  | { kind: "move"; widgetId: string; rect: WidgetRect }
  /** `path` is dotted and rooted at the widget's `props` — `"label"`, `"thresholds.warn"`. It is
   * NOT rooted at the widget: `props` is the only sub-tree `contracts/hmi-screen.schema.json`
   * leaves unconstrained (`{"type": "object"}`), so a write confined to it cannot invalidate the
   * document by construction, and this module needs no second copy of the schema's rules to allow
   * it. Reaching `kind`/`bindings`/`policyAction` needs its own edit kind with its own guards —
   * 🔴 WS-HMI-2 Task 10 DEFINES THEM (the three members below), so the sentence that used to end
   * "this task's brief defines none, so the reach is closed" is retracted for those three names. The
   * boundary itself is unchanged and still enforced: a `set-prop` path whose first segment names one
   * of those fields is REFUSED (`out-of-scope-path`) rather than absorbed into `props` under the
   * same name, because `set-prop` is still rooted at `props` and a caller that meant the widget
   * field now has a named edit to reach for. */
  | { kind: "set-prop"; widgetId: string; path: string; value: unknown }
  | { kind: "add"; widget: ScreenWidget }
  | { kind: "remove"; widgetId: string }
  | { kind: "reorder"; widgetId: string; toIndex: number }
  /**
   * WS-HMI-2 Task 10 — the property panel's kind picker, and the §5 gate that comes with it.
   *
   * `policyAction` is OPTIONAL on the edit and that is the whole design: omitted means "leave
   * whatever the widget already declares alone", which is what changing a `readout` to a `gauge`
   * wants. It is NOT a way to skip the gate. Setting `widgetKind` to one of the two WRITE kinds
   * while the resulting widget would carry no `policyAction` is refused with its own code
   * (`policy-action-required`) — the panel branches on that code to demand an action rather than
   * to apologise — and the frozen schema's own `allOf`/`if`/`then` refuses the same document, which
   * `editorState.test.mjs` measures rather than assumes.
   *
   * The action, when given, comes from `PolicyAction` — the frozen two-member enum. There is no
   * free-text path to this field anywhere in the editor.
   */
  | { kind: "set-kind"; widgetId: string; widgetKind: WidgetKind; policyAction?: PolicyAction }
  /** Changes ONLY the write gate, leaving `kind` alone — the panel's action picker on a widget that
   * is already a write kind. There is no member for REMOVING a `policyAction`: the schema permits a
   * gate on a non-write kind (harmless), and removing one from a write kind is precisely the
   * document §5 forbids, so the edit that would do it is simply not in the vocabulary. */
  | { kind: "set-policy-action"; widgetId: string; policyAction: PolicyAction }
  /**
   * Writes one entry of `widget.bindings` — the tag picker's destination.
   *
   * `path` omitted (or `undefined`) REMOVES the named binding; any other value must survive
   * `$defs/widget`'s `bindings` rule (a name→string map), which is checked by running the widget
   * this edit would produce through `widgetRefusal` rather than by restating the rule here.
   *
   * `name` must be a non-empty string. That is STRICTER than the frozen schema, which puts no
   * constraint on a binding KEY at all and would happily store `{"": "cycles"}` — see strictness
   * note (4) in the header, and the two-sided measurement in `editorState.test.mjs`.
   */
  | { kind: "set-binding"; widgetId: string; name: string; path?: string }
  /**
   * WS-HMI-2 Task 11 — the layer tree's rename, and the ONE edit that changes a widget's ADDRESS.
   *
   * 🔴 CONTROLLER RULING, 2026-09-04 (task-10-review.md F4): renaming is naming, and naming belongs
   * with the layer tree, so it arrives here with Task 11 rather than with Task 10's property panel.
   * `PropertyPanel` keeps `id` read-only and says on screen where the rename lives
   * (`editor.panel.idReadOnly`), so the field is not a control that silently does nothing.
   *
   * TWO guards, and NEITHER is a new copy of a rule:
   *
   *   * the frozen schema's `$defs/widget.properties.id.pattern` — reached by building the widget
   *     this edit WOULD produce and handing it to `widgetRefusal`, exactly as Task 10's three edits
   *     do. `WIDGET_ID_PATTERN` is declared once, in this file, and `SCHEMA_MIRROR.handledKeywords`'s
   *     inventory pin keeps it answerable to the schema file itself.
   *   * UNIQUENESS — strictness note (1) in the header, and the same rule `add` enforces, for the
   *     same reason: four edits address a widget BY id. Refused with `add`'s own `duplicate-id` code
   *     so a consumer switches on ONE code for "that name is taken" regardless of which edit asked.
   *     The widget's OWN id is not a duplicate of itself, so renaming a widget to the name it
   *     already has falls through to `applyEdit`'s ordinary no-op rule rather than to this one.
   *
   * The widget keeps its POSITION in `doc.widgets`: a rename is not a reorder, and draw order must
   * not change because someone corrected a spelling.
   *
   * What a rename does NOT rewrite is any reference to the old name, because the frozen contract has
   * none: `component` names a node of the MACHINE's component model (`$defs/widget.properties
   * .component`), not another widget, and nothing else in an `HmiScreenDocument` carries a widget id.
   * The only thing that does hold one is the EDITOR's own selection, which lives in `EditorCanvas`
   * and is re-pointed there — a UI concern, deliberately not smuggled into this module's data.
   */
  | { kind: "rename"; widgetId: string; newId: string }

/**
 * Why a call left the document unchanged, as something a caller can SWITCH ON.
 *
 * 🔴 FIX ROUND 1, task-7-review.md §7.2. Before this, `lastRefusal` was a bare sentence and both
 * refusal kinds returned identical `doc`/`past`/`future` references — so the Task 8 drag layer had
 * no way to tell a refused no-op (swallow it: the drag ended where it started) from a refused
 * invalid rect (show it: the operator dragged somewhere impossible) except by string-matching prose.
 * `policyGate`'s bare `reason` is the tree's precedent, but its consumer only DISPLAYS the reason;
 * this one must BRANCH on it.
 */
export type EditorRefusalCode =
  /** The edit was well-formed and legal but would not change the document. */
  | "no-op"
  /** `edit` was not an object with a `kind` — a caller-side bug, refused rather than thrown. */
  | "malformed-edit"
  /** `edit.kind` is not a member of `EditorEdit`. */
  | "unknown-edit-kind"
  /** `state.doc` has no `widgets` array — refused rather than thrown. */
  | "malformed-document"
  /** No widget on the document carries the `widgetId` the edit named. */
  | "unknown-widget"
  /** The `rect` a `move` carries does not satisfy `$defs/rect`. */
  | "invalid-rect"
  /** The `widget` an `add` carries does not satisfy `$defs/widget`. */
  | "invalid-widget"
  /** `add` or `rename` named an `id` already on the document — stricter than the schema, on purpose.
   * One code for both, because "that name is taken" needs the same answer from a UI whichever edit
   * asked; the message names the edit. */
  | "duplicate-id"
  /** A `set-prop` `path` that is not a non-empty dotted string. */
  | "bad-path"
  /** A `set-prop` `path` whose first segment names a widget field — stricter than the schema. */
  | "out-of-scope-path"
  /** A `set-prop` path that would have to descend through an existing non-object, deleting it. */
  | "path-blocked"
  /** A `set-prop` `value` that would not survive `JSON.stringify` — stricter than the schema. */
  | "non-json-value"
  /** A `reorder` `toIndex` outside `[0, widgets.length - 1]`. */
  | "index-out-of-range"
  /**
   * 🔴 INVARIANT §5, reached from the panel — WS-HMI-2 Task 10. A `set-kind` naming one of the two
   * WRITE kinds while the widget would end up with no `policyAction`.
   *
   * Its OWN code rather than `invalid-widget`, because the two need different answers from the UI: a
   * malformed widget is a defect in the layer that built the edit, whereas this one is an ordinary
   * thing an engineer does — pick "command-button" from a list — that needs one more decision before
   * it can be accepted. A panel that could only string-match the prose would either say nothing or
   * say the wrong thing.
   */
  | "policy-action-required"
  /** A `set-binding` `name` that is not a non-empty string — stricter than the schema, on purpose;
   * see header strictness note (4). */
  | "bad-binding-name"
  /** `undo` with an empty undo stack. */
  | "nothing-to-undo"
  /** `redo` with an empty redo stack. */
  | "nothing-to-redo"

export type EditorRefusal = {
  readonly code: EditorRefusalCode
  /** Always a non-empty sentence naming the offending value. Never a silently-blocked path with no
   * reason shown — `policyGate`'s rule, applied to editing. */
  readonly message: string
}

/**
 * Every code the union above declares, as a runtime value. Exhaustive in BOTH directions at compile
 * time (`Record<EditorRefusalCode, true>`), and `editorState.test.mjs` asserts that every member is
 * REACHABLE — it produces all of them from real inputs and compares the observed set with this one.
 * A code declared but unproducible, or produced but undeclared, reddens. Same census idiom as
 * `widgetRegistry.test.mjs`'s "every registered kind is drawn at least once".
 */
export const EDITOR_REFUSAL_CODES: Record<EditorRefusalCode, true> = {
  "no-op": true,
  "malformed-edit": true,
  "unknown-edit-kind": true,
  "malformed-document": true,
  "unknown-widget": true,
  "invalid-rect": true,
  "invalid-widget": true,
  "duplicate-id": true,
  "bad-path": true,
  "out-of-scope-path": true,
  "path-blocked": true,
  "non-json-value": true,
  "index-out-of-range": true,
  "policy-action-required": true,
  "bad-binding-name": true,
  "nothing-to-undo": true,
  "nothing-to-redo": true,
}

export type EditorState = {
  /** The document as it stands. Never the same object the caller passed to `createEditorState`. */
  readonly doc: HmiScreenDocument
  /** Undo stack, OLDEST first. At most `UNDO_DEPTH_LIMIT` entries; `undo` pops the last. */
  readonly past: readonly HmiScreenDocument[]
  /** Redo stack, OLDEST-undone first. Emptied by any accepted `applyEdit`. */
  readonly future: readonly HmiScreenDocument[]
  /**
   * Why the most recent call left the document unchanged. `undefined` after any call that DID change
   * it. Callers that want to know whether undo/redo is AVAILABLE should read `past.length` /
   * `future.length` — this field is about the call that just happened.
   */
  readonly lastRefusal: EditorRefusal | undefined
}

// ── vocabularies, reached through the frozen types rather than retyped ────────────────────────────

/** Exhaustive in BOTH directions at compile time: a kind added to `WidgetKind` and not here is a
 * missing-property error, a name here that the union lacks is an excess-property error. Same device,
 * same reason, as `widgets/shared.ts`'s `POLICY_ACTIONS`. */
const WIDGET_KINDS: Record<WidgetKind, true> = {
  readout: true,
  "status-lamp": true,
  gauge: true,
  trend: true,
  "alarm-banner": true,
  "alarm-list": true,
  log: true,
  faceplate: true,
  label: true,
  sheet: true,
  "kpi-tile": true,
  "state-badge": true,
  "setpoint-input": true,
  "command-button": true,
  "line-state": true,
}

const POLICY_ACTIONS: Record<PolicyAction, true> = {
  "machine.setpoint": true,
  "machine.command": true,
}

/** The two kinds `$defs/widget`'s `allOf`/`if`/`then` makes `policyAction` REQUIRED for — invariant
 * §5, "no write path without a gate". `Extract<...>` makes tsc reject a name that is not a real
 * `WidgetKind`, so a typo here cannot quietly stop requiring the gate. */
const POLICY_REQUIRED_KINDS: Record<Extract<WidgetKind, "setpoint-input" | "command-button">, true> = {
  "setpoint-input": true,
  "command-button": true,
}

/**
 * The §5 rule itself — "`kind` is one of the write kinds" — as ONE predicate with two callers.
 *
 * `widgetRefusal` uses it to mirror `$defs/widget`'s `allOf`/`if`/`then` for `add`; `set-kind`
 * (WS-HMI-2 Task 10) uses it to refuse with its own code BEFORE the general mirror runs, so the
 * property panel can branch on "you must choose an action" rather than on a sentence. Two refusal
 * codes, one rule, one place — this repository's standing objection is to a second COPY of a rule,
 * and there is none: change `POLICY_REQUIRED_KINDS` and both callers change with it.
 */
function requiresPolicyAction(kind: unknown): boolean {
  return typeof kind === "string" && Object.hasOwn(POLICY_REQUIRED_KINDS, kind)
}

/** `additionalProperties: false` on `$defs/widget`, reached through `keyof ScreenWidget` so a field
 * added to the frozen type must be acknowledged here before it can be edited. Also the set of
 * first-path-segment names a `set-prop` REFUSES — see strictness note (3) in the header. */
const WIDGET_KEYS: Record<keyof ScreenWidget, true> = {
  id: true,
  kind: true,
  rect: true,
  component: true,
  bindings: true,
  props: true,
  policyAction: true,
}

const WIDGET_REQUIRED_KEYS: readonly (keyof ScreenWidget)[] = ["id", "kind", "rect"]

/** `$defs/rect`'s four `minimum`s, and — via its key set — `additionalProperties: false` over the
 * same four names. */
const RECT_MINIMUM: Record<keyof WidgetRect, number> = { col: 0, row: 0, colSpan: 1, rowSpan: 1 }

/** `$defs/widget.properties.id.pattern`. JavaScript's `$` (no `m` flag) anchors at end of INPUT, so
 * `"probe-a\n"` does not match — unlike .NET, where `ContractInvariants.cs` needs `\z` for exactly
 * this case. Nothing to work around on this side; noted so the difference is not read as an
 * oversight. */
const WIDGET_ID_PATTERN = /^[a-z0-9-]+$/

/**
 * ── THE PROPERTY PANEL'S VOCABULARIES (WS-HMI-2 Task 10) ─────────────────────────────────────────
 *
 * The three lists a picker has to render, reached through `Object.keys` of the very records the
 * guards above enforce — NOT retyped beside the JSX. The consequence is the one that matters and it
 * is structural rather than promised: a panel built from these cannot offer a value `applyEdit` would
 * refuse, and cannot fail to offer one it would accept, because there is only one list.
 *
 * `SCHEMA_MIRROR` below exposes the same key sets and is NOT what the panel reads — that object says
 * of itself that nothing in the product reads it, and it stays true. These three are declared for the
 * product, and `tests/39-editor-properties.spec.ts` compares what the panel actually RENDERS against
 * the frozen schema file read from disk, so neither this module nor the panel is the only witness.
 */
export const WIDGET_KIND_VALUES: readonly WidgetKind[] = Object.keys(WIDGET_KINDS) as WidgetKind[]

/** Every field name `$defs/widget`'s `additionalProperties: false` allows. The panel reads it for one
 * narrow job: a `props` KEY that happens to share one of these names has no editable control, because
 * `set-prop` refuses such a path (`out-of-scope-path`, header strictness note (3)) and a control that
 * can only ever be refused is worse than a value shown read-only. */
export const WIDGET_FIELD_NAMES: readonly string[] = Object.keys(WIDGET_KEYS)

/** The frozen two-member `policyAction` enum, in schema order. There is no free-text path to this
 * field anywhere in the editor: the panel renders exactly these as the options of a native
 * `<select>`, and `applyEdit` refuses anything outside them regardless of what a caller sends. */
export const POLICY_ACTION_VALUES: readonly PolicyAction[] = Object.keys(POLICY_ACTIONS) as PolicyAction[]

/** The two kinds `$defs/widget`'s `allOf`/`if`/`then` makes `policyAction` REQUIRED for. The panel
 * reads this to decide when to DEMAND an action before it will commit a kind change; `applyEdit`
 * reads the same record to refuse the commit if the panel ever got it wrong. */
export const POLICY_REQUIRED_WIDGET_KINDS: readonly WidgetKind[] = Object.keys(POLICY_REQUIRED_KINDS) as WidgetKind[]

/**
 * 🔴 FIX ROUND 1, task-7-review.md §7.1 — the parity declaration that closes the mirror's residual
 * hole, plus the literal values the mirror enforces.
 *
 * `handledKeywords` names EVERY `(json-pointer, keyword)` pair inside `$defs/widget` and
 * `$defs/rect` that the guards below have code for. `editorState.test.mjs` WALKS those two
 * definitions in `contracts/hmi-screen.schema.json` and asserts the walk's result equals this list —
 * so a schema keyword this file cannot enforce reddens by NAME and by PATH, and a line here with no
 * corresponding schema keyword reddens too. Not a count: a count would pass a `minLength` that moved
 * from `id` to `component`, which is the defect Task 6's floor was just fixed for.
 *
 * The other fields let the same test compare the mirror's LITERALS against the schema's, which the
 * differential corpus already covers but which is nearly free once the walk exists.
 *
 * Exported ONLY for that test. Nothing in the product reads it.
 */
export const SCHEMA_MIRROR = {
  widgetProperties: Object.keys(WIDGET_KEYS),
  widgetRequired: [...WIDGET_REQUIRED_KEYS],
  widgetIdPattern: WIDGET_ID_PATTERN.source,
  widgetKinds: Object.keys(WIDGET_KINDS),
  policyActions: Object.keys(POLICY_ACTIONS),
  policyRequiredKinds: Object.keys(POLICY_REQUIRED_KINDS),
  rectProperties: Object.keys(RECT_MINIMUM),
  rectMinimum: { ...RECT_MINIMUM },
  handledKeywords: [
    // $defs/rect — enforced by `rectRefusal`
    "#/$defs/rect::type", //                            isPlainObject
    "#/$defs/rect::required", //                        the `!Object.hasOwn(rect, key)` loop
    "#/$defs/rect::properties", //                      the RECT_MINIMUM key set
    "#/$defs/rect::additionalProperties", //            the unknown-field loop (false ⇒ reject)
    "#/$defs/rect/properties/col::type", //             Number.isInteger
    "#/$defs/rect/properties/col::minimum", //          RECT_MINIMUM.col
    "#/$defs/rect/properties/row::type",
    "#/$defs/rect/properties/row::minimum",
    "#/$defs/rect/properties/colSpan::type",
    "#/$defs/rect/properties/colSpan::minimum",
    "#/$defs/rect/properties/rowSpan::type",
    "#/$defs/rect/properties/rowSpan::minimum",
    // $defs/widget — enforced by `widgetRefusal`
    "#/$defs/widget::type", //                          isPlainObject
    "#/$defs/widget::required", //                      WIDGET_REQUIRED_KEYS
    "#/$defs/widget::properties", //                    WIDGET_KEYS
    "#/$defs/widget::additionalProperties", //          the unknown-field loop (false ⇒ reject)
    "#/$defs/widget::allOf", //                         the POLICY_REQUIRED_KINDS branch
    "#/$defs/widget/properties/id::type", //            typeof id !== "string"
    "#/$defs/widget/properties/id::pattern", //         WIDGET_ID_PATTERN
    "#/$defs/widget/properties/kind::enum", //          WIDGET_KINDS
    "#/$defs/widget/properties/rect::$ref", //          the call to rectRefusal
    "#/$defs/widget/properties/component::type", //     typeof component !== "string"
    "#/$defs/widget/properties/bindings::type", //      isPlainObject
    "#/$defs/widget/properties/bindings::additionalProperties",
    "#/$defs/widget/properties/bindings/additionalProperties::type", // every value must be a string
    "#/$defs/widget/properties/props::type", //         isPlainObject
    "#/$defs/widget/properties/policyAction::enum", //  POLICY_ACTIONS
    "#/$defs/widget/allOf/0::if", //                    POLICY_REQUIRED_KINDS is the `if`
    "#/$defs/widget/allOf/0::then", //                  ... and the refusal below is the `then`
    "#/$defs/widget/allOf/0/if::properties",
    "#/$defs/widget/allOf/0/if::required",
    "#/$defs/widget/allOf/0/if/properties/kind::enum", // POLICY_REQUIRED_KINDS's key set
    "#/$defs/widget/allOf/0/then::properties",
    "#/$defs/widget/allOf/0/then::required", //         policyAction must be present
    "#/$defs/widget/allOf/0/then/properties/policyAction::type",
  ],
} as const

// ── small shared predicates ───────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** `JSON.stringify` returns `undefined` (not a string) for `undefined`, functions and symbols, which
 * would splice the word "undefined" into a message without saying WHAT was there. Falls back to the
 * typeof name for those. */
function describe(value: unknown): string {
  return JSON.stringify(value) ?? typeof value
}

/**
 * Deep VALUE equality over two JSON trees — object key ORDER is irrelevant, array order is not.
 *
 * 🔴 FIX ROUND 1, task-7-review.md §7.4. `applyEdit`'s no-op check used to be
 * `JSON.stringify(a) === JSON.stringify(b)`, which is byte-level and therefore key-order sensitive:
 * a `move` carrying `{rowSpan, colSpan, row, col}` with the SAME VALUES as the stored rect changed
 * the bytes, passed the check, and spent one step of the bounded 100-step history on an undo that
 * does nothing when taken — precisely what the no-op rule exists to prevent. Values are what
 * "changed" means to the operator; the bytes are an implementation detail of how the file is
 * written. (`move` now also builds the rect in canonical key order, so an ACCEPTED move never churns
 * the saved document's key order either.)
 *
 * Safe without a cycle guard: both sides are JSON trees by construction — the document came through
 * `structuredClone` of parsed JSON, and every value written into it passed `jsonRefusal`.
 */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => sameJsonValue(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
}

/** Names the first value in `value`'s tree that would not survive `JSON.stringify` — see the header's
 * point (2). Returns `undefined` when the whole tree is JSON. Also catches cycles, which would make
 * `JSON.stringify` throw rather than lie. */
function jsonRefusal(value: unknown, where: string, seen: readonly object[] = []): string | undefined {
  if (value === null) return undefined
  const type = typeof value
  if (type === "string" || type === "boolean") return undefined
  if (type === "number") {
    return Number.isFinite(value)
      ? undefined
      : `${where}: ${String(value)} is not a JSON value — JSON.stringify writes it as null, so the ` +
          `saved document would not say what this one says`
  }
  if (type !== "object") {
    return `${where}: a ${type} is not a JSON value — JSON.stringify drops it silently, so the saved ` +
      `document would not say what this one says`
  }
  if (seen.includes(value as object)) return `${where}: cyclic structure — JSON.stringify would throw`
  const nextSeen = [...seen, value as object]
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const refusal = jsonRefusal(value[i], `${where}[${i}]`, nextSeen)
      if (refusal !== undefined) return refusal
    }
    return undefined
  }
  if (!isPlainObject(value)) {
    return `${where}: a non-plain object is not a JSON value — JSON.stringify flattens it (a Date to a ` +
      `string, a Map to {}), so the saved document would not say what this one says`
  }
  for (const [key, child] of Object.entries(value)) {
    const refusal = jsonRefusal(child, `${where}.${key}`, nextSeen)
    if (refusal !== undefined) return refusal
  }
  return undefined
}

/** Mirror of `$defs/rect`. Returns `undefined` when `rect` satisfies it. */
function rectRefusal(rect: unknown, where: string): string | undefined {
  if (!isPlainObject(rect)) return `${where}: must be an object, got ${describe(rect)}`
  for (const key of Object.keys(rect)) {
    if (!Object.hasOwn(RECT_MINIMUM, key)) {
      return `${where}: unknown field "${key}" — the frozen schema sets additionalProperties:false on ` +
        `$defs/rect, so only ${Object.keys(RECT_MINIMUM).join(", ")} may appear`
    }
  }
  for (const key of Object.keys(RECT_MINIMUM) as (keyof WidgetRect)[]) {
    if (!Object.hasOwn(rect, key)) return `${where}: missing required field "${key}"`
    const value = rect[key]
    if (!Number.isInteger(value)) return `${where}.${key}: must be an integer, got ${describe(value)}`
    if ((value as number) < RECT_MINIMUM[key]) {
      return `${where}.${key}: ${value} is below the frozen schema's minimum of ${RECT_MINIMUM[key]}`
    }
  }
  return undefined
}

/** Mirror of `$defs/widget`. Returns `undefined` when `widget` satisfies it (plus the JSON rule on
 * `props` — header point (2); id UNIQUENESS is not checked here because it is a property of the
 * DOCUMENT, not of the widget, and `add` checks it separately). */
function widgetRefusal(widget: unknown, where: string): string | undefined {
  if (!isPlainObject(widget)) return `${where}: must be an object, got ${describe(widget)}`

  for (const key of Object.keys(widget)) {
    if (!Object.hasOwn(WIDGET_KEYS, key)) {
      return `${where}: unknown field "${key}" — the frozen schema sets additionalProperties:false on ` +
        `$defs/widget, so only ${Object.keys(WIDGET_KEYS).join(", ")} may appear`
    }
  }
  for (const key of WIDGET_REQUIRED_KEYS) {
    if (!Object.hasOwn(widget, key)) return `${where}: missing required field "${key}"`
  }

  const id = widget.id
  if (typeof id !== "string" || !WIDGET_ID_PATTERN.test(id)) {
    return `${where}.id: ${describe(id)} does not match the frozen schema's pattern ` +
      `${WIDGET_ID_PATTERN.source} (lowercase letters, digits and hyphens, at least one)`
  }

  const kind = widget.kind
  if (typeof kind !== "string" || !Object.hasOwn(WIDGET_KINDS, kind)) {
    return `${where}.kind: ${describe(kind)} is not one of ${Object.keys(WIDGET_KINDS).join(", ")}`
  }

  const rect = rectRefusal(widget.rect, `${where}.rect`)
  if (rect !== undefined) return rect

  if (Object.hasOwn(widget, "component") && typeof widget.component !== "string") {
    return `${where}.component: must be a string, got ${describe(widget.component)}`
  }

  if (Object.hasOwn(widget, "bindings")) {
    const bindings = widget.bindings
    if (!isPlainObject(bindings)) return `${where}.bindings: must be an object, got ${describe(bindings)}`
    for (const [key, value] of Object.entries(bindings)) {
      if (typeof value !== "string") {
        return `${where}.bindings.${key}: must be a string — the frozen schema types bindings as a ` +
          `name-to-tag-path map, got ${describe(value)}`
      }
    }
  }

  if (Object.hasOwn(widget, "props")) {
    if (!isPlainObject(widget.props)) return `${where}.props: must be an object, got ${describe(widget.props)}`
    const props = jsonRefusal(widget.props, `${where}.props`)
    if (props !== undefined) return props
  }

  if (Object.hasOwn(widget, "policyAction")) {
    const action = widget.policyAction
    if (typeof action !== "string" || !Object.hasOwn(POLICY_ACTIONS, action)) {
      return `${where}.policyAction: ${describe(action)} is not one of ${Object.keys(POLICY_ACTIONS).join(" | ")}`
    }
  } else if (requiresPolicyAction(kind)) {
    // 🔴 TASK 10 REVIEW §1, RECORDED HERE BECAUSE THIS IS THE BRANCH IT IS ABOUT. §5 is enforced at
    // THREE layers — the property panel's hold, `set-kind`'s `policy-action-required`, and this
    // branch — and the reviewer measured each one individually pinned. But THIS one is pinned ONLY by
    // Task 7's `WIDGET_CORPUS` members "command-button/setpoint-input THIẾU policyAction (bất biến
    // §5)" in `editorState.test.mjs`, and by NOTHING in Task 10's three new corpora: `set-kind`'s own
    // branch fires first, and `set-policy-action`/`set-binding` never construct an ungated write
    // widget. Trim those two `add` members and this layer silently becomes the untested one.
    return `${where}: a "${kind}" widget must declare policyAction — invariant §5, enforced by the ` +
      `frozen schema's allOf/if/then: no write path without a gate`
  }

  return undefined
}

// ── the edits ─────────────────────────────────────────────────────────────────────────────────────

/** Either the document an edit produces, or the coded refusal explaining why it was not. Two shapes
 * rather than a nullable document, so neither a caller nor tsc can read one as the other. */
type EditResult = { readonly doc: HmiScreenDocument } | { readonly refusal: EditorRefusal }

function refusal(code: EditorRefusalCode, message: string): { readonly refusal: EditorRefusal } {
  return { refusal: { code, message } }
}

function indexOfWidget(doc: HmiScreenDocument, widgetId: unknown): number {
  return doc.widgets.findIndex((widget) => widget.id === widgetId)
}

function unknownWidget(editKind: string, widgetId: unknown): { readonly refusal: EditorRefusal } {
  return refusal(
    "unknown-widget",
    `${editKind}: no widget with id ${describe(widgetId)} on this document — refused rather than ` +
      `applied to nothing, which would push an undo step that undoes nothing`
  )
}

/** Rewrites `root` with `segments` set to `value`, copying every object on the path and mutating
 * none of them. Refuses rather than overwriting a non-object standing where the path needs to
 * descend: silently replacing `props.label = "Nhiệt độ"` with `props.label.warn = 30` would DELETE
 * the label, and an editor that deletes what the user did not ask it to delete is worse than one
 * that says no. */
function setDeep(
  root: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
  where: string
): { readonly value: Record<string, unknown> } | { readonly refusal: EditorRefusal } {
  const [head, ...rest] = segments
  if (rest.length === 0) return { value: { ...root, [head]: value } }

  const child = root[head]
  if (child !== undefined && !isPlainObject(child)) {
    return refusal(
      "path-blocked",
      `${where}.${head}: cannot descend — ${describe(child)} is already there and is not an object; ` +
        `setting through it would delete it`
    )
  }
  const inner = setDeep(isPlainObject(child) ? child : {}, rest, value, `${where}.${head}`)
  if ("refusal" in inner) return inner
  return { value: { ...root, [head]: inner.value } }
}

function nextDocument(doc: HmiScreenDocument, edit: EditorEdit): EditResult {
  switch (edit.kind) {
    case "move": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("move", edit.widgetId)
      const bad = rectRefusal(edit.rect, `move ${describe(edit.widgetId)}: rect`)
      if (bad !== undefined) return refusal("invalid-rect", bad)
      const widgets = doc.widgets.slice()
      // Built field by field, in the frozen contract's own declaration order, rather than spread
      // from the caller's object — fix round 1, task-7-review.md §7.4: an accepted move must not
      // churn the saved document's key order just because the caller happened to build the rect in a
      // different order. `rectRefusal` has already proved these four fields are integers in range
      // and that no fifth field exists.
      const { col, row, colSpan, rowSpan } = edit.rect
      widgets[index] = { ...widgets[index], rect: { col, row, colSpan, rowSpan } }
      return { doc: { ...doc, widgets } }
    }

    case "set-prop": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("set-prop", edit.widgetId)
      if (typeof edit.path !== "string" || edit.path.length === 0) {
        return refusal(
          "bad-path",
          `set-prop ${describe(edit.widgetId)}: path must be a non-empty dotted string rooted at ` +
            `props, got ${describe(edit.path)}`
        )
      }
      const segments = edit.path.split(".")
      if (segments.some((segment) => segment.length === 0)) {
        return refusal(
          "bad-path",
          `set-prop ${describe(edit.widgetId)}: path ${describe(edit.path)} has an empty segment — a ` +
            `leading, trailing or doubled "." names a property with no name`
        )
      }
      // Fix round 1, task-7-review.md §7.5 — header strictness note (3).
      if (Object.hasOwn(WIDGET_KEYS, segments[0])) {
        return refusal(
          "out-of-scope-path",
          `set-prop ${describe(edit.widgetId)}: path ${describe(edit.path)} starts with ` +
            `"${segments[0]}", which is a WIDGET field, but set-prop is rooted at the widget's props. ` +
            `Applying it would have written props.${segments[0]} and left widget.${segments[0]} ` +
            `untouched — a green edit that does nothing you asked for. Editing ` +
            `${Object.keys(WIDGET_KEYS).join("/")} needs its own edit kind with its own guards: ` +
            `kind and policyAction have set-kind/set-policy-action, bindings has set-binding, id has ` +
            `rename (WS-HMI-2 Task 11), rect has move, props IS this edit's own root, and component ` +
            `has none`
        )
      }
      const valueRefusal = jsonRefusal(
        edit.value,
        `set-prop ${describe(edit.widgetId)} ${describe(edit.path)}: value`
      )
      if (valueRefusal !== undefined) return refusal("non-json-value", valueRefusal)

      const widget = doc.widgets[index]
      const written = setDeep(
        widget.props ?? {},
        segments,
        structuredClone(edit.value),
        `set-prop ${describe(edit.widgetId)}: props`
      )
      if ("refusal" in written) return written
      const widgets = doc.widgets.slice()
      widgets[index] = { ...widget, props: written.value }
      return { doc: { ...doc, widgets } }
    }

    case "add": {
      const bad = widgetRefusal(edit.widget, "add: widget")
      if (bad !== undefined) return refusal("invalid-widget", bad)
      const id = edit.widget.id
      if (indexOfWidget(doc, id) >= 0) {
        return refusal(
          "duplicate-id",
          `add: a widget with id ${describe(id)} is already on this document. The frozen schema ` +
            `permits duplicates; this editor does not, because move/set-prop/remove/reorder all ` +
            `address a widget BY id and a duplicate makes them ambiguous`
        )
      }
      // Cloned so the caller cannot reach into the document — or into every undo snapshot that will
      // later share this object — by mutating the widget it just handed over.
      return { doc: { ...doc, widgets: [...doc.widgets, structuredClone(edit.widget)] } }
    }

    // ── WS-HMI-2 Task 10 — the three edits the property panel needs ─────────────────────────────
    //
    // All three share ONE shape, and the shape is the whole argument for widening the reach: build
    // the widget this edit WOULD produce, then hand it to `widgetRefusal` — the same mirror `add`
    // already used. No new copy of `$defs/widget` exists anywhere as a result, and a keyword the
    // mirror cannot enforce still reddens `SCHEMA_MIRROR.handledKeywords`'s inventory pin exactly as
    // it did before. The only rule stated a second time is the one the panel must BRANCH on (§5),
    // and it is stated through the shared `requiresPolicyAction` rather than re-written.

    case "set-kind": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("set-kind", edit.widgetId)
      const widget = doc.widgets[index]
      // Spread, not a canonical rebuild: assigning an EXISTING key leaves it in the position it
      // already had, so an accepted edit does not churn the saved document's key order (the same
      // property `move` states for `rect`). A `policyAction` the widget never had lands last, which
      // is the only place a new key can go.
      const candidate =
        edit.policyAction === undefined
          ? { ...widget, kind: edit.widgetKind }
          : { ...widget, kind: edit.widgetKind, policyAction: edit.policyAction }

      // 🔴 §5, BEFORE the general mirror, so the code the panel reads is the specific one. The mirror
      // would refuse this same widget a line later with `invalid-widget`; both are correct, only one
      // tells a UI what to ask the engineer for.
      if (requiresPolicyAction(edit.widgetKind) && !Object.hasOwn(candidate, "policyAction")) {
        return refusal(
          "policy-action-required",
          `set-kind ${describe(edit.widgetId)}: a "${edit.widgetKind}" widget is a WRITE path, so the ` +
            `frozen schema requires a policyAction on it (invariant §5: no write path without a gate). ` +
            `This widget declares none and this edit carries none, so the kind is NOT changed — choose ` +
            `one of ${Object.keys(POLICY_ACTIONS).join(" | ")} and send both together`
        )
      }

      const bad = widgetRefusal(candidate, `set-kind ${describe(edit.widgetId)}: widget`)
      if (bad !== undefined) return refusal("invalid-widget", bad)
      const widgets = doc.widgets.slice()
      widgets[index] = candidate
      return { doc: { ...doc, widgets } }
    }

    case "set-policy-action": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("set-policy-action", edit.widgetId)
      const widget = doc.widgets[index]
      const candidate = { ...widget, policyAction: edit.policyAction }
      // Note what this refuses that may read as surprising and is deliberate: a widget whose STORED
      // `kind` is not in the frozen enum (the write door accepts one — see
      // `tests/37-editor-canvas.spec.ts` on `probe-kind`) cannot have its gate set here, because the
      // widget this edit would produce is still not a `$defs/widget`. Fix the kind first; the panel
      // offers exactly that.
      const bad = widgetRefusal(candidate, `set-policy-action ${describe(edit.widgetId)}: widget`)
      if (bad !== undefined) return refusal("invalid-widget", bad)
      const widgets = doc.widgets.slice()
      widgets[index] = candidate
      return { doc: { ...doc, widgets } }
    }

    case "set-binding": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("set-binding", edit.widgetId)
      // 🔴 FIX ROUND 1, task-10-review.md F6 — `trim()`, not `length`. See header note (4).
      if (typeof edit.name !== "string" || edit.name.trim().length === 0) {
        return refusal(
          "bad-binding-name",
          `set-binding ${describe(edit.widgetId)}: name must be a non-blank string, got ` +
            `${describe(edit.name)}. The frozen schema puts no constraint on a binding KEY, so this is ` +
            `the editor being stricter on purpose: every widget reads its bindings by a name it ` +
            `hardcodes, so an unnamed or whitespace-only one is a binding nothing can ever consult`
        )
      }
      const widget = doc.widgets[index]
      const current = isPlainObject(widget.bindings) ? widget.bindings : undefined
      // Removing a binding from a widget that has no bindings MAP at all returns the document
      // untouched, so `applyEdit`'s own no-op rule refuses it. Writing `bindings: {}` instead would
      // be a change — a new key in the saved file — for an edit that removed nothing.
      if (edit.path === undefined && current === undefined) return { doc }
      const nextBindings: Record<string, unknown> = { ...(current ?? {}) }
      if (edit.path === undefined) delete nextBindings[edit.name]
      else nextBindings[edit.name] = edit.path
      const candidate = { ...widget, bindings: nextBindings }
      const bad = widgetRefusal(candidate, `set-binding ${describe(edit.widgetId)}: widget`)
      if (bad !== undefined) return refusal("invalid-widget", bad)
      const widgets = doc.widgets.slice()
      // The cast is carried by the line above, not by optimism: `widgetRefusal` returning
      // `undefined` IS the proof that every value in `nextBindings` is a string.
      widgets[index] = candidate as ScreenWidget
      return { doc: { ...doc, widgets } }
    }

    // ── WS-HMI-2 Task 11 — the layer tree's rename ──────────────────────────────────────────────
    //
    // Same shape as the three above, and for the same reason: build the widget this edit WOULD
    // produce, hand it to `widgetRefusal`. The frozen `id` pattern is therefore enforced by the one
    // copy of it this file already carried, and `SCHEMA_MIRROR.handledKeywords` still accounts for
    // that keyword by path. Uniqueness is the one thing `widgetRefusal` cannot answer — it is a
    // property of the DOCUMENT, not of a widget — so it is checked here, exactly as `add` does.
    case "rename": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("rename", edit.widgetId)
      const widget = doc.widgets[index]
      // Spread, not a rebuild: `id` is already the first key of every widget the contract describes,
      // so assigning it leaves the saved document's key order alone (the property `move` and
      // `set-kind` both state).
      const candidate = { ...widget, id: edit.newId }
      const bad = widgetRefusal(candidate, `rename ${describe(edit.widgetId)}: widget`)
      if (bad !== undefined) return refusal("invalid-widget", bad)
      // The widget's OWN id is not a collision with itself — otherwise re-typing the current name
      // would be reported as "taken" instead of falling through to the no-op rule.
      if (doc.widgets.some((other, i) => i !== index && other.id === edit.newId)) {
        return refusal(
          "duplicate-id",
          `rename ${describe(edit.widgetId)}: a different widget already carries the id ` +
            `${describe(edit.newId)}. The frozen schema permits duplicates; this editor does not, ` +
            `because move/set-prop/remove/reorder all address a widget BY id and a duplicate makes ` +
            `them ambiguous`
        )
      }
      const widgets = doc.widgets.slice()
      // Written at the SAME index: a rename is not a reorder, and draw order must not shift because
      // someone corrected a spelling.
      widgets[index] = candidate as ScreenWidget
      return { doc: { ...doc, widgets } }
    }

    case "remove": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return unknownWidget("remove", edit.widgetId)
      const widgets = doc.widgets.slice()
      widgets.splice(index, 1)
      return { doc: { ...doc, widgets } }
    }

    case "reorder": {
      const from = indexOfWidget(doc, edit.widgetId)
      if (from < 0) return unknownWidget("reorder", edit.widgetId)
      const to = edit.toIndex
      if (!Number.isInteger(to) || to < 0 || to >= doc.widgets.length) {
        return refusal(
          "index-out-of-range",
          `reorder ${describe(edit.widgetId)}: toIndex ${describe(to)} is outside ` +
            `[0, ${doc.widgets.length - 1}] — the last position is ${doc.widgets.length - 1}, not ` +
            `${doc.widgets.length}`
        )
      }
      const widgets = doc.widgets.slice()
      const [moved] = widgets.splice(from, 1)
      widgets.splice(to, 0, moved)
      return { doc: { ...doc, widgets } }
    }

    default:
      return refusal(
        "unknown-edit-kind",
        `unrecognised edit kind ${describe((edit as { kind: unknown }).kind)} — refused rather than ` +
          `ignored, so a sixth member added to EditorEdit without a case here is visible instead of ` +
          `silently doing nothing`
      )
  }
}

// ── the public surface ────────────────────────────────────────────────────────────────────────────

/**
 * Opens an editing session on `doc`. The document is DEEP-COPIED: `past`/`future` will hold whole
 * documents that structurally share unchanged sub-trees with this one, and a caller that kept a
 * reference and mutated it would rewrite history it can no longer see.
 *
 * No schema claim is made about `doc` here — see the header. `applyEdit` preserves validity; it does
 * not establish it.
 */
export function createEditorState(doc: HmiScreenDocument): EditorState {
  return { doc: structuredClone(doc), past: [], future: [], lastRefusal: undefined }
}

/** A NEW state object (so a caller diffing states sees the refusal) carrying the SAME doc/past/future
 * references — nothing about the document changed, by identity and not merely by value. */
function refuse(state: EditorState, code: EditorRefusalCode, message: string): EditorState {
  return { doc: state.doc, past: state.past, future: state.future, lastRefusal: { code, message } }
}

/**
 * Applies one edit. Pure: `state` and everything reachable from it is left exactly as it was, and the
 * returned state shares every sub-tree the edit did not touch.
 *
 * An accepted edit pushes the OUTGOING document onto `past` (dropping the oldest entry once `past`
 * would exceed `UNDO_DEPTH_LIMIT`) and CLEARS `future` — the standard rule that editing after an undo
 * abandons the redo branch, because the document that branch would redo onto no longer exists.
 *
 * An edit that would change nothing is refused too, not applied (`code: "no-op"`). Pushing an undo
 * step for it would give the user an undo that visibly does nothing — a drag that ends where it
 * started, or a property re-set to the value it already had, must not consume a step of a bounded
 * history. Compared by VALUE (`sameJsonValue`), not by serialised bytes — see that function.
 *
 * A malformed `edit`, or a `state.doc` with no `widgets` array, is REFUSED rather than thrown
 * (fix round 1, task-7-review.md §7.6). Both are outside the declared types and tsc stops a
 * TypeScript caller reaching them, but this module's posture everywhere else is "refuse with a
 * sentence, never throw", and a UI layer should not need a `try` it did not expect.
 */
export function applyEdit(state: EditorState, edit: EditorEdit): EditorState {
  if (!isPlainObject(edit) || typeof edit.kind !== "string") {
    return refuse(
      state,
      "malformed-edit",
      `applyEdit: edit must be an object carrying a string "kind", got ${describe(edit)}`
    )
  }
  if (!isPlainObject(state.doc) || !Array.isArray(state.doc.widgets)) {
    return refuse(
      state,
      "malformed-document",
      `applyEdit: this state's document has no widgets array (${describe(state.doc?.widgets)}), so ` +
        `there is nothing an edit could address`
    )
  }

  const result = nextDocument(state.doc, edit)
  if ("refusal" in result) return refuse(state, result.refusal.code, result.refusal.message)

  if (sameJsonValue(result.doc, state.doc)) {
    return refuse(
      state,
      "no-op",
      `${edit.kind}: this edit changes nothing — refused rather than pushed, so undo never offers a ` +
        `step that does nothing when taken`
    )
  }

  return {
    doc: result.doc,
    past: [...state.past, state.doc].slice(-UNDO_DEPTH_LIMIT),
    future: [],
    lastRefusal: undefined,
  }
}

/** Steps one document back. At the bottom of the stack this changes nothing and says so. */
export function undo(state: EditorState): EditorState {
  if (state.past.length === 0) {
    return refuse(
      state,
      "nothing-to-undo",
      `undo: nothing left to undo — the history is empty (it holds at most ${UNDO_DEPTH_LIMIT} steps, ` +
        `and anything older has already been dropped)`
    )
  }
  return {
    doc: state.past[state.past.length - 1],
    past: state.past.slice(0, -1),
    future: [...state.future, state.doc],
    lastRefusal: undefined,
  }
}

/** Steps one document forward along the branch `undo` walked back. Any accepted `applyEdit` since
 * that undo has already cleared this stack. */
export function redo(state: EditorState): EditorState {
  if (state.future.length === 0) {
    return refuse(
      state,
      "nothing-to-redo",
      "redo: nothing to redo — no undo has been taken, or an edit since then discarded the redo branch"
    )
  }
  // `past` needs no cap here: `applyEdit` caps it, and `undo`/`redo` only move ONE document between
  // the two stacks, so `past.length + future.length` never rises above the cap once it has been applied.
  return {
    doc: state.future[state.future.length - 1],
    past: [...state.past, state.doc],
    future: state.future.slice(0, -1),
    lastRefusal: undefined,
  }
}
