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
 * Does this source DECLARE the ladder — as opposed to merely mentioning it?
 *
 * 🔴 THE DISTINCTION IS THE WHOLE POINT. Two files in this tree (`hmi-runtime/writePermissionChannel.ts`
 * and `lib/api.ts`) name `ROLE_RANK` in prose, and the owning module quotes its own former shape in a
 * doc comment. A matcher that counted those would report ten declarations where there are one, and
 * would send the next reader to edit two files that compare no roles at all.
 *
 * So comments are STRIPPED before matching, and what is matched is a binding — `const ROLE_RANK` /
 * `let ROLE_RANK` / `var ROLE_RANK`, optionally exported — not the identifier. An IMPORT of the name
 * is not a declaration of the table and stays legal everywhere.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

const DECLARES = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+ROLE_RANK\b/

function declaringFiles() {
  return SRC_FILES.filter((rel) => DECLARES.test(stripComments(readSource(join(SRC, rel)))))
}

test("floor: the census reads a real source tree and can see the owning module", () => {
  // A census that walked nothing would make every rule below vacuously green.
  assert.ok(SRC_FILES.length > 50, `listSources found only ${SRC_FILES.length} files — the walk is broken`)
  assert.ok(SRC_FILES.includes(OWNER), `the census does not contain ${OWNER} — it moved, or the walk is broken`)
  for (const rel of ["lib/api.ts", "hmi-runtime/writePermissionChannel.ts", "shell/Sidebar.tsx"]) {
    assert.ok(SRC_FILES.includes(rel), `the census does not contain ${rel}`)
  }
})

test("EXACTLY ONE file under web/src declares the role ladder, and it is lib/roleRank.ts", () => {
  assert.deepEqual(
    declaringFiles(),
    [OWNER],
    "a ninth ROLE_RANK declaration has appeared (or the one true one moved) — import it from " +
      "`@/lib/roleRank` instead of re-declaring the table"
  )
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
    const text = stripComments(readSource(join(SRC, rel)))
    assert.match(
      text,
      new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*["']@/lib/roleRank["']`),
      `${rel} does not import ${fn} from @/lib/roleRank`
    )
    assert.ok(!DECLARES.test(text), `${rel} declares ROLE_RANK again`)
  }
})

test("the PROSE-ONLY mention is still prose, and was not mistaken for a declaration", () => {
  // 🔴 THE LEDGER'S WARNING, KEPT EXECUTABLE. At `5f00fef8` TWO files mentioned the ladder without
  // declaring it — `hmi-runtime/writePermissionChannel.ts` and `lib/api.ts` — and a grep counting
  // mentions would have "consolidated" both, neither of which compares a role at all.
  //
  // `lib/api.ts`'s mention was retired in this same session: its text was the M-1 note saying the
  // cache defect was "carried to S5 alongside the eight duplicate ROLE_RANK tables", and once M-1 was
  // actually fixed that sentence was rewritten to describe the fix. So one prose mention remains, and
  // it is the one whose whole point is to say NO role comparison belongs on that path. An earlier
  // version of this test asserted both, and reddened when `api.ts` was edited — which is the control
  // working: it refuses to keep claiming something that stopped being true.
  const rel = "hmi-runtime/writePermissionChannel.ts"
  const raw = readSource(join(SRC, rel))
  assert.ok(raw.includes("ROLE_RANK"), `${rel} no longer mentions ROLE_RANK — this control is stale`)
  assert.ok(!DECLARES.test(stripComments(raw)), `${rel} now DECLARES the ladder`)
  assert.ok(!declaringFiles().includes(rel), `${rel} was counted as a declarer`)

  // `lib/api.ts` must still not declare it, mention or no mention — that half of the guard stands.
  assert.ok(!declaringFiles().includes("lib/api.ts"), "lib/api.ts was counted as a declarer")
})

test("FALSIFICATION CONTROL: the matcher really fires on a ninth copy, and really ignores a mention", () => {
  // Without this pair, `EXACTLY ONE` above would pass just as happily against a regex that matches
  // nothing at all — the exact way a census can measure zero and look green.
  const NINTH = `const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }\n`
  assert.ok(DECLARES.test(stripComments(`import x from "y"\n${NINTH}`)), "the matcher missed a bare ninth copy")
  assert.ok(DECLARES.test(stripComments(`export ${NINTH}`)), "the matcher missed an EXPORTED ninth copy")
  assert.ok(DECLARES.test(stripComments(`let ROLE_RANK = {}\n`)), "the matcher missed a `let` declaration")

  // …and the other direction: the shapes that must NOT count.
  assert.ok(!DECLARES.test(stripComments(`/** eight copies of ROLE_RANK once lived here */\n`)), "a block comment counted")
  assert.ok(!DECLARES.test(stripComments(`// const ROLE_RANK: Record<string, number> = {}\n`)), "a line comment counted")
  assert.ok(
    !DECLARES.test(stripComments(`import { ROLE_RANK } from "@/lib/roleRank"\n`)),
    "an import counted as a declaration"
  )
  assert.ok(!DECLARES.test(stripComments(`const x = ROLE_RANK["Admin"]\n`)), "a USE counted as a declaration")
})

test("FALSIFICATION CONTROL: stripComments does not eat code, and does not spare a URL's slashes", () => {
  // If `stripComments` over-stripped, the census would report zero declarers and stay green forever.
  assert.ok(stripComments(`const a = 1 // note\nconst ROLE_RANK = {}\n`).includes("const ROLE_RANK"))
  assert.ok(stripComments(`const u = "https://x/y"\nconst ROLE_RANK = {}\n`).includes("const ROLE_RANK"))
  assert.ok(stripComments(`const u = "https://x/y"`).includes("https://x/y"), "a URL lost its path")
})
