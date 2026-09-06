# SESSION 5 — the residuals: report

Branch `feat/hmi-s5-residuals`, BASE `5f00fef8`. Debt-clearing only: no new schema, no new write
route, no baseline moved, no frozen file touched.

---

## 1. The role ladder — eight declarations to one

### What was there

The ledger's count is confirmed by measurement, including the part a naive grep gets wrong:

| | files | what they did |
|---|---|---|
| declared the ladder | **8** | `MachineControlPanel`, `AlarmCenter`, `AssetRegistry`, `Connectors`, `LineControl`, `Notifications`, `Site`, `Sidebar` |
| mentioned it in prose only | **2** | `hmi-runtime/writePermissionChannel.ts`, `lib/api.ts` |
| a naive `grep -l ROLE_RANK` | 10 | would have "consolidated" two files that compare no roles at all |

### The consolidation

New module `web/src/lib/roleRank.ts`, following the precedent `lib/driverKind.ts` already set
(a per-file duplicate hoisted to one plain-`.ts`, JSX-free home that `node --test` can execute).

It exports **two** functions, not one, and that is the load-bearing finding of this item.

### 🔴 The eight copies were not eight copies of the same thing

Seven were byte-identical. `Sidebar.tsx`'s was **not**: it took `minRole: string | undefined` and
carried one extra leading line, `if (!minRole) return true`, because its caller passes the optional
`NavItem.minRole` where absence means "visible to every authenticated role".

Merging that guard into one shared function would have **changed the other seven**. Each of them
passes a required `role`/literal; under the merged body a `minRole` that ever arrived falsy would
flip from DENY (`ROLE_RANK[""] ?? +Infinity` — nothing outranks it) to ALLOW. That is seven gates
opening silently. So the *ladder* is shared and the two comparison shapes stay two functions:
`meetsMinRole` (strict) and `navMeetsMinRole` (nav entries).

### How behaviour-preservation was PROVEN, not asserted

Two independent mechanical checks, both run against the base commit's own text:

**(a) At edit time.** The hoist was performed by a script that, for each file, required the exact
seven-copy block to be present **verbatim exactly once** before removing it, and aborted otherwise.
Nothing was matched loosely or removed by hand. All seven reported `ok`. `Sidebar.tsx` was handled
separately with its own unique-anchor assertion, and a post-check that no bare `meetsMinRole`
reference survived.

**(b) After the fact, as a differential.** A script extracted the `ROLE_RANK` declaration and the
`meetsMinRole` signature+body from all eight files **as they stood at `5f00fef8`** (via `git show`,
line-ending normalised) and compared them against the shared module:

```
── ROLE_RANK declarations at 5f00fef8 ──
distinct texts: 1
  const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

── meetsMinRole bodies at 5f00fef8 ──
[7 file(s)] MachineControlPanel, AlarmCenter, AssetRegistry, Connectors, LineControl, Notifications, Site
    (minRole: string, userRole: string | undefined) { … 3 lines … }
[1 file(s)] Sidebar.tsx
    (minRole: string | undefined, userRole: string | undefined) { … 4 lines … }

── shared lib/roleRank.ts ──
ROLE_RANK identical to all eight originals: true
meetsMinRole      === the seven-file body : true
navMeetsMinRole   === Sidebar's own body  : true
Sidebar was the ONE outlier              : true
```

Every call site therefore computes exactly what it computed before, by textual identity of the
function bodies rather than by assertion.

**One note on the instrument itself.** The first run of (b) reported `ROLE_RANK identical: false`.
The cause was not a behaviour difference: my regex's first match in the shared file landed on the
declaration **quoted inside its own doc comment**, not on the code. This is the same
comment-vs-code hazard the ledger records for the eight-vs-ten file count, reproduced inside my own
proof. Fixed by taking the exported declaration and asserting it is the exported one. Recorded
because the failure was instructive, not incidental.

### The pin against a ninth copy

`web/runtime-tests/roleRank.test.mjs` (24 tests), following the census precedent in
`editorCanvasSeam.test.mjs` rather than inventing a mechanism:

- **SIDE A — behaviour, executed.** The full 3×3 matrix written out as the *answer* (not recomputed
  from `ROLE_RANK`, which would pass at any table), plus absent/unknown `userRole` and unknown
  `minRole` — all of which must fail closed. The two functions are asserted to agree everywhere
  except on an absent `minRole`, which is pinned as the deliberate divergence so a later
  "simplification" that merges them reddens instead of widening seven gates.
- **SIDE B — census.** Walks `web/src/**` over `.ts/.tsx/.js/.mjs/.cjs`, **strips comments**, and
  matches a *binding* (`const|let|var ROLE_RANK`), never the bare identifier. Asserts exactly one
  declaring file. Also asserts all eight former declarers now import, and that the prose-only
  mention is still prose.

---

## 2. `logout` does not clear the query cache — fixed, pinned both ways

### The change

`lib/auth.ts`'s `logout` previously called the API and wrote `null` into `["auth","me"]`. It now
also removes every other cache entry:

```ts
await postLogout()
queryClient.removeQueries({ predicate: (query) => !isAuthGateQueryKey(query.queryKey) })
queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
```

### 🔴 Why not `queryClient.clear()` — the half that bites

`clear()` empties the query **and mutation** caches, including the two `["auth", …]` entries
`App.tsx`'s `AuthGate` renders from:

```
if (auth.isLoading || bootstrapStatus.isLoading) return <AuthSplash />
if (bootstrapStatus.data?.needsBootstrap)        return <Bootstrap />
if (auth.user == null)                           return <Login />
```

Dropping `["auth","bootstrap-status"]` puts that query back to `isLoading`, so a signing-out user
lands on the **splash** rather than on `<Login/>` — and then on whatever the refetch says. Dropping
`["auth","me"]` does the same via `auth.isLoading`. Hence the exemption.

The predicate lives in a new alias-free module `web/src/lib/authCacheScope.ts` (with the two key
constants moved there, so predicate and queries cannot name different keys), because `auth.ts`
imports React and `@/lib/api` and Node cannot resolve the `@/` alias — the rule had to be
**executable**, not pattern-matched. The exemption is elementwise against two literals, *not* an
`"auth"` prefix, so a future `["auth", …]` key the gate does not read is still cleared.

### The pin, in both directions

`web/runtime-tests/authLogoutCache.test.mjs` (11 tests) drives a **real `QueryClient`** from
`@tanstack/query-core`, seeded as a signed-in Admin's would be, through the exact two statements.

- **Direction 1 — it really clears.** The Admin's `["writePermissions","AOI-01"]` is gone as an
  **entry**, not merely stale — a stale entry is still served synchronously to the next reader,
  which *is* the defect. All four non-auth entries go.
- **Direction 2 — it breaks nothing.** Both gate entries survive with data intact, so the gate
  renders `<Login/>` with no refetch; `["auth","me"]` exists and is exactly `null` (not `undefined`,
  which would mean "still loading" → splash). A live session is untouched.

---

## 3. The five load-bearing lines — three pinned, two deliberately not

Confirmed at base: **no test mentioned `alreadyWarned`**, `describeId`, or `staleTime: Infinity`.

### Pinned — `web/runtime-tests/publishedScreenWarning.test.mjs` (11 tests)

`renderableScreen`'s fallback is deliberately **silent on screen and loud in the console**. The
console line is therefore the entire compensating control, and it was unmeasured — a silent-on-screen
fallback whose loud half is untested has no observable behaviour at all.

1. **`alreadyWarned` warn-once.** Ten renders of one bad document → exactly one line. Plus: the
   de-duplication is per-document, not a global "have we ever warned" boolean (which would pass a
   naive warn-once test while silencing every screen after the first); equal-but-not-identical
   documents each warn (identity keying, stated as the deliberate design it is); a good document
   never warns; a non-object is refused **without** warning but still refused with a reason.
2. **`describeId`.** Both branches, observed through the emitted message rather than by exporting
   the private helper: the id appears quoted, and a document with no usable `screenId` prints
   `(with no screenId)` and never leaks the literal `undefined`.
3. **The reason and provenance** travel into the message — and it is asserted to be the *same*
   string `unrenderableReason` returns, so console and guard cannot drift.

### Pinned — `web/tests/46-demo-route-no-screen-fetch.spec.ts` (2 tests)

The **demo-route exclusion**, observed as network traffic. `Hmi.tsx`'s own comment demands it be
excluded "at the FETCH, not merely at the render", and only the network can tell "fetched and
ignored" from "never fetched". The collision is real: the demo route substitutes
`DEMO_MACHINE_CODE = "IOT-01"`, so without the exclusion it would request `machine-iot-01` while the
URL named a different document. The **operator route is the control in the same file** — it must
make exactly such a request, so the spec cannot pass against an app that lost the join entirely.

### 🔴 NOT pinned, deliberately — with the reason

**`useScreenAtVersion`'s `staleTime: Infinity`.** The only test available in this tree is a
source-text assertion that the literal appears in `lib/api.ts`. That measures a character sequence,
not a behaviour: it cannot fail except when someone edits that line, and if they edit it deliberately
it tells them only what they already know. The property it *claims* to protect — a version row is
immutable, so refetching is pure cost — is a statement about the **server**
(`HmiScreenStore.PutAsync`/`RollbackAsync` append, never rewrite), already pinned in the .NET store
tests. Restating it client-side as a string match would add a red light that means nothing.

**The three `enabled` gates.** `enabled: screenId !== undefined && …` is TanStack's own documented
behaviour applied to a one-line boolean; a unit test would be testing the library. The consequence
that actually matters — no request on the demo route — is pinned as browser traffic in spec 46
above, which is where the claim is真 falsifiable.

Both decisions are recorded in the test file's own header so the gaps are known choices, not
oversights. A test written only to raise a number is worse than the gap it fills.

---

## 4. Editor navigation — deferred, with the measurement that decides it

**Decision: do not add it in this session. It belongs in a later session with a design pass.**

The state is as the ledger says: `/editor/:screenId` is routed in `App.tsx` but nothing links to it,
and `GET /v1/screens` (`HmiScreenEndpoints.cs:165`, `RequireAuthorization(Policies.Operator)`) has
**no client function at all** — not an unused hook, no consumer whatsoever.

The reason for deferring is measured, not aesthetic. A screens index needs a nav entry to be
reachable, and `tests/00-visual-and-a11y.spec.ts` holds **22 full-page pixel baselines** — dashboard,
machines, machine-detail, product-config, scenario, inspector, onboarding and more, across three
themes — every one of which contains the sidebar. Adding one nav row changes all 22.

The constraint for this session is explicit: *no baseline may move; a moved baseline is a finding
you report, never a file you update.* The minimal-looking option is therefore not minimal — it is a
22-baseline change plus a new route, a new client hook, i18n keys in two languages, and role gating,
inside a session whose boundary says "no new features".

This is an acceptable answer under the brief, and it is the honest one: the item is small in UI and
large in blast radius, which is exactly the shape that deserves its own session rather than being
bolted onto a debt-clearing pass.

---

## Falsification table

Every property was falsified by mutating the code and confirming the *named* test reddens, then
restoring and confirming green. Negative controls are listed where a check could otherwise pass by
refusing or clearing everything.

| # | Property | Mutation applied | Result |
|---|---|---|---|
| 1 | Only one file declares the ladder | added a ninth `const ROLE_RANK` to `Site.tsx` | ✅ `EXACTLY ONE file…` + `all eight former declarers…` red (22/24) |
| 2 | The census counts declarations, not mentions | *(control)* comment / import / use fed to the matcher | ✅ none counted; a bare, an exported and a `let` copy all counted |
| 3 | `stripComments` does not over-strip | *(control)* real code + a `https://` URL | ✅ code and URL path survive |
| 4 | The gate is not "deny everything" | *(control)* 6 permit rows vs 3 deny rows asserted | ✅ both classes non-empty |
| 5 | Logout really clears | reverted `logout` to its pre-S5 body | ✅ `DIRECTION 1` ×2 + the no-op control red (8/11) |
| 6 | Logout does not break the gate | swapped in naive `queryClient.clear()` | ✅ `DIRECTION 2: AuthGate can still render <Login/>` red (8/11) |
| 7 | **Negative control** for #5/#6 | `clear()` asserted to *drop* bootstrap-status | ✅ the hazard is demonstrated, so "gate still works" is not vacuous |
| 8 | The predicate is not a constant | *(control)* true-side and false-side keys | ✅ both reachable |
| 9 | warn-once is the WeakSet's doing | removed `!alreadyWarned.has(doc)` | ✅ `warns EXACTLY ONCE` + `per DOCUMENT` red (9/11) |
| 10 | `describeId`'s no-id branch exists | made it always return the id branch | ✅ `a document with NO usable screenId…` red (10/11) |
| 11 | **Negative control** for #9 | the warning is asserted to actually FIRE | ✅ separates "once" from "never" |
| 12 | The message names id/reason/rollback | *(control)* a bare message rejected by all three matchers | ✅ matchers discriminate |
| 13 | Source matchers can fail | *(control)* old logout body vs new | ✅ matcher fires on new, not old |
| 14 | Demo route makes no screen request | *(control in-file)* operator route must make one | ✅ one-sided "no request" cannot pass alone |

An additional falsification arrived unplanned and is worth recording: the roleRank census test
**reddened when I edited `lib/api.ts`'s prose**, because it asserted that file still mentions
`ROLE_RANK`. That is the control refusing to keep claiming something that had stopped being true —
the test was corrected to the new reality, not weakened.

---

## Suites — run by name

| Suite | Base | This branch |
|---|---|---|
| `St4i.Connector.Abstractions.Tests` | 161 | **161** ✅ |
| `St4i.Hmi.Contracts.Tests` | 170 | **170** ✅ |
| `St4i.Connector.Conformance.Tests` | 24 | **24** ✅ |
| `St4i.EdgeService.Tests` | 52 | **52** ✅ |
| `St4i.EdgeCore.Tests` | 1310 | **1310** ✅ |
| `St4i.EngineApi.Tests` | 1949 | **1949** ✅ |
| `node scripts/check-contracts.mjs` | pass | **pass (52)** ✅ |
| `npx tsc -b --force` | clean | **clean** ✅ |
| `npx oxlint` | 15 warnings, 0 errors | **15 warnings, 0 errors** ✅ |
| `npm run test:runtime` | 556 | **602** (+46) ✅ |
| `npm run check:test-budgets` | pass | **pass, 0 over budget** ✅ |
| `npx playwright test` | 299 | *(see below)* |

`Abstractions` was re-run after the `web/src/` changes, as required.

The oxlint count is unchanged and the two `Sidebar.tsx` `only-export-components` warnings were
verified **pre-existing** by linting the base versions of the changed files in isolation.

---

## Frozen files and baselines

`git diff --name-only` against each frozen path returns zero:

- `contracts/*.schema.json` — 0
- `src/St4i.Hmi.Contracts/*.cs` — 0
- `web/src/contracts/*.ts` — 0
- `web/src/hmi-runtime/ScreenRenderer.tsx` — 0
- `web/runtime-tests/editorCanvasSeam.test.mjs` — 0
- `web/tests/38-editor-drag.spec.ts` — 0

No snapshot file appears in `git status`. **No baseline moved.**

Net production change: **−16 lines** across 12 files, despite substantially more documentation —
the duplication removed exceeds the shared module added.
