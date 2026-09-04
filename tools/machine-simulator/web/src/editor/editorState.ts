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
 * identity, not merely by value — and puts a human-readable sentence in `lastRefusal`. Never a
 * silent no-op.
 *
 * The guards below are a hand-written mirror of `$defs/widget` and `$defs/rect`. This repository's
 * standing objection to a second copy of a rule (see `contracts/README.md`, `validate.mjs`'s header,
 * `policyGate`'s doc comment) is answered the same way it is answered for `web/src/contracts/*.ts`
 * itself: by an EXECUTING two-way pin, not by a promise. `editorState.test.mjs` runs a corpus of
 * candidate widgets and rects through BOTH this guard and Milestone 0's real `validate.mjs`, and
 * asserts the two answers agree member by member — so a guard that drifts loose (accepts what the
 * schema rejects) or tight (rejects what the schema accepts) reddens.
 *
 * Where a vocabulary already exists as a frozen TYPE, it is reached through the type instead of
 * retyped: `Record<WidgetKind, true>` and `Record<keyof ScreenWidget, true>` below are exhaustive in
 * BOTH directions at COMPILE time, exactly as `policyGate`'s `Record<PolicyAction, true>` is, and
 * those unions are themselves pinned against the schema's enums by `scripts/check-contracts.mjs`.
 * Only three things could not be reached that way and are written out as literals: the widget-id
 * `pattern`, the rect `minimum`s, and the set of required widget fields. All three are covered by
 * the differential corpus above.
 *
 * ── TWO PLACES THIS IS DELIBERATELY STRICTER THAN THE SCHEMA ──────────────────────────────────────
 *
 * (1) WIDGET IDS MUST BE UNIQUE. The frozen schema does not say so — `widgets` is a plain array and
 *     two widgets may share an `id` and still validate. But four of this module's five edits ADDRESS
 *     a widget BY id (`move`, `set-prop`, `remove`, `reorder`), so a duplicate id makes those edits
 *     ambiguous and undo/redo unreproducible. `add` therefore refuses an id already on the document.
 *     This is an EDITOR invariant, stated here rather than smuggled in.
 *
 * (2) EVERY VALUE WRITTEN INTO `props` MUST BE JSON. The schema declares `props` as bare
 *     `{"type": "object"}`, so `validate.mjs` never even descends into it — `props.x = undefined`,
 *     a `Date`, a `Map`, a function, `NaN` all "validate". They do not SURVIVE: `JSON.stringify`
 *     silently drops `undefined` and functions, turns `NaN` into `null`, flattens a `Date` to a
 *     string and a `Map` to `{}`. The in-memory document and the file written back would then
 *     disagree, and an undo stack full of documents that no longer round-trip is worse than a
 *     refused edit.
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
 * It does not edit `kind`, `bindings`, `component`, `policyAction`, `layout`, `theme`, `title` or
 * `screenId` — this task's `EditorEdit` union has no edit for them, and `set-prop` is rooted at
 * `props` precisely so it cannot reach them (see `set-prop` below).
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

/** The five edits the visual editor can make. Each is data — serialisable, replayable, and carrying
 * no reference to any React component or DOM node. */
export type EditorEdit =
  | { kind: "move"; widgetId: string; rect: WidgetRect }
  /** `path` is dotted and rooted at the widget's `props` — `"label"`, `"thresholds.warn"`. It is
   * NOT rooted at the widget: `props` is the only sub-tree `contracts/hmi-screen.schema.json`
   * leaves unconstrained (`{"type": "object"}`), so a write confined to it cannot invalidate the
   * document by construction, and this module needs no second copy of the schema's rules to allow
   * it. Reaching `kind`/`bindings`/`policyAction` needs its own edit kind with its own guards; this
   * task's brief defines none, so the reach is closed rather than left half-open. */
  | { kind: "set-prop"; widgetId: string; path: string; value: unknown }
  | { kind: "add"; widget: ScreenWidget }
  | { kind: "remove"; widgetId: string }
  | { kind: "reorder"; widgetId: string; toIndex: number }

export type EditorState = {
  /** The document as it stands. Never the same object the caller passed to `createEditorState`. */
  readonly doc: HmiScreenDocument
  /** Undo stack, OLDEST first. At most `UNDO_DEPTH_LIMIT` entries; `undo` pops the last. */
  readonly past: readonly HmiScreenDocument[]
  /** Redo stack, OLDEST-undone first. Emptied by any accepted `applyEdit`. */
  readonly future: readonly HmiScreenDocument[]
  /**
   * Why the most recent call left the document unchanged — a refused edit, or an `undo`/`redo` with
   * nothing left on its stack. `undefined` after any call that DID change the document.
   *
   * A refused edit that reported nothing would be indistinguishable, from the caller's side, from an
   * edit that worked; `policyGate` states the same rule for the same reason (a disabled control that
   * never says why). Callers that want to know whether undo/redo is available should read
   * `past.length`/`future.length` — this field is about the call that just happened.
   */
  readonly lastRefusal: string | undefined
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

/** `additionalProperties: false` on `$defs/widget`, reached through `keyof ScreenWidget` so a field
 * added to the frozen type must be acknowledged here before it can be edited. */
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
 * same four names. These, plus `WIDGET_ID_PATTERN` and `WIDGET_REQUIRED_KEYS`, are the only schema
 * facts here that no frozen type could carry; `editorState.test.mjs`'s differential corpus is what
 * keeps them honest. */
const RECT_MINIMUM: Record<keyof WidgetRect, number> = { col: 0, row: 0, colSpan: 1, rowSpan: 1 }

/** `$defs/widget.properties.id.pattern`. JavaScript's `$` (no `m` flag) anchors at end of INPUT, so
 * `"probe-a\n"` does not match — unlike .NET, where `ContractInvariants.cs` needs `\z` for exactly
 * this case. Nothing to work around on this side; noted so the difference is not read as an
 * oversight. */
const WIDGET_ID_PATTERN = /^[a-z0-9-]+$/

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
  } else if (Object.hasOwn(POLICY_REQUIRED_KINDS, kind)) {
    return `${where}: a "${kind}" widget must declare policyAction — invariant §5, enforced by the ` +
      `frozen schema's allOf/if/then: no write path without a gate`
  }

  return undefined
}

// ── the edits ─────────────────────────────────────────────────────────────────────────────────────

/** Either the document an edit produces, or the sentence explaining why it was refused. Two shapes
 * rather than a nullable document, so neither a caller nor tsc can read one as the other. */
type EditResult = { readonly doc: HmiScreenDocument } | { readonly refusal: string }

function indexOfWidget(doc: HmiScreenDocument, widgetId: unknown): number {
  return doc.widgets.findIndex((widget) => widget.id === widgetId)
}

function unknownWidget(editKind: string, widgetId: unknown): string {
  return `${editKind}: no widget with id ${describe(widgetId)} on this document — refused rather than ` +
    `applied to nothing, which would push an undo step that undoes nothing`
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
): { readonly value: Record<string, unknown> } | { readonly refusal: string } {
  const [head, ...rest] = segments
  if (rest.length === 0) return { value: { ...root, [head]: value } }

  const child = root[head]
  if (child !== undefined && !isPlainObject(child)) {
    return {
      refusal: `${where}.${head}: cannot descend — ${describe(child)} is already there and is not an ` +
        `object; setting through it would delete it`,
    }
  }
  const inner = setDeep(isPlainObject(child) ? child : {}, rest, value, `${where}.${head}`)
  if ("refusal" in inner) return inner
  return { value: { ...root, [head]: inner.value } }
}

function nextDocument(doc: HmiScreenDocument, edit: EditorEdit): EditResult {
  switch (edit.kind) {
    case "move": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return { refusal: unknownWidget("move", edit.widgetId) }
      const refusal = rectRefusal(edit.rect, `move ${describe(edit.widgetId)}: rect`)
      if (refusal !== undefined) return { refusal }
      const widgets = doc.widgets.slice()
      widgets[index] = { ...widgets[index], rect: { ...edit.rect } }
      return { doc: { ...doc, widgets } }
    }

    case "set-prop": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return { refusal: unknownWidget("set-prop", edit.widgetId) }
      if (typeof edit.path !== "string" || edit.path.length === 0) {
        return {
          refusal: `set-prop ${describe(edit.widgetId)}: path must be a non-empty dotted string rooted ` +
            `at props, got ${describe(edit.path)}`,
        }
      }
      const segments = edit.path.split(".")
      if (segments.some((segment) => segment.length === 0)) {
        return {
          refusal: `set-prop ${describe(edit.widgetId)}: path ${describe(edit.path)} has an empty ` +
            `segment — a leading, trailing or doubled "." names a property with no name`,
        }
      }
      const valueRefusal = jsonRefusal(
        edit.value,
        `set-prop ${describe(edit.widgetId)} ${describe(edit.path)}: value`
      )
      if (valueRefusal !== undefined) return { refusal: valueRefusal }

      const widget = doc.widgets[index]
      const written = setDeep(
        widget.props ?? {},
        segments,
        structuredClone(edit.value),
        `set-prop ${describe(edit.widgetId)}: props`
      )
      if ("refusal" in written) return { refusal: written.refusal }
      const widgets = doc.widgets.slice()
      widgets[index] = { ...widget, props: written.value }
      return { doc: { ...doc, widgets } }
    }

    case "add": {
      const refusal = widgetRefusal(edit.widget, "add: widget")
      if (refusal !== undefined) return { refusal }
      const id = edit.widget.id
      if (indexOfWidget(doc, id) >= 0) {
        return {
          refusal: `add: a widget with id ${describe(id)} is already on this document. The frozen ` +
            `schema permits duplicates; this editor does not, because move/set-prop/remove/reorder all ` +
            `address a widget BY id and a duplicate makes them ambiguous`,
        }
      }
      // Cloned so the caller cannot reach into the document — or into every undo snapshot that will
      // later share this object — by mutating the widget it just handed over.
      return { doc: { ...doc, widgets: [...doc.widgets, structuredClone(edit.widget)] } }
    }

    case "remove": {
      const index = indexOfWidget(doc, edit.widgetId)
      if (index < 0) return { refusal: unknownWidget("remove", edit.widgetId) }
      const widgets = doc.widgets.slice()
      widgets.splice(index, 1)
      return { doc: { ...doc, widgets } }
    }

    case "reorder": {
      const from = indexOfWidget(doc, edit.widgetId)
      if (from < 0) return { refusal: unknownWidget("reorder", edit.widgetId) }
      const to = edit.toIndex
      if (!Number.isInteger(to) || to < 0 || to >= doc.widgets.length) {
        return {
          refusal: `reorder ${describe(edit.widgetId)}: toIndex ${describe(to)} is outside ` +
            `[0, ${doc.widgets.length - 1}] — the last position is ${doc.widgets.length - 1}, not ` +
            `${doc.widgets.length}`,
        }
      }
      const widgets = doc.widgets.slice()
      const [moved] = widgets.splice(from, 1)
      widgets.splice(to, 0, moved)
      return { doc: { ...doc, widgets } }
    }

    default:
      return {
        refusal: `unrecognised edit kind ${describe((edit as { kind: unknown }).kind)} — refused rather ` +
          `than ignored, so a sixth member added to EditorEdit without a case here is visible instead ` +
          `of silently doing nothing`,
      }
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
function refuse(state: EditorState, reason: string): EditorState {
  return { doc: state.doc, past: state.past, future: state.future, lastRefusal: reason }
}

/**
 * Applies one edit. Pure: `state` and everything reachable from it is left exactly as it was, and the
 * returned state shares every sub-tree the edit did not touch.
 *
 * An accepted edit pushes the OUTGOING document onto `past` (dropping the oldest entry once `past`
 * would exceed `UNDO_DEPTH_LIMIT`) and CLEARS `future` — the standard rule that editing after an undo
 * abandons the redo branch, because the document that branch would redo onto no longer exists.
 *
 * An edit that would change nothing is refused too, not applied. Pushing an undo step for it would
 * give the user an undo that visibly does nothing — a drag that ends where it started, or a property
 * re-set to the value it already had, must not consume a step of a bounded history. The comparison is
 * over the serialised document because that is what "changed" means for a document whose whole point
 * is to be written back as JSON.
 */
export function applyEdit(state: EditorState, edit: EditorEdit): EditorState {
  const result = nextDocument(state.doc, edit)
  if ("refusal" in result) return refuse(state, result.refusal)

  if (JSON.stringify(result.doc) === JSON.stringify(state.doc)) {
    return refuse(
      state,
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
