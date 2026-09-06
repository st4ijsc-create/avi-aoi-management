// Run: npm run test:runtime   (node --test, no extra package)
//
// SESSION 5 (residuals) — THE WARN-ONCE PATH IN `hmi-runtime/publishedScreen.ts`.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
// WS-HMI-2's perimeter report named five load-bearing lines with no test. Grepped at `5f00fef8`:
// NO test in this repository mentioned `alreadyWarned`. `screenJoin.test.mjs` measures which
// documents `renderableScreen` REFUSES, and measures it thoroughly — but it never looks at what the
// operator's console is told, which is the entire compensating control for a fallback that is
// deliberately SILENT ON SCREEN. `publishedScreen.ts`'s own comment says so: "The fallback is silent
// ON SCREEN and loud in the console, on purpose… the console line names the screen id and what was
// wrong with it." A silent-on-screen fallback whose loud half is unmeasured is a fallback with no
// observable behaviour at all.
//
// So this file measures the loud half, and only the parts of it that are genuinely load-bearing:
//
//   1. WARN-ONCE. `Hmi.tsx` re-renders on every 1 s machine poll. Without the `alreadyWarned`
//      WeakSet, one bad document would emit a console line per render — thousands an hour — burying
//      the one line an engineer needs. The de-duplication is keyed on OBJECT IDENTITY, which is what
//      makes it correct: TanStack Query hands back the same object until the data actually changes.
//   2. THE NAMED SCREEN ID (`describeId`). A warning that does not say WHICH screen is a warning an
//      engineer cannot act on — there is one console line and a fleet of machines. Both branches are
//      reachable and both are pinned, through `renderableScreen` rather than by exporting the private
//      helper: what matters is the message an operator's console actually receives.
//   3. THE REASON travels into the message, so the line says what was wrong as well as where.
//
// ── WHAT IS DELIBERATELY *NOT* PINNED HERE, AND WHY ──────────────────────────────────────────────
// Two of the five lines the perimeter report named are NOT pinned by this file, and that is a
// judgement rather than an omission — this programme has said consistently that a test written only
// to raise a number is worse than the gap it fills.
//
//   * `useScreenAtVersion`'s `staleTime: Infinity` — NOT PINNED. The only test available for it in
//     this tree is a source-text assertion that the literal `staleTime: Infinity` appears in
//     `lib/api.ts`. That measures the presence of a character sequence, not a behaviour: it cannot
//     fail for any reason except someone editing that line, and if someone edits that line
//     deliberately the test tells them only what they already know. The property it would claim to
//     protect — "a version row is immutable, so re-fetching it is pure cost" — is a statement about
//     the SERVER (`HmiScreenStore.PutAsync`/`RollbackAsync` append, never rewrite), and that is
//     already pinned where it is true, in the .NET store tests. Restating it as a client-side string
//     match would add a red light that means nothing. Recorded here so the gap is a known decision
//     with a reason, not an oversight.
//
//   * The three `enabled` gates — NOT PINNED HERE. `enabled: screenId !== undefined && …` is
//     TanStack's own documented behaviour applied to a one-line boolean; pinning it in a unit test
//     would test the library. The consequence that actually matters — that the demo route issues no
//     `/v1/screens` request at all — is a claim about a running browser, and it is pinned as such in
//     `tests/46-demo-route-no-screen-fetch.spec.ts` (added this session), where a real request is
//     either observed or not.
//
// The demo-route exclusion, the fifth line, is covered by that same Playwright spec.

import { test } from "node:test"
import assert from "node:assert/strict"

const { renderableScreen, unrenderableReason } = await import("../src/hmi-runtime/publishedScreen.ts")

/** Runs `fn` with `console.warn` captured, and hands back every line it emitted. */
function capturingWarn(fn) {
  const lines = []
  const real = console.warn
  console.warn = (...args) => lines.push(args.join(" "))
  try {
    fn()
  } finally {
    console.warn = real
  }
  return lines
}

const GOOD = {
  schemaVersion: 1,
  screenId: "warn-probe-ok",
  title: "probe",
  theme: "blueprint",
  layout: { cols: 12, rows: 8, breakpoint: "panel" },
  widgets: [],
}

/** A fresh unrenderable document each time — the WeakSet keys on identity, so reusing one object
 * across tests would let an earlier test silence a later one. Every test below builds its own. */
const unrenderable = (over = {}) => ({ ...GOOD, screenId: "warn-probe", layout: null, ...over })

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1 — warn-once
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("a bad document warns EXACTLY ONCE however many times it is rendered", () => {
  // 🔴 The 1 s machine poll is the reason this matters: `Hmi.tsx` calls `renderableScreen` on every
  // render, and TanStack hands back the SAME object until the data changes. Ten renders here stands
  // in for an hour of polling.
  const doc = unrenderable()
  const lines = capturingWarn(() => {
    for (let i = 0; i < 10; i += 1) assert.equal(renderableScreen(doc), undefined)
  })
  assert.equal(lines.length, 1, `warned ${lines.length} times for one document across ten renders`)
})

test("FALSIFICATION CONTROL: the warning really does fire — silence is not what is being measured", () => {
  // Every "exactly once" assertion above would also pass against a `renderableScreen` that never
  // warned at all. This is the row that separates once from never.
  const lines = capturingWarn(() => renderableScreen(unrenderable()))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\[hmi-runtime\]/)
})

test("de-duplication is per DOCUMENT, not global — a second bad document still gets its own line", () => {
  // A WeakSet that had degenerated into a single "have we ever warned?" boolean would pass the
  // warn-once test and silence every screen after the first, which is the failure that would actually
  // hurt: a fleet where only the first broken panel is ever reported.
  const first = unrenderable({ screenId: "warn-probe-a" })
  const second = unrenderable({ screenId: "warn-probe-b" })
  const lines = capturingWarn(() => {
    renderableScreen(first)
    renderableScreen(first)
    renderableScreen(second)
    renderableScreen(second)
  })
  assert.equal(lines.length, 2)
  assert.match(lines[0], /"warn-probe-a"/)
  assert.match(lines[1], /"warn-probe-b"/)
})

test("two documents that are EQUAL but not identical each warn — the key is identity, as designed", () => {
  // Stated as the deliberate consequence it is. Structural de-duplication would need to hash every
  // document on every render of every kiosk; identity is free and is exactly right for the query
  // cache's actual behaviour (same object until the data changes).
  const a = unrenderable()
  const b = unrenderable()
  const lines = capturingWarn(() => {
    renderableScreen(a)
    renderableScreen(b)
  })
  assert.equal(lines.length, 2)
})

test("a document the renderer CAN draw warns not at all", () => {
  const lines = capturingWarn(() => {
    assert.equal(renderableScreen(GOOD), GOOD)
    assert.equal(renderableScreen(GOOD), GOOD)
  })
  assert.deepEqual(lines, [])
})

test("a non-object is refused WITHOUT warning — there is nothing to put in a WeakSet", () => {
  // `isPlainObject(doc) && !alreadyWarned.has(doc)` — the guard is what keeps `WeakSet.add` from
  // throwing on a primitive. The refusal itself still happens, and is still reasoned.
  for (const bad of [undefined, null, "iot-overview", 7, []]) {
    const lines = capturingWarn(() => assert.equal(renderableScreen(bad), undefined))
    assert.deepEqual(lines, [], `warned for ${JSON.stringify(bad) ?? "undefined"}`)
    assert.ok(typeof unrenderableReason(bad) === "string", "…but it must still be REFUSED, with a reason")
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2 — the message names the screen (describeId) and the reason
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the warning NAMES the screen id, quoted", () => {
  const lines = capturingWarn(() => renderableScreen(unrenderable({ screenId: "machine-aoi-01" })))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /"machine-aoi-01"/)
})

test("a document with NO usable screenId says so, rather than printing undefined", () => {
  // `describeId`'s other branch. An engineer reading `document undefined cannot be laid out` learns
  // less than one reading `(with no screenId)`, and the second is not mistakable for a screen called
  // "undefined".
  for (const screenId of [undefined, 42, null]) {
    const doc = unrenderable()
    if (screenId === undefined) delete doc.screenId
    else doc.screenId = screenId
    const lines = capturingWarn(() => renderableScreen(doc))
    assert.equal(lines.length, 1)
    assert.match(lines[0], /\(with no screenId\)/)
    assert.ok(!/undefined/.test(lines[0]), `the message leaked "undefined": ${lines[0]}`)
  }
})

test("the warning carries the REASON, and the reason is the one unrenderableReason gives", () => {
  // Not merely "a reason is present": the SAME reason, so the console and the guard cannot drift.
  const doc = unrenderable({ layout: { cols: 1e9, rows: 8, breakpoint: "panel" } })
  const reason = unrenderableReason(doc)
  assert.ok(typeof reason === "string" && reason.length > 0)
  const lines = capturingWarn(() => renderableScreen(doc))
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes(reason), `message did not carry "${reason}": ${lines[0]}`)
})

test("the warning explains the ROLLBACK provenance — the one way such a row can exist", () => {
  // The message's job is not only to report; it is to stop the reader hunting for a write-door bug
  // that cannot exist. `PUT /v1/screens` validates; `RollbackAsync` deliberately does not.
  const lines = capturingWarn(() => renderableScreen(unrenderable()))
  assert.match(lines[0], /rollback/i)
  assert.match(lines[0], /falling back/i)
})

test("FALSIFICATION CONTROL: these matchers reject a message that lost its id or its reason", () => {
  // Without this, every `assert.match` above would be satisfied by a matcher that fires on anything.
  const bare = "[hmi-runtime] something went wrong"
  assert.ok(!/"machine-aoi-01"/.test(bare))
  assert.ok(!/\(with no screenId\)/.test(bare))
  assert.ok(!/rollback/i.test(bare))
  // …and a real message satisfies all three of the relevant ones.
  const real = capturingWarn(() => renderableScreen(unrenderable({ screenId: "machine-aoi-01" })))[0]
  assert.ok(/"machine-aoi-01"/.test(real) && /rollback/i.test(real))
})
