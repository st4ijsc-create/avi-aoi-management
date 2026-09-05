// Run: npm run test:runtime   (node --test, no extra package)
//
// Session 3 (WS-HMI-4) — THE ISA-101 LINTER'S PINS.
//
// ── THE RULE THIS FILE IS BUILT AROUND ───────────────────────────────────────────────────────────
// A rule that cannot fail is worse than a missing rule: it reports safety that was never measured.
// So EVERY one of the eight rules gets BOTH halves, and neither is optional:
//
//   * a FALSIFICATION — a document that violates it, asserted to produce that rule's finding at that
//     rule's severity. Without this, a rule could be dead code and nothing would say so.
//   * a NEGATIVE CONTROL — a document that does NOT violate it, asserted to produce NO finding for
//     that rule. Without this, a linter that flagged EVERY document would pass every falsification
//     and be worthless.
//
// The two together are what make the suite falsifiable in both directions. A separate test below
// closes the last hole in that scheme: it asserts every `Isa101RuleId` the module declares is
// exercised by BOTH halves here, so adding a ninth rule without pinning it reddens by name rather
// than passing unnoticed.
//
// ── WHAT IS EXECUTED VS READ AS TEXT, AND WHY THE SPLIT ──────────────────────────────────────────
// `isa101Linter.ts` is plain `.ts` with no JSX and no imports of anything that carries JSX or JSON,
// so it is `import()`-ed and EXECUTED here — the pins measure real behaviour. (That property is why
// `BREAKPOINT_WIDTH_PX` is declared locally in that module rather than imported from
// `lib/hmiScreens.ts`: that file imports a `.json`, which Node's ESM loader refuses without an import
// attribute. See its doc comment.)
//
// The three constants that MIRROR another file are pinned by reading that file as TEXT — the same
// technique, and the same reason, as `chartTokens.test.mjs`, `widgetRegistry.test.mjs`'s
// `readRegisteredKinds` and `contracts.test.mjs`'s `tsUnionMembers`: a mirror pinned by a promise is
// the defect `chartTokens.test.mjs`'s header records this repository already paying for.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  BREAKPOINT_WIDTH_PX,
  KNOWN_TONE_WORDS,
  MAX_NON_STATUS_COLOURS,
  MIN_TOUCH_TARGET_PX,
  TOUCH_TARGET_GRID_GAP_PX,
  lintScreen,
  normaliseForEstop,
  widgetWidthPx,
} from "../src/editor/isa101Linter.ts"
import { KIND_FACTS } from "../src/hmi-runtime/widgetKindFacts.ts"
import { validate } from "../contract-tests/validate.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SIM = join(WEB, "..")

const SCHEMA = JSON.parse(
  readFileSync(join(SIM, "contracts", "hmi-screen.schema.json"), "utf8")
)

/** Every rule id the module can emit. Kept here as a LITERAL rather than imported, so the coverage
 * test below compares two independently-authored sets rather than a constant against itself. */
const ALL_RULE_IDS = [
  "status-colour-as-decoration",
  "numeric-widget-without-unit-or-range",
  "widget-impersonates-emergency-stop",
  "contrast-below-aa",
  "touch-target-below-44px",
  "too-many-non-status-colours",
  "no-route-to-alarm-state",
  "quality-never-displayed",
]

/** Records which rules got a falsification and which got a negative control, so the coverage test at
 * the bottom can prove BOTH halves exist for all eight. Populated by the helpers below. */
const falsified = new Set()
const controlled = new Set()

function findingsFor(doc, rule) {
  return lintScreen(doc).findings.filter((f) => f.rule === rule)
}

/** Asserts `doc` VIOLATES `rule` at `severity`, and records the falsification. */
function expectViolates(doc, rule, severity) {
  const hits = findingsFor(doc, rule)
  assert.ok(
    hits.length > 0,
    `expected rule "${rule}" to fire on this document but it did not. ` +
      `A rule that cannot fail reports safety nobody measured. Findings were: ` +
      JSON.stringify(lintScreen(doc).findings.map((f) => f.rule))
  )
  for (const hit of hits) assert.equal(hit.severity, severity, `rule "${rule}" fired at the wrong severity`)
  falsified.add(rule)
  return hits
}

/** Asserts `doc` does NOT violate `rule`, and records the negative control. */
function expectClean(doc, rule) {
  const hits = findingsFor(doc, rule)
  assert.deepEqual(
    hits.map((f) => f.detail),
    [],
    `NEGATIVE CONTROL FAILED: rule "${rule}" fired on a document that complies with it. ` +
      `A linter that flags everything passes every falsification and is worthless.`
  )
  controlled.add(rule)
}

/** A minimal, schema-valid, doctrine-clean screen. Every fixture below is a SMALL EDIT of this, so a
 * falsification differs from its own control by exactly the thing under test — not by ten things. */
function baseDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    screenId: "lint-base",
    title: "Cơ sở",
    theme: "isa101",
    layout: { cols: 12, rows: 8, breakpoint: "panel" },
    widgets: [],
    ...overrides,
  }
}

/** Every fixture this file builds must be a document the FROZEN SCHEMA accepts. Otherwise a
 * "violation" could be an artefact of a malformed document rather than of the rule, and a finding
 * about a document nobody could ever author proves nothing about the product. */
function assertSchemaValid(doc, label) {
  const errs = validate(SCHEMA, SCHEMA, doc)
  assert.deepEqual(
    errs,
    [],
    `fixture "${label}" is not valid against the frozen schema, so any finding it produces is ` +
      `untrustworthy: ${JSON.stringify(errs)}`
  )
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE SPRINT-DECIDING CHECK — THE GENERATOR'S OWN OUTPUT MUST PASS CLEAN
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("🔴 CROSS-SESSION: the S2 generator's own output produces NO error finding — publish is not blocked", () => {
  const generated = JSON.parse(
    readFileSync(join(HERE, "fixtures", "generated-scrw-01.json"), "utf8")
  )
  const report = lintScreen(generated)
  const errors = report.findings.filter((f) => f.severity === "error")
  assert.deepEqual(
    errors.map((f) => `${f.rule}@${f.widgetId ?? "screen"}: ${f.detail}`),
    [],
    "The ISA-101 linter blocks the generator's own output. Per the controller's cross-session ruling " +
      "one of the two sessions is then WRONG and it must be arbitrated — NOT relaxed away."
  )
  assert.equal(report.blocksPublish, false)
})

test("🔴 CROSS-SESSION: the generator's all-`idle` tone map is NOT penalised as decoration", () => {
  const generated = JSON.parse(
    readFileSync(join(HERE, "fixtures", "generated-scrw-01.json"), "utf8")
  )
  // The document really does carry an all-`idle` map — if this stops being true the test below is
  // measuring nothing, so it is asserted rather than assumed.
  const badge = generated.widgets.find((w) => w.id === "spindle-state")
  assert.ok(badge, "fixture no longer has the state-badge this ruling is about")
  const tones = Object.values(badge.props.tones)
  assert.ok(tones.length >= 2, "fixture's tone map got too small to be a meaningful constant map")
  assert.deepEqual([...new Set(tones)], ["idle"], "fixture is no longer all-`idle`")

  expectClean(generated, "status-colour-as-decoration")
})

test("the generator's output is still a document the frozen schema accepts (guards the fixture itself)", () => {
  const generated = JSON.parse(
    readFileSync(join(HERE, "fixtures", "generated-scrw-01.json"), "utf8")
  )
  assertSchemaValid(generated, "generated-scrw-01.json")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R1 — STATUS COLOUR USED AS DECORATION (error)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R1 falsification (a): a status-colour tone map with NO binding to index it", () => {
  const doc = baseDoc({
    screenId: "r1-unbound",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        // no `bindings` at all — the map can never be indexed
        props: { tones: { running: "run", faulted: "fault" } },
      },
    ],
  })
  assertSchemaValid(doc, "r1-unbound")
  const [hit] = expectViolates(doc, "status-colour-as-decoration", "error")
  assert.match(hit.detail, /no "state"\/"value" binding/)
  assert.equal(lintScreen(doc).blocksPublish, true)
})

test("R1 falsification (b): a CONSTANT status-colour map — every state the same colour", () => {
  const doc = baseDoc({
    screenId: "r1-constant",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "run", stopped: "run", faulted: "run" } },
      },
    ],
  })
  assertSchemaValid(doc, "r1-constant")
  const [hit] = expectViolates(doc, "status-colour-as-decoration", "error")
  // Fix round 1: the message now names HOW MANY states share the colour and WHICH they are, because
  // that is the measured quantity — "constant" was a verdict, this is the evidence for it.
  assert.match(hit.detail, /3 states/)
  assert.match(hit.detail, /SAME single status colour "run"/)
  // The reachability limit must reach the engineer, not just this file's doc comment (review H1).
  assert.match(hit.detail, /NOT MEASURED: whether the states above can actually occur/)
})

/** Builds a one-`state-badge` screen with the given tone map and a real `state` binding — the shape
 * every H1 case below shares, so each case differs from its neighbours by the tone map ALONE. */
function badgeDoc(screenId, tones) {
  return baseDoc({
    screenId,
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones },
      },
    ],
  })
}

test("🔴 R1 falsification (b1): a NEUTRAL padding entry does not buy a pass — fix round 1, review H1", () => {
  // Round 0 asked whether the WHOLE map was constant, so one `neutral` entry made `distinct.size` 2
  // and the rule went silent on three permanently-green states. The reviewer published exactly this
  // and got `blocksPublish: false`.
  const doc = badgeDoc("r1-pad-neutral", {
    running: "run",
    stopped: "run",
    faulted: "run",
    __pad: "neutral",
  })
  assertSchemaValid(doc, "r1-pad-neutral")
  const [hit] = expectViolates(doc, "status-colour-as-decoration", "error")
  assert.match(hit.detail, /3 states/)
  assert.match(hit.detail, /1 neutral entry/, "the finding must account for the padding it ignored")
  assert.equal(lintScreen(doc).blocksPublish, true)
})

test("🔴 R1 falsification (b2): an `idle` padding entry does not buy a pass either", () => {
  const doc = badgeDoc("r1-pad-idle", {
    running: "run",
    stopped: "run",
    faulted: "run",
    off: "idle",
  })
  assertSchemaValid(doc, "r1-pad-idle")
  expectViolates(doc, "status-colour-as-decoration", "error")
})

test("🔴 R1 falsification (b3): four states all `fault` beside one `idle` — the third H1 shape", () => {
  const doc = badgeDoc("r1-all-fault", { a: "fault", b: "fault", c: "fault", d: "idle" })
  assertSchemaValid(doc, "r1-all-fault")
  const [hit] = expectViolates(doc, "status-colour-as-decoration", "error")
  assert.match(hit.detail, /"fault"/, "the finding must name the colour that is constant")
})

test("🔴 R1 NEGATIVE CONTROL for the H1 fix: ONE state coloured beside a neutral is MEANING, not decoration", () => {
  // 🔴 THE BOUNDARY CASE, and the reason the rule counts `>= 2` rather than `>= 1`. The reviewer
  // named this exact map as the most natural two-entry map an author writes, and it is genuinely
  // covarying: green marks exactly one of two states and grey the other. A fix that reddened this
  // would have "closed" H1 by failing everything, which is the failure this suite's negative controls
  // exist to catch.
  const doc = badgeDoc("r1-one-state", { running: "run", off: "idle" })
  assertSchemaValid(doc, "r1-one-state")
  expectClean(doc, "status-colour-as-decoration")

  // ...and adding a SECOND state to the green side flips it, so the boundary is measured from both
  // sides rather than asserted from one.
  const twoGreen = badgeDoc("r1-two-state", { running: "run", stopped: "run", off: "idle" })
  assert.ok(
    findingsFor(twoGreen, "status-colour-as-decoration").length > 0,
    "green stops being informative the moment a second state shares it — that transition is the rule"
  )
})

test("🔴 R1 NEGATIVE CONTROL: two DIFFERENT status colours stay clean however few the entries", () => {
  const doc = badgeDoc("r1-two-hues", { running: "run", hot: "warn" })
  assertSchemaValid(doc, "r1-two-hues")
  expectClean(doc, "status-colour-as-decoration")
})

test("🔴 R1: the reviewer's own attack document, verbatim, is now BLOCKED", () => {
  // Copied from s3-review.md §H1 rather than reconstructed, so this pins the exact artefact that was
  // demonstrated passing. Both badges are permanently coloured; both must be named.
  const attack = {
    schemaVersion: 1,
    screenId: "decor-demo",
    title: "Decorative colour demo",
    theme: "isa101",
    layout: { breakpoint: "panel", cols: 12, rows: 8 },
    widgets: [
      {
        id: "alarms",
        kind: "alarm-banner",
        rect: { col: 0, row: 0, colSpan: 12, rowSpan: 1 },
        bindings: { value: "sim.alarm" },
        props: {},
      },
      {
        id: "deco",
        kind: "state-badge",
        rect: { col: 0, row: 1, colSpan: 6, rowSpan: 2 },
        bindings: { state: "sim.state" },
        props: { tones: { running: "run", stopped: "run", faulted: "run", __pad: "neutral" } },
      },
      {
        id: "deco2",
        kind: "line-state",
        rect: { col: 6, row: 1, colSpan: 6, rowSpan: 2 },
        bindings: { state: "sim.line" },
        props: { tones: { EXECUTE: "run", HOLDING: "run", ABORTED: "run", __pad: "idle" } },
      },
    ],
  }
  assertSchemaValid(attack, "reviewer H1 attack document")
  const report = lintScreen(attack)
  assert.equal(report.blocksPublish, true, "the H1 bypass is back")
  assert.deepEqual(
    report.findings
      .filter((f) => f.rule === "status-colour-as-decoration")
      .map((f) => f.widgetId)
      .sort(),
    ["deco", "deco2"],
    "both decorative widgets must be named, not just the first"
  )
})

test("R1 NEGATIVE CONTROL: a bound map whose colour VARIES with state is clean", () => {
  const doc = baseDoc({
    screenId: "r1-ok",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "run", stopped: "idle", faulted: "fault" } },
      },
    ],
  })
  assertSchemaValid(doc, "r1-ok")
  expectClean(doc, "status-colour-as-decoration")
})

test("R1 NEGATIVE CONTROL: an UNBOUND all-`idle` map is clean too — the ruling, isolated from the generator", () => {
  // Deliberately the (a) shape (no binding) with idle tones, so this proves the exemption is about the
  // TONE being non-status rather than about the generator's documents happening to be bound.
  const doc = baseDoc({
    screenId: "r1-idle",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        props: { tones: { running: "idle", stopped: "idle", faulted: "idle" } },
      },
    ],
  })
  assertSchemaValid(doc, "r1-idle")
  expectClean(doc, "status-colour-as-decoration")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R2 — NUMERIC WIDGET WITHOUT UNIT OR ENGINEERING RANGE (error)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R2 falsification (unit): a numeric readout with no props.unit AND no binding to supply one", () => {
  const doc = baseDoc({
    screenId: "r2-nounit",
    widgets: [
      {
        id: "figure",
        kind: "readout",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        props: { label: "Số" },
      },
    ],
  })
  assertSchemaValid(doc, "r2-nounit")
  const [hit] = expectViolates(doc, "numeric-widget-without-unit-or-range", "error")
  assert.match(hit.detail, /neither props\.unit nor a value\/series binding/)
})

test("R2 falsification (range): a gauge with no min/max — the invented 0..100 scale", () => {
  const doc = baseDoc({
    screenId: "r2-norange",
    widgets: [
      {
        id: "g",
        kind: "gauge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { value: "SCRW-01/spindle/torque" },
        props: { label: "Mô-men", unit: "Nm" },
      },
    ],
  })
  assertSchemaValid(doc, "r2-norange")
  const [hit] = expectViolates(doc, "numeric-widget-without-unit-or-range", "error")
  assert.match(hit.detail, /invented 0\.\.100/)
})

test("R2 falsification (range): an inverted band (max <= min) is not a range either", () => {
  const doc = baseDoc({
    screenId: "r2-inverted",
    widgets: [
      {
        id: "g",
        kind: "gauge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { value: "SCRW-01/spindle/torque" },
        props: { label: "Mô-men", unit: "Nm", min: 20, max: 5 },
      },
    ],
  })
  assertSchemaValid(doc, "r2-inverted")
  expectViolates(doc, "numeric-widget-without-unit-or-range", "error")
})

test("🔴 R2 falsification (range, setpoint-input): the OTHER range branch and its own message — fix round 1, review M1", () => {
  // 🔴 Round 0's only `setpoint-input` declared min AND max, so this branch never ran: disabling the
  // whole range check reddened only the two GAUGE tests. The branch was live (it fires on both frozen
  // fixtures) but its MESSAGE was pinned by nothing — and that message is the one this session
  // rewrote after measuring that `setpoint-input.tsx` reads neither prop. A regression reverting it to
  // gauge's "invented 0..100" wording — the exact defect that was caught mid-flight — would have
  // passed. It no longer can.
  const doc = baseDoc({
    screenId: "r2-sp-norange",
    widgets: [
      {
        id: "sp",
        kind: "setpoint-input",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        policyAction: "machine.setpoint",
        bindings: { value: "SCRW-01/spindle/torque-target" },
        props: { label: "Đích", unit: "Nm" },
      },
    ],
  })
  assertSchemaValid(doc, "r2-sp-norange")
  const [hit] = expectViolates(doc, "numeric-widget-without-unit-or-range", "error")
  // The two range branches must not share a message: gauge's reason is FALSE of this widget.
  assert.match(hit.detail, /setpoint-input has no engineering range/)
  assert.match(hit.detail, /reads neither prop/, "the measured fact must be in the message")
  assert.match(hit.detail, /WRITE path/)
  assert.doesNotMatch(
    hit.detail,
    /invented 0\.\.100/,
    "this is gauge's reasoning and it is untrue of setpoint-input — the correction must not regress"
  )
})

test("🔴 R2: the two range branches carry DIFFERENT messages, compared side by side", () => {
  // The distinction is the whole point of M1's fix, so it is asserted directly rather than inferred
  // from two separate tests passing.
  const gauge = baseDoc({
    screenId: "r2-cmp-g",
    widgets: [
      {
        id: "g",
        kind: "gauge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { value: "SCRW-01/spindle/torque" },
        props: { label: "G", unit: "Nm" },
      },
    ],
  })
  const setpoint = baseDoc({
    screenId: "r2-cmp-s",
    widgets: [
      {
        id: "s",
        kind: "setpoint-input",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        policyAction: "machine.setpoint",
        bindings: { value: "SCRW-01/spindle/torque-target" },
        props: { label: "S", unit: "Nm" },
      },
    ],
  })
  const gDetail = findingsFor(gauge, "numeric-widget-without-unit-or-range")[0].detail
  const sDetail = findingsFor(setpoint, "numeric-widget-without-unit-or-range")[0].detail
  assert.notEqual(gDetail, sDetail, "the two range branches must not report the same reason")
  assert.match(gDetail, /invented 0\.\.100/)
  assert.match(sDetail, /reads neither prop/)
})

test("R2 NEGATIVE CONTROL: a fully declared gauge is clean", () => {
  const doc = baseDoc({
    screenId: "r2-ok",
    widgets: [
      {
        id: "g",
        kind: "gauge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { value: "SCRW-01/spindle/torque" },
        props: { label: "Mô-men", unit: "Nm", min: 0, max: 20 },
      },
    ],
  })
  assertSchemaValid(doc, "r2-ok")
  expectClean(doc, "numeric-widget-without-unit-or-range")
})

test("R2 NEGATIVE CONTROL: a readout with NO props.unit but a real binding is clean — the tag supplies the unit", () => {
  // 🔴 This is the shape of the FROZEN, SHIPPED fixture `screen-screwdrive-full.json`'s "torque"
  // widget, and the reason this rule is not the one-liner it looks like: `readout.tsx:23` reads
  // `typeof p.unit === "string" ? p.unit : tv?.unit`. A naive rule reddens a document this repository
  // committed as valid, and the only cure would be relaxing the rule until it measured nothing.
  const doc = baseDoc({
    screenId: "r2-tagunit",
    widgets: [
      {
        id: "torque",
        kind: "readout",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        component: "spindle",
        bindings: { value: "{component}/torque" },
        props: { label: "Mô-men", labelEn: "TORQUE" },
      },
    ],
  })
  assertSchemaValid(doc, "r2-tagunit")
  expectClean(doc, "numeric-widget-without-unit-or-range")
})

test("R2 NEGATIVE CONTROL: a status-lamp is NOT a numeric widget and is never asked for a unit", () => {
  // The generator explicitly `props.Remove("unit")`s for bool/enum widgets. Demanding a unit here
  // would penalise it for being correct.
  const doc = baseDoc({
    screenId: "r2-lamp",
    widgets: [
      {
        id: "lamp",
        kind: "status-lamp",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/running" },
        props: { label: "Chạy" },
      },
    ],
  })
  assertSchemaValid(doc, "r2-lamp")
  expectClean(doc, "numeric-widget-without-unit-or-range")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R3 — A WIDGET THAT IMPERSONATES A REAL EMERGENCY STOP (error) — spec §5.2
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R3 falsification: a command-button labelled E-STOP", () => {
  const doc = baseDoc({
    screenId: "r3-estop",
    widgets: [
      {
        id: "stop",
        kind: "command-button",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        policyAction: "machine.command",
        props: { label: "Dừng", labelEn: "E-STOP", variant: "estop" },
      },
    ],
  })
  assertSchemaValid(doc, "r3-estop")
  const [hit] = expectViolates(doc, "widget-impersonates-emergency-stop", "error")
  assert.match(hit.detail, /ISO 13849/)
})

test("R3 falsification: the Vietnamese phrase, diacritics and all", () => {
  const doc = baseDoc({
    screenId: "r3-vn",
    widgets: [
      {
        id: "stop",
        kind: "command-button",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        policyAction: "machine.command",
        props: { label: "DỪNG KHẨN CẤP", variant: "estop" },
      },
    ],
  })
  assertSchemaValid(doc, "r3-vn")
  expectViolates(doc, "widget-impersonates-emergency-stop", "error")
})

test("R3 falsification: a plain LABEL widget can tell the same lie, and is caught too", () => {
  const doc = baseDoc({
    screenId: "r3-label",
    widgets: [
      {
        id: "cap",
        kind: "label",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        props: { text: "EMERGENCY STOP" },
      },
    ],
  })
  assertSchemaValid(doc, "r3-label")
  expectViolates(doc, "widget-impersonates-emergency-stop", "error")
})

test("R3 spelling variants all fold to the same phrase", () => {
  for (const spelling of ["E-STOP", "E STOP", "e_stop", "EStop", "Emergency  Stop", "ngừng khẩn cấp"]) {
    const doc = baseDoc({
      screenId: "r3-spell",
      widgets: [
        {
          id: "b",
          kind: "command-button",
          rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
          policyAction: "machine.command",
          props: { label: spelling },
        },
      ],
    })
    assert.ok(
      findingsFor(doc, "widget-impersonates-emergency-stop").length > 0,
      `spelling ${JSON.stringify(spelling)} escaped the emergency-stop rule`
    )
  }
})

test("R3 NEGATIVE CONTROL: HALT — the SANCTIONED name — is clean, variant:'estop' included", () => {
  // 🔴 The rule must not flag the product's own correct control. `ControlColumn.tsx:24` glosses the
  // `estop` VARIANT as "HALT" deliberately, keeping the internal identifier while changing only the
  // operator-facing text. A rule that flagged this would push an author to `variant: "start"` — a red
  // button relabelled green, which is worse than what it set out to prevent.
  const doc = baseDoc({
    screenId: "r3-halt",
    widgets: [
      {
        id: "halt",
        kind: "command-button",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        policyAction: "machine.command",
        props: { label: "DỪNG", labelEn: "HALT", variant: "estop" },
      },
    ],
  })
  assertSchemaValid(doc, "r3-halt")
  expectClean(doc, "widget-impersonates-emergency-stop")
})

test("R3 NEGATIVE CONTROL: an ordinary Stop/Dừng button is clean — 'stop' alone is not the claim", () => {
  for (const label of ["Stop", "Dừng", "PAUSE", "Tạm dừng", "Stopped"]) {
    const doc = baseDoc({
      screenId: "r3-plain",
      widgets: [
        {
          id: "b",
          kind: "command-button",
          rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
          policyAction: "machine.command",
          props: { label },
        },
      ],
    })
    assert.deepEqual(
      findingsFor(doc, "widget-impersonates-emergency-stop"),
      [],
      `an ordinary supervisory stop labelled ${JSON.stringify(label)} was wrongly flagged`
    )
  }
  controlled.add("widget-impersonates-emergency-stop")
})

test("normaliseForEstop folds diacritics, case and punctuation (the mechanism, directly)", () => {
  assert.equal(normaliseForEstop("E-STOP"), "e stop")
  assert.equal(normaliseForEstop("DỪNG KHẨN CẤP"), "dung khan cap")
  assert.equal(normaliseForEstop("Đóng"), "dong")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R4 — CONTRAST (error). See the module's R4 note: this is the DOCUMENT-CHECKABLE part, and the
// module says so rather than pretending to measure rendered pixels.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R4 falsification: a theme naming no palette this build can resolve", () => {
  // NOT schema-valid on purpose — the frozen `enum` blocks this at the write door. It is reachable in
  // the EDITOR because `createEditorState` takes whatever it is handed (that module's header makes
  // exactly this argument for its own guards), e.g. a document loaded from disk or an older store.
  const doc = baseDoc({ screenId: "r4-bad", theme: "neon" })
  assert.ok(
    validate(SCHEMA, SCHEMA, doc).length > 0,
    "this fixture is supposed to be schema-INVALID; if the schema now accepts it, the rule's " +
      "reachability argument changed and this test's comment is stale"
  )
  const [hit] = expectViolates(doc, "contrast-below-aa", "error")
  assert.match(hit.detail, /axe-core/, "the finding must disclose where real contrast IS measured")
  // 🔴 Fix round 1, review M2 — the NARROWNESS must reach the engineer too, not live only in the doc
  // comment: this check's value set is the schema enum's own pair, so it cannot fire on anything the
  // write door would accept. A reader who sees "contrast: implemented" must be able to learn that
  // from the product, not from a markdown report they will never open.
  assert.match(
    hit.detail,
    /SAME pair as the frozen schema's own theme enum/,
    "R4's finding must disclose that it cannot fire on a document the write door accepts"
  )
})

test("R4 NEGATIVE CONTROL: both frozen theme values are clean — including `blueprint`, the inherit case", () => {
  for (const theme of ["isa101", "blueprint"]) {
    const doc = baseDoc({ screenId: "r4-ok", theme })
    assertSchemaValid(doc, `r4-ok/${theme}`)
    assert.deepEqual(
      findingsFor(doc, "contrast-below-aa"),
      [],
      `theme "${theme}" is a legal value of the frozen enum and must not be flagged`
    )
  }
  controlled.add("contrast-below-aa")
})

test("R4 honesty pin: `blueprint` really does have NO [data-theme] block in index.css", () => {
  // The negative control above rests on index.css's own claim that `blueprint` inherits deliberately.
  // If a `[data-theme="blueprint"]` block is ever added, that reasoning changes and this reddens.
  // 🔴 Comments must be stripped FIRST. index.css lines 62-83 DISCUSS `[data-theme="blueprint"]` at
  // length in prose (explaining that no such block exists on purpose), so a naive substring search
  // finds the string and concludes the opposite of the truth. Measured: this test failed that way on
  // its first run. What is searched for is a real RULE — the selector followed by an opening brace.
  const css = readFileSync(join(WEB, "src", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.match(css, /\[data-theme="isa101"\]\s*\{/, "isa101 block vanished from index.css")
  assert.ok(
    !/\[data-theme="blueprint"\]\s*\{/.test(css),
    "index.css now HAS a real blueprint rule — R4's inherit-case reasoning needs revisiting"
  )
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R5 — TOUCH TARGETS (error)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R5 falsification: a 1-column command-button on a 48-column grid is under 44 px at BOTH breakpoints", () => {
  const doc = baseDoc({
    screenId: "r5-tiny",
    layout: { cols: 48, rows: 8, breakpoint: "panel" },
    widgets: [
      {
        id: "b",
        kind: "command-button",
        rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        policyAction: "machine.command",
        props: { label: "Đặt lại" },
      },
    ],
  })
  assertSchemaValid(doc, "r5-tiny")
  const hits = expectViolates(doc, "touch-target-below-44px", "error")
  assert.equal(hits.length, 2, "spec §6 names panel AND tablet — both must be reported")
  assert.deepEqual(
    hits.map((h) => (h.detail.includes('"panel"') ? "panel" : "tablet")).sort(),
    ["panel", "tablet"]
  )
  // The measured number, not just "it fired": (1280 - 47*8)/48 = 18.83 px, reported to one decimal.
  assert.match(hits[0].detail, /18\.8 px wide/)
  assert.equal(widgetWidthPx(1280, 48, 1).toFixed(1), "18.8")
})

test("R5 the panel/tablet boundary is real — a span that passes at panel can fail at tablet", () => {
  // 1024 px, 24 cols: track = (1024 - 23*8)/24 = 35.0 px  -> FAILS
  // 1280 px, 24 cols: track = (1280 - 23*8)/24 = 46.5 px  -> passes
  const doc = baseDoc({
    screenId: "r5-edge",
    layout: { cols: 24, rows: 8, breakpoint: "panel" },
    widgets: [
      {
        id: "b",
        kind: "setpoint-input",
        rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        policyAction: "machine.setpoint",
        props: { label: "Đích", unit: "Nm", min: 5, max: 15 },
      },
    ],
  })
  assertSchemaValid(doc, "r5-edge")
  const hits = findingsFor(doc, "touch-target-below-44px")
  assert.equal(hits.length, 1, "exactly one of the two breakpoints should fail here")
  assert.match(hits[0].detail, /"tablet"/)
})

test("R5 NEGATIVE CONTROL: a comfortably sized button is clean at both breakpoints", () => {
  const doc = baseDoc({
    screenId: "r5-ok",
    widgets: [
      {
        id: "b",
        kind: "command-button",
        rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
        policyAction: "machine.command",
        props: { label: "Đặt lại" },
      },
    ],
  })
  assertSchemaValid(doc, "r5-ok")
  expectClean(doc, "touch-target-below-44px")
})

test("R5 NEGATIVE CONTROL: a NON-interactive widget of the same tiny size is not a touch target", () => {
  const doc = baseDoc({
    screenId: "r5-label",
    layout: { cols: 48, rows: 8, breakpoint: "panel" },
    widgets: [
      { id: "l", kind: "label", rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, props: { text: "x" } },
    ],
  })
  assertSchemaValid(doc, "r5-label")
  assert.deepEqual(findingsFor(doc, "touch-target-below-44px"), [])
})

test("R5 the `phone` exemption is the SPEC's, and it is real", () => {
  const widgets = [
    {
      id: "b",
      kind: "command-button",
      rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      policyAction: "machine.command",
      props: { label: "Đặt lại" },
    },
  ]
  const onPhone = baseDoc({ screenId: "r5-phone", layout: { cols: 12, rows: 8, breakpoint: "phone" }, widgets })
  const onPanel = baseDoc({ screenId: "r5-panel", layout: { cols: 12, rows: 8, breakpoint: "panel" }, widgets })
  assertSchemaValid(onPhone, "r5-phone")
  // Same widget, same span: exempt at phone, and NOT vacuous — at 12 cols it passes at panel too, so
  // the sharper proof is that a phone-declared doc with a span that WOULD fail is still exempt.
  assert.deepEqual(findingsFor(onPhone, "touch-target-below-44px"), [])
  assert.deepEqual(findingsFor(onPanel, "touch-target-below-44px"), [])

  const tightPhone = baseDoc({
    screenId: "r5-phone2",
    layout: { cols: 48, rows: 8, breakpoint: "phone" },
    widgets,
  })
  const tightPanel = baseDoc({
    screenId: "r5-panel2",
    layout: { cols: 48, rows: 8, breakpoint: "panel" },
    widgets,
  })
  assert.deepEqual(
    findingsFor(tightPhone, "touch-target-below-44px"),
    [],
    "a document DECLARING phone is exempt from R5 — see TOUCH_TARGET_BREAKPOINTS' note"
  )
  assert.ok(
    findingsFor(tightPanel, "touch-target-below-44px").length > 0,
    "...while the same layout declaring panel is not — otherwise the exemption is untested"
  )
})

test("R5 arithmetic: widgetWidthPx matches the renderer's uniform-track model exactly", () => {
  // track = (W - (cols-1)*gap)/cols ; width = span*track + (span-1)*gap
  assert.equal(widgetWidthPx(1280, 12, 1), (1280 - 11 * 8) / 12)
  assert.equal(widgetWidthPx(1280, 1, 1), 1280)
  const track = (1280 - 11 * 8) / 12
  assert.equal(widgetWidthPx(1280, 12, 3), 3 * track + 2 * 8)
  // A full-width span reconstructs the whole screen, which is the strongest single check that the
  // gap bookkeeping is right (11 gaps between 12 tracks, not 12).
  assert.equal(Math.round(widgetWidthPx(1280, 12, 12)), 1280)
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R6 — TOO MANY NON-STATUS COLOURS (warn)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R6 falsification: a tone word outside the widgets' five-word vocabulary", () => {
  const doc = baseDoc({
    screenId: "r6-hue",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "green", stopped: "purple", faulted: "fault" } },
      },
    ],
  })
  assertSchemaValid(doc, "r6-hue")
  const [hit] = expectViolates(doc, "too-many-non-status-colours", "warn")
  assert.match(hit.detail, /green/)
  assert.match(hit.detail, /purple/)
  // `warn` must NOT block publish — that is the whole difference between the two severities.
  assert.equal(lintScreen(doc).blocksPublish, false)
})

test("R6 NEGATIVE CONTROL: a screen using only vocabulary tone words is clean", () => {
  const doc = baseDoc({
    screenId: "r6-ok",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "run", stopped: "idle", faulted: "fault", other: "neutral" } },
      },
    ],
  })
  assertSchemaValid(doc, "r6-ok")
  expectClean(doc, "too-many-non-status-colours")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R7 — NO ROUTE TO ALARM STATE (warn)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R7 falsification: a screen with no alarm-banner and no alarm-list", () => {
  const doc = baseDoc({
    screenId: "r7-none",
    widgets: [
      { id: "l", kind: "label", rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 }, props: { text: "x" } },
    ],
  })
  assertSchemaValid(doc, "r7-none")
  expectViolates(doc, "no-route-to-alarm-state", "warn")
  assert.equal(lintScreen(doc).blocksPublish, false, "a warn must never block publish")
})

test("R7 NEGATIVE CONTROL: either alarm kind satisfies the rule", () => {
  for (const kind of ["alarm-banner", "alarm-list"]) {
    const doc = baseDoc({
      screenId: "r7-ok",
      widgets: [{ id: "a", kind, rect: { col: 0, row: 0, colSpan: 12, rowSpan: 1 } }],
    })
    assertSchemaValid(doc, `r7-ok/${kind}`)
    assert.deepEqual(findingsFor(doc, "no-route-to-alarm-state"), [], `${kind} should satisfy R7`)
  }
  controlled.add("no-route-to-alarm-state")
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// R8 — `quality` DISPLAYED NOWHERE (warn)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R8 falsification: a screen that binds tags but shows quality nowhere", () => {
  const doc = baseDoc({
    screenId: "r8-hidden",
    widgets: [
      {
        id: "g",
        kind: "gauge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { value: "SCRW-01/spindle/torque" },
        props: { label: "Mô-men", unit: "Nm", min: 0, max: 20 },
      },
    ],
  })
  assertSchemaValid(doc, "r8-hidden")
  const [hit] = expectViolates(doc, "quality-never-displayed", "warn")
  assert.match(hit.detail, /no "quality" TAG in this product/, "the finding must disclose the ruling")
})

test("R8 NEGATIVE CONTROL: any of the four quality-surfacing kinds satisfies the rule", () => {
  for (const kind of ["readout", "kpi-tile", "alarm-banner", "alarm-list"]) {
    const doc = baseDoc({
      screenId: "r8-ok",
      widgets: [
        {
          id: "g",
          kind: "gauge",
          rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
          bindings: { value: "SCRW-01/spindle/torque" },
          props: { label: "Mô-men", unit: "Nm", min: 0, max: 20 },
        },
        {
          id: "q",
          kind,
          rect: { col: 3, row: 0, colSpan: 3, rowSpan: 1 },
          bindings: { value: "SCRW-01/spindle/torque" },
          props: { label: "Q", unit: "Nm" },
        },
      ],
    })
    assertSchemaValid(doc, `r8-ok/${kind}`)
    assert.deepEqual(findingsFor(doc, "quality-never-displayed"), [], `${kind} should satisfy R8`)
  }
  controlled.add("quality-never-displayed")
})

test("R8 NEGATIVE CONTROL: a screen that binds NOTHING has no quality to hide", () => {
  const doc = baseDoc({
    screenId: "r8-unbound",
    widgets: [
      { id: "l", kind: "label", rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 }, props: { text: "x" } },
    ],
  })
  assertSchemaValid(doc, "r8-unbound")
  assert.deepEqual(findingsFor(doc, "quality-never-displayed"), [])
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SEVERITY, AND THE TWO-WAY PINS ON EVERY RESTATED CONSTANT
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("severity: `error` blocks publish and `warn` does not — asserted on one document carrying both", () => {
  const doc = baseDoc({
    screenId: "sev-both",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        // 🔴 The error and the warn are carried by SEPARATE widgets, and that is not cosmetic. The
        // first draft put both on one tone map (`{running:"run", stopped:"run", faulted:"green"}`)
        // and R1 correctly did NOT fire: adding "green" makes the map non-constant, so it is no
        // longer a constant status colour. The linter was right and the fixture was wrong.
        props: { tones: { running: "run", stopped: "run", faulted: "run" } },
      },
      {
        id: "hue",
        kind: "state-badge",
        rect: { col: 3, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "green", stopped: "idle" } },
      },
    ],
  })
  assertSchemaValid(doc, "sev-both")
  const report = lintScreen(doc)
  const severities = new Set(report.findings.map((f) => f.severity))
  assert.ok(severities.has("error") && severities.has("warn"), "fixture must carry both levels")
  assert.equal(report.blocksPublish, true)

  // ...and with the error removed, the SAME warn no longer blocks.
  const warnOnly = baseDoc({
    screenId: "sev-warn",
    widgets: [
      {
        id: "badge",
        kind: "state-badge",
        rect: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
        bindings: { state: "SCRW-01/spindle/state" },
        props: { tones: { running: "run", stopped: "idle", faulted: "green" } },
      },
    ],
  })
  const warnReport = lintScreen(warnOnly)
  assert.ok(warnReport.findings.some((f) => f.severity === "warn"))
  assert.ok(!warnReport.findings.some((f) => f.severity === "error"))
  assert.equal(warnReport.blocksPublish, false)
})

test("PIN: BREAKPOINT_WIDTH_PX equals lib/hmiScreens.ts's SCREEN_BREAKPOINT_WIDTHS, read as text", () => {
  // Two-way, and the reason is in that constant's doc comment: this repository has already shipped a
  // hand-copied constant that drifted (chartTokens.ts's isa101 textStrong) with every gate green.
  const src = readFileSync(join(WEB, "src", "lib", "hmiScreens.ts"), "utf8")
  const block = src.match(/SCREEN_BREAKPOINT_WIDTHS[^=]*=\s*\{([^}]*)\}/)
  assert.ok(block, "could not find SCREEN_BREAKPOINT_WIDTHS in lib/hmiScreens.ts")
  const parsed = {}
  for (const m of block[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) parsed[m[1]] = Number(m[2])
  assert.ok(Object.keys(parsed).length >= 3, "parsed too few breakpoints — the regex or the table moved")
  assert.deepEqual(parsed, { ...BREAKPOINT_WIDTH_PX })
})

test("PIN: TOUCH_TARGET_GRID_GAP_PX really is the gap ScreenRenderer renders with", () => {
  const src = readFileSync(join(WEB, "src", "hmi-runtime", "ScreenRenderer.tsx"), "utf8")
  const cls = src.match(/className="grid h-full w-full min-h-0 min-w-0 ([\w-]+)"/)
  assert.ok(cls, "ScreenRenderer's grid className changed shape — re-derive the gap before trusting R5")
  // Tailwind's `gap-N` is N * 0.25rem, i.e. N * 4 px at the 16 px root.
  const n = Number(cls[1].replace("gap-", ""))
  assert.ok(Number.isFinite(n), `could not read a numeric gap from ${JSON.stringify(cls[1])}`)
  assert.equal(n * 4, TOUCH_TARGET_GRID_GAP_PX)
})

test("PIN: the tone vocabulary equals what the widgets themselves accept", () => {
  // `status-lamp.tsx`'s KNOWN_STATES and `state-badge.tsx`'s KNOWN_TONES are the two places a tone
  // word is checked. Their UNION is the vocabulary; a widget that learns a new word must redden here
  // rather than silently escaping R1/R6.
  const readSet = (file, name) => {
    const src = readFileSync(join(WEB, "src", "hmi-runtime", "widgets", file), "utf8")
    const m = src.match(new RegExp(`${name}[^[]*\\[([^\\]]*)\\]`))
    assert.ok(m, `could not find ${name} in ${file}`)
    return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1])
  }
  const lamp = readSet("status-lamp.tsx", "KNOWN_STATES")
  const badge = readSet("state-badge.tsx", "KNOWN_TONES")
  assert.ok(lamp.length >= 4 && badge.length >= 4, "extraction returned too few words to be trusted")
  assert.deepEqual([...new Set([...lamp, ...badge])].sort(), [...KNOWN_TONE_WORDS].sort())
})

test("PIN: no frozen widget reads a colour-bearing prop — the fact N=0 rests on", () => {
  // R6's ceiling of 0 is justified by there being nowhere in a document to put a hue. If a widget
  // ever gains `props.color` (or a hardcoded hex), that justification dies and this reddens BY NAME,
  // pointing at MAX_NON_STATUS_COLOURS as the constant to revisit.
  const dir = join(WEB, "src", "hmi-runtime", "widgets")
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"))
  assert.ok(files.length >= 15, `expected the fifteen frozen widgets, found ${files.length}`)
  const offenders = []
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8")
    // Strip block and line comments first: the widgets' doc comments legitimately DISCUSS colour.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    if (/\bp\.(color|colour|bg|background|fill|accent|hex|style|className)\b/.test(code)) offenders.push(f)
    if (/#[0-9a-fA-F]{6}\b/.test(code)) offenders.push(`${f} (hardcoded hex)`)
  }
  assert.deepEqual(
    offenders,
    [],
    `a widget now reads a colour-bearing prop or hardcodes a hex, so MAX_NON_STATUS_COLOURS === ` +
      `${MAX_NON_STATUS_COLOURS} is no longer justified — revisit R6 and R4`
  )
})

test("MIN_TOUCH_TARGET_PX is the standard's 44", () => {
  assert.equal(MIN_TOUCH_TARGET_PX, 44)
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE COVERAGE FLOOR — every rule must have BOTH halves, or this file is not what it claims
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("🔴 FLOOR: every rule has BOTH a falsification and a negative control", () => {
  const missingFalsification = ALL_RULE_IDS.filter((r) => !falsified.has(r))
  const missingControl = ALL_RULE_IDS.filter((r) => !controlled.has(r))
  assert.deepEqual(
    missingFalsification,
    [],
    "these rules were never watched going RED — they could be dead code and nothing here would say so"
  )
  assert.deepEqual(
    missingControl,
    [],
    "these rules have no negative control — a linter that flags EVERY document would pass their " +
      "falsifications and this suite would not notice"
  )
  assert.equal(ALL_RULE_IDS.length, 8, "spec §6 defines exactly eight rules")
})

test("🔴 FLOOR: the rule-id list here matches the union the module actually emits", () => {
  // Independently authored sets: the literal at the top of this file, versus the ids observed coming
  // out of `lintScreen` across every fixture above plus the module's own type. A ninth rule added
  // without a pin lands here.
  //
  // 🔴 THIS EXTRACTION IS LINE-ENDING AGNOSTIC, AND IT DID NOT USED TO BE. READ THIS BEFORE WRITING
  // ANOTHER SOURCE-TEXT MATCHER ANYWHERE IN THIS TREE.
  //
  // Round 1 terminated the match at a BLANK LINE: `/...([\s\S]*?)\n\nexport type Isa101Finding/`.
  // That passed here and went RED the moment the branch was merged, on a tree at the SAME COMMIT.
  // Measured on the two worktrees:
  //
  //     this branch's checkout : CRLF=0    LF-only=921   contains "\n\n"
  //     main's checkout        : CRLF=921  LF-only=0     contains "\r\n\r\n", never "\n\n"
  //
  // This repository has `core.autocrlf=true` and NO `.gitattributes`, so the object store holds LF
  // and a checkout materialises CRLF -- while a worktree written by some other path can hold LF. A
  // blank line is therefore `\n\n` in one checkout and `\r\n\r\n` in another, `match` returns null,
  // and `assert.ok(union, ...)` fires. A floor test that reports its own CHECKOUT rather than the
  // source it claims to measure is worse than a missing test: green where it is written, red where
  // it is merged, and neither result is about the code.
  //
  // Two fixes were available and the weaker one was REJECTED. Normalising the text
  // (`.replace(/\r\n/g, "\n")` -- which `bindings.test.mjs`, `chartTokens.test.mjs`,
  // `editorCanvasSeam.test.mjs`, `hmiWiring.test.mjs` and `editorState.test.mjs` all already do; this
  // tree had learned the lesson and this file had not) would have fixed THIS regex while leaving the
  // pattern's real weakness in place: it was anchored both to a blank line AND to `Isa101Finding`
  // being the very next declaration, so inserting anything between the two -- a helper, a comment, a
  // second blank line -- breaks it for reasons that have nothing to do with the union it measures.
  //
  // So the union is located by ITS OWN SYNTAX and terminated at its own last member: a run of
  // `| "literal"` alternatives. `\s*` spans any line ending by construction, there is no delimiter to
  // depend on, and nothing after the union can extend the match (verified by inspecting the text
  // immediately following the capture). Falsified three ways when written: a ninth member yields 9
  // ids, a removed member yields 7, and renaming the union yields null so `assert.ok` still fires.
  //
  // Related trap, different mechanism, same root cause: `web/scripts/check-comment-only.mjs` records
  // why a raw token scan is unsafe on this tree's spec files. Both are text matchers that are correct
  // on their author's bytes and wrong on somebody else's.
  const src = readFileSync(join(WEB, "src", "editor", "isa101Linter.ts"), "utf8")
  const union = src.match(/export type Isa101RuleId\s*=\s*((?:\s*\|\s*"[a-z0-9-]+")+)/)
  assert.ok(union, "could not find the Isa101RuleId union")
  const declared = [...union[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.deepEqual(declared.sort(), [...ALL_RULE_IDS].sort())
})

test("PIN: KIND_FACTS covers exactly the fifteen kinds the registry declares", () => {
  // 🔴 `Record<WidgetKind, KindFacts>` already makes the table exhaustive over the frozen UNION at
  // compile time (verified by deleting a row: tsc reports "Property 'sheet' is missing"). This pin
  // adds the half a type cannot give: that the union is still the REGISTRY's fifteen. Same extraction
  // `widgetRegistry.test.mjs` uses — quoted keys of the object literal — so a kind added to the
  // registry without a row here reddens by name.
  const src = readFileSync(join(WEB, "src", "hmi-runtime", "widgetRegistry.ts"), "utf8")
  const body = src.slice(src.indexOf("export const widgetRegistry"))
  const registered = [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1])
  assert.ok(registered.length >= 15, `extracted ${registered.length} kinds from the registry — the extraction broke`)
  assert.deepEqual(Object.keys(KIND_FACTS).sort(), registered.sort())
})

test("PIN: every KIND_FACTS column is used by a rule, and none is all-false", () => {
  // A column nobody reads is dead weight; a column that is false for every kind makes its rule
  // unable to fire — the always-green stub this suite exists to rule out. Both are caught here.
  const columns = ["numeric", "alarmRoute", "surfacesQuality", "touchable", "needsRange"]
  for (const column of columns) {
    const trueKinds = Object.entries(KIND_FACTS).filter(([, f]) => f[column])
    assert.ok(
      trueKinds.length > 0,
      `KIND_FACTS column "${column}" is false for every kind — the rule reading it cannot fire`
    )
  }
  // ...and no kind is silently absent from the shape.
  for (const [kind, facts] of Object.entries(KIND_FACTS)) {
    assert.deepEqual(
      Object.keys(facts).sort(),
      [...columns].sort(),
      `kind "${kind}" does not carry every column`
    )
  }
})
