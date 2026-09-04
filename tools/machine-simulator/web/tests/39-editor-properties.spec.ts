import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-2 Task 10 — the PROPERTY PANEL and the TAG PICKER: the task where an engineer stops needing
 * to know JSON.
 *
 * ── WHAT THIS FILE IS THE ONLY PLACE TO MEASURE ──────────────────────────────────────────────────
 * `runtime-tests/editorState.test.mjs` executes the edit vocabulary directly and proves, against the
 * real `contract-tests/validate.mjs`, that `applyEdit` accepts exactly the `set-kind` /
 * `set-policy-action` / `set-binding` edits whose resulting DOCUMENT the frozen schema accepts —
 * including that a `setpoint-input` or `command-button` with no `policyAction` is refused by both.
 * None of that says a PANEL exists, that its action control has no free-text path, or that changing a
 * binding redraws the canvas. Those are claims about DOM, and a `.tsx` file cannot be `import()`ed
 * under `node --test` (measured repeatedly on this tree — see `widgetRegistry.test.mjs`'s header), so
 * they live here and only here.
 *
 * ── 🔴 THE §5 GATE, AND EXACTLY WHAT IS CLAIMED ABOUT IT ─────────────────────────────────────────
 * The claim this file measures is: **the panel cannot PRODUCE a write widget with no `policyAction`,
 * and `applyEdit` refuses one if the panel is bypassed.** It is measured three ways in the §5 test
 * below — the kind is NOT changed while the action is missing (read off the CANVAS, not off the
 * panel's own select, which would be measuring the panel against itself); the action control is a
 * native `<select>` whose option values equal the frozen schema file's own `policyAction` enum read
 * from disk, with no `<input>` anywhere in that group; and the whole change costs exactly ONE undo
 * step, which is only true if a single edit carried kind and action together — i.e. no intermediate
 * document ever existed in which the widget was a write kind without a gate.
 *
 * 🔴 FIX ROUND 1, task-10-review.md F1 — THE PARAGRAPH THAT STOOD HERE IS RETRACTED, KEPT VERBATIM:
 * *"IT IS NOT A CLAIM ABOUT SAVING. There is no save in the editor at this task (`PUT` is Task 12's),
 * so 'cannot be saved' is not a sentence this file is entitled to."* It confused "the editor has no
 * save BUTTON" with "the property is unmeasurable", while this very file already calls
 * `PUT /v1/screens/{id}` in its own `beforeEach`. The write door is the §5 gate's OUTERMOST layer and
 * it is reachable from here today, so it is pinned — see the test named "🔴 §5's outermost layer",
 * which asserts BOTH halves (a 400 whose body names the widget, the kind and `policyAction`; and a
 * 200 for a twin that differs by nothing but the gate) so a 400 for some unrelated reason cannot pass
 * as this one.
 *
 * Still Task 12's, and still not claimed here: the editor's own save button, and the version/conflict
 * handling around it.
 *
 * ── 🔴 S-6, AND WHAT REMAINS OPEN ────────────────────────────────────────────────────────────────
 * The panel and the picker both DISPLAY a `policyAction`, which could be read as "this action is
 * permitted". Both fail closed on a value outside the screen contract's frozen vocabulary, and the
 * test named "a policyAction the contract does not know is never offered as a valid choice" measures
 * it with the ENGINE'S OWN action string (`machine.command.invoke`) as the probe — a value that is
 * real somewhere else in this system and meaningless here, which is exactly the confusion S-6 exists
 * to stop.
 *
 * What neither surface does is RESOLVE whether an action is permitted; nothing in the web tier can
 * see `Policy/MachineWriteGate.cs`'s vocabulary, and the two sets are disjoint with no translation
 * layer. So S-6 is NOT closed by this task. The panel says so on screen
 * (`editor.panel.policyNotResolved`) and the task report says so in words.
 *
 * ── WHAT THIS FILE DOES NOT MEASURE ──────────────────────────────────────────────────────────────
 * Nothing about pixels: `/editor` still has no visual baseline, for the reason `37-editor-canvas`
 * gives. Nothing about a composed `{component}/leaf` path RESOLVING to a live reading — no
 * `TagValueSource` in this tree can answer one, and the component test below asserts the OPPOSITE
 * (the renderer's own unresolved-`{component}` warning appears), so a future adapter that closes that
 * gap will redden this file rather than slip past it.
 */

const SCREEN_ID = "editor-properties-probe"
const ROUTE = `/editor/${SCREEN_ID}`

/** A fleet machine deliberately NOT the one `35-hmi-indirect-binding` and `37-editor-canvas` use
 * (`IOT-01`), so this file's tag namespace and component tree cannot change what those two measure. */
const MACHINE = "IOT-02"
const COMPONENT_ID = "panel-spindle"

// Sentinels — ASCII, unmistakable, and distinct in every position that matters.
const LABEL_TEXT = "ALPHA-PANEL-LABEL"
const LABEL_TEXT_EDITED = "BRAVO-PANEL-LABEL"
const READOUT_LABEL = "ALPHA-PANEL-READOUT"

/**
 * 🔴 THE S-6 PROBE, AND WHY IT IS THIS STRING AND NOT A RANDOM ONE.
 *
 * `machine.command.invoke` is the **engine's** own action vocabulary
 * (`src/St4i.EngineApi/Policy/MachineWriteGate.cs`), which is DISJOINT from the screen contract's
 * (`machine.setpoint` / `machine.command`) with no translation layer anywhere in this tree — the fact
 * `policyGate`'s doc comment records after it was measured. A panel that showed it as the current,
 * valid selection would be telling an engineer that a real-looking permission is in force. It is
 * stored on the document because the write door accepts it: `ContractInvariants.Validate` checks
 * `policyAction` only for null/whitespace on a writable kind, never against the enum, so
 * `PUT /v1/screens/{id}` takes it. That is a measured property of the write door, not an accident
 * here — the same one `37-editor-canvas.spec.ts` relies on for its `probe-kind` widget.
 */
const ENGINE_VOCABULARY_ACTION = "machine.command.invoke"

/** `web/tests` → `web` → `tools/machine-simulator` → `contracts/hmi-screen.schema.json`. Read from
 * DISK so the vocabularies the panel renders are compared against the frozen schema itself rather
 * than against the module that builds them — a spec that imported `WIDGET_KIND_VALUES` from
 * `editorState.ts` would pass at any vocabulary, which is the one-directional-pin defect this tree
 * has been caught by repeatedly. */
const SCHEMA = JSON.parse(
  readFileSync(
    join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "contracts", "hmi-screen.schema.json"),
    "utf8"
  )
) as {
  $defs: { widget: { properties: { kind: { enum: string[] }; policyAction: { enum: string[] } } } }
}

const SCHEMA_KINDS = SCHEMA.$defs.widget.properties.kind.enum
const SCHEMA_ACTIONS = SCHEMA.$defs.widget.properties.policyAction.enum

type ProbeWidget = {
  id: string
  kind: string
  rect: { col: number; row: number; colSpan: number; rowSpan: number }
  component?: string
  bindings?: Record<string, string>
  props?: Record<string, unknown>
  policyAction?: string
}

type ProbeDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  theme: string
  layout: { cols: number; rows: number; breakpoint: string }
  widgets: ProbeWidget[]
}

const PROBE_DOC: ProbeDocument = {
  schemaVersion: 1,
  screenId: SCREEN_ID,
  title: "Panel probe — thuoc tinh",
  theme: "isa101",
  layout: { cols: 12, rows: 4, breakpoint: "panel" },
  widgets: [
    // The §5 subject: an ordinary read-only widget an engineer turns into a write control.
    {
      id: "panel-label",
      kind: "label",
      rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
      // `tones` is here for the read-only-props rule: an OBJECT prop has no editable control, and the
      // panel has to say so rather than offering a box that cannot round-trip.
      props: { text: LABEL_TEXT, tones: { warn: "amber" } },
    },
    // The binding subject: a bound readout whose value comes through the whole runtime seam, so a
    // changed binding is visible on the canvas as a changed READING rather than as changed markup.
    {
      id: "panel-readout",
      kind: "readout",
      rect: { col: 3, row: 0, colSpan: 3, rowSpan: 1 },
      bindings: { value: "cycles" },
      // `max` is here for the F2 pin (an emptied NUMBER box must not write 0). `widgets/readout.tsx`
      // reads `label`/`labelEn`/`unit`/`valueType` and ignores it, so it changes nothing on screen —
      // it exists to give the panel a numeric prop control to measure.
      props: { label: READOUT_LABEL, max: 500 },
    },
    // The `{component}` subject.
    {
      id: "panel-component",
      kind: "readout",
      rect: { col: 6, row: 0, colSpan: 3, rowSpan: 1 },
      component: COMPONENT_ID,
      bindings: { value: "cycles" },
      props: { label: "COMPONENT-READOUT" },
    },
    // The S-6 subject — see `ENGINE_VOCABULARY_ACTION`.
    {
      id: "panel-gate",
      kind: "command-button",
      rect: { col: 9, row: 0, colSpan: 3, rowSpan: 1 },
      policyAction: ENGINE_VOCABULARY_ACTION,
      props: { label: "GATE-PROBE" },
    },
    // A widget with NO bindings and NO component, for the two "nothing declared yet" states.
    { id: "panel-plain", kind: "sheet", rect: { col: 0, row: 1, colSpan: 4, rowSpan: 1 }, props: { title: "KHUNG" } },
  ],
}

/**
 * The namespace the picker lists. Three tags on purpose:
 *   * one driver-backed read tag,
 *   * one NOT driver-backed (so `isBackedByDriver` is measured in BOTH states from the document, not
 *     asserted against whatever a component happens to default to),
 *   * one writable tag carrying the ENGINE's action string, so the picker's fail-closed rendering has
 *     a subject of its own.
 * Tag paths are a GLOBAL key across every machine (`HmiTagEndpoints.PutAsync`'s 409 branch says so),
 * so they are prefixed with something no other spec in this suite uses.
 */
const TAG_NAMESPACE = {
  schemaVersion: 1,
  machineCode: MACHINE,
  tags: [
    {
      path: "PANELPROBE/inlet-temp",
      dataType: "float",
      unit: "C",
      engMin: 0,
      engMax: 120,
      access: "r",
      source: { kind: "simulated" },
      isBackedByDriver: true,
    },
    {
      path: "PANELPROBE/ghost-tag",
      dataType: "string",
      access: "r",
      source: { kind: "simulated" },
      isBackedByDriver: false,
    },
    {
      path: "PANELPROBE/valve-cmd",
      dataType: "bool",
      access: "rw",
      policyAction: ENGINE_VOCABULARY_ACTION,
      source: { kind: "simulated" },
      isBackedByDriver: true,
    },
  ],
}

const BACKED_TAG = "PANELPROBE/inlet-temp"
const UNBACKED_TAG = "PANELPROBE/ghost-tag"
const WRITABLE_TAG = "PANELPROBE/valve-cmd"

/** The component tree the `{component}/…` half reads. Two tags, so the section is a LIST rather than
 * one row that could be produced by anything. */
const COMPONENT_MODEL = {
  schemaVersion: 1,
  machineCode: MACHINE,
  components: [{ id: COMPONENT_ID, typeId: "panel.spindle", label: "Truc chinh", tagPrefix: "telemetry/temperature" }],
  types: [
    {
      typeId: "panel.spindle",
      label: "Truc",
      tags: [
        { name: "torque", role: "in", dataType: "float" },
        { name: "angle", role: "in", dataType: "float" },
      ],
      states: [],
      defaultFaceplate: "fp.overview.iot",
    },
  ],
}

/**
 * `props.text` on `panel-readout`'s bound value BEFORE anything is edited.
 *
 * Written as a LITERAL, not computed from `EditorCanvas.tsx`'s `DESIGN_TIME_SNAPSHOT`: `cycles` is
 * 128 there and `formatMetric` renders `abs >= 100` with one decimal. Importing the snapshot to
 * derive this would make the assertion pass at ANY value the canvas showed. Same reasoning, and the
 * same duplication, as `37-editor-canvas.spec.ts`'s own `READOUT_VALUE`.
 */
const CYCLES_READING = "128.0"

/** …and what the same readout shows once its binding names `passRate` instead. `passRate` is 0.97 in
 * that snapshot and `formatMetric` renders `abs < 1` with four decimals. */
const PASS_RATE_READING = "0.9700"

/** `shared.ts`'s `NO_DATA`, written out for the same reason. A tag path the design-time source cannot
 * answer produces exactly this. */
const NO_DATA = "—"

/** The widget id every write-door probe document uses — asserted to appear in the engine's own 400,
 * so that refusal cannot be confused with one raised for a different widget or a different rule. */
const WRITE_PROBE_WIDGET_ID = "gate-probe"

/**
 * A one-widget document for the write-door test, parameterised on the write kind and on whether it
 * carries a gate. ONE function builds both halves on purpose: the refused document and the accepted
 * one then differ by `policyAction` and by nothing else, which is what makes the 400/200 pair a
 * differential rather than two unrelated observations.
 */
function writeWidgetDoc(screenId: string, kind: string, policyAction?: string): ProbeDocument {
  const widget: ProbeWidget = {
    id: WRITE_PROBE_WIDGET_ID,
    kind,
    rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    props: { label: "WRITE-DOOR-PROBE" },
  }
  if (policyAction !== undefined) widget.policyAction = policyAction
  return {
    schemaVersion: 1,
    screenId,
    title: "Write door probe",
    theme: "isa101",
    layout: { cols: 12, rows: 4, breakpoint: "panel" },
    widgets: [widget],
  }
}

async function putScreen(request: APIRequestContext, doc: ProbeDocument): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/screens/${doc.screenId}`, { data: doc })
  if (!res.ok()) throw new Error(`PUT /v1/screens/${doc.screenId} failed: ${res.status()} ${await res.text()}`)
}

async function putTags(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/tags/${MACHINE}`, { data: TAG_NAMESPACE })
  if (!res.ok()) throw new Error(`PUT /v1/tags/${MACHINE} failed: ${res.status()} ${await res.text()}`)
}

async function putComponents(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/components/${MACHINE}`, { data: COMPONENT_MODEL })
  if (!res.ok()) throw new Error(`PUT /v1/components/${MACHINE} failed: ${res.status()} ${await res.text()}`)
}

/** The renderer's own cell for a widget — what the OPERATOR would see, and therefore the only honest
 * witness that a panel edit reached the document the canvas draws. */
function renderedCell(page: Page, widgetId: string): Locator {
  return page.locator(`[data-hmi-widget="${widgetId}"]`)
}

/** Opens the editor and selects one widget through the overlay's own hit target — the same control a
 * pointer presses (`38-editor-drag.spec.ts` pins that it selects). */
async function selectWidget(page: Page, widgetId: string): Promise<void> {
  await page.locator(`[data-editor-widget="${widgetId}"]`).click()
  await expect(page.locator("[data-panel-widget-id]")).toHaveText(widgetId)
}

async function openCanvas(page: Page): Promise<void> {
  await page.goto(ROUTE)
  await expect(page.locator(`[data-editor-canvas="${SCREEN_ID}"]`)).toBeVisible()
  await expect(page.locator(`[data-hmi-screen="${SCREEN_ID}"]`)).toBeVisible()
}

/** The `value` attribute of every `<option>` in a select, in DOM order. */
async function optionValues(select: Locator): Promise<string[]> {
  return select.locator("option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value))
}

/** Moves focus off any field so the canvas's window-level `Ctrl+Z` handler is not skipped —
 * `EditorCanvas.tsx`'s `isTextEntry` deliberately leaves the shortcut to an `INPUT`/`SELECT` that has
 * focus, which is correct behaviour and would otherwise make an undo assertion here measure nothing. */
async function blurFields(page: Page): Promise<void> {
  await page.locator("[data-editor-design-mode]").click()
  await expect(page.locator("[data-editor-design-mode]")).toBeVisible()
}

test.describe("HMI screen editor — the property panel and the tag picker", () => {
  test.beforeEach(async ({ request }) => {
    // Every test re-establishes all three documents, so none inherits what an earlier one edited and
    // none depends on file ORDER. The canvas holds its edits in memory only (no save exists yet), so
    // a fresh page load is already a fresh document — the PUTs make that true across re-runs too.
    await putScreen(request, PROBE_DOC)
    await putTags(request)
    await putComponents(request)
  })

  test("selecting a widget opens its properties, and the kind vocabulary is the frozen schema's own", async ({
    page,
  }) => {
    await openCanvas(page)

    // Nothing selected yet: a named empty state, not a blank column.
    await expect(page.locator("[data-property-panel]")).toBeVisible()
    await expect(page.locator("[data-panel-empty]")).toHaveText(viDict.editor.panel.empty)

    await selectWidget(page, "panel-readout")

    // id, kind, rect, component, bindings, props — the six things the brief asks the panel to show.
    await expect(page.locator("[data-panel-widget-id]")).toHaveText("panel-readout")
    await expect(page.locator("[data-panel-kind]")).toHaveValue("readout")
    await expect(page.locator('[data-panel-rect="col"]')).toHaveValue("3")
    await expect(page.locator('[data-panel-rect="row"]')).toHaveValue("0")
    await expect(page.locator('[data-panel-rect="colSpan"]')).toHaveValue("3")
    await expect(page.locator('[data-panel-rect="rowSpan"]')).toHaveValue("1")
    await expect(page.locator("[data-panel-component]")).toHaveText(viDict.editor.panel.componentNone)
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("cycles")
    await expect(page.locator('[data-panel-prop="label"]')).toHaveValue(READOUT_LABEL)

    // 🔴 The kind picker's vocabulary is the FROZEN SCHEMA's, compared against the schema FILE rather
    // than against the module that renders it. A panel offering a kind the schema does not know would
    // build an edit `applyEdit` refuses; one missing a kind the schema does know is an editor that
    // cannot author part of the contract. Both are caught here, by name.
    expect(await optionValues(page.locator("[data-panel-kind]"))).toEqual(SCHEMA_KINDS)
    expect(SCHEMA_KINDS.length, "the schema's kind enum is empty — this comparison would be vacuous").toBe(15)

    // A widget with nothing declared reaches the two named empty states rather than an empty column.
    await selectWidget(page, "panel-plain")
    await expect(page.locator("[data-panel-bindings-empty]")).toHaveText(viDict.editor.panel.bindingsEmpty)
    // …and its `title` prop IS editable, so "empty" above is about bindings and not about a dead panel.
    await expect(page.locator('[data-panel-prop="title"]')).toHaveValue("KHUNG")
  })

  test("🔴 §5: choosing a write kind does NOT change the widget until an action is chosen, and the action can only come from the frozen enum", async ({
    page,
  }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-label")

    // Where it starts, read off the CANVAS: `widgets/label.tsx` drew `props.text`, and there is no
    // button in the cell.
    await expect(renderedCell(page, "panel-label")).toHaveText(LABEL_TEXT)
    await expect(renderedCell(page, "panel-label").locator("button")).toHaveCount(0)
    // The policy group is not even on screen for a `label` that declares no action.
    await expect(page.locator("[data-panel-policy-action]")).toHaveCount(0)

    // The engineer picks a WRITE kind.
    await page.locator("[data-panel-kind]").selectOption("command-button")

    // 🔴 THE GATE. The document is UNCHANGED — measured on the canvas, not on the panel's own select,
    // which is showing the held choice and would be measuring the panel against itself.
    await expect(
      renderedCell(page, "panel-label"),
      "the widget became a write control before any policyAction was chosen"
    ).toHaveText(LABEL_TEXT)
    await expect(renderedCell(page, "panel-label").locator("button")).toHaveCount(0)

    // …and the panel says why, naming the kind.
    await expect(page.locator("[data-panel-policy-required]")).toHaveText(
      viDict.editor.panel.policyRequired({ kind: "command-button" })
    )

    // 🔴 NO FREE-TEXT FIELD. The control is a native `<select>` — which cannot accept typed text at
    // all — and its options are the placeholder plus EXACTLY the frozen schema file's own enum.
    const policy = page.locator("[data-panel-policy-action]")
    expect(await policy.evaluate((el) => el.tagName)).toBe("SELECT")
    expect(await optionValues(policy)).toEqual(["", ...SCHEMA_ACTIONS])
    expect(SCHEMA_ACTIONS, "the schema's policyAction enum moved — this comparison must be re-read").toEqual([
      "machine.setpoint",
      "machine.command",
    ])
    // 🔴 FIX ROUND 1, task-10-review.md F8 — the round-0 selector matched only an `<input>` CARRYING
    // the hook or nested INSIDE it, while the sentence above it claimed "anywhere in the group". A
    // free-text sibling under a different attribute, in the same section, would have passed. Scoped to
    // the SECTION that contains the policy control, which is what the sentence actually says.
    await expect(
      page.locator("[data-property-panel] section:has([data-panel-policy-action]) input"),
      "a text input sits in the same section as the policy control — the action has a free-text path"
    ).toHaveCount(0)

    // Choosing one commits BOTH, in a single edit.
    await policy.selectOption("machine.command")
    await expect(page.locator("[data-panel-kind]")).toHaveValue("command-button")
    await expect(page.locator("[data-panel-policy-action]")).toHaveValue("machine.command")
    // On the canvas: the registry's own `command-button` implementation, and `policyGate` let it
    // through — an ungated one would carry `role="note"` with its refusal sentence instead.
    await expect(renderedCell(page, "panel-label").locator("button")).toHaveCount(1)
    await expect(renderedCell(page, "panel-label").locator("[role=note]")).toHaveCount(0)
    await expect(page.locator("[data-panel-policy-required]")).toHaveCount(0)

    // 🔴 ONE undo step, not two. This is the assertion that the kind and the action travelled in ONE
    // edit: if the panel had applied the kind first and the action second, the first `Ctrl+Z` would
    // land on a `command-button` with no gate — the very document §5 forbids — instead of back on the
    // label.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    await expect(
      renderedCell(page, "panel-label"),
      "one Ctrl+Z did not reach the label — the kind and the action were applied as two separate edits"
    ).toHaveText(LABEL_TEXT)
    await expect(renderedCell(page, "panel-label").locator("button")).toHaveCount(0)
  })

  test("🔴 S-6: a policyAction the screen contract does not know is never offered as a valid choice", async ({
    page,
  }) => {
    await openCanvas(page)

    // The runtime's own gate already fails closed on this document — established FIRST, so "the panel
    // fails closed" is not the only witness and the two postures are shown to agree.
    await expect(renderedCell(page, "panel-gate").locator("[role=note]")).toContainText(ENGINE_VOCABULARY_ACTION)

    await selectWidget(page, "panel-gate")

    // The panel names the offending value and does NOT present it as the current selection.
    await expect(page.locator("[data-panel-policy-unrecognised]")).toHaveText(
      viDict.editor.panel.policyUnrecognised({ value: JSON.stringify(ENGINE_VOCABULARY_ACTION) })
    )
    await expect(
      page.locator("[data-panel-policy-action]"),
      "the panel presented an action outside the contract's vocabulary as the widget's current, valid gate"
    ).toHaveValue("")
    expect(await optionValues(page.locator("[data-panel-policy-action]"))).not.toContain(ENGINE_VOCABULARY_ACTION)
    // …and, because the widget IS a write kind with no RECOGNISED gate, the panel demands one.
    await expect(page.locator("[data-panel-policy-required]")).toBeVisible()

    // The honest limit, on screen: this panel selects, it does not resolve.
    await expect(page.locator("[data-panel-policy-not-resolved]")).toHaveText(viDict.editor.panel.policyNotResolved)

    // Choosing a real action fixes both surfaces at once.
    await page.locator("[data-panel-policy-action]").selectOption("machine.command")
    await expect(page.locator("[data-panel-policy-unrecognised]")).toHaveCount(0)
    await expect(renderedCell(page, "panel-gate").locator("[role=note]")).toHaveCount(0)
  })

  test("changing a binding updates the document and the canvas together, through one history", async ({ page }) => {
    await openCanvas(page)

    // The reading that only exists if the whole runtime seam ran.
    await expect(renderedCell(page, "panel-readout").locator(".hmi-readout-value")).toHaveText(CYCLES_READING)

    await selectWidget(page, "panel-readout")
    await page.locator('[data-panel-binding-path="value"]').fill("passRate")
    await page.locator('[data-panel-binding-path="value"]').press("Enter")

    // BOTH sides of "together": the document (what the panel reads back out of it) and the canvas
    // (what the renderer drew from it) moved on the same edit.
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("passRate")
    await expect(
      renderedCell(page, "panel-readout").locator(".hmi-readout-value"),
      "the canvas kept drawing the old binding's reading after the document changed"
    ).toHaveText(PASS_RATE_READING)

    // One history, shared with the drag layer: `Ctrl+Z` walks this edit back too.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    await expect(renderedCell(page, "panel-readout").locator(".hmi-readout-value")).toHaveText(CYCLES_READING)
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("cycles")

    // Removing the binding entirely leaves the widget drawing its own no-data placeholder rather than
    // a stale number — `readBinding` treats "no such binding" and "unresolved" identically.
    await page.locator('[data-panel-binding-remove="value"]').click()
    await expect(page.locator("[data-panel-bindings-empty]")).toBeVisible()
    await expect(renderedCell(page, "panel-readout").locator(".hmi-readout-value")).toHaveText(NO_DATA)
  })

  test("the tag picker lists a machine's namespace, shows isBackedByDriver in BOTH states, and inserts into the binding being edited", async ({
    page,
  }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-readout")

    // Closed until asked for, and then it asks which machine — a screen document names none.
    await expect(page.locator("[data-tag-picker]")).toHaveCount(0)
    await page.locator('[data-panel-binding-pick="value"]').click()
    await expect(page.locator('[data-tag-picker="value"]')).toBeVisible()
    await expect(page.locator("[data-tag-picker-no-machine]")).toHaveText(viDict.editor.tagPicker.noMachine)

    // 🔴 FIX ROUND 1, task-10-review.md F5 — S-6's disclaimer has to be on screen HERE, in the exact
    // scenario the report leaned on it for. `panel-readout` is a plain `readout`: it declares no
    // action and is not a write kind, so the panel's policy section does not exist — asserted FIRST,
    // otherwise this leg would pass for the wrong reason on a widget that happens to have one.
    await expect(
      page.locator("[data-panel-policy-action]"),
      "panel-readout grew a policy section — this leg no longer measures the case F5 was about"
    ).toHaveCount(0)
    await expect(
      page.locator("[data-tag-picker-not-resolved]"),
      "the picker shows a tag's declared policyAction with nothing on the page saying permission was never resolved"
    ).toHaveText(viDict.editor.panel.policyNotResolved)

    await page.locator("[data-tag-picker-machine]").selectOption(MACHINE)

    // Every declared tag is listed, by path.
    for (const path of [BACKED_TAG, UNBACKED_TAG, WRITABLE_TAG]) {
      await expect(page.locator(`[data-tag-row="${path}"]`)).toBeVisible()
    }

    // 🔴 `isBackedByDriver` is on screen, and it is READ FROM THE DOCUMENT — asserted in both states,
    // so a picker that hardcoded either one is caught. A declared tag with no driver behind it is a
    // perfectly valid declaration that will never answer, which is the whole reason this field is
    // shown at authoring time.
    await expect(page.locator(`[data-tag-row="${BACKED_TAG}"] [data-tag-backed]`)).toHaveAttribute("data-tag-backed", "true")
    await expect(page.locator(`[data-tag-row="${UNBACKED_TAG}"] [data-tag-backed]`)).toHaveAttribute(
      "data-tag-backed",
      "false"
    )
    await expect(page.locator(`[data-tag-row="${BACKED_TAG}"] [data-tag-backed]`)).toContainText(
      viDict.editor.tagPicker.backedYes
    )
    await expect(page.locator(`[data-tag-row="${UNBACKED_TAG}"] [data-tag-backed]`)).toContainText(
      viDict.editor.tagPicker.backedNo
    )

    // S-6 again, on the picker's own surface: the writable tag declares the ENGINE's action string,
    // which is not in the screen contract's vocabulary, so it is named as unrecognised rather than
    // rendered as if it were one of the two real ones.
    await expect(page.locator(`[data-tag-row="${WRITABLE_TAG}"] [data-tag-policy]`)).toHaveAttribute(
      "data-tag-policy",
      "unrecognised"
    )

    // Insert: the path lands in the binding field this picker was opened FOR, and the canvas redraws.
    // The design-time source cannot answer a namespace path, so the honest result on screen is the
    // widget's own no-data placeholder — not a fabricated reading.
    await page.locator(`[data-tag-insert="${BACKED_TAG}"]`).click()
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue(BACKED_TAG)
    await expect(renderedCell(page, "panel-readout").locator(".hmi-readout-value")).toHaveText(NO_DATA)
  })

  test("the tag picker offers {component}/… for a widget that declares a component, and the renderer itself recognises what it inserted", async ({
    page,
  }) => {
    await openCanvas(page)

    // A widget with NO component gets the named "nothing to compose" state, so the section below is
    // not simply always present.
    await selectWidget(page, "panel-readout")
    await page.locator('[data-panel-binding-pick="value"]').click()
    await expect(page.locator("[data-tag-picker-component-none]")).toHaveText(
      viDict.editor.tagPicker.componentNoneOnWidget
    )

    // The widget that DOES declare one.
    await selectWidget(page, "panel-component")
    await page.locator('[data-panel-binding-pick="value"]').click()
    await page.locator("[data-tag-picker-machine]").selectOption(MACHINE)

    // Both tags the component's TYPE declares are offered — a list, not one row.
    await expect(page.locator("[data-tag-picker-component-list] li")).toHaveCount(2)
    await expect(page.locator('[data-tag-component-insert="torque"]')).toBeVisible()
    await expect(page.locator('[data-tag-component-insert="angle"]')).toBeVisible()

    await page.locator('[data-tag-component-insert="torque"]').click()
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("{component}/torque")

    // 🔴 THE DIFFERENTIAL THAT MAKES THIS MORE THAN A STRING COMPARISON. The renderer has its own
    // reader for the token (`hmi-runtime/bindings.ts`'s `unresolvedComponentBindingWarning`), and it
    // now warns about THIS widget in the cell's `title`. That is the runtime agreeing the inserted
    // string really is a `{component}` binding — a picker that spelled the token differently would
    // insert a plain path and produce no warning at all.
    await expect(renderedCell(page, "panel-component")).toHaveAttribute("title", /\{component\}/)
    await expect(renderedCell(page, "panel-component")).toHaveAttribute("title", /panel-component/)

    // 🔴 AND THE LIMIT, MEASURED RATHER THAN PROMISED: no `TagValueSource` in this tree answers a
    // composed path, so the cell shows its named placeholder. The picker says so on screen; if a
    // future adapter closes that gap this assertion reddens, which is the point.
    await expect(
      renderedCell(page, "panel-component").locator(".hmi-readout-value"),
      // 🔴 FIX ROUND 1, task-10-review.md F7 — this is the one INVERSION in the file, and round 0 left
      // it with the default message, so a future engineer would read "Expected — / Received 31.4" as a
      // regression and try to restore the placeholder.
      "a composed {component}/leaf path now RESOLVES to a reading. That is a FEATURE landing, not a " +
        "regression: some TagValueSource has learned to answer a composed path. Do not 'fix' this back " +
        "— update this assertion to the value the new adapter produces, and retire " +
        "editor.tagPicker.componentNote (the on-screen sentence saying it cannot resolve) in the " +
        "same commit, or the picker will start lying to engineers."
    ).toHaveText(NO_DATA)
    await expect(page.locator("[data-tag-picker-component-note]")).toHaveText(viDict.editor.tagPicker.componentNote)
  })

  test("the rect and prop fields edit the same document the canvas draws, and a prop the panel cannot round-trip is shown read-only", async ({
    page,
  }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-label")

    // A prop edit reaches `widgets/label.tsx`'s own output.
    await page.locator('[data-panel-prop="text"]').fill(LABEL_TEXT_EDITED)
    await page.locator('[data-panel-prop="text"]').press("Enter")
    await expect(renderedCell(page, "panel-label")).toHaveText(LABEL_TEXT_EDITED)

    // An OBJECT prop has no editable control — `set-prop` would need a JSON editor this task does not
    // build — so it is shown as a value rather than as a box that cannot save what is typed in it.
    await expect(page.locator('[data-panel-prop="tones"]')).toHaveCount(0)
    await expect(page.locator('[data-panel-prop-readonly="tones"]')).toHaveText('{"warn":"amber"}')

    // A rect edit moves the widget on the renderer's own grid lines (`ScreenRenderer`'s 1-based
    // translation of the document's 0-based rect: col 5 ⇒ grid-column-start 6).
    await page.locator('[data-panel-rect="col"]').fill("5")
    await page.locator('[data-panel-rect="col"]').press("Enter")
    await expect(renderedCell(page, "panel-label")).toHaveCSS("grid-column-start", "6")
    await page.locator('[data-panel-rect="rowSpan"]').fill("2")
    await page.locator('[data-panel-rect="rowSpan"]').press("Enter")
    await expect(renderedCell(page, "panel-label")).toHaveCSS("grid-row-end", "span 2")

    // Three edits, three undo steps — the panel pushed one per COMMITTED field, not one per keystroke.
    // `Ctrl+Z` walking exactly three times back to the original is what measures that.
    await blurFields(page)
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+z")
    await expect(renderedCell(page, "panel-label")).toHaveText(LABEL_TEXT)
    await expect(renderedCell(page, "panel-label")).toHaveCSS("grid-column-start", "1")
  })

  /**
   * 🔴 FIX ROUND 1, task-10-review.md F1 — §5's OUTERMOST LAYER.
   *
   * The three layers this file already pins live in the browser: the panel's hold, `applyEdit`'s
   * `policy-action-required`, and `widgetRefusal`'s mirror. This is the fourth and the last one an
   * ungated widget would have to get past to become a stored document, and it is a different
   * mechanism in a different language — `ContractInvariants.Validate(HmiScreenDocument)`, called by
   * `HmiScreenStore.PutAsync` before anything is written.
   *
   * BOTH HALVES, and they are a differential rather than two observations: the refused document and
   * the accepted one are built by the SAME function and differ by `policyAction` alone. A 400 for a
   * malformed rect, a bad screenId or an unparseable body could not pass as this one, because the twin
   * carrying every one of those same fields gets a 200.
   *
   * The 400's BODY is asserted too, on three tokens — the widget id, the kind, and the field name — so
   * "some 400 happened" is not what makes this green.
   */
  test("🔴 §5's outermost layer: the write door REFUSES an ungated write widget and ACCEPTS its gated twin", async ({
    request,
  }) => {
    for (const [kind, action] of [
      ["command-button", "machine.command"],
      ["setpoint-input", "machine.setpoint"],
    ] as const) {
      const ungatedId = `editor-properties-nogate-${kind}`
      const gatedId = `editor-properties-gated-${kind}`

      const refused = await request.put(`${ENGINE_URL}/v1/screens/${ungatedId}`, {
        data: writeWidgetDoc(ungatedId, kind),
      })
      expect(
        refused.status(),
        `the write door STORED a "${kind}" widget with no policyAction — invariant §5's outermost layer is open`
      ).toBe(400)
      const body = await refused.text()
      for (const token of [WRITE_PROBE_WIDGET_ID, kind, "policyAction"]) {
        expect(
          body,
          `the 400 does not name "${token}", so it cannot be told apart from a 400 for some other reason: ${body}`
        ).toContain(token)
      }

      // The twin: identical but for the gate. Without this half, a door that refused EVERY document
      // would look exactly like a door that enforces §5.
      const accepted = await request.put(`${ENGINE_URL}/v1/screens/${gatedId}`, {
        data: writeWidgetDoc(gatedId, kind, action),
      })
      expect(
        accepted.status(),
        `the write door refused a GATED "${kind}" widget too, so the 400 above measures nothing about §5: ${await accepted.text()}`
      ).toBe(200)
    }
  })

  /**
   * 🔴 FIX ROUND 1, task-10-review.md F2 — `Number("") === 0`, and `0` is an integer.
   *
   * Round 0's `commitRect` carried a comment saying an emptied box "keeps what it had until it says
   * something legal". The reviewer measured the opposite: clearing the Column box wrote `col: 0` and
   * moved the widget, with no refusal shown, and a `max: 500` prop became `0`. The comment is gone and
   * the behaviour is fixed; this is the pin that keeps it fixed.
   *
   * The last leg is a CONTROL: a real number still commits. Without it, a field that had simply
   * stopped working would satisfy everything above.
   */
  test("an emptied number box writes nothing and snaps back to the committed value", async ({ page }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-readout")
    // col 3 ⇒ grid-column-start 4. Deliberately not a widget at col 0, where writing 0 would be
    // invisible and this test would pass by measuring nothing.
    await expect(renderedCell(page, "panel-readout")).toHaveCSS("grid-column-start", "4")

    const col = page.locator('[data-panel-rect="col"]')
    await col.fill("")
    await col.press("Enter")
    await expect(
      renderedCell(page, "panel-readout"),
      "an emptied Column box wrote col: 0 and moved the widget"
    ).toHaveCSS("grid-column-start", "4")
    await expect(col, "the box kept a value the document does not carry").toHaveValue("3")

    const max = page.locator('[data-panel-prop="max"]')
    await expect(max).toHaveValue("500")
    await max.fill("")
    await max.press("Enter")
    await expect(max, "an emptied number prop box wrote 0 over an authored value").toHaveValue("500")

    // CONTROL — the field is refusing a blank, not simply dead.
    await col.fill("5")
    await col.press("Enter")
    await expect(renderedCell(page, "panel-readout")).toHaveCSS("grid-column-start", "6")
  })

  /**
   * 🔴 FIX ROUND 1, task-10-review.md F3 — a button labelled "Add" must not delete.
   *
   * Measured by the reviewer: typing the name of an EXISTING binding and pressing Add wiped that
   * binding's authored path to `""`, with no warning. The ruling taken is EDIT, NOT CREATE — the
   * existing row is opened for editing and its path is left exactly as authored, with a named notice
   * saying which of the two things happened.
   */
  test("adding a binding whose name already exists opens that binding instead of wiping its path", async ({
    page,
  }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-readout")
    await expect(page.locator('[data-panel-binding-path="value"]')).toHaveValue("cycles")
    await expect(renderedCell(page, "panel-readout").locator(".hmi-readout-value")).toHaveText(CYCLES_READING)

    await page.locator("[data-panel-binding-new-name]").fill("value")
    await page.locator("[data-panel-binding-add]").click()

    // The authored path survives — on BOTH sides, the document (what the panel reads back) and the
    // canvas (what the renderer drew). A wipe to "" would show as the widget's no-data placeholder.
    await expect(
      page.locator('[data-panel-binding-path="value"]'),
      '"Add binding" destroyed an authored binding path'
    ).toHaveValue("cycles")
    await expect(
      renderedCell(page, "panel-readout").locator(".hmi-readout-value"),
      '"Add binding" destroyed an authored binding path — the canvas lost its reading'
    ).toHaveText(CYCLES_READING)

    // …and the engineer is TOLD which of the two things happened, rather than being left to notice.
    await expect(page.locator("[data-panel-binding-duplicate]")).toHaveText(
      viDict.editor.panel.bindingDuplicate({ name: "value" })
    )
    // No second row was created, and the picker opened on the row that already existed.
    await expect(page.locator("[data-panel-binding-row='value']")).toHaveCount(1)
    await expect(page.locator('[data-tag-picker="value"]')).toBeVisible()
  })

  test("a binding created from the panel is a real, named field the picker can fill in", async ({ page }) => {
    await openCanvas(page)
    await selectWidget(page, "panel-plain")
    await expect(page.locator("[data-panel-bindings-empty]")).toBeVisible()

    await page.locator("[data-panel-binding-new-name]").fill("state")
    await page.locator("[data-panel-binding-add]").click()

    // The row exists, empty, with its picker already open on it — the field it will fill in has to
    // exist before there is anywhere to insert a path.
    await expect(page.locator('[data-panel-binding-row="state"]')).toBeVisible()
    await expect(page.locator('[data-panel-binding-path="state"]')).toHaveValue("")
    await expect(page.locator('[data-tag-picker="state"]')).toBeVisible()

    await page.locator("[data-tag-picker-machine]").selectOption(MACHINE)
    await page.locator(`[data-tag-insert="${WRITABLE_TAG}"]`).click()
    await expect(page.locator('[data-panel-binding-path="state"]')).toHaveValue(WRITABLE_TAG)
    await expect(page.locator("[data-panel-bindings-empty]")).toHaveCount(0)
  })
})
