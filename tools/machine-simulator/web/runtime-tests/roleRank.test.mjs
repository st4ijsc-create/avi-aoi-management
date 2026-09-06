// Run: npm run test:runtime   (node --test, no extra package)
//
// SESSION 5 (residuals) — THE ROLE LADDER, NOW DECLARED ONCE, AND THE PIN THAT KEEPS IT THAT WAY.
//
// ── WHAT WAS CONSOLIDATED ────────────────────────────────────────────────────────────────────────
// Measured at `5f00fef8`, the session's BASE: the line
//
//     const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }
//
// appeared VERBATIM in eight files — `components/MachineControlPanel.tsx`, `routes/AlarmCenter.tsx`,
// `routes/AssetRegistry.tsx`, `routes/Connectors.tsx`, `routes/LineControl.tsx`,
// `routes/Notifications.tsx`, `routes/Site.tsx` and `shell/Sidebar.tsx`. All eight now import from
// `lib/roleRank.ts`.
//
// 🔴 TEN FILES MENTION THE LADDER; ONLY EIGHT DECLARED IT. `hmi-runtime/writePermissionChannel.ts`
// and `lib/api.ts` name it in PROSE ONLY, each to say it deliberately does not compare roles. A grep
// counting ten and editing ten damages two innocent files. That distinction is what SIDE B below is
// built to preserve: the census counts DECLARATIONS, never mentions, and it has a control that proves
// it can tell the two apart.
//
// ── WHAT THIS FILE PINS, IN TWO INDEPENDENT HALVES ───────────────────────────────────────────────
//
//   SIDE A — BEHAVIOUR. `meetsMinRole` and `navMeetsMinRole` are EXECUTED, over the whole
//   role × minRole matrix plus the unknown/absent cases, because a shared function is only a safe
//   consolidation if it computes what the eight copies computed. The two functions are asserted to
//   DIFFER on exactly one input class (an absent `minRole`) and to agree on every other, which is the
//   entire reason there are two of them rather than one.
//
//   SIDE B — CENSUS. No ninth declaration can appear anywhere under `web/src/` outside the one module
//   that owns it. Same mechanism `editorCanvasSeam.test.mjs` uses for the renderer's DOM hooks: walk
//   the real source tree, read every code file, and assert the set of files declaring the literal is
//   exactly the expected one.
//
// SIDE B is a source-text rule, so it is line-ending normalised: this repository has
// `core.autocrlf=true` and no `.gitattributes`, and a matcher requiring an exact newline shape passed
// on one worktree and failed on another at the same commit two sessions ago. Same `readSource` shape
// as `screenPackGates.test.mjs` and `editorCanvasSeam.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..")
const SRC = join(WEB, "src")

const readSource = (abs) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n")

const { ROLE_RANK, meetsMinRole, navMeetsMinRole } = await import("../src/lib/roleRank.ts")

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SIDE A — the ladder, EXECUTED
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const ROLES = ["Operator", "Engineer", "Admin"]

test("the ladder is exactly Operator < Engineer < Admin, and nothing else is on it", () => {
  assert.deepEqual(ROLE_RANK, { Operator: 0, Engineer: 1, Admin: 2 })
  assert.deepEqual(Object.keys(ROLE_RANK), ROLES)
})

// The full matrix, written out as the ANSWER rather than recomputed from ROLE_RANK — reading the
// table from both sides would make this pass at any table, which is the defect shape this workstream
// has been caught by before (`editorState.test.mjs`'s UNDO_DEPTH_LIMIT carries the same note).
const EXPECTED = [
  // [minRole,     userRole,     meetsMinRole]
  ["Operator", "Operator", true],
  ["Operator", "Engineer", true],
  ["Operator", "Admin", true],
  ["Engineer", "Operator", false],
  ["Engineer", "Engineer", true],
  ["Engineer", "Admin", true],
  ["Admin", "Operator", false],
  ["Admin", "Engineer", false],
  ["Admin", "Admin", true],
]

for (const [minRole, userRole, expected] of EXPECTED) {
  test(`meetsMinRole("${minRole}", "${userRole}") === ${expected}`, () => {
    assert.equal(meetsMinRole(minRole, userRole), expected)
  })
}

test("a higher role clears every lower gate — Admin is a superset, which is the whole point of ranking", () => {
  // If this ever went false, `Audit.tsx`/`Users.tsx`'s exact-string `RequireRole` shape would have
  // leaked in here, which `AssetRegistry.tsx`'s own doc comment exists to warn against.
  for (const minRole of ROLES) assert.equal(meetsMinRole(minRole, "Admin"), true, minRole)
})

test("an ABSENT userRole fails closed for every gate — signed out is not Operator", () => {
  for (const minRole of ROLES) {
    assert.equal(meetsMinRole(minRole, undefined), false, minRole)
    assert.equal(meetsMinRole(minRole, ""), false, `${minRole} / empty string`)
  }
})

test("an UNKNOWN userRole fails closed — an unrecognised role ranks below Operator, it does not default to it", () => {
  for (const minRole of ROLES) {
    assert.equal(meetsMinRole(minRole, "Superuser"), false, minRole)
    assert.equal(meetsMinRole(minRole, "operator"), false, `${minRole} / wrong case`)
  }
})

test("an UNKNOWN minRole fails closed — nothing clears a gate the ladder does not know", () => {
  // The asymmetric defaults (`-1` for an unknown user, `+Infinity` for an unknown gate) are what make
  // BOTH unknown directions deny. A single shared sentinel would make one of them permit.
  for (const userRole of ROLES) {
    assert.equal(meetsMinRole("Superuser", userRole), false, userRole)
    assert.equal(meetsMinRole("", userRole), false, `${userRole} / empty minRole`)
  }
})

test("FALSIFICATION CONTROL: the gate is not simply refusing everything", () => {
  // Every deny test above would also pass against `() => false`. This is the row that does not.
  assert.equal(meetsMinRole("Operator", "Operator"), true)
  assert.equal(meetsMinRole("Admin", "Admin"), true)
  assert.equal(EXPECTED.filter(([, , e]) => e).length, 6)
  assert.equal(EXPECTED.filter(([, , e]) => !e).length, 3)
})

// ── the nav variant: identical EXCEPT on an absent minRole ───────────────────────────────────────

test("navMeetsMinRole agrees with meetsMinRole on every STATED minimum", () => {
  for (const [minRole, userRole, expected] of EXPECTED) {
    assert.equal(navMeetsMinRole(minRole, userRole), expected, `${minRole}/${userRole}`)
  }
  for (const userRole of [undefined, "", "Superuser"]) {
    for (const minRole of ROLES) {
      assert.equal(
        navMeetsMinRole(minRole, userRole),
        meetsMinRole(minRole, userRole),
        `${minRole}/${String(userRole)}`
      )
    }
  }
})

test("an ABSENT minRole is the ONE divergence — nav says visible-to-all, strict says deny", () => {
  // 🔴 This is why the two functions were not merged. `NavItem.minRole` is optional and most entries
  // omit it, meaning "every authenticated role may see this". The seven route/component call sites
  // all pass a REQUIRED role, so under a merged body a falsy minRole would flip them from DENY to
  // ALLOW — a gate opening. The divergence is deliberate, and it is pinned here so a later
  // "simplification" that merges them reddens instead of silently widening seven gates.
  for (const userRole of ROLES) {
    assert.equal(navMeetsMinRole(undefined, userRole), true, userRole)
    assert.equal(meetsMinRole(undefined, userRole), false, userRole)
  }
})

test("an UNRESTRICTED nav entry answers `true` even with no user — the guard order, pinned as it is", () => {
  // 🔴 WRITTEN DOWN BECAUSE IT SURPRISED THIS TEST FIRST. `if (!minRole) return true` runs BEFORE the
  // `!userRole` check, so an entry carrying no `minRole` is "visible" even for `userRole: undefined`.
  // Verified against `5f00fef8`'s own `Sidebar.tsx` — this is the behaviour the copy always had, not
  // something the hoist introduced, and the hoist is required to preserve it rather than improve it.
  //
  // It is harmless where it is used, and the reason is structural rather than lucky: the ONLY caller
  // is `visibleNavItems`, and `App.tsx` does not render the Shell (hence no sidebar and no command
  // palette) until `useAuth()` has resolved a non-null user. A signed-out visitor gets `<Login/>`, so
  // no unrestricted entry is ever listed for a `userRole` of `undefined` in practice. Tightening this
  // to `false` would be a behaviour CHANGE in a debt-clearing session, and would additionally be
  // wrong if the shell were ever mounted during the auth round-trip: every unrestricted entry would
  // vanish and reappear.
  assert.equal(navMeetsMinRole(undefined, undefined), true)
  assert.equal(navMeetsMinRole(undefined, ""), true)

  // The strict function, by contrast, denies — which is what its seven call sites need.
  assert.equal(meetsMinRole(undefined, undefined), false)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SIDE B — the census: no ninth declaration
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The extensions a client-side declaration could live in. Same list `editorCanvasSeam.test.mjs`
 * settled on after a reviewer's impostor hid constants in a file kind the census did not read. */
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"]

/** Every file under `dir` with one of `extensions`, recursively, relative to `SRC` with `/`. */
function listSources(dir, extensions) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      found.push(...listSources(abs, extensions))
      continue
    }
    if (extensions.some((ext) => entry.endsWith(ext))) found.push(relative(SRC, abs).split(sep).join("/"))
  }
  return found
}

const SRC_FILES = listSources(SRC, CODE_EXTENSIONS)

/** The one module allowed to declare the ladder. */
const OWNER = "lib/roleRank.ts"

/**
 * ── HOW A DECLARATION IS RECOGNISED, AND WHY IT IS A PARSE AND NOT A REGEX ───────────────────────
 *
 * 🔴 FIX ROUND 1, review M-1. The first version of this census stripped comments with two regexes and
 * then matched `const|let|var ROLE_RANK`. The reviewer defeated it in one line, appended to `Site.tsx`:
 *
 *     const __probeUrl = "https://example.com//docs"; const ROLE_RANK: Record<string, number> = { … }
 *
 * The `//` inside the STRING LITERAL was read as the start of a line comment, so everything after it —
 * including the ninth ladder — was deleted before matching. The census exited 0 with two ladders in
 * the tree. Reproduced before fixing, and re-run as a control below.
 *
 * That is the same defect class this session's own report recorded learning from: the hoist-proof tool
 * matched a declaration quoted inside a doc comment, and the lesson was written down — comment
 * detection without a parser is not comment detection — and then not applied to the neighbouring
 * instrument. `scripts/check-comment-only.mjs`'s header already states the general form of the trap
 * ("a raw `ts.createScanner` is not safe… a parser knows what a backtick means") and this file now
 * follows its remedy: TypeScript's own parse, resolved the way `editorCanvasSeam.test.mjs` resolves
 * it. A parser knows a `//` inside a string is not a comment, and it needs no comment-stripping at
 * all, because comments are never part of the AST in the first place.
 *
 * ── WHAT IS RECOGNISED: A SHAPE, NOT A NAME ──────────────────────────────────────────────────────
 *
 * 🔴 FIX ROUND 1, review M-2. The regex forbade one IDENTIFIER, so a renamed table or an inline
 * literal walked straight past it. The rule is now the ladder's SHAPE: an object literal whose
 * property names are exactly the three roles. That is what makes a second ladder a second ladder —
 * the name it is bound to is incidental, and so is whether it is bound at all.
 *
 * WHAT THIS CATCHES (each asserted below, not merely claimed here):
 *   * the shipped form, and the string-literal probe that defeated round 1;
 *   * a RENAMED table (`const RANKS = { Operator: 0, … }`);
 *   * an INLINE literal never bound to a name (`({ Operator: 0, … })[role]`);
 *   * quoted keys, and keys in any order;
 *   * while ignoring comments, imports, uses, and unrelated objects.
 *
 * 🔴 WHAT IT STILL DOES NOT CATCH — stated because a census claiming total reach is worse than one
 * that names its limits, and this branch states its other limits the same way:
 *   * `new Map([["Operator", 0], …])` — an ordered role list re-encoded as a Map;
 *   * `["Operator","Engineer","Admin"]` with `indexOf` — the same ladder as an array;
 *   * a table built at runtime (`ROLES.reduce(…)`), or read from JSON;
 *   * two roles compared by `<`/`>` on some other encoding entirely.
 * There is no finite syntactic rule that catches every re-encoding of an ordered role list, and this
 * one does not pretend to. What it does is make the CHEAP path — copy the object literal back into a
 * route file, under any name — impossible to take silently. Anything in the list above is a
 * deliberate re-implementation, a different act from a copy-paste and one a reviewer reading a diff
 * will see. SIDE A's behavioural tests are what hold if someone writes one anyway.
 */
const ts = createRequire(join(WEB, "package.json"))("typescript")

/**
 * The property names of `node` if it is an object literal whose every property is a plain
 * `name: value` assignment, else `null`. A spread or a computed key returns `null` — such a literal is
 * not a legible table, and guessing at one would be a census reporting what it cannot see.
 */
function objectLiteralKeys(node) {
  if (!ts.isObjectLiteralExpression(node)) return null
  const keys = []
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) return null
    const name = prop.name
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) keys.push(name.text)
    else return null
  }
  return keys
}

/** Is this node an object literal keyed by exactly the three roles — under any name, or none? */
function isLadderLiteral(node) {
  const keys = objectLiteralKeys(node)
  return keys !== null && keys.length === ROLES.length && ROLES.every((role) => keys.includes(role))
}

/** Every ladder-shaped object literal in `text`, as `{ line }` records. */
function laddersIn(text, fileName = "probe.tsx") {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits = []
  const walk = (node) => {
    if (isLadderLiteral(node)) {
      hits.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 })
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return hits
}

const declaresLadder = (text) => laddersIn(text).length > 0

function declaringFiles() {
  return SRC_FILES.filter((rel) => declaresLadder(readSource(join(SRC, rel))))
}

test("floor: the census reads a real source tree and can see the owning module", () => {
  // A census that walked nothing would make every rule below vacuously green.
  assert.ok(SRC_FILES.length > 50, `listSources found only ${SRC_FILES.length} files — the walk is broken`)
  assert.ok(SRC_FILES.includes(OWNER), `the census does not contain ${OWNER} — it moved, or the walk is broken`)
  for (const rel of ["lib/api.ts", "hmi-runtime/writePermissionChannel.ts", "shell/Sidebar.tsx"]) {
    assert.ok(SRC_FILES.includes(rel), `the census does not contain ${rel}`)
  }
})

test("floor: the parser really parses — a syntactically real file yields real declarations", () => {
  // If `createSourceFile` were handed something it could not parse it would return an AST full of
  // error nodes and this census would quietly find nothing anywhere. One positive probe pins it works.
  const hits = laddersIn("const A = { Operator: 0, Engineer: 1, Admin: 2 }\nconst B = { x: 1 }\n")
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 1)
})

test("EXACTLY ONE file under web/src declares the role ladder, and it is lib/roleRank.ts", () => {
  assert.deepEqual(
    declaringFiles(),
    [OWNER],
    "a second role ladder has appeared (or the one true one moved) — import `meetsMinRole`/" +
      "`navMeetsMinRole` from `@/lib/roleRank` instead of re-declaring the table"
  )
})

test("the owning module declares the ladder exactly ONCE — its doc comment does not count", () => {
  // `lib/roleRank.ts` quotes the old declaration in its own header. A parser never sees it, which is
  // the property that makes this whole census trustworthy; asserted rather than assumed.
  const hits = laddersIn(readSource(join(SRC, OWNER)), OWNER)
  assert.equal(hits.length, 1, `expected one ladder in ${OWNER}, found ${hits.length}`)
})

test("all eight former declarers now IMPORT the ladder instead of declaring it", () => {
  // The consolidation itself, pinned by name: this is the list from the session ledger. If a file is
  // renamed this reddens, which is correct — the census above alone would stay green if a call site
  // quietly stopped gating at all.
  const FORMER = [
    ["components/MachineControlPanel.tsx", "meetsMinRole"],
    ["routes/AlarmCenter.tsx", "meetsMinRole"],
    ["routes/AssetRegistry.tsx", "meetsMinRole"],
    ["routes/Connectors.tsx", "meetsMinRole"],
    ["routes/LineControl.tsx", "meetsMinRole"],
    ["routes/Notifications.tsx", "meetsMinRole"],
    ["routes/Site.tsx", "meetsMinRole"],
    ["shell/Sidebar.tsx", "navMeetsMinRole"],
  ]
  for (const [rel, fn] of FORMER) {
    const text = readSource(join(SRC, rel))
    assert.match(
      text,
      new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*["']@/lib/roleRank["']`),
      `${rel} does not import ${fn} from @/lib/roleRank`
    )
    assert.ok(!declaresLadder(text), `${rel} declares a role ladder again`)
  }
})

test("the PROSE-ONLY mention is still prose, and was not mistaken for a declaration", () => {
  // 🔴 THE LEDGER'S WARNING, KEPT EXECUTABLE. At `5f00fef8` TWO files mentioned the ladder without
  // declaring it — `hmi-runtime/writePermissionChannel.ts` and `lib/api.ts` — and a grep counting
  // mentions would have "consolidated" both, neither of which compares a role at all.
  //
  // `lib/api.ts`'s mention was retired in this same session: its text was the M-1 note saying the
  // cache defect was "carried to S5 alongside the eight duplicate ROLE_RANK tables", and once that was
  // actually fixed the sentence was rewritten to describe the fix. So one prose mention remains, and
  // it is the one whose whole point is to say NO role comparison belongs on that path. An earlier
  // version of this test asserted both, and reddened when `api.ts` was edited — the control refusing
  // to keep claiming something that had stopped being true.
  const rel = "hmi-runtime/writePermissionChannel.ts"
  const raw = readSource(join(SRC, rel))
  assert.ok(raw.includes("ROLE_RANK"), `${rel} no longer mentions ROLE_RANK — this control is stale`)
  assert.ok(!declaresLadder(raw), `${rel} now DECLARES a ladder`)
  assert.ok(!declaringFiles().includes(rel), `${rel} was counted as a declarer`)

  // `lib/api.ts` must still not declare one, mention or no mention — that half of the guard stands.
  assert.ok(!declaringFiles().includes("lib/api.ts"), "lib/api.ts was counted as a declarer")
})

// ── the census's own falsification: what it catches, and what it admits it does not ───────────────

test("FALSIFICATION CONTROL: the M-1 string-literal probe is CAUGHT — round 1's bypass is closed", () => {
  // 🔴 THE REVIEWER'S EXACT PROBE. Under round 1's regex the `//` in the URL swallowed the rest of the
  // line and the census exited 0 with two ladders in the tree.
  const PROBE =
    'const __probeUrl = "https://example.com//docs"; const ROLE_RANK: Record<string, number> = ' +
    "{ Operator: 0, Engineer: 1, Admin: 2 }\n"
  assert.equal(laddersIn(PROBE).length, 1, "the string-literal probe still hides a ladder")

  // …and the PLAIN form must keep reddening too — closing the probe must not have cost the base case.
  const PLAIN = "const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }\n"
  assert.equal(laddersIn(PLAIN).length, 1, "the plain ninth copy is no longer caught")

  // Both in one file are two ladders, not one.
  assert.equal(laddersIn(PROBE + PLAIN).length, 2)
})

test("FALSIFICATION CONTROL: a RENAMED table and an INLINE literal are caught (review M-2)", () => {
  // The round-1 regex forbade an identifier, so both of these walked past it.
  assert.equal(laddersIn("const RANKS = { Operator: 0, Engineer: 1, Admin: 2 }\n").length, 1, "a rename escaped")
  assert.equal(
    laddersIn("const ok = ({ Operator: 0, Engineer: 1, Admin: 2 })[role] >= 1\n").length,
    1,
    "an inline literal escaped"
  )
  assert.equal(laddersIn('const R = { "Operator": 0, "Engineer": 1, "Admin": 2 }\n').length, 1, "quoted keys escaped")
  assert.equal(laddersIn("const R = { Admin: 2, Operator: 0, Engineer: 1 }\n").length, 1, "reordered keys escaped")
})

test("FALSIFICATION CONTROL: comments, imports and uses are NOT declarations", () => {
  // The other direction. Without these the census could be satisfied by a rule that fires on anything
  // containing the three words — which would report the owning module's own header as a violation.
  for (const notADeclaration of [
    "/** const ROLE_RANK = { Operator: 0, Engineer: 1, Admin: 2 } */\n",
    "// const ROLE_RANK = { Operator: 0, Engineer: 1, Admin: 2 }\n",
    'import { ROLE_RANK } from "@/lib/roleRank"\n',
    'const x = ROLE_RANK["Admin"]\n',
    'const s = "Operator Engineer Admin"\n',
    "const colours = { red: 0, green: 1, blue: 2 }\n",
    "const partial = { Operator: 0, Engineer: 1 }\n",
  ]) {
    assert.equal(laddersIn(notADeclaration).length, 0, `counted as a declaration: ${notADeclaration.trim()}`)
  }
})

test("STATED RESIDUE: re-encodings this census does NOT catch, asserted so the limit is honest", () => {
  // 🔴 These are the census's known blind spots, pinned AS blind spots. If a later change makes any of
  // them detectable, this test reddens and the header's "what it does not catch" list must be
  // corrected — which is the point: the limit is measured, not merely described.
  //
  // Each is a deliberate re-implementation rather than a copy of the literal, and SIDE A's behavioural
  // tests are what hold if someone writes one.
  const RESIDUE = [
    'const m = new Map([["Operator", 0], ["Engineer", 1], ["Admin", 2]])\n',
    'const order = ["Operator", "Engineer", "Admin"]\nconst ok = order.indexOf(a) >= order.indexOf(b)\n',
    'const built = ["Operator", "Engineer", "Admin"].reduce((acc, r, i) => ({ ...acc, [r]: i }), {})\n',
  ]
  for (const reEncoding of RESIDUE) {
    assert.equal(
      laddersIn(reEncoding).length,
      0,
      `this census now DETECTS a re-encoding it documents as out of reach — update the header:\n${reEncoding}`
    )
  }
})
