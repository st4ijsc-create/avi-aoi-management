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

> 🔴 **The review found I understated this, and it was right.** I described one direction of the
> hazard. Measured on `NAV_ITEMS` via the AST: **17 nav items, only 3 carry a `minRole`, so 14 take
> the falsy branch.** The absent-`minRole` case is therefore the *common* nav path, not an edge —
> which means a merge in the **other** direction (adopting the strict body for the nav caller) would
> have emptied most of the sidebar. **Both directions were live hazards**, and keeping two functions
> was load-bearing in both.
>
> Worth recording: my first attempt at this count used `grep -c "minRole:"` and returned 4, because
> one match sat in a comment. That is the prose-counted-as-code error for the **third** time in this
> session — the ledger's eight-vs-ten warning, my hoist-proof tool, and the census bypass being the
> others. The AST count above is the one to trust, and the pattern is the session's real lesson.

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

`web/runtime-tests/roleRank.test.mjs` (28 tests), following the census precedent in
`editorCanvasSeam.test.mjs` rather than inventing a mechanism:

- **SIDE A — behaviour, executed.** The full 3×3 matrix written out as the *answer* (not recomputed
  from `ROLE_RANK`, which would pass at any table), plus absent/unknown `userRole` and unknown
  `minRole` — all of which must fail closed. The two functions are asserted to agree everywhere
  except on an absent `minRole`, which is pinned as the deliberate divergence so a later
  "simplification" that merges them reddens instead of widening seven gates.
- **SIDE B — census.** Walks `web/src/**` over `.ts/.tsx/.js/.mjs/.cjs` and finds ladders through
  **TypeScript's own parse**, by *shape*: an object literal whose keys are exactly the three roles.

### 🔴 Fix round 1 — the census was defeated, twice, and both were fair

**M-1 — a `//` inside a string literal.** Round 1's census stripped comments with two regexes. The
reviewer appended one line to `Site.tsx`:

```ts
const __probeUrl = "https://example.com//docs"; const ROLE_RANK: Record<string, number> = { … }
```

The `//` in the URL was read as a line comment, so the rest of the line — including the ninth ladder
— was deleted before matching. **The census exited 0 with two ladders in the tree.** I reproduced
this before fixing it.

This is the same defect class I recorded learning from *in this very session*: my hoist-proof tool
matched a declaration quoted inside a doc comment, I wrote down that comment detection without a
parser is not comment detection — and then did not apply that lesson to the instrument next to it.
`scripts/check-comment-only.mjs`'s header already states the general form of this trap and its
remedy; the census now follows it. A parser needs no comment-stripping at all, because comments are
never in the AST to begin with. My round-1 control was a near miss: it tested `"https://x/y"`
(one slash), which survives — `//docs` is what breaks it.

**M-2 — the pin forbade a name, not a ladder.** A rename, an inline literal, quoted keys or a
reordering all walked past a regex keyed on the identifier `ROLE_RANK`. The rule is now the shape.

**What the widened census catches** (each asserted, not claimed): the shipped form; the M-1
string-literal probe; a **renamed** table; an **inline** literal never bound to a name; quoted keys;
keys in any order — while ignoring comments, imports, uses, unrelated objects, and partial keys.

**What it still does not catch, stated rather than papered over:** `new Map([["Operator",0],…])`; an
`["Operator","Engineer","Admin"]` array with `indexOf`; a table built at runtime (`reduce`) or read
from JSON; two roles compared on some other encoding entirely. There is no finite syntactic rule
that catches every re-encoding of an ordered role list, and this one does not pretend to. What it
does is make the *cheap* path — copy the object literal back into a route file, under any name —
impossible to take silently; everything in the residue list is a deliberate re-implementation a
reviewer reading a diff will see, and SIDE A holds if someone writes one. **The residue is itself
asserted** (`STATED RESIDUE`), so if a later change makes any of it detectable the test reddens and
the header must be corrected — the limit is measured, not merely described.

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
themes. **21 of those 22 contain the sidebar**; the exception is `tokens-glass`, because `/tokens`
is routed outside `<Shell>` (`App.tsx:79`) and renders standalone. Adding one nav row changes all 21.

> 🔴 CORRECTED in fix round 1 (review L-1). This paragraph originally said "every one of which
> contains the sidebar… changes all 22". That was wrong by one, and wrong in the direction that
> flatters the argument. The conclusion is unaffected — 21 moved baselines is just as much a finding
> as 22 — but a number stated for effect is exactly what this programme does not accept, so the
> sentence is corrected rather than the conclusion defended.

The constraint for this session is explicit: *no baseline may move; a moved baseline is a finding
you report, never a file you update.* The minimal-looking option is therefore not minimal — it is a
21-baseline change plus a new route, a new client hook, i18n keys in two languages, and role gating,
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
| 1 | Only one file declares the ladder | added a plain ninth `const ROLE_RANK` to `Site.tsx` | ✅ `EXACTLY ONE file…` + `all eight former declarers…` red (26/28) |
| 1a | **Round 1's bypass is closed** (review M-1) | the reviewer's exact line — `const __probeUrl = "https://example.com//docs"; const ROLE_RANK = {…}` — appended to `Site.tsx` | ✅ red (26/28). Under round 1 this exited **0 with two ladders in the tree** |
| 1b | A **renamed** table is caught (review M-2) | `const RANKS = { Operator: 0, … }` appended to `Site.tsx` | ✅ red (26/28); round 1 missed it entirely |
| 2 | The census counts declarations, not mentions | *(control)* comment / import / use / unrelated object / partial keys | ✅ none counted |
| 3 | The census's **stated residue** is real | *(control)* `Map`, `indexOf` array, and `reduce`-built table asserted **undetected** | ✅ the documented blind spots are pinned as blind spots, so the header cannot drift from the code |
| 4 | The gate is not "deny everything" | *(control)* 6 permit rows vs 3 deny rows asserted | ✅ both classes non-empty |
| 5 | Logout really clears | neutered `isAuthGateQueryKey` in the **predicate module** to always exempt | ✅ 5 red (6/11): both `DIRECTION 1` rows, the no-op control, the namespace row, and the predicate control |
| 5a | *(correction, review L-2)* | reverting `auth.ts`'s `logout` body | ⚠️ reddens **1**, not 3 — only the source-text seam check. The direction-1 tests execute the test file's own local `runLogoutCacheSequence`, so `auth.ts` is not in their path; the seam check is precisely what covers that gap. Row 5 above is the mutation that actually exercises the property |
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
| `npm run test:runtime` | 556 | **606** (+50) ✅ |
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

### One diff entry that is not a source change

`web/package.json` appears in the diff. It is the registration of the three new runtime-test files in
the `test:runtime` command — explicit filenames, never a glob, because that script's own `//` note
records that *a glob matching zero files exits 0 with zero tests*, and `testRuntimeScript.test.mjs`
reddens if a `runtime-tests/*.test.mjs` is added without being listed. Registering them is what that
file demands; the printed count was re-verified to have grown (556 → 606), not merely to still exit 0.

Net production change: **−16 lines** across 12 files, despite substantially more documentation —
the duplication removed exceeds the shared module added.
