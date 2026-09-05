// Run: npm run test:runtime   (node --test, no extra package)
//
// Session 4 (HMI-5) — DOES AN IMPORTED DOCUMENT STILL MEET SESSION 1'S PERMISSION GATE AND SESSION 3'S
// ISA-101 LINTER?
//
// ── WHY THIS FILE EXISTS, AND WHAT IT REFUSES TO CLAIM ───────────────────────────────────────────
// The session brief says both gates "must still apply to an imported document" and that an import "must
// not become a side door around either". The tempting answer is to assert it in a doc comment. That is
// exactly the failure this repository has paid for before: a claim about a gate, written beside the gate,
// that nothing measures.
//
// So this file MEASURES it, and the measurement rests on one structural fact that has to be stated
// precisely, because it is what makes the answer true:
//
//   🔴 BOTH GATES ARE PURE FUNCTIONS OF A DOCUMENT. NEITHER TAKES, READS, OR CAN OBSERVE PROVENANCE.
//
//   * `policyGate(widget, resolution)` (`src/hmi-runtime/widgets/shared.ts`) is Session 1's gate. Its
//     inputs are a widget and the engine's per-session write-permission resolution. There is no third
//     parameter, and no import of anything that could tell it where the document came from.
//   * `lintScreen(doc)` (`src/editor/isa101Linter.ts`) is Session 3's linter. Its input is a document.
//     Same story.
//
// A function that cannot observe provenance cannot behave differently for an imported document. That is
// the whole argument, and it is stronger than any per-path assertion could be — but it is only sound if
// the premise (no provenance parameter, no provenance import) is TRUE, so this file pins the premise as
// well as the behaviour:
//
//   1. BEHAVIOUR — the same document, run through each gate, produces the IDENTICAL verdict whether it
//      is labelled as authored-here or as arrived-in-a-pack. Falsified by a positive case (a document
//      that DOES trip each gate) so the test cannot pass by both sides being trivially empty.
//   2. PREMISE — the two modules' source text is read and asserted to contain no provenance vocabulary
//      at all. This is the half that would go red if someone later added an `isImported` escape hatch,
//      which is precisely the side door the brief names.
//
// ── WHAT THIS FILE DOES NOT CLAIM ────────────────────────────────────────────────────────────────
// It does NOT claim the ISA-101 linter blocks the import ENDPOINT. It does not, deliberately and by
// Session 3's standing ruling (`isa101Linter.ts`'s own header): the linter is an EDITOR gate on the
// Publish BUTTON, and `PUT /v1/screens/{id}` keeps exactly the rules it had, because a doctrine that
// could 400 an API call would be un-opt-out-able for every future non-editor writer, the generator
// included. `POST /v1/screens/import` inherits that same asymmetry — it enforces the CONTRACT
// (`ContractInvariants`, measured in `HmiScreenPackTests`), not the DOCTRINE. What IS true, and is what
// this file measures, is that an imported document reaching the EDITOR is linted exactly as an authored
// one is, and an imported document reaching the RUNTIME is permission-gated exactly as an authored one
// is. Neither gate has a bypass for it.
//
// Source text is read line-ending normalised — this repository has `core.autocrlf=true` and no
// `.gitattributes`, and a matcher requiring an exact newline shape passed on one worktree and failed on
// another at the same commit one session ago. Same `readSource` helper shape as
// `screenRendererComponents.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..")
const readSource = (...parts) => readFileSync(join(WEB, ...parts), "utf8").replace(/\r\n/g, "\n")

const { lintScreen } = await import("../src/editor/isa101Linter.ts")
const { policyGate } = await import("../src/hmi-runtime/widgets/shared.ts")

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Fixtures. `authoredHere` and `arrivedInAPack` are the SAME document — the point is that nothing
// distinguishes them, because nothing in a screen document records where it came from. The pack
// wrapper carries provenance (`exportedFrom`, `exportedAtUtc`, per-entry `version`), and it is
// deliberately OUTSIDE the frozen document, so what reaches these gates is byte-identical either way.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const screen = (widgets) => ({
  schemaVersion: 1,
  screenId: "line-overview",
  title: "Tổng quan",
  theme: "isa101",
  layout: { cols: 12, rows: 8, breakpoint: "panel" },
  widgets,
})

test("an imported document is linted identically to an authored one — clean case", () => {
  const doc = screen([{ id: "w1", kind: "label", rect: { col: 0, row: 0, colSpan: 4, rowSpan: 2 } }])

  // Same bytes, reached by two different routes in the product. `lintScreen` cannot tell them apart,
  // and this asserts the consequence rather than the intent.
  const authoredHere = lintScreen(doc)
  const arrivedInAPack = lintScreen(structuredClone(doc))

  assert.deepEqual(arrivedInAPack.findings, authoredHere.findings)
  assert.equal(arrivedInAPack.blocksPublish, authoredHere.blocksPublish)
})

test("an imported document that violates ISA-101 still trips the linter — the positive control", () => {
  // NEGATIVE CONTROL for the test above: two clean documents agreeing on "no findings" would pass it
  // even if `lintScreen` were a stub returning nothing. This document must actually PRODUCE findings,
  // and must produce them for the imported copy exactly as for the authored one.
  const offending = screen([
    {
      id: "estop-lookalike",
      kind: "command-button",
      rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      policyAction: "machine.command",
      props: { label: "EMERGENCY STOP", tone: "alarm" },
    },
  ])

  const authoredHere = lintScreen(offending)
  const arrivedInAPack = lintScreen(structuredClone(offending))

  // The linter really did fire — otherwise this test measures nothing.
  assert.ok(
    authoredHere.findings.length > 0,
    "fixture must actually violate at least one ISA-101 rule, else this control is vacuous"
  )
  // And it fired identically for the imported copy.
  assert.deepEqual(arrivedInAPack.findings, authoredHere.findings)
  assert.equal(arrivedInAPack.blocksPublish, authoredHere.blocksPublish)
})

test("an imported widget is permission-gated identically to an authored one — denied case", () => {
  const widget = { kind: "command-button", policyAction: "machine.command" }
  // The engine's verdict for this session: NOT permitted.
  const denied = { permitted: {} }

  const authoredHere = policyGate(widget, denied)
  const arrivedInAPack = policyGate(structuredClone(widget), denied)

  assert.equal(arrivedInAPack.disabled, authoredHere.disabled)
  assert.equal(arrivedInAPack.reason, authoredHere.reason)
  // The gate really is closed — a test where both sides were open would not measure a gate at all.
  assert.equal(authoredHere.disabled, true)
})

test("an imported widget is permission-gated identically to an authored one — permitted case", () => {
  // NEGATIVE CONTROL for the test above: a `policyGate` that disabled EVERYTHING would pass it. When
  // the engine DOES permit the action, both copies must come back enabled.
  const widget = { kind: "command-button", policyAction: "machine.command" }
  const permitted = { permitted: { "machine.command": true } }

  const authoredHere = policyGate(widget, permitted)
  const arrivedInAPack = policyGate(structuredClone(widget), permitted)

  assert.equal(arrivedInAPack.disabled, authoredHere.disabled)
  assert.equal(authoredHere.disabled, false)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PREMISE — the half that would catch a side door being ADDED later.
//
// The behavioural tests above are sound only because neither gate can observe provenance. If someone
// later threaded an `imported` flag into either module, those tests would still pass (both sides would
// carry the same flag) while the side door existed. This is the pin that reddens instead.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 COMMENTS ARE STRIPPED BEFORE THIS PIN LOOKS AT ANYTHING, and that is a correction rather than a
 * convenience. The first draft of this test scanned RAW source text and went red on two hits that were
 * both prose: `isa101Linter.ts:726` says "1024. IMPORTED, not restated." about an ES import, and
 * `shared.ts:66` says a props value "can't be trusted to already have this shape". Neither is a
 * provenance branch; a pin that reddens on a doc comment measures English, not behaviour, and would
 * have been silenced by rewording rather than by fixing anything. What the premise actually needs is
 * that no provenance value reaches these gates AS DATA, which is a claim about code.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")

test("neither gate's CODE reads a provenance value — no import escape hatch exists", () => {
  const PROVENANCE_VOCABULARY =
    /\b(imported|isImported|isImport|fromPack|screenPack|packVersion|exportedFrom|provenance|skipLint|bypassGate)\b/i

  for (const rel of [
    ["src", "editor", "isa101Linter.ts"],
    ["src", "hmi-runtime", "widgets", "shared.ts"],
  ]) {
    const code = stripComments(readSource(...rel))
    const match = code.match(PROVENANCE_VOCABULARY)
    assert.equal(
      match,
      null,
      `${rel.join("/")} has ${match?.[0]} in its CODE — if a provenance concept has legitimately ` +
        `entered this module, the behavioural pins above no longer prove an imported document is ` +
        `treated identically, and this test must be replaced by one that measures the new branch ` +
        `rather than relaxed.`
    )
  }
})

test("the premise pin is falsifiable, and its comment-stripping does not blind it", () => {
  // NEGATIVE CONTROL, in two directions, because this pin has two ways to be vacuous.
  //
  //   1. A typo'd or over-anchored pattern would match nothing and pass for every possible file.
  //   2. `stripComments` removing too much would blind the pin to real code — the more dangerous
  //      failure, since it is exactly what an over-eager fix to the false positive above would cause.
  const PROVENANCE_VOCABULARY =
    /\b(imported|isImported|isImport|fromPack|screenPack|packVersion|exportedFrom|provenance|skipLint|bypassGate)\b/i

  // (1) The pattern fires on real provenance branches.
  assert.notEqual(
    stripComments("if (widget.isImported) return { disabled: false }").match(PROVENANCE_VOCABULARY),
    null
  )
  assert.notEqual(stripComments("const skipLint = doc.fromPack").match(PROVENANCE_VOCABULARY), null)

  // (2) …and still fires when the same code sits beside a comment, so stripping did not eat the code.
  assert.notEqual(
    stripComments("/* a comment */ if (doc.provenance) skip() // trailing").match(PROVENANCE_VOCABULARY),
    null
  )
  assert.notEqual(
    stripComments("// harmless prose about IMPORTED things\nconst x = doc.exportedFrom").match(
      PROVENANCE_VOCABULARY
    ),
    null
  )

  // (3) The two real prose hits this pin was corrected for are, correctly, NOT matches once stripped —
  //     verified against the live source rather than against a paraphrase of it.
  assert.equal(
    stripComments(readSource("src", "editor", "isa101Linter.ts")).match(/\bIMPORTED\b/),
    null
  )
  assert.equal(
    stripComments(readSource("src", "hmi-runtime", "widgets", "shared.ts")).match(/\btrusted\b/),
    null
  )

  // (4) Ordinary gate code is not a match.
  assert.equal(stripComments("const gate = policyGate(widget, resolution)").match(PROVENANCE_VOCABULARY), null)
})
