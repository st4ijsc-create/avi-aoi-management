// Run: npm run test:runtime   (node --test, no extra package)
//
// Session 2 (HMI-3) — THE HONEST MEASURE OF THE GENERATED SCREEN'S GAP.
//
// ── WHY THIS FILE EXISTS, AND WHY IT COUNTS RATHER THAN ASSERTS ──────────────────────────────────
// `ScreenGenerator` (C#) produces a document that is valid under BOTH contract doors — the .NET
// `ContractInvariants` and, measured below, Milestone 0's real `validate.mjs` over the real schema
// file. Neither of those says anything about whether the screen SHOWS anything, and the measurement
// that follows says it does not:
//
//   * `ModelIntegrity.cs:133-141` requires a component's `tagPrefix` to prefix AT LEAST ONE declared
//     tag path. It does NOT require `tagPrefix + "/" + tagName` to exist — so a component model and a
//     tag namespace can BOTH be valid and integrity-clean while most composed paths name nothing.
//   * `TagValueSource.ts`'s `readPath` answers exactly SEVEN path shapes (`cycles`, `passRate`,
//     `statusText`, `driftState`, `keyMetric`, `code`, and the `telemetry/` prefix). None of them is a
//     composed `{machine}/{component}/{tag}` path — so even a binding naming a path the namespace DOES
//     declare resolves to `undefined` against the only adapter that exists.
//
// A generated screen therefore renders EMPTY on a real kiosk with every mechanical signal green.
// That is the exact defect shape this programme keeps paying for, so it is COUNTED here rather than
// footnoted: the test prints and asserts how many of the generated bindings resolve to `undefined`
// against the real `createMachineDetailSource`. The number is near-total today. It falls on its own
// the day an adapter that answers composed paths lands, and the assertion is written so that a
// SILENT improvement reddens this test instead of passing unnoticed — a gap measurement nobody has to
// re-read is a gap measurement that stops being read.
//
// ── WHERE THE GENERATED DOCUMENT COMES FROM ──────────────────────────────────────────────────────
// `node --test` cannot invoke a C# generator, so this file reads a COMMITTED ARTEFACT:
// `fixtures/generated-scrw-01.json`, which is `ScreenGenerator.Generate()`'s real output for
// `contracts/fixtures/valid/components-screwdrive-cell.json`. A committed artefact of a generator
// becomes a lie the moment the generator moves, so it is not trusted on its own:
// `ScreenGeneratorTests.The_committed_web_fixture_is_still_exactly_what_this_generator_produces`
// regenerates it and compares, and reddens BY NAME the day the two diverge. Both halves are needed;
// neither is sufficient.
//
// ── WHAT THIS FILE DOES NOT MEASURE ──────────────────────────────────────────────────────────────
// It does not render anything. `readBinding` and the widgets live in `.tsx`, which `node --test`
// cannot import (measured across this tree — see `widgetRegistry.test.mjs`'s header), so what is
// exercised here is the exact pair the widgets use: `bindings.ts`'s `resolveBinding` +
// `componentTagPrefixOf`, then `TagValueSource`'s `get`. That the EDITOR calls the generate route at
// all is a claim about a running browser and lives in `tests/44-editor-generate.spec.ts`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { validate } from "../contract-tests/validate.mjs"
import { componentTagPrefixOf, resolveBinding } from "../src/hmi-runtime/bindings.ts"
import { createMachineDetailSource } from "../src/hmi-runtime/TagValueSource.ts"
import { createBlankScreen } from "../src/editor/editorState.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SIM = join(WEB, "..")

const SCHEMA = JSON.parse(readFileSync(join(SIM, "contracts", "hmi-screen.schema.json"), "utf8"))
const GENERATED = JSON.parse(readFileSync(join(HERE, "fixtures", "generated-scrw-01.json"), "utf8"))
const MODEL = JSON.parse(
  readFileSync(join(SIM, "contracts", "fixtures", "valid", "components-screwdrive-cell.json"), "utf8"),
)
const NAMESPACE = JSON.parse(
  readFileSync(join(SIM, "contracts", "fixtures", "valid", "tags-screwdrive-full.json"), "utf8"),
)

/** A `MachineDetail` shaped exactly as `lib/api.ts` declares it, populated so every one of the seven
 * paths `TagValueSource` DOES answer returns a real reading. That is the point: the source below is
 * not starved — it is fully loaded, and the generated bindings still resolve to nothing. A source with
 * no data would make the count below meaningless. */
function loadedMachine() {
  return {
    code: "SCRW-01",
    class: "Automation",
    driverKind: "Simulated",
    statusText: "RUN",
    passRate: 0.97,
    cycles: 42,
    spc: { values: [1, 2, 3], mean: 2, ucl: 3, lcl: 1 },
    telemetry: [{ metric: "torque", values: [4.1, 4.2] }],
    boardPoints: [],
    cycleLog: [{ time: "t0", serial: "S1", verdict: "OK", keyMetric: "Torque=4.2Nm" }],
    driftState: "in-sync",
    plan: null,
  }
}

/** Every binding the generated document declares, resolved the way the runtime resolves it: the
 * `{component}` token replaced by that component's `tagPrefix` from the component model, exactly as
 * `ScreenRenderer` does through `bindings.ts`. */
function resolvedBindings(doc, model) {
  const out = []
  for (const widget of doc.widgets) {
    const prefix = componentTagPrefixOf(model.components, widget.component)
    for (const [key, raw] of Object.entries(widget.bindings ?? {})) {
      out.push({ widget: widget.id, key, raw, path: resolveBinding(raw, prefix) })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE GENERATED DOCUMENT PASSES THE SCHEMA DOOR — the half `ContractInvariants` explicitly is not.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the generated document is VALID under the real schema, through Milestone 0's real validator", () => {
  // `ContractInvariants` says of itself that it is NOT a JSON-Schema validator, so passing it is not
  // passing this. Both doors, or the generator is only known to survive one of them.
  assert.deepEqual(validate(SCHEMA, SCHEMA, GENERATED), [])
})

test("the generated document declares the isa101 theme, and a BLANK screen still declares blueprint", () => {
  // Two entry points, two defaults. Pinned together in ONE test on purpose: the risk is not that
  // either value is wrong today, it is that a later edit makes them the same and nothing notices.
  assert.equal(GENERATED.theme, "isa101")
  assert.equal(createBlankScreen("some-screen").theme, "blueprint")
  assert.notEqual(GENERATED.theme, createBlankScreen("some-screen").theme)
})

test("every kind the generator emitted is one the frozen schema's own enum declares", () => {
  const declared = new Set(SCHEMA.$defs.widget.properties.kind.enum)
  assert.ok(declared.size > 0, "the schema no longer declares $defs.widget.properties.kind.enum")
  for (const w of GENERATED.widgets) {
    assert.ok(declared.has(w.kind), `generated kind "${w.kind}" is not in the frozen enum`)
  }
})

test("no tone the generator emitted is anything but idle — nothing here evaluates a state expression", () => {
  // The INPUT declares `run` and `warn` tones (components-screwdrive-cell.json's `states`), so a
  // generator that copied them would fail here. Guarded, so this is not vacuous.
  const declaredTones = MODEL.types.flatMap((t) => (t.states ?? []).map((s) => s.tone))
  assert.ok(
    declaredTones.some((t) => t !== "idle"),
    "the component fixture no longer declares a non-idle tone — this test would measure nothing",
  )

  let toneMaps = 0
  for (const w of GENERATED.widgets) {
    const tones = w.props?.tones
    if (!tones) continue
    toneMaps++
    for (const [value, tone] of Object.entries(tones)) {
      assert.equal(tone, "idle", `widget ${w.id} claims tone "${tone}" for "${value}" — nothing computes that`)
    }
  }
  assert.ok(toneMaps > 0, "no tone map was emitted at all — the loop above measured nothing")
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2. 🔴 THE FALSIFYING MEASUREMENT. This is the number the session has to report honestly.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("🔴 MEASURED: how many generated bindings resolve to undefined against the real value source", () => {
  const source = createMachineDetailSource(loadedMachine())
  const bindings = resolvedBindings(GENERATED, MODEL)

  // The premise, guarded first. A document with no bindings would make every number below zero and
  // the test would pass while measuring nothing at all.
  assert.ok(bindings.length > 0, "the generated document declares no bindings — nothing to measure")

  const unresolved = bindings.filter((b) => source.get(b.path) === undefined)
  const resolved = bindings.filter((b) => source.get(b.path) !== undefined)

  // Printed, not only asserted: the next person to read this suite's output needs the number itself,
  // not a green tick that a number was in range.
  console.log(
    `\n  generated bindings          : ${bindings.length}` +
      `\n  resolve to a real reading   : ${resolved.length}` +
      `\n  resolve to UNDEFINED        : ${unresolved.length}` +
      `\n  ${unresolved.map((b) => `    ${b.widget}.${b.key} -> ${b.path}`).join("\n  ")}\n`,
  )

  // 🔴 THE HONEST NUMBER, TODAY: all six. Written as an EQUALITY rather than a `>=` so that the day
  // an adapter answers composed paths, this test goes RED and a human has to come and lower it —
  // which is the only way a gap measurement keeps reporting a gap instead of quietly tolerating its
  // own obsolescence. Lowering it is the good outcome; not noticing would not be.
  assert.equal(
    unresolved.length,
    6,
    "the number of unresolvable generated bindings changed. If it went DOWN, an adapter now answers " +
      "composed paths — which is the good outcome, and FOUR PLACES state this count, so lower them " +
      "together or the product starts telling engineers a number that is no longer true:\n" +
      "  1. this assertion;\n" +
      "  2. ScreenGenerator.cs's doc comment (the 'THE MEASUREMENT THIS TYPE MUST NOT BE READ WITHOUT' block);\n" +
      "  3. web/src/i18n/en.ts   -> editor.generate.note   ('6 of 6 generated bindings resolve to nothing');\n" +
      "  4. web/src/i18n/vi.ts   -> editor.generate.note   ('6/6 binding sinh ra phân giải ra rỗng').\n" +
      "🔴 (3) and (4) are the USER-FACING ones: they are rendered beside the generate button in the " +
      "editor, so a stale number there is a false statement to an engineer, not merely a stale comment. " +
      "Nothing but this message ties them to this count. If the number went UP, the generator started " +
      "emitting bindings that name even less — fix the generator, not this number.",
  )
  assert.equal(resolved.length, 0)
})

test("the source is NOT starved — the seven paths it does answer all return readings on this same fixture", () => {
  // 🔴 THE NEGATIVE CONTROL for the measurement above, and without it that measurement means nothing:
  // a source that answered NOTHING would produce the identical count. This shows the source is fully
  // loaded and answering — the generated paths are what it cannot answer.
  const source = createMachineDetailSource(loadedMachine())
  for (const path of ["cycles", "passRate", "statusText", "driftState", "keyMetric", "code", "telemetry/torque"]) {
    assert.notEqual(source.get(path), undefined, `the control path "${path}" answered nothing`)
  }
})

test("the bindings resolve to WELL-FORMED composed paths — they are not malformed, they are unanswered", () => {
  // 🔴 The second half of the same honesty: the failure above is NOT the generator emitting garbage.
  // Every path is exactly `<tagPrefix>/<tag name>`, which is what §3.3's indirect binding means. The
  // gap is a missing adapter, not a missing wire — and a reader who confused the two would go and
  // "fix" the generator.
  const prefixes = new Set(MODEL.components.map((c) => c.tagPrefix))
  for (const b of resolvedBindings(GENERATED, MODEL)) {
    assert.ok(!b.path.includes("{component}"), `${b.widget}.${b.key} left the token unresolved: ${b.path}`)
    assert.ok(
      [...prefixes].some((p) => b.path.startsWith(p + "/")),
      `${b.widget}.${b.key} resolved to "${b.path}", which is under no declared tagPrefix`,
    )
  }
})

test("MEASURED: three of the six composed paths name nothing the tag namespace declares either", () => {
  // The SECOND, independent reason a generated screen is empty — and it is upstream of the adapter,
  // so fixing the adapter would not fix these three. `ModelIntegrity` accepts both documents anyway,
  // because it only requires `tagPrefix` to prefix SOME path.
  const declared = new Set(NAMESPACE.tags.map((t) => t.path))
  const composed = resolvedBindings(GENERATED, MODEL).map((b) => b.path)
  const missing = composed.filter((p) => !declared.has(p)).sort()

  assert.deepEqual(missing, [
    "SCRW-01/ambient/value",
    "SCRW-01/spindle/reset",
    "SCRW-01/spindle/running",
  ])
  // And the control: three of them DO name a declared path, so the namespace is not simply empty.
  assert.equal(composed.filter((p) => declared.has(p)).length, 3)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE MAPPING RULES, AS THEY REACH THE BROWSER.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the setpoint that also carries a hard band arrived as a WRITE widget, not a gauge", () => {
  // The architect's first correction, verified on the artefact the browser would actually receive
  // rather than only inside the generator's own language.
  const w = GENERATED.widgets.find((x) => x.bindings?.value === "{component}/torque-target")
  assert.ok(w, "no widget was generated for torque-target")
  assert.equal(w.kind, "setpoint-input")
  assert.equal(w.policyAction, "machine.setpoint")

  // The negative control on the same document: the plain float with a band next to it IS a gauge, so
  // the rule discriminates rather than turning everything into a write widget.
  const gauge = GENERATED.widgets.find((x) => x.bindings?.value === "{component}/torque")
  assert.equal(gauge.kind, "gauge")
})

test("every write widget carries a policyAction the frozen schema's own enum admits", () => {
  const admitted = new Set(SCHEMA.$defs.widget.properties.policyAction.enum)
  const writeKinds = new Set(SCHEMA.$defs.widget.allOf[0].if.properties.kind.enum)
  let seen = 0
  for (const w of GENERATED.widgets) {
    if (!writeKinds.has(w.kind)) continue
    seen++
    assert.ok(
      admitted.has(w.policyAction),
      `write widget ${w.id} carries policyAction "${w.policyAction}", which the schema does not admit`,
    )
  }
  // 🔴 The control: a document with NO write widget would pass the loop vacuously, and that is exactly
  // the failure mode the architect's first correction described.
  assert.ok(seen > 0, "the generated document contains no write widget at all")
})

test("the bool went to status-lamp, which names its degradation, and not to state-badge, which is silent", () => {
  const w = GENERATED.widgets.find((x) => x.bindings?.state === "{component}/running")
  assert.ok(w, "no widget was generated for the bool tag `running`")
  assert.equal(w.kind, "status-lamp")

  // The control on the same document: the ENUM did take state-badge, so this is a type decision and
  // not a generator that simply never emits one of the two.
  const badge = GENERATED.widgets.find((x) => x.bindings?.state === "{component}/state")
  assert.equal(badge.kind, "state-badge")
})

test("the generated screen id never lands in the machine- panel namespace", () => {
  // `machine-<code>` is the browser-side id of a machine's SHIPPED operator panel
  // (`hmi-runtime/publishedScreen.ts`), the store has no DELETE, and rollback cannot reach a document
  // that was never one of that id's versions. A generated draft must not arrive pre-aimed at one.
  assert.ok(!GENERATED.screenId.startsWith("machine-"), GENERATED.screenId)
  assert.equal(GENERATED.screenId, "generated-scrw-01")
})

test("every widget id is unique — the write door refuses duplicates and React keys children by id", () => {
  const ids = GENERATED.widgets.map((w) => w.id)
  assert.equal(new Set(ids).size, ids.length, `duplicate widget id among ${ids.join(", ")}`)
})
