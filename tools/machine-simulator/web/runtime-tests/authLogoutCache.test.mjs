// Run: npm run test:runtime   (node --test, no extra package)
//
// SESSION 5 (residuals) — M-1: DOES A LOGOUT ACTUALLY EMPTY THE CACHE, AND DOES IT LEAVE A LIVE
// SESSION ALONE?
//
// ── THE DEFECT THIS PINS THE FIX FOR ─────────────────────────────────────────────────────────────
// At `5f00fef8`, `lib/auth.ts`'s `logout` called `POST /v1/auth/logout` and wrote `null` into
// `["auth","me"]`. Nothing else was touched, so every other entry survived for the default 5-minute
// `gcTime`. `lib/api.ts`'s `useWritePermissions` caches a per-machine WRITE VERDICT under
// `["writePermissions", code]`; an Admin's verdict could therefore be served synchronously to the
// next person who signed in on the same browser and opened the same machine, showing an Operator an
// enabled control for one round-trip. Carried from S1 deliberately, because changing global cache
// behaviour is a wider blast radius than a security review covered. This is that change, measured.
//
// ── WHY BOTH DIRECTIONS ARE PINNED, AND WHICH ONE IS THE DANGEROUS ONE ───────────────────────────
// A logout fix is trivially "provable" by clearing everything, and clearing everything is exactly the
// bug: `queryClient.clear()` also drops `["auth","me"]` and `["auth","bootstrap-status"]`, which
// `App.tsx`'s `AuthGate` renders from —
//
//     if (auth.isLoading || bootstrapStatus.isLoading) return <AuthSplash />
//     if (bootstrapStatus.data?.needsBootstrap)        return <Bootstrap />
//     if (auth.user == null)                           return <Login />
//
// so a signing-out user would land on the SPLASH rather than on `<Login/>`, and a mid-session
// mis-fire would blank a working screen. So this file pins:
//
//   DIRECTION 1 (it really clears) — a seeded non-auth entry is GONE after the logout sequence, and
//   is gone as an ENTRY, not merely stale: a stale entry is still served synchronously to the next
//   reader, which is the whole defect.
//
//   DIRECTION 2 (it breaks nothing) — the two gate keys SURVIVE with their data intact, so the gate
//   can still render `<Login/>` without a refetch; and, separately, nothing on the live-session paths
//   removes anything at all.
//
// ── HOW IT IS MEASURED ───────────────────────────────────────────────────────────────────────────
// Against a REAL `QueryClient` from `@tanstack/query-core` (the same package `@tanstack/react-query`
// re-exports it from — `App.tsx` constructs one), seeded the way the app seeds it, and then put
// through the EXACT two statements `logout` runs after `postLogout()` resolves:
//
//     queryClient.removeQueries({ predicate: (query) => !isAuthGateQueryKey(query.queryKey) })
//     queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
//
// `isAuthGateQueryKey` and both key constants are IMPORTED FROM THE SHIPPING MODULE
// (`src/lib/authCacheScope.ts`), not re-declared here, so this test cannot pass against a predicate
// that stopped matching what the app uses. The two statements themselves are re-stated in
// `runLogoutCacheSequence` below (`auth.ts` imports React and `@/lib/api`, so Node cannot import it),
// and a source-text check at the bottom asserts `auth.ts` really runs this pair — the seam this file
// cannot execute across, named rather than left implicit.
//
// Source text is read line-ending normalised: `core.autocrlf=true`, no `.gitattributes`, and a
// matcher requiring an exact newline shape passed on one worktree and failed on another at the same
// commit two sessions ago. Same `readSource` shape as `screenPackGates.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { QueryClient } from "@tanstack/query-core"

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..")
const readSource = (...parts) => readFileSync(join(WEB, ...parts), "utf8").replace(/\r\n/g, "\n")

/** Block and line comments removed, so a source-text rule measures CODE rather than prose about it.
 * See the source-text test's own note for the failure that made this necessary. The `[^:]` guard
 * keeps a `https://` URL's path intact. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const { AUTH_ME_QUERY_KEY, BOOTSTRAP_STATUS_QUERY_KEY, isAuthGateQueryKey } = await import(
  "../src/lib/authCacheScope.ts"
)

/** The two statements `lib/auth.ts`'s `logout` runs once `POST /v1/auth/logout` has resolved. */
function runLogoutCacheSequence(queryClient) {
  queryClient.removeQueries({ predicate: (query) => !isAuthGateQueryKey(query.queryKey) })
  queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
}

/** A client seeded as a signed-in Admin's would be: the two gate entries, plus real app traffic. */
function seededClient() {
  const qc = new QueryClient()
  qc.setQueryData(AUTH_ME_QUERY_KEY, { username: "ad", role: "Admin", displayName: null })
  qc.setQueryData(BOOTSTRAP_STATUS_QUERY_KEY, { needsBootstrap: false })
  // 🔴 The entry M-1 is actually about.
  qc.setQueryData(["writePermissions", "AOI-01"], { permissions: [{ action: "start", permitted: true }] })
  qc.setQueryData(["machine", "AOI-01"], { code: "AOI-01", state: "Execute" })
  qc.setQueryData(["fleet"], [{ code: "AOI-01" }])
  qc.setQueryData(["screen", "machine-aoi-01"], { screenId: "machine-aoi-01" })
  return qc
}

const keysIn = (qc) =>
  qc
    .getQueryCache()
    .getAll()
    .map((q) => JSON.stringify(q.queryKey))
    .sort()

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The predicate itself
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the exemption covers EXACTLY the two keys AuthGate renders from", () => {
  assert.equal(isAuthGateQueryKey(["auth", "me"]), true)
  assert.equal(isAuthGateQueryKey(["auth", "bootstrap-status"]), true)
})

test("the exemption is not a NAMESPACE — another [\"auth\", …] key is still cleared", () => {
  // If this were a `queryKey[0] === "auth"` prefix test, a future auth-adjacent cache entry would
  // survive a logout for free, which is M-1 reappearing at a new address.
  assert.equal(isAuthGateQueryKey(["auth", "sessions"]), false)
  assert.equal(isAuthGateQueryKey(["auth"]), false)
  assert.equal(isAuthGateQueryKey(["auth", "me", "extra"]), false)
})

test("FALSIFICATION CONTROL: the predicate is not simply answering true, or simply false", () => {
  assert.equal(isAuthGateQueryKey(["writePermissions", "AOI-01"]), false)
  assert.equal(isAuthGateQueryKey([]), false)
  // …and the true side is genuinely reachable (the two rows above already assert it, restated here so
  // this control fails if someone "simplifies" the predicate to a constant `false`).
  assert.ok([["auth", "me"], ["auth", "bootstrap-status"]].every((k) => isAuthGateQueryKey(k)))
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// DIRECTION 1 — the logout really clears
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("DIRECTION 1: the Admin's cached write verdict is GONE after logout — not stale, ABSENT", () => {
  const qc = seededClient()
  assert.ok(qc.getQueryData(["writePermissions", "AOI-01"]) !== undefined, "seed failed")

  runLogoutCacheSequence(qc)

  // Absence of the DATA…
  assert.equal(qc.getQueryData(["writePermissions", "AOI-01"]), undefined)
  // …and absence of the ENTRY. A merely-invalidated entry keeps its data and is still handed to the
  // next reader synchronously while it refetches, which is precisely the one-round-trip window M-1
  // describes. `removeQueries` is what makes the next reader start from nothing.
  assert.equal(
    qc.getQueryCache().find({ queryKey: ["writePermissions", "AOI-01"] }),
    undefined,
    "the entry survived as a cache row — the next identity would still be served it"
  )
})

test("DIRECTION 1: every non-auth entry goes, not just the one M-1 named", () => {
  const qc = seededClient()
  runLogoutCacheSequence(qc)
  assert.deepEqual(keysIn(qc), [JSON.stringify(BOOTSTRAP_STATUS_QUERY_KEY), JSON.stringify(AUTH_ME_QUERY_KEY)].sort())
})

test("FALSIFICATION CONTROL: the sequence is not a no-op — the seed really held those entries first", () => {
  // Without this, DIRECTION 1 would pass just as happily against a client that was empty all along.
  const qc = seededClient()
  assert.equal(keysIn(qc).length, 6)
  runLogoutCacheSequence(qc)
  assert.equal(keysIn(qc).length, 2)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// DIRECTION 2 — the logout breaks nothing
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("DIRECTION 2: AuthGate can still render <Login/> WITHOUT a refetch — both gate entries survive", () => {
  const qc = seededClient()
  runLogoutCacheSequence(qc)

  // `bootstrapStatus.data` must still be there, or `bootstrapStatus.isLoading` flips true and the
  // gate shows <AuthSplash/> instead of <Login/>.
  assert.deepEqual(qc.getQueryData(BOOTSTRAP_STATUS_QUERY_KEY), { needsBootstrap: false })
  assert.notEqual(qc.getQueryCache().find({ queryKey: BOOTSTRAP_STATUS_QUERY_KEY }), undefined)

  // `["auth","me"]` must exist AND be exactly `null` — `undefined` would mean "no data yet"
  // (`auth.isLoading`), which is the splash again; `null` is the resolved "signed out" answer.
  assert.notEqual(qc.getQueryCache().find({ queryKey: AUTH_ME_QUERY_KEY }), undefined)
  assert.equal(qc.getQueryData(AUTH_ME_QUERY_KEY), null)
})

test("DIRECTION 2 — NEGATIVE CONTROL: `queryClient.clear()` DOES break the gate", () => {
  // 🔴 This is the test that gives DIRECTION 2 its meaning. Both assertions below would be identical
  // for the shipped sequence and for the naive one; what separates them is that `clear()` fails here
  // and the shipped sequence passes the test above. Without this row, "the gate still works" could be
  // satisfied by any implementation, including one that never cleared anything.
  const qc = seededClient()
  qc.clear()
  qc.setQueryData(AUTH_ME_QUERY_KEY, null)

  assert.equal(
    qc.getQueryData(BOOTSTRAP_STATUS_QUERY_KEY),
    undefined,
    "clear() left bootstrap-status behind — this control no longer demonstrates the hazard"
  )
  // …which is `bootstrapStatus.isLoading === true` on the next render: <AuthSplash/>, not <Login/>.
})

test("DIRECTION 2: a LIVE session is untouched — nothing outside logout removes anything", () => {
  // The login path writes; it must not remove. Seeded, logged in again, everything still present.
  const qc = seededClient()
  qc.setQueryData(AUTH_ME_QUERY_KEY, { username: "op", role: "Operator", displayName: null })
  assert.equal(keysIn(qc).length, 6, "a plain setQueryData removed something")
  assert.deepEqual(qc.getQueryData(["machine", "AOI-01"]), { code: "AOI-01", state: "Execute" })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The seam this file cannot execute across: that `auth.ts` actually runs the pair
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("lib/auth.ts's logout runs the removeQueries+setQueryData pair, and does NOT call clear()", () => {
  // Everything above measures the SEQUENCE. This is the one claim that has to be read rather than
  // run, because `auth.ts` imports React and `@/lib/api` and Node cannot resolve the `@/` alias.
  // Named as a source-text check so nobody mistakes it for a behavioural one.
  // 🔴 COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. `logout`'s own doc comment EXPLAINS why
  // `queryClient.clear()` is the wrong call, so `auth.ts` contains that literal twice — in prose. The
  // first version of this test matched raw source and failed on its own explanation: a matcher
  // measuring prose rather than code, the same hazard the session ledger records for the
  // eight-declarations-vs-ten-mentions grep. Kept as a note because the failure was instructive.
  const src = stripComments(readSource("src", "lib", "auth.ts"))
  const logout = src.slice(src.indexOf("const logout = React.useCallback"))
  const body = logout.slice(0, logout.indexOf("}, [queryClient])"))

  assert.match(body, /await postLogout\(\)/, "logout no longer awaits the API call first")
  assert.match(
    body,
    /queryClient\.removeQueries\(\{\s*predicate:\s*\(query\)\s*=>\s*!isAuthGateQueryKey\(query\.queryKey\)\s*\}\)/,
    "logout does not run the exempting removeQueries the tests above measure"
  )
  assert.match(body, /queryClient\.setQueryData\(AUTH_ME_QUERY_KEY,\s*null\)/, "logout no longer seeds null")
  assert.ok(!/queryClient\.clear\(\)/.test(src), "auth.ts calls clear() — see the negative control above")

  // Order matters: seeding `null` BEFORE the removal would have the removal delete the seed.
  assert.ok(
    body.indexOf("removeQueries") < body.indexOf("setQueryData"),
    "setQueryData runs before removeQueries — the null seed would be removed again"
  )
})

test("FALSIFICATION CONTROL: the source matchers really can fail, and stripComments cuts both ways", () => {
  // A regex that matches nothing would make the check above green forever.
  const pattern = /queryClient\.removeQueries\(\{\s*predicate:/
  assert.ok(!pattern.test("await postLogout()\nqueryClient.setQueryData(K, null)"), "matcher fires on the OLD body")
  assert.ok(pattern.test("queryClient.removeQueries({ predicate: (q) => true })"), "matcher misses the new body")

  // The stripper must remove a MENTION of clear()…
  assert.ok(!/clear\(\)/.test(stripComments("/** why not queryClient.clear() */")), "a block comment survived")
  assert.ok(!/clear\(\)/.test(stripComments("// queryClient.clear()")), "a line comment survived")
  // …and must NOT remove the call itself, or `does NOT call clear()` above would measure nothing.
  assert.ok(/clear\(\)/.test(stripComments("queryClient.clear()")), "the stripper ate real code")
  assert.ok(stripComments('const u = "https://x/y"').includes("https://x/y"), "a URL lost its path")
})
