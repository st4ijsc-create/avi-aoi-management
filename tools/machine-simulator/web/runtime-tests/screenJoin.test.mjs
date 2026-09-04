// Run: npm run test:runtime   (node --test, no extra package)
//
// WS-HMI-2 Task 13 — THE JOIN, executed rather than pattern-matched.
//
// ── WHAT THIS FILE PINS ──────────────────────────────────────────────────────────────────────────
// Three pure functions this task added, all in plain `.ts` so `node --test` can `import()` and RUN
// them (a `.tsx` cannot be — measured across this tree, see `widgetRegistry.test.mjs`'s header):
//
//   * `hmi-runtime/publishedScreen.ts`'s `machineScreenId` — WHICH screen id a machine's kiosk asks
//     the store for. Pinned against `fleet.json`'s real roster and against the frozen schema's own
//     `screenId` pattern read from disk, not against a second copy of either.
//   * the same module's `unrenderableReason`/`renderableScreen` — the guard that stops a document the
//     renderer cannot lay out from taking the kiosk page down. Each rejection is asserted BY ITS
//     REASON, because a guard that rejects everything for the same reason measures nothing; and every
//     document this repository actually ships is asserted to pass it, because a guard that rejects
//     the real corpus would be a silent kill switch on the whole feature.
//   * `editor/editorState.ts`'s `createBlankScreen` — the first document of a screen nobody has
//     published. Validated against Milestone 0's REAL `validate.mjs`, and again after a widget is
//     added through `applyEdit`, because a "new screen" the publish door would refuse is a button
//     that can only ever fail.
//
// ── WHAT IT DOES NOT PIN ─────────────────────────────────────────────────────────────────────────
// That `routes/Hmi.tsx` actually CALLS any of this. Nothing here renders, mounts or fetches. The join
// itself — the kiosk asking the store, and the published document reaching the operator's screen — is
// a claim about a running browser and it lives in `tests/43-editor-acceptance.spec.ts`, which drives
// the whole journey end to end. This file is the cheap half: it makes the ARITHMETIC of the join
// answerable in under a second, and it is what reddens by name when a rule changes rather than when a
// page stops working.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { validate } from "../contract-tests/validate.mjs"
import {
  LAYOUT_DIMENSION_MAX,
  LAYOUT_DIMENSION_MIN,
  MACHINE_SCREEN_ID_PREFIX,
  SCREEN_ID_PATTERN,
  machineForScreenId,
  machineScreenId,
  renderableScreen,
  unrenderableReason,
} from "../src/hmi-runtime/publishedScreen.ts"
import { applyEdit, createBlankScreen, createEditorState } from "../src/editor/editorState.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SIM = join(WEB, "..")
const SCHEMA_PATH = join(SIM, "contracts", "hmi-screen.schema.json")
const FLEET_PATH = join(SIM, "fleet.json")

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))
const FLEET = JSON.parse(readFileSync(FLEET_PATH, "utf8"))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The screenId pattern is a MIRROR, and it is held to the file it mirrors
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("SCREEN_ID_PATTERN is `properties.screenId.pattern` read off the frozen schema — not a second rule", () => {
  const fromSchema = SCHEMA.properties?.screenId?.pattern
  assert.equal(
    typeof fromSchema,
    "string",
    "contracts/hmi-screen.schema.json no longer declares properties.screenId.pattern — this test was reading nothing"
  )
  assert.equal(
    SCREEN_ID_PATTERN.source,
    fromSchema,
    "publishedScreen.ts's SCREEN_ID_PATTERN has drifted from the frozen schema's own screenId pattern"
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// machineScreenId
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 SECURITY REVIEW MEDIUM-2 — the layout bounds are a MIRROR too, and held to the same file
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("LAYOUT_DIMENSION_MIN/MAX are `$defs.layout.properties.cols|rows`'s frozen minimum/maximum, read off the schema", () => {
  for (const field of ["cols", "rows"]) {
    const declared = SCHEMA.$defs?.layout?.properties?.[field]
    assert.equal(typeof declared?.minimum, "number", `schema no longer declares $defs.layout.${field}.minimum`)
    assert.equal(typeof declared?.maximum, "number", `schema no longer declares $defs.layout.${field}.maximum`)
    assert.equal(declared.minimum, LAYOUT_DIMENSION_MIN, `$defs.layout.${field}.minimum has drifted from publishedScreen.ts`)
    assert.equal(declared.maximum, LAYOUT_DIMENSION_MAX, `$defs.layout.${field}.maximum has drifted from publishedScreen.ts`)
  }
})

test("the join's guard refuses the RANGES the write door refuses — not merely non-finite ones", () => {
  // The reviewer's own example first: `1e9` is finite, so the round-0 guard passed it and the renderer
  // reached `repeat(1000000000, minmax(0, 1fr))`. Then the rest of the boundary, both axes, both ends,
  // plus a fractional value the schema's `"type": "integer"` forbids and finiteness accepts.
  const cases = [
    ["cols", 1e9],
    ["cols", 0],
    ["cols", -1],
    ["cols", LAYOUT_DIMENSION_MAX + 1],
    ["cols", 12.5],
    ["rows", 1e9],
    ["rows", 0],
    ["rows", LAYOUT_DIMENSION_MAX + 1],
    ["rows", 4.5],
  ]
  for (const [field, value] of cases) {
    const doc = structuredClone(GOOD_DOC)
    doc.layout[field] = value
    const reason = unrenderableReason(doc)
    assert.ok(reason, `layout.${field} = ${value} was ACCEPTED by the join's guard`)
    // `startsWith`, not a regex: the field name is interpolated, and a template literal that has to
    // escape a dot for a RegExp is one backslash away from matching any character instead of a dot —
    // which is exactly what the first draft of this line did.
    assert.ok(
      reason.startsWith(`layout.${field} is`),
      `the guard blamed the wrong field for ${field} = ${value}: ${reason}`
    )
  }
})

test("…and ACCEPTS both ends of the frozen range — a guard that refused everything would satisfy the test above", () => {
  for (const value of [LAYOUT_DIMENSION_MIN, LAYOUT_DIMENSION_MAX]) {
    for (const field of ["cols", "rows"]) {
      const doc = structuredClone(GOOD_DOC)
      doc.layout[field] = value
      assert.equal(unrenderableReason(doc), undefined, `layout.${field} = ${value} is inside the frozen range but was refused`)
    }
  }
})

test("floor: fleet.json really was read and really has machines — otherwise the roster tests below measure an empty set", () => {
  assert.ok(Array.isArray(FLEET) && FLEET.length > 0, "fleet.json parsed to no roster")
  assert.ok(
    FLEET.every((m) => typeof m.code === "string" && m.code.length > 0),
    "a roster entry has no code"
  )
})

test("EVERY machine in the real roster derives a screen id the FROZEN SCHEMA would accept", () => {
  // The property that makes the join usable at all: if a code could not produce a legal screenId, that
  // machine's kiosk could never read a published screen no matter what an engineer authored. Measured
  // against the schema pattern read from disk, over the actual roster, rather than against the three
  // codes this task happened to test by hand.
  for (const machine of FLEET) {
    const id = machineScreenId(machine.code)
    assert.equal(typeof id, "string", `${machine.code} derives no screen id at all`)
    assert.match(id, new RegExp(SCHEMA.properties.screenId.pattern), `${machine.code} derives an illegal screen id "${id}"`)
    assert.ok(id.startsWith(MACHINE_SCREEN_ID_PREFIX), `${machine.code} derives "${id}", outside the reserved prefix`)
  }
})

test("the derivation is INJECTIVE over the roster — no two machines share a panel", () => {
  const ids = FLEET.map((m) => machineScreenId(m.code))
  assert.equal(new Set(ids).size, ids.length, `two machines derive the same screen id: ${ids.join(", ")}`)
})

test("case is FOLDED, because two spellings of a machine code are one machine — but a screenId is never folded", () => {
  // `CanonicalScreenStore.cs` refuses to fold a screenId's case on purpose (the frozen schema says a
  // screenId is already lowercase, so a capital letter is a contract violation, not a second
  // spelling). A MACHINE CODE has no case constraint at all and `MachineCodeIdentity` folds it. This
  // function crosses from the second vocabulary into the first, which is the one place a fold is
  // correct — so these three spellings of ONE machine must reach ONE panel.
  assert.equal(machineScreenId("AOI-01"), "machine-aoi-01")
  assert.equal(machineScreenId("aoi-01"), "machine-aoi-01")
  assert.equal(machineScreenId("Aoi-01"), "machine-aoi-01")
})

test("surrounding whitespace is trimmed, the same accident CanonicalScreenStore's Trim() forgives", () => {
  assert.equal(machineScreenId("  IOT-02  "), "machine-iot-02")
})

test("a code that cannot make a LEGAL screen id answers undefined — never a sanitised best effort", () => {
  // A sanitised id is the dangerous answer: two different machines whose codes differ only in the
  // stripped characters would silently share one operator panel. `undefined` means "no derivable
  // panel", and the kiosk then renders exactly what it rendered before this task existed.
  for (const hostile of ["SCRW_01", "SCRW 01", "SCRW.01", "máy-01", "SCRW/01", "SCRW+01"]) {
    assert.equal(machineScreenId(hostile), undefined, `"${hostile}" was accepted — check what id it produced`)
  }
})

test("no code at all — undefined, empty, blank, and a non-string — answer undefined rather than throwing", () => {
  for (const empty of [undefined, "", "   ", null, 7, {}]) {
    assert.equal(machineScreenId(empty), undefined)
  }
})

test("FALSIFICATION CONTROL: the reserved prefix is genuinely part of the answer", () => {
  // If `MACHINE_SCREEN_ID_PREFIX` were dropped, every assertion above about legality and injectivity
  // would still pass — a bare lowercased code is legal and injective too. This is the one assertion
  // that reddens, and the prefix is the whole reason an engineer's free-form screen id (`component-demo`,
  // `editor-drag-probe`, …) can never take over a machine's operator panel.
  assert.equal(machineScreenId("IOT-01"), `${MACHINE_SCREEN_ID_PREFIX}iot-01`)
  assert.notEqual(machineScreenId("IOT-01"), "iot-01")
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// machineForScreenId — the inverse, and the roster is the authority (fix round 1, HIGH-1)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("machineForScreenId finds the machine whose panel a screen id IS, in the ROSTER's own spelling", () => {
  // The spelling matters and is the reason this is a roster lookup rather than a prefix strip: the
  // editor has to warn an engineer that they are about to replace "AOI-01"'s panel, not "aoi-01"'s.
  for (const machine of FLEET) {
    const found = machineForScreenId(machineScreenId(machine.code), FLEET)
    assert.equal(found?.code, machine.code, `${machine.code} did not resolve back to itself`)
  }
})

test("a screen id that is nobody's panel resolves to undefined — the ordinary case, and the silent one", () => {
  // Every screen id this repository's own suites actually PUT. If any of these resolved to a machine,
  // the editor would warn about replacing an operator panel while editing an ordinary probe document.
  for (const id of [
    "component-demo",
    "editor-canvas-probe",
    "editor-canvas-overflow",
    "editor-drag-probe",
    "editor-properties-probe",
    "editor-layers-probe",
    "grid-uniformity-probe",
    "iot-overview",
    "aoi-overview",
    "automation-overview",
    "machine-",
    "machine-no-such-code",
  ]) {
    assert.equal(machineForScreenId(id, FLEET), undefined, `"${id}" was resolved to a machine panel`)
  }
})

test("the inverse agrees with the FORWARD direction on case, because it compares derived ids", () => {
  // A roster whose codes are spelled differently still resolves, because both sides go through
  // `machineScreenId`. A prefix strip would have had to re-implement the fold and could drift from it.
  const oddRoster = [{ code: "aoi-01" }, { code: "Iot-02" }]
  assert.equal(machineForScreenId("machine-aoi-01", oddRoster)?.code, "aoi-01")
  assert.equal(machineForScreenId("machine-iot-02", oddRoster)?.code, "Iot-02")
})

test("no roster, or no id, is undefined rather than a throw", () => {
  assert.equal(machineForScreenId("machine-aoi-01", undefined), undefined)
  assert.equal(machineForScreenId(undefined, FLEET), undefined)
  assert.equal(machineForScreenId("", FLEET), undefined)
})

test("FALSIFICATION CONTROL: the roster really is consulted — an EMPTY roster resolves nothing", () => {
  // Without this, a `machineForScreenId` that simply stripped the prefix would pass every test above
  // that uses the real roster.
  assert.equal(machineForScreenId("machine-aoi-01", []), undefined)
})
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// renderableScreen — the safety net, asserted BY REASON
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const GOOD_DOC = {
  schemaVersion: 1,
  screenId: "join-probe",
  title: "probe",
  theme: "blueprint",
  layout: { cols: 12, rows: 8, breakpoint: "panel" },
  widgets: [{ id: "w-1", kind: "readout", rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } }],
}

test("a document the renderer can lay out is returned AS THE SAME OBJECT — no copy, no rebuild", () => {
  assert.equal(renderableScreen(GOOD_DOC), GOOD_DOC)
  assert.equal(unrenderableReason(GOOD_DOC), undefined)
})

// Each row: a document, and the SUBSTRING the reason must contain. Asserting the reason (not merely
// that one exists) is what stops a guard from degenerating into "reject everything" while every test
// here stays green — the defect shape this workstream has now been caught by more than once.
const UNRENDERABLE = [
  ["no document at all", undefined, "no document"],
  ["null", null, "not an object"],
  ["an array", [], "not an object"],
  ["a string", "iot-overview", "not an object"],
  ["no layout", { ...GOOD_DOC, layout: undefined }, "layout is undefined"],
  ["a layout that is an array", { ...GOOD_DOC, layout: [] }, "layout is an array"],
  ["cols missing", { ...GOOD_DOC, layout: { rows: 8, breakpoint: "panel" } }, "layout.cols is undefined"],
  ["cols not a number", { ...GOOD_DOC, layout: { cols: "12", rows: 8, breakpoint: "panel" } }, "layout.cols is"],
  ["cols NaN", { ...GOOD_DOC, layout: { cols: Number.NaN, rows: 8, breakpoint: "panel" } }, "layout.cols is NaN"],
  ["rows Infinity", { ...GOOD_DOC, layout: { cols: 12, rows: Infinity, breakpoint: "panel" } }, "layout.rows is Infinity"],
  ["widgets missing", { ...GOOD_DOC, widgets: undefined }, "widgets is undefined"],
  ["widgets not an array", { ...GOOD_DOC, widgets: {} }, "widgets is object"],
  ["a null widget", { ...GOOD_DOC, widgets: [GOOD_DOC.widgets[0], null] }, "widgets[1] is null"],
  ["a widget that is a string", { ...GOOD_DOC, widgets: ["readout"] }, "widgets[0] is"],
]

for (const [what, doc, expected] of UNRENDERABLE) {
  test(`unrenderable — ${what} — is refused, and the reason NAMES it`, () => {
    const reason = unrenderableReason(doc)
    assert.ok(typeof reason === "string" && reason.length > 0, `${what}: no reason given`)
    assert.ok(reason.includes(expected), `${what}: reason was "${reason}", expected it to mention "${expected}"`)
    assert.equal(renderableScreen(doc), undefined)
  })
}

test("the guard stops EXACTLY at what would throw or collapse the grid — an ODD-but-drawable document still passes", () => {
  // The renderer already degrades all of this in place, one widget at a time: an unknown `kind` draws
  // a named placeholder, an out-of-range rect is clamped and warned, an unresolved `{component}` gets
  // a tooltip. If this guard rejected any of it, a screen with ONE bad widget would lose its whole
  // document to the fallback — which is the opposite of the degrade-in-place rule it exists to protect.
  const odd = {
    ...GOOD_DOC,
    widgets: [
      { id: "unknown-kind", kind: "probe-kind", rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
      { id: "way-out", kind: "readout", rect: { col: 99, row: 99, colSpan: 99, rowSpan: 99 } },
      { id: "no-rect", kind: "readout" },
      { id: "unresolved", kind: "readout", component: "nope", bindings: { value: "{component}" }, rect: {} },
      { id: "empty-widget" },
    ],
  }
  assert.equal(unrenderableReason(odd), undefined)
  assert.equal(renderableScreen(odd), odd)
})

test("every document this repository SHIPS survives the guard — including the demo screen", () => {
  const shipped = [
    join(WEB, "screens", "automation-overview.json"),
    join(WEB, "screens", "aoi-overview.json"),
    join(WEB, "screens", "iot-overview.json"),
    join(WEB, "screens", "demo", "component-demo.json"),
  ]
  for (const path of shipped) {
    const doc = JSON.parse(readFileSync(path, "utf8"))
    assert.equal(unrenderableReason(doc), undefined, `${path} was refused by the join's guard`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// createBlankScreen — the first document
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("a blank screen is VALID under the frozen contract — the publish door would take it", () => {
  // Not "looks right": the real `validate.mjs` from Milestone 0, over the real schema file. A "start
  // a new screen" button whose very first document the write door refuses is a button that can only
  // ever fail, and nothing else in this tree would have caught that.
  const doc = createBlankScreen("machine-iot-02")
  assert.deepEqual(validate(SCHEMA, SCHEMA, doc), [])
  assert.equal(doc.screenId, "machine-iot-02")
  assert.equal(doc.widgets.length, 0)
})

test("the blank screen's identity is EXACTLY the id it was asked for — the 409 the write door answers has no way to fire", () => {
  // `PUT /v1/screens/{id}` refuses a body whose `screenId` names a different identity from the route
  // (409, WS-HMI-0b HIGH-1). The route's id is the only input here, so there is no second place for
  // the two to disagree. Measured over an id that is legal but not a machine panel, too.
  for (const id of ["machine-iot-02", "line-overview", "a"]) {
    assert.equal(createBlankScreen(id).screenId, id)
  }
})

test("a blank screen is EDITABLE — adding the first widget through applyEdit keeps it schema-valid", () => {
  // The blank document is the one shape `applyEdit` had never been handed: `widgets: []`. Its own
  // guard refuses a state whose `widgets` is not an array, so an empty array had to be checked rather
  // than assumed, and the result is put through the real validator like every other edit corpus here.
  const state = createEditorState(createBlankScreen("machine-iot-02"))
  const after = applyEdit(state, {
    kind: "add",
    widget: { id: "w-1", kind: "readout", rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
  })
  assert.equal(after.lastRefusal, undefined, `add was refused: ${after.lastRefusal?.message}`)
  assert.equal(after.doc.widgets.length, 1)
  assert.deepEqual(validate(SCHEMA, SCHEMA, after.doc), [])
})

test("a blank screen is also the shape a `set-component` + `{component}` binding is authored on, end to end", () => {
  // The exact document `tests/43-editor-acceptance.spec.ts` builds with a mouse, built here with the
  // same edits so the ARITHMETIC of it is answerable without a browser: two instances of one widget
  // shape, differing only in `component`, both bound to the BARE token.
  let state = createEditorState(createBlankScreen("machine-iot-02"))
  for (const [id, component] of [
    ["w-1", "ins-temp"],
    ["w-2", "ins-hum"],
  ]) {
    state = applyEdit(state, {
      kind: "add",
      widget: { id, kind: "readout", rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
    })
    state = applyEdit(state, { kind: "set-binding", widgetId: id, name: "value", path: "{component}" })
    state = applyEdit(state, { kind: "set-component", widgetId: id, componentId: component })
    assert.equal(state.lastRefusal, undefined, `${id}: ${state.lastRefusal?.message}`)
  }
  assert.deepEqual(validate(SCHEMA, SCHEMA, state.doc), [])
  assert.deepEqual(
    state.doc.widgets.map((w) => `${w.id}:${w.component}:${w.bindings.value}`),
    ["w-1:ins-temp:{component}", "w-2:ins-hum:{component}"]
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// set-component — the edit that made the acceptance pass possible
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const COMPONENT_DOC = {
  ...GOOD_DOC,
  widgets: [
    { id: "w-1", kind: "readout", rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
    { id: "w-2", kind: "readout", component: "already", rect: { col: 2, row: 0, colSpan: 2, rowSpan: 1 } },
  ],
}

test("set-component writes the field, and the result is valid under the frozen schema", () => {
  const after = applyEdit(createEditorState(COMPONENT_DOC), {
    kind: "set-component",
    widgetId: "w-1",
    componentId: "ins-temp",
  })
  assert.equal(after.lastRefusal, undefined)
  assert.equal(after.doc.widgets[0].component, "ins-temp")
  assert.deepEqual(validate(SCHEMA, SCHEMA, after.doc), [])
})

test("set-component with no id REMOVES the field — the key is gone, not set to an empty string", () => {
  // `component: ""` is a value the frozen schema accepts and that `componentTagPrefixOf` treats as no
  // component at all — a field that reads as declared and behaves as absent. Both the omitted and the
  // blank form must produce the same, honest document.
  for (const componentId of [undefined, "", "   "]) {
    const after = applyEdit(createEditorState(COMPONENT_DOC), {
      kind: "set-component",
      widgetId: "w-2",
      componentId,
    })
    assert.equal(after.lastRefusal, undefined, `componentId=${JSON.stringify(componentId)} was refused`)
    assert.equal(
      Object.hasOwn(after.doc.widgets[1], "component"),
      false,
      `componentId=${JSON.stringify(componentId)} left a component key behind: ${JSON.stringify(after.doc.widgets[1])}`
    )
    assert.deepEqual(validate(SCHEMA, SCHEMA, after.doc), [])
  }
})

test("set-component on a widget that has no component and is given none is a NO-OP, not a rewrite", () => {
  // Removing something that is not there must not push a step onto the bounded undo stack, and must
  // not hand back a rebuilt document that merely deep-equals the old one — `Ctrl+Z` would then offer
  // a step that does nothing when taken.
  const state = createEditorState(COMPONENT_DOC)
  const after = applyEdit(state, { kind: "set-component", widgetId: "w-1" })
  assert.equal(after.lastRefusal?.code, "no-op")
  assert.equal(after.doc, state.doc, "a refused no-op rebuilt the document")
  assert.equal(after.past.length, 0, "a no-op consumed a step of the bounded undo history")
})

test("set-component naming a widget nothing on the document carries is refused by name", () => {
  const after = applyEdit(createEditorState(COMPONENT_DOC), {
    kind: "set-component",
    widgetId: "no-such-widget",
    componentId: "ins-temp",
  })
  assert.equal(after.lastRefusal?.code, "unknown-widget")
})

test("set-component with a NON-STRING id is refused through the schema mirror, not stored", () => {
  // The frozen schema says `component` is a string. This edit does not re-state that rule — it builds
  // the widget it would produce and hands it to `widgetRefusal`, the same mirror `add` uses — so this
  // test is what proves the mirror is actually on the path.
  for (const hostile of [7, true, {}, []]) {
    const after = applyEdit(createEditorState(COMPONENT_DOC), {
      kind: "set-component",
      widgetId: "w-1",
      componentId: hostile,
    })
    assert.equal(after.lastRefusal?.code, "invalid-widget", `componentId=${JSON.stringify(hostile)} was accepted`)
    assert.match(after.lastRefusal.message, /component/)
  }
})

test("set-component does NOT check that the id resolves anywhere — and that is the documented choice", () => {
  // A screen document names no machine, so "does this component exist" has no answer at authoring
  // time. The renderer answers it per widget at draw time. Pinned so a future 'improvement' that
  // starts refusing unknown ids has to change this test and read the reasoning first.
  const after = applyEdit(createEditorState(COMPONENT_DOC), {
    kind: "set-component",
    widgetId: "w-1",
    componentId: "a-component-no-machine-declares",
  })
  assert.equal(after.lastRefusal, undefined)
  assert.equal(after.doc.widgets[0].component, "a-component-no-machine-declares")
})

test("set-component writes ONLY doc.widgets — every other top-level field comes back by REFERENCE", () => {
  // The scope claim `editorState.test.mjs` makes edit by edit, made here for the tenth-and-first one
  // in the same shape: an edit that quietly started touching `layout` or `theme` would be invisible to
  // a deep-equality check that only looked at the widget it named.
  const state = createEditorState(COMPONENT_DOC)
  const before = state.doc
  const after = applyEdit(state, { kind: "set-component", widgetId: "w-1", componentId: "ins-temp" })
  for (const field of ["schemaVersion", "screenId", "title", "theme", "layout"]) {
    assert.equal(after.doc[field], before[field], `set-component rebuilt doc.${field}`)
  }
  assert.notEqual(after.doc.widgets, before.widgets)
  // The widget it did NOT name is the same object, so nothing was rebuilt wholesale.
  assert.equal(after.doc.widgets[1], before.widgets[1])
})
