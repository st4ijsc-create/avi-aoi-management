/**
 * WS-HMI-2 Task 13 — THE JOIN. Which screen document an operator's kiosk reads for a machine, and
 * whether a document that came off the wire is one `ScreenRenderer` can actually draw.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────────────────────
 * Measured at `20f78b8d`, before this task: `routes/Hmi.tsx` rendered `SCREEN_DOCS[machine.class]` —
 * three documents STATICALLY imported into the JS bundle — and no file outside `src/editor/` called
 * `/v1/screens` at all. Twelve tasks built a screen store, a publish door with versions and rollback,
 * and a visual editor that writes to it; the operator panel never read any of it. The editor wrote
 * into a store the runtime never opened. That is WS-HMI-0c's lesson at a different address: both
 * halves were thoroughly pinned and nothing joined them.
 *
 * Plain `.ts`, no JSX, no React import — the same reason `bindings.ts` and `gridLayout.ts` are plain:
 * Node's native loader strips TYPE syntax but cannot parse JSX, so a `.tsx` module can never be
 * `import()`-ed under `node --test`. Both functions below are therefore EXECUTED by
 * `runtime-tests/screenJoin.test.mjs` rather than pattern-matched.
 */
import type { HmiScreenDocument } from "../contracts/hmiScreen.ts"

/**
 * `contracts/hmi-screen.schema.json`'s `properties.screenId.pattern`, mirrored here.
 *
 * It is a MIRROR, and it is pinned as one: `runtime-tests/screenJoin.test.mjs` reads the pattern out
 * of the schema FILE ON DISK and compares it against this regex's own `.source`. Two sides of
 * genuinely different origin — the frozen contract, parsed; this module, declared — so this is not a
 * constant read from both ends. (`editorState.ts` carries the same character class for
 * `$defs/widget.properties.id`; they are two independent properties of the contract that happen to
 * agree today, and coupling them would make a future divergence in one silently change the other.)
 *
 * JavaScript's `$` with no `m` flag anchors at end of INPUT, so a trailing newline does not match —
 * the .NET side needs `\z` for the same case (`ContractInvariants.cs`). Nothing to work around here.
 */
export const SCREEN_ID_PATTERN = /^[a-z0-9-]+$/

/**
 * 🔴 SECURITY REVIEW MEDIUM-2 — `$defs/layout.properties.cols`/`rows`'s frozen `[1..48]`, mirrored here
 * for the same reason `SCREEN_ID_PATTERN` above is, and pinned the same way: `screenJoin.test.mjs`
 * reads both bounds out of the schema FILE ON DISK and compares them against these.
 *
 * **Why the guard needed them.** `unrenderableReason` checked `Number.isFinite` on `cols`/`rows` while
 * the write door checks the RANGE — so `layout.cols = 1e9` was finite, passed this guard, and reached
 * `repeat(1000000000, minmax(0, 1fr))`. Not reachable today: every row a shipped engine can hold went
 * through the current door, which caps at 48. It becomes reachable the first time a contract rule is
 * TIGHTENED, because `RollbackAsync` deliberately does not re-validate — "a restore is not new
 * authorship", which the review judged correct and which is being kept. That decision is exactly what
 * makes rollback the one path able to serve content the current door would refuse, and this guard is
 * the net behind it, so it has to cover the same ground the door does.
 */
export const LAYOUT_DIMENSION_MIN = 1

/** See {@link LAYOUT_DIMENSION_MIN}. */
export const LAYOUT_DIMENSION_MAX = 48

/**
 * The prefix every machine's own operator-panel screen id carries.
 *
 * 🔴 WHY A RESERVED PREFIX AND NOT THE BARE MACHINE CODE — the question this task's brief asks to be
 * answered rather than assumed, because a published row must not change what an unrelated spec (or an
 * unrelated engineer) sees.
 *
 * A screen document is NOT owned by a machine: the frozen `HmiScreenDocument` has no machine field
 * and cannot grow one (`additionalProperties: false`), so the same document can describe any number
 * of machines and the kiosk has to DERIVE the id it asks for. Deriving it as the bare lowercased code
 * would put every machine's kiosk into the SAME flat namespace an engineer authors free-form screen
 * ids in — `component-demo`, `editor-canvas-probe`, `editor-drag-probe`, `editor-layers-probe`,
 * `editor-properties-probe` are all real ids this repository's own suites `PUT` into the store — and
 * an engineer who happened to name a screen after a machine code would silently take over that
 * machine's operator panel, with nothing on either surface to say so. `machine-` reserves a
 * sub-namespace for the one id the kiosk resolves by itself: an id in it is a claim about a machine's
 * panel, and every other id in the store is a document nothing renders unless a URL names it.
 *
 * It also keeps the rule cheap to check by eye, which matters for the §5-bis property this whole join
 * rests on: the three shipped operator screens keep rendering exactly what they render today PRECISELY
 * BECAUSE `machine-scrw-01` / `machine-aoi-01` / `machine-iot-01` are ids nothing in this repository
 * ever writes.
 *
 * 🔴 WHOLE-BRANCH REVIEW M-2 — THAT SENTENCE SAID "That is a grep, not an argument", AND THE GREP
 * STOPPED BEING EMPTY INSIDE THIS BRANCH. The security round's audit fix (`6dad4d2c`) added
 * `HmiScreenEndpointsTests.cs:579`, which `PUT`s `machine-aoi-01` on purpose — the right fixture for a
 * machine-panel id, into a `WebApplicationFactory` temp store, so no baseline is at risk and the
 * CONCLUSION is unchanged. What changed is the evidence, and this repository's whole discipline is that
 * a sentence standing where a check should be is a defect. The standing guard is the live one:
 * `tests/43-editor-acceptance.spec.ts` asserts the 404 precondition for all three baseline machines
 * against the REAL store and names the machine when it fails. Nothing enforces this namespace — see the
 * "way back" the editor now offers (`editor/shadowedPanel.ts`) for what happens when someone publishes
 * here anyway.
 */
export const MACHINE_SCREEN_ID_PREFIX = "machine-"

/**
 * The screen id `/hmi/{code}`'s kiosk asks the store for — or `undefined` when this machine code
 * cannot produce a legal one.
 *
 * ── LOWERCASING IS NOT LAUNDERING HERE, AND THE DIFFERENCE IS LOAD-BEARING ───────────────────────
 * `CanonicalScreenStore.cs` refuses to case-fold a screenId, deliberately: the frozen schema says a
 * screenId is already lowercase, so `Line-Overview` is not a second spelling of `line-overview`, it is
 * a document that should never have existed, and folding it would launder a contract violation into a
 * merge. A MACHINE CODE is the opposite case and the same file says so: `MachineCodeIdentity` folds
 * case because a machine code carries no case constraint at all, so `AOI-01` and `aoi-01` are two
 * equally-valid spellings of ONE identity. This function crosses from the second vocabulary into the
 * first, which is exactly when a fold is correct: it is injective on machine IDENTITY (two codes that
 * differ only in case are the same machine, and get the same panel), and it never folds a screenId.
 *
 * ── WHY A CODE THAT CANNOT PRODUCE A LEGAL ID ANSWERS `undefined` RATHER THAN A BEST EFFORT ──────
 * `fleet.json` constrains a machine code to nothing. A code carrying an underscore, a dot or a space
 * would produce an id the frozen schema rejects — so the kiosk would spend a request per load on an id
 * the store could never hold, and (worse) a "sanitised" id would silently point two different machines
 * at one panel. `undefined` means "this machine has no derivable panel id"; the caller then renders
 * exactly what it rendered before this task existed, which is the §5-bis answer.
 */
export function machineScreenId(machineCode: string | undefined): string | undefined {
  if (typeof machineCode !== "string") return undefined
  const trimmed = machineCode.trim()
  if (trimmed.length === 0) return undefined
  const candidate = `${MACHINE_SCREEN_ID_PREFIX}${trimmed.toLowerCase()}`
  return SCREEN_ID_PATTERN.test(candidate) ? candidate : undefined
}

/** Objects only — `typeof null === "object"`, and an array is not a document. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Documents already reported. `Hmi.tsx` re-renders on every 1 s machine poll and a `console.warn` per
 * render would bury the one line that matters under thousands. TanStack Query hands back the SAME
 * object identity until the data actually changes, so keying on identity reports each distinct bad
 * document exactly once per session. A `WeakSet` so a document that goes out of scope is collectable.
 */
const alreadyWarned = new WeakSet<object>()

/**
 * 🔴 THE SAFETY NET FOR THE JOIN — returns `doc` when `ScreenRenderer` can draw it, `undefined` when
 * it cannot, so the caller falls back to the screen it was rendering before.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────────
 * It is NOT schema validation and must never grow into it. The write door already validates
 * (`ContractInvariants.Validate` inside `HmiScreenStore.PutAsync`, plus the frozen schema on the
 * contract side), and a second copy of those rules in the browser is precisely the defect this
 * repository keeps paying for. Everything a valid-but-odd document can contain — an unknown widget
 * `kind`, a rect that overflows the grid, a `{component}` binding that resolves to nothing — is
 * ALREADY handled by the renderer in place, one widget at a time, with a named placeholder or a
 * clamp-and-warn. That safety net stays and this function must not duplicate it.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────────────────────────────
 * The narrow set of shapes that would make `ScreenRenderer` THROW or produce a heap instead of a
 * grid — i.e. the shapes that take the whole kiosk page down rather than degrading one cell:
 *
 *   * `const { layout, widgets } = doc` then `Math.max(1, layout.cols)` — a document with no `layout`
 *     throws `TypeError` before a single widget is placed;
 *   * `widgets.map(...)` — a document whose `widgets` is not an array throws the same way;
 *   * `clampRectToLayout(widget.rect, ...)` — a `null` entry in `widgets` throws on the property read
 *     (the clamp itself is defensive about the rect's CONTENTS, not about the widget being absent);
 *   * a non-finite `cols`/`rows` reaches `repeat(NaN, minmax(0, 1fr))`, which is not a valid CSS
 *     value: the declaration is dropped, the grid falls back to a single implicit column, and every
 *     widget on the screen is stacked on top of every other. Nothing throws — it is just wrong, and
 *     wrong in the one way an operator cannot read around.
 *
 * ── WHY A ROW LIKE THAT CAN EXIST AT ALL, MEASURED RATHER THAN IMAGINED ─────────────────────────
 * `HmiScreenStore.AppendVersionAsync` restores WITHOUT re-validating on the rollback path — a
 * deliberate decision with its own doc comment there ("a restore is not new authorship"), taken so a
 * document written under an older, laxer contract can still be rolled back to. The consequence is
 * stated plainly here rather than left to be discovered: a legacy row that predates a tightening can
 * be made current again by a rollback, and this kiosk will be handed it. The operator gets the
 * shipped screen for that machine instead of a blank page.
 *
 * The fallback is silent ON SCREEN and loud in the console, on purpose. A banner would be a pixel
 * change on a kiosk whose three shipped screens carry visual baselines, for a state no fleet member
 * can reach today; the console line names the screen id and what was wrong with it.
 */
export function renderableScreen(doc: unknown): HmiScreenDocument | undefined {
  const bad = unrenderableReason(doc)
  if (bad === undefined) return doc as HmiScreenDocument

  if (isPlainObject(doc) && !alreadyWarned.has(doc)) {
    alreadyWarned.add(doc)
    console.warn(
      `[hmi-runtime] the published screen document ${describeId(doc)} cannot be laid out (${bad}) — ` +
        `falling back to this machine's shipped screen rather than rendering a broken or blank kiosk. ` +
        `A document like this cannot come through PUT /v1/screens (it validates); it can come back from ` +
        `a rollback, which restores without re-validating.`
    )
  }
  return undefined
}

/** The offending shape, as a sentence, or `undefined` when there is none. Split out of
 * `renderableScreen` so the runtime test can assert WHICH condition fired rather than only that one
 * did — a guard that rejects everything for the same reason is a guard that measures nothing. */
export function unrenderableReason(doc: unknown): string | undefined {
  if (doc === undefined) return "no document"
  if (!isPlainObject(doc)) return `not an object: ${describeValue(doc)}`
  const layout = doc.layout
  if (!isPlainObject(layout)) return `layout is ${describeValue(layout)}`
  // 🔴 SECURITY REVIEW MEDIUM-2 — the RANGE the write door enforces, not merely finiteness. See
  // `LAYOUT_DIMENSION_MIN`. Checked in one place for both axes so the two cannot drift apart, and the
  // reason names the bound rather than only the value, because the operator-visible symptom of getting
  // this wrong (a grid with a billion tracks) does not look like a layout problem from the outside.
  const colsBad = outsideLayoutRange(layout.cols)
  if (colsBad) return `layout.cols is ${colsBad}`
  const rowsBad = outsideLayoutRange(layout.rows)
  if (rowsBad) return `layout.rows is ${rowsBad}`
  if (!Array.isArray(doc.widgets)) return `widgets is ${describeValue(doc.widgets)}`
  const holeAt = doc.widgets.findIndex((widget) => !isPlainObject(widget))
  if (holeAt >= 0) return `widgets[${holeAt}] is ${describeValue(doc.widgets[holeAt])}`
  return undefined
}

/** The offending description when `value` is not a whole number inside the frozen `[1..48]`, or
 * `undefined` when it is. Integer-ness is part of it: `cols: 12.5` is finite and in range and still
 * produces a fractional CSS track count, which the schema's `"type": "integer"` forbids and this guard
 * used to accept. */
function outsideLayoutRange(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${describeValue(value)} (not a whole number)`
  }
  if (value < LAYOUT_DIMENSION_MIN || value > LAYOUT_DIMENSION_MAX) {
    return `${value} (outside the frozen range ${LAYOUT_DIMENSION_MIN}..${LAYOUT_DIMENSION_MAX})`
  }
  return undefined
}

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === "number") return String(value)
  return typeof value === "string" ? JSON.stringify(value) : typeof value
}

function describeId(doc: Record<string, unknown>): string {
  return typeof doc.screenId === "string" ? `"${doc.screenId}"` : "(with no screenId)"
}

/**
 * WS-HMI-2 Task 13 fix round 1 (task-13-review.md HIGH-1) — the INVERSE of `machineScreenId`, resolved
 * against the live roster rather than by string surgery on the id.
 *
 * The editor needs it to answer "is this screenId somebody's operator panel, and whose?" before it
 * lets an engineer replace one. Stripping the prefix would be wrong in two ways that matter: it would
 * report a machine that is not in the roster (so the warning would name a machine that does not
 * exist), and it would report the LOWERCASED code, when the spelling an engineer has to be shown is
 * the roster's own (`AOI-01`, not `aoi-01`). Comparing DERIVED ids makes the roster the authority for
 * both, and makes this function agree with `machineScreenId` by construction rather than by a second
 * copy of the rule — including the case fold and the reserved prefix.
 *
 * Kept HERE, beside the forward direction and away from the shipped-document table, so it can be
 * executed by `runtime-tests/screenJoin.test.mjs`: `editor/shadowedPanel.ts` imports JSON and Node
 * cannot load such a module without an import attribute.
 */
export function machineForScreenId<T extends { code: string }>(
  screenId: string | undefined,
  machines: readonly T[] | undefined
): T | undefined {
  if (!screenId || !machines) return undefined
  return machines.find((machine) => machineScreenId(machine.code) === screenId)
}
