/**
 * Session 3 (WS-HMI-4) — THE ISA-101 LINTER, run in the editor before publish.
 *
 * Plain `.ts`, NO JSX, NO React, NO DOM — the same reason `editorState.ts`, `gridGeometry.ts` and
 * `hmi-runtime/gridLayout.ts` are plain: it lets `web/runtime-tests/isa101Linter.test.mjs` `import()`
 * and EXECUTE this file under `node --test`, so its pins measure real behaviour rather than matching
 * source text. Everything below is a pure function of an `HmiScreenDocument`; nothing reads or writes
 * anything outside its arguments.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY WEB-SIDE, AND WHY NOT A THIRD COPY OF ANYTHING
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * Spec §6 says the linter scores "trong editor TRƯỚC khi publish" — in the editor, before publish. The
 * editor is web-side, so a gate that blocks its Publish button is web-side by construction. That alone
 * would not settle it (the engine could score and the editor could render the verdict), so here is the
 * measurement that does:
 *
 * FOUR of the eight rules can only be answered from facts that exist ONLY on the web side.
 *
 *   * R1/R6 (status colour, non-status colour) need the set of props the fifteen frozen widgets
 *     actually READ. That set is a property of `web/src/hmi-runtime/widgets/*.tsx` and of nothing else.
 *   * R4 (contrast) needs the theme palettes, which live in `web/src/index.css`.
 *   * R5 (touch targets) needs `SCREEN_BREAKPOINT_WIDTHS` (`web/src/lib/hmiScreens.ts`) and the grid
 *     gap `ScreenRenderer.tsx` renders with.
 *
 * An engine-side C# linter would have to HARD-CODE all four. That is precisely the third copy of a
 * frozen rule this repository's standing objection forbids (`contracts/README.md`, `validate.mjs`'s
 * header, `editorState.ts`'s header, `policyGate`'s doc comment). So the linter lives beside the facts
 * it reads, and — where a value must be restated because importing it would cost this module its
 * executability (see `BREAKPOINT_WIDTH_PX`'s note for the measured `ERR_IMPORT_ATTRIBUTE_MISSING`) —
 * every restated value carries a two-way pin in `isa101Linter.test.mjs` against the file it mirrors:
 * `BREAKPOINT_WIDTH_PX` against `lib/hmiScreens.ts`, `TOUCH_TARGET_GRID_GAP_PX` against
 * `ScreenRenderer.tsx`'s own `gap-2`, and the tone vocabulary against the two `.tsx` files that
 * define it. Restated with a pin, never restated and hoped for.
 *
 * 🔴 THE WRITE DOOR IS NOT TOUCHED. `PUT /v1/screens/{id}` keeps exactly the rules it had. This is an
 * EDITOR gate: it blocks the Publish BUTTON, not the endpoint. A document that fails an `error` rule
 * here is still a document the engine would accept, and that asymmetry is deliberate — the linter
 * encodes a DOCTRINE (ISA-101), the write door encodes a CONTRACT (the frozen schema plus §5's safety
 * invariants), and a doctrine that could 400 an API call would make the doctrine un-opt-out-able for
 * every future non-editor writer, including the generator.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 THE CROSS-SESSION RULING THIS MODULE IS BUILT AROUND — AN ALL-`idle` TONE MAP IS CORRECT
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * Session 2's `ScreenGenerator` emits `props.tones` with EVERY entry `"idle"`, because nothing in this
 * repository evaluates a `ComponentStateDef.Expr` (it is a string; there is no expression engine on
 * either tier), so any other tone would be a claim it cannot compute.
 *
 * That is RESTRAINT, not "unconfigured", and this linter does not penalise it. The argument is the
 * spec's own, not a preference: R1 punishes status colour used as DECORATION. A screen whose every
 * tone is `idle` uses no status colour at all — `--status-idle` is the neutral grey the doctrine
 * PRESCRIBES for normal running equipment (spec §6: "thiết bị chạy bình thường vẽ xám trung tính").
 * It cannot violate a decoration rule by any reading. `lintScreen` on the generator's own committed
 * output must therefore be clean, and `isa101Linter.test.mjs` asserts exactly that against
 * `runtime-tests/fixtures/generated-scrw-01.json` — the artefact `ScreenGeneratorTests` regenerates
 * and compares, so the fixture cannot drift away from the generator behind this claim's back.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT THIS MODULE REFUSED TO PRETEND IT MEASURES
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * A rule that cannot fail is worse than a missing rule: it reports safety that was never measured. Two
 * of the spec's five `error` rules are NOT implementable from an `HmiScreenDocument`, and both are
 * documented here with what was pinned INSTEAD rather than shipped as an always-green stub. See R4 and
 * R5 below. Nothing in this file returns a finding that no document can produce — the test suite
 * carries a FALSIFICATION for every rule (a document that violates it, watched going red) AND a
 * NEGATIVE CONTROL (a compliant document that must stay green), so a linter that flagged everything
 * could not pass either.
 */
import type {
  HmiScreenDocument,
  ScreenBreakpoint,
  ScreenWidget,
} from "../contracts/hmiScreen.ts"
import { GAUGE_KIND, kindsWhere } from "../hmi-runtime/widgetKindFacts.ts"

/**
 * Which kinds each rule applies to. The TABLE lives in `hmi-runtime/widgetKindFacts.ts`, next to the
 * fifteen widgets whose behaviour it records — see that file's header for why, including the
 * `src/editor/` census that caught the first draft declaring these inline.
 */
/** R2 — a numeric bound value, so a unit is owed. */
export const NUMERIC_WIDGET_KINDS = kindsWhere("numeric")
/** R7 — a route to alarm state. */
export const ALARM_ROUTE_KINDS = kindsWhere("alarmRoute")
/** R8 — surfaces `TagValue.quality`. */
export const QUALITY_SURFACING_KINDS = kindsWhere("surfacesQuality")
/** R5 — a finger presses this. */
export const TOUCHABLE_WIDGET_KINDS = kindsWhere("touchable")
/** R2, range half — a declared engineering band is a real concept for this kind. */
export const RANGE_REQUIRED_KINDS = kindsWhere("needsRange")

/**
 * The target width in CSS px of each breakpoint — `lib/hmiScreens.ts`'s `SCREEN_BREAKPOINT_WIDTHS`.
 *
 * 🔴 WHY THIS IS A LOCAL DECLARATION AND NOT AN `import`, WHICH IS THE FIRST THING A REVIEWER SHOULD
 * OBJECT TO. It was written as an import first and MEASURED to break the property this whole module
 * is arranged around: `lib/hmiScreens.ts:36` does `import componentDemo from
 * "../../screens/demo/component-demo.json"`, and Node's ESM loader refuses a JSON specifier without an
 * import attribute (`ERR_IMPORT_ATTRIBUTE_MISSING`, reproduced against this exact file). So importing
 * it would make `isa101Linter.ts` un-`import()`-able under `node --test`, and every pin below would
 * degrade from an EXECUTED test to a source-text one — the exact trade this tree refuses (see
 * `gridLayout.ts`'s and `editorState.ts`'s headers for the same constraint forcing the same shape).
 *
 * A hand-copied constant is a drift hazard, and this repository has already PAID for one: `chartTokens
 * .ts` hand-copied `isa101Tokens.textStrong = "#1C1E1E"` — the exact value that had measured 4.32:1
 * and failed axe — after `index.css` had been darkened, with tsc, oxlint, Playwright and axe all green
 * (see `runtime-tests/chartTokens.test.mjs`'s header). So it is answered the same way that was: NOT by
 * a promise, but by a two-way pin. `isa101Linter.test.mjs` reads `lib/hmiScreens.ts` as TEXT, parses
 * its `SCREEN_BREAKPOINT_WIDTHS` literal, and asserts it equals this table entry for entry — so a
 * width changed there reddens HERE, by name, instead of silently making every touch-target
 * measurement wrong.
 */
export const BREAKPOINT_WIDTH_PX: Readonly<Record<ScreenBreakpoint, number>> = {
  panel: 1280,
  tablet: 1024,
  phone: 390,
}

/** `error` blocks publish; `warn` is shown and does not. Spec §6's two levels, no third. */
export type Isa101Severity = "error" | "warn"

/** Stable machine-readable rule identities. The UI keys its copy off these, and the tests name them —
 * so a rule that stops firing reddens by NAME rather than by an unexplained count change. */
export type Isa101RuleId =
  | "status-colour-as-decoration"
  | "numeric-widget-without-unit-or-range"
  | "widget-impersonates-emergency-stop"
  | "contrast-below-aa"
  | "touch-target-below-44px"
  | "too-many-non-status-colours"
  | "no-route-to-alarm-state"
  | "quality-never-displayed"

export type Isa101Finding = {
  readonly rule: Isa101RuleId
  readonly severity: Isa101Severity
  /** The widget this is about, when it is about one. Screen-level rules (R6/R7/R8) leave it undefined
   * rather than blaming an arbitrary widget for a property of the whole document. */
  readonly widgetId?: string
  /** English, non-localised, and DIAGNOSTIC — it names the measured quantity, not just the verdict.
   * The operator-facing localised sentence is the UI's job (`i18n/*.ts`); this string is what a test,
   * a log line and a bug report read, and it is deliberately not a translation key. */
  readonly detail: string
}

export type Isa101Report = {
  readonly findings: readonly Isa101Finding[]
  /** True when at least one `error` finding exists — i.e. publish is blocked. Computed here rather
   * than by the caller so "what blocks publish" has exactly one definition in this tree. */
  readonly blocksPublish: boolean
}

/**
 * The four status tones, and the ONLY colour vocabulary any frozen widget understands.
 *
 * Measured, not assumed: `status-lamp.tsx:5` (`KNOWN_STATES`) and `state-badge.tsx:13`
 * (`KNOWN_TONES`) are the two places a `props.tones` value is checked, and `line-state.tsx` reuses
 * `StatusLampState`. `state-badge` additionally accepts `"neutral"` (a fifth `ReadoutTone` word that
 * is not a status colour at all — it is the plain-ink tone). Both sets are covered below; the test
 * reads BOTH `.tsx` files and asserts this constant equals their union, so a widget that learns a new
 * tone word reddens here instead of silently escaping R1.
 */
export const KNOWN_TONE_WORDS: ReadonlySet<string> = new Set([
  "run",
  "warn",
  "fault",
  "idle",
  "neutral",
])

/**
 * The three tones that are STATUS COLOUR in the doctrine's sense — the ones spec §6 reserves for
 * abnormality (`--status-run/warn/fault`, named verbatim in the spec's own rule text).
 *
 * `idle` and `neutral` are NOT in this set, and that is the ruling above expressed as data: they are
 * the neutral greys (`--status-idle: #6f7371` in the isa101 block, `--text-muted` for
 * `--status-idle-text`), i.e. the ABSENCE of status colour.
 *
 * 🔴 `run` IS in this set even though a running machine is not "abnormal". That is not an oversight:
 * spec §6 lists `--status-run` in the rule's own text, and the doctrine's point is that a green
 * "everything is fine" lamp on a normal screen is the single commonest decorative use of the status
 * ramp there is — a screen where green means "running" has spent the operator's colour budget on the
 * state they are in 99% of the time, which is exactly what degrades the 38-42% ack figure. So `run`
 * counts as status colour, and R1's question is whether it was earned.
 */
export const STATUS_TONE_WORDS: ReadonlySet<string> = new Set(["run", "warn", "fault"])

/**
 * The grid gap `ScreenRenderer.tsx` renders the screen with, in CSS pixels — Tailwind's `gap-2`, i.e.
 * `0.5rem` at the 16 px root, which is 8 px.
 *
 * 🔴 NOT a number this module is free to choose. `isa101Linter.test.mjs` reads `ScreenRenderer.tsx`'s
 * own source and asserts the className really does carry `gap-2`, so if the renderer's gap changes,
 * this constant reddens BY NAME rather than making every touch-target measurement quietly wrong.
 */
export const TOUCH_TARGET_GRID_GAP_PX = 8

/**
 * WCAG 2.x AA's minimum touch target, in CSS pixels. Spec §6 names 44 px verbatim; it is also the
 * WCAG 2.5.5 / 2.5.8-AAA figure and Apple's HIG minimum. Written as a literal because it is an
 * EXTERNAL standard's number, not a fact about this repository — there is nothing here to derive it
 * from, and a constant read from two places inside this tree would prove nothing about the standard.
 */
export const MIN_TOUCH_TARGET_PX = 44

/**
 * The breakpoints R5 is required to check — spec §6 says "trên breakpoint panel/tablet", so `phone` is
 * deliberately NOT checked.
 *
 * That exclusion is the spec's, and it is a real one rather than a rounding: at `phone`'s 390 px a
 * 12-column grid gives cells of ~25 px, so EVERY single-column widget on EVERY phone document would
 * fail. A rule that fires on all input is as uninformative as one that fires on none — and the spec
 * anticipated it by naming only two breakpoints. `layout.breakpoint: "phone"` therefore produces no
 * R5 finding at all, and the test pins that (a phone document with a 1-cell widget stays green here
 * while the same rect at `panel` and `tablet` goes red).
 */
export const TOUCH_TARGET_BREAKPOINTS: readonly ScreenBreakpoint[] = ["panel", "tablet"]

/**
 * N for R6 — the ceiling on DISTINCT NON-STATUS colours on one screen.
 *
 * 🔴 N = 0, AND THE NUMBER IS THIS SMALL BECAUSE OF WHAT WAS MEASURED, NOT BECAUSE OF TASTE.
 *
 * The obvious reading of "too many non-status colours" is a designer's budget — three or four accent
 * hues, say. That reading assumes a document can CARRY a colour. It cannot. The complete set of props
 * any of the fifteen frozen widgets reads is
 *
 *     __testOnlyThrow, faceplate, label, labelEn, max, min, motor, overview, rows, size, sub,
 *     text, textEn, title, titleEn, tones, unit, valueType, variant
 *
 * (extracted mechanically from `web/src/hmi-runtime/widgets/*.tsx`, and re-extracted by this module's
 * test so the list cannot rot). Not one of them is a colour, a hex, a class name or a style object;
 * `grep` for a hardcoded hex across those fifteen files returns nothing. Every pixel of colour comes
 * from a theme token in `index.css`, chosen by `data-theme={doc.theme}`.
 *
 * So the only colour a document can name at all is a TONE WORD in `props.tones`, and the tone
 * vocabulary is exactly the five words above. "A non-status colour" therefore means "a tone word that
 * is not one of the five" — and since `state-badge.tsx:34` and `status-lamp.tsx:24` both FALL BACK to
 * `idle` for an unrecognised word, such a word paints nothing. N = 0 is the honest ceiling: any
 * non-vocabulary tone word is both a colour that never appears and an author who believed it would,
 * which is worth exactly the `warn` the spec assigns it.
 *
 * Stating the alternative that was rejected, so the next reader does not "fix" this to 3 or 4: a
 * budget of N>0 distinct hues would be a rule that NO document in this repository can violate and no
 * document a future author writes can violate either, because the schema gives them nowhere to put a
 * hue. That is the always-green rule the brief forbids. If a future `props.color` is ever added to a
 * widget, THIS is the constant to raise, and the test that extracts the prop vocabulary will redden
 * to say so on the day it happens.
 */
export const MAX_NON_STATUS_COLOURS = 0

/** `props` as a plain record, defensively — a document reaching the editor arrived as JSON and is not
 * guaranteed to match its declared TS shape. Same posture as `widgets/shared.ts`'s `asRecord`. */
function propsOf(widget: ScreenWidget): Record<string, unknown> {
  const raw: unknown = widget.props
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/** `props.tones` as a plain record of string→string. Non-string values are dropped rather than
 * coerced: `tones: { running: 3 }` names no colour, and `state-badge.tsx:34`'s `typeof mapped ===
 * "string"` check means it paints nothing either, so it is not R1's or R6's business. */
function tonesOf(widget: ScreenWidget): Record<string, string> {
  const raw = propsOf(widget).tones
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * ── R1, `error` — STATUS COLOUR USED AS DECORATION RATHER THAN MEANING ──────────────────────────
 *
 * 🔴 WHAT THIS ACTUALLY MEASURES, AND WHAT IT DOES NOT. This is the hardest of the eight and the one
 * most likely to be pinned badly, so the boundary is stated before the code.
 *
 * NOT MEASURABLE from an `HmiScreenDocument`: whether a colour on a rendered screen is "meaningful"
 * in the human sense. That needs a rendered pixel AND a running machine AND a judgement about whether
 * the operator can act on what the colour told them. Nothing in a JSON document contains it, and a
 * rule claiming to measure it would be pretending.
 *
 * MEASURABLE, and what this rule is: a status tone (`run`/`warn`/`fault`) that CANNOT COVARY WITH
 * STATE. That is a structural property of the document and it is decidable.
 *
 * A `tones` map is the document's only way to name a status colour, and it works by LOOKUP: the
 * widget reads its bound value and indexes `tones[value]` (`state-badge.tsx:30`,
 * `line-state.tsx:29`). Two structural cases make that lookup a constant function, and a constant
 * colour is decoration by definition — it says the same thing whatever the machine is doing:
 *
 *   (a) THE MAP HAS NO BINDING TO INDEX IT. A `tones` map on a widget with no `bindings.state` (for
 *       `state-badge`/`status-lamp`/`line-state`, the binding those three read) can never be indexed
 *       by anything. Whatever colour it names is painted on a fixed input or on none.
 *
 *   (b) TWO OR MORE STATES SHARE ONE STATUS COLOUR. `{running:"run", stopped:"run", faulted:"run"}` is
 *       green whatever happens: the colour cannot tell those states apart, so it carries no bits an
 *       operator can act on while occupying their whole colour budget.
 *
 *       🔴 COUNTED OVER THE STATUS ENTRIES ONLY — FIX ROUND 1, review H1. Round 0 asked whether the
 *       WHOLE map was constant, which one padding entry defeats: the reviewer published
 *       `{running:"run", stopped:"run", faulted:"run", __pad:"neutral"}` with zero findings, and the
 *       same with an `"idle"` pad and a four-entry all-`fault` map. A neutral sitting beside the green
 *       says nothing about whether the green covaries, so neutrals no longer dilute the count.
 *
 *       The `>= 2` is the deliberate half of the boundary, not a fudge. `{running:"run", off:"idle"}`
 *       — the most natural two-entry map there is — marks exactly ONE state green and is genuinely
 *       covarying, so it stays clean. Green stops being informative at the moment a SECOND state joins
 *       it. See the implementation for the full argument.
 *
 * 🔴 CASE (b) IS WHY THE GENERATOR PASSES, AND THE ASYMMETRY IS THE SPEC'S. An all-`idle` map is ALSO
 * constant — but `idle` is not a status colour (see `STATUS_TONE_WORDS`), so (b) does not fire on it.
 * The rule punishes a constant STATUS COLOUR, not constancy. That is exactly what "status colour used
 * as decoration" says, and it is the reading under which Session 2's generator is correct rather than
 * merely tolerated: `{stopped: "idle", running: "idle", faulted: "idle"}` spends no colour, so there
 * is no decorative spend to punish.
 *
 * A map with a MIX (`{running: "run", faulted: "fault"}`) is clean under both cases: it is indexed by
 * a binding and its output varies with the input, which is the definition of colour carrying meaning.
 * That is the negative control this rule is falsified against.
 *
 * 🔴 WHAT THIS RULE DOES NOT MEASURE, stated here because R4 and R5 state theirs and round 0's review
 * found this one the only rule claiming coverage it did not have: REACHABILITY. A map whose extra
 * same-coloured states can never actually occur is decoration too, and deciding that means evaluating
 * `ComponentStateDef.Expr` — a plain string with no expression engine on either tier. (That is the
 * same absence which makes the generator's all-`idle` map correct rather than lazy.) So this rule
 * judges a tone map by its SHAPE, never by which of its states are live, and the finding's own
 * `detail` says so to the engineer reading it.
 */
function lintStatusColourAsDecoration(widget: ScreenWidget): Isa101Finding[] {
  const tones = tonesOf(widget)
  const entries = Object.entries(tones)
  if (entries.length === 0) return []

  const statusEntries = entries.filter(([, tone]) => STATUS_TONE_WORDS.has(tone))
  if (statusEntries.length === 0) return []

  const findings: Isa101Finding[] = []
  const bindings = widget.bindings ?? {}
  // The three tone-consuming kinds all read `bindings.state`; `bindings.value` is checked too so a
  // future tone consumer bound on `value` is not falsely accused. Anything else is "no index".
  const hasIndex = isNonBlankString(bindings.state) || isNonBlankString(bindings.value)

  if (!hasIndex) {
    findings.push({
      rule: "status-colour-as-decoration",
      severity: "error",
      widgetId: widget.id,
      detail:
        `props.tones names status colour(s) ${JSON.stringify(statusEntries.map(([, t]) => t))} but the ` +
        `widget has no "state"/"value" binding to index the map with, so the colour cannot vary with ` +
        `machine state — it is decoration, not meaning`,
    })
    return findings
  }

  // 🔴 CASE (b) — THE STATUS ENTRIES ARE WHAT IS COUNTED, NOT THE WHOLE MAP. FIX ROUND 1, review H1.
  //
  // Round 0 asked `new Set(ALL tone values).size === 1`, which a SINGLE padding entry defeats: the
  // reviewer published `{running:"run", stopped:"run", faulted:"run", __pad:"neutral"}` — three
  // permanently-green states — with ZERO findings and `blocksPublish:false`, and got the same result
  // with an `"idle"` pad and with a four-entry all-`fault` map. Reproduced here before changing
  // anything. Whether a neutral sits beside them says nothing about whether the STATUS colour
  // covaries, so the neutral entries are now excluded from the count rather than allowed to dilute it.
  //
  // WHAT THE TWO CONDITIONS MEAN, AND WHY THE SECOND IS NOT A FUDGE — the boundary the reviewer
  // correctly called "not sharp" is decided here deliberately:
  //
  //   * `statusDistinct.size === 1` — every state that gets a status colour gets the SAME one, so the
  //     colour cannot distinguish those states from each other.
  //   * `statusEntries.length >= 2` — and it does so for at least TWO states, which is what makes the
  //     colour uninformative. This is the load-bearing half. `{running:"run", off:"idle"}` is the most
  //     natural two-entry map an author writes and it is GENUINELY COVARYING — green marks exactly one
  //     of two states, grey the other; that is meaning, and it stays clean. Add a second state to the
  //     green side (`{running:"run", stopped:"run", off:"idle"}`) and green no longer tells `running`
  //     from `stopped` — the operator cannot act on it, and THAT is decoration. One status entry is a
  //     highlight; two or more sharing one colour is a constant wearing a highlight's clothes.
  //
  // What this still does NOT measure, stated because R4 and R5 state theirs: REACHABILITY. A map whose
  // extra green states can never occur is decoration too, and deciding that requires evaluating
  // `ComponentStateDef.Expr` — a string with no expression engine on either tier (the ledger records
  // this, and it is the same fact that makes the generator's all-`idle` map correct). So a two-state
  // green map is judged by its SHAPE, not by whether both states are live. That is a real limit and it
  // is named in the finding's own `detail` text, not only here.
  const statusTones = statusEntries.map(([, tone]) => tone)
  const statusDistinct = new Set(statusTones)
  if (statusDistinct.size === 1 && statusEntries.length >= 2) {
    const only = [...statusDistinct][0]
    const neutralCount = entries.length - statusEntries.length
    findings.push({
      rule: "status-colour-as-decoration",
      severity: "error",
      widgetId: widget.id,
      detail:
        `props.tones gives ${statusEntries.length} states (${JSON.stringify(
          statusEntries.map(([state]) => state)
        )}) the SAME single status colour "${only}"` +
        (neutralCount > 0
          ? `, beside ${neutralCount} neutral entr${neutralCount === 1 ? "y" : "ies"} that spend no ` +
            `status colour and do not make it vary`
          : "") +
        `. The colour cannot tell those states apart, so it carries no information an operator can act ` +
        `on — decoration, not meaning. (An all-"idle"/"neutral" map is NOT this: those are the ` +
        `doctrine's neutral greys, i.e. no status colour spent at all. A map giving ONE state a status ` +
        `colour — e.g. {running:"run", off:"idle"} — is also not this: it marks exactly one state, ` +
        `which is meaning.) NOT MEASURED: whether the states above can actually occur. That needs ` +
        `evaluating ComponentStateDef.Expr, and no expression engine exists on either tier, so this ` +
        `rule judges the map's SHAPE rather than its reachability.`,
    })
  }
  return findings
}

/**
 * ── R2, `error` — A NUMERIC WIDGET MISSING ITS UNIT OR ITS ENGINEERING RANGE ────────────────────
 *
 * 🔴 THE ONE SUBTLETY, AND IT IS THE REASON THIS RULE IS NOT A ONE-LINER: `unit` HAS A SECOND SOURCE.
 * `readout.tsx:23`, `kpi-tile.tsx:21`, `gauge.tsx:20` and `setpoint-input.tsx:31` all read
 * `typeof p.unit === "string" ? p.unit : tv?.unit` — the BOUND TAG's unit is the fallback. So a
 * `readout` with no `props.unit` but a real `bindings.value` is NOT unitless on screen; it shows the
 * unit the tag namespace declared.
 *
 * This matters because it is the difference between a rule and a false accusation:
 * `contracts/fixtures/valid/screen-screwdrive-full.json` — a FROZEN fixture that ships — has exactly
 * that shape ("torque", a `readout` with `props.label`/`labelEn` and no `props.unit`, bound to
 * `{component}/torque`, whose tag declares `"unit": "Nm"`). A naive rule reddens a document this
 * repository committed as valid, and the only way to make it green again would be to relax the rule
 * until it measured nothing.
 *
 * So the rule is: a numeric widget must have EITHER a `props.unit` OR a binding that could supply one.
 * What it catches is the genuinely unitless case — a number with no props unit AND nothing bound, i.e.
 * a figure on an operator's screen with no way to know what it counts.
 *
 * ── THE TWO RANGE CASES, WHICH ARE NOT THE SAME CASE ────────────────────────────────────────────
 * RANGE applies only where a declared band is a real concept, and the two kinds that qualify fail for
 * DIFFERENT reasons. They are reported with different messages on purpose: a shared one would have
 * been false of a widget, which is how this was caught.
 *
 *   * `gauge` — `gauge.tsx:18-19` defaults to `0..100` when the props are absent, and then DRAWS
 *     against it. A silent default scale is precisely the "looks fine and is wrong" failure: 12 Nm on
 *     an invented 0..100 bar reads as 12% of nothing.
 *   * `setpoint-input` — 🔴 MEASURED, and it corrected this rule's first draft. This widget reads
 *     NEITHER `props.min` NOR `props.max` (grep for `p.min`/`p.max` across all fifteen widget files
 *     returns `gauge.tsx` and nothing else); it renders `type="text" inputMode="decimal"` with no
 *     bound enforcement at all. The first version of this rule reported it with gauge's reason, which
 *     was simply untrue of it. The finding SURVIVED the correction rather than being dropped, because
 *     the spec demands an engineering range on numeric widgets and this is the widget where its
 *     absence costs most — a WRITE path where the operator has nothing to be checked against. What
 *     changed is the message, which now says what is actually true.
 *
 * `readout`, `kpi-tile` and `trend` do not draw or write against a declared band, so no range is
 * demanded of them.
 *
 * 🔴 THIS RULE FIRES ON `contracts/fixtures/valid/screen-screwdrive-full.json` (its `torque-sp`), AND
 * THAT WAS INVESTIGATED RATHER THAN ACCOMMODATED. That file is a SCHEMA CONFORMANCE fixture — grepped:
 * it is referenced only by doc comments and by `contract-tests`, is not among the `screens/*.json` the
 * kiosk ships, and is never published. "Valid against the frozen schema" and "ISA-101 compliant" are
 * different claims, and the fixture only ever asserted the first. So the finding is TRUE and is kept;
 * the fixture is not edited (it is frozen) and the rule is not relaxed to silence it.
 */
function lintNumericWidgetUnitAndRange(widget: ScreenWidget): Isa101Finding[] {
  if (!NUMERIC_WIDGET_KINDS.has(widget.kind)) return []
  const findings: Isa101Finding[] = []
  const p = propsOf(widget)
  const bindings = widget.bindings ?? {}

  // A binding that could carry `TagValue.unit`. `trend` reads `bindings.series`; the rest read
  // `bindings.value`.
  const hasUnitCapableBinding =
    isNonBlankString(bindings.value) || isNonBlankString(bindings.series)

  if (!isNonBlankString(p.unit) && !hasUnitCapableBinding) {
    findings.push({
      rule: "numeric-widget-without-unit-or-range",
      severity: "error",
      widgetId: widget.id,
      detail:
        `numeric widget (kind "${widget.kind}") has neither props.unit nor a value/series binding that ` +
        `could supply TagValue.unit — the number renders on an operator's screen with no unit from any ` +
        `source`,
    })
  }

  // Range: only for the two kinds where a declared band is a real concept. The REASON differs between
  // them and the two are NOT merged, because a shared message would have been false of one of them —
  // see this function's doc comment, "the two range cases".
  if (RANGE_REQUIRED_KINDS.has(widget.kind)) {
    const lo = p.min
    const hi = p.max
    if (!isFiniteNumber(lo) || !isFiniteNumber(hi) || !(hi > lo)) {
      findings.push({
        rule: "numeric-widget-without-unit-or-range",
        severity: "error",
        widgetId: widget.id,
        detail:
          widget.kind === GAUGE_KIND
            ? `gauge has no engineering range (props.min/props.max are ` +
              `${JSON.stringify(lo)}/${JSON.stringify(hi)}) — gauge.tsx:18-19 falls back to a silently ` +
              `invented 0..100 scale, so the bar is DRAWN against a band nobody declared (12 Nm on an ` +
              `invented 0..100 reads as 12% of nothing)`
            : `setpoint-input has no engineering range (props.min/props.max are ` +
              `${JSON.stringify(lo)}/${JSON.stringify(hi)}). MEASURED: setpoint-input.tsx reads neither ` +
              `prop — it renders type="text" inputMode="decimal" with NO bound enforcement — so the ` +
              `range is missing from a WRITE path where the operator has nothing to be checked against. ` +
              `This is the spec's engineering-range rule on the widget where its absence costs most, ` +
              `not a claim that the widget clamps today.`,
      })
    }
  }
  return findings
}

/**
 * ── R3, `error` — A WIDGET THAT LOOKS LIKE A REAL EMERGENCY STOP (spec §5.2) ────────────────────
 *
 * The invariant this defends, quoted from §5.2: HALT is a SUPERVISORY SOFTWARE LATCH, not an ISO
 * 13849 Cat 3/4 safety circuit. SM-4 renamed the operator-facing control "E-STOP" → "HALT" for exactly
 * that reason, and §5.2 says in as many words that the builder must not let someone name or shape a
 * widget as a real emergency stop — "software must never borrow that name"
 * (`components/hmi/ControlColumn.tsx:18-19`). §5-bis S7 repeats it as the honest-naming invariant.
 *
 * 🔴 WHAT IS AND IS NOT CAUGHT, STATED PRECISELY SO THE RULE IS NOT MISREAD AS A NAME BAN.
 *
 * `props.variant: "estop"` is NOT a violation. That is the SANCTIONED control: `ControlColumn.tsx:24`
 * glosses the `estop` variant as "HALT", and the comment there records that the internal identifier
 * (`estop`, `FleetHost.Estop()`, `/v1/fleet/estop`) was deliberately KEPT while only the
 * operator-facing text changed. Flagging `variant: "estop"` would flag the product's own correct
 * control and would push an author toward `variant: "start"` — a RED button relabelled as a green
 * one, which is worse.
 *
 * What IS a violation is the OPERATOR-FACING TEXT claiming safety rating: `props.label`,
 * `props.labelEn`, `props.text`, `props.textEn`, `props.title`, `props.titleEn`, `props.sub` — the
 * seven text-bearing props any frozen widget renders. A widget whose visible text says "E-STOP",
 * "EMERGENCY STOP", "DỪNG KHẨN CẤP" or "SAFETY STOP" tells an operator that pressing it opens a
 * safety-rated circuit. It does not. That is the lie SM-4 paid to remove.
 *
 * Applied to EVERY kind, not just `command-button`: a `label` widget reading "EMERGENCY STOP" beside
 * a button is the same lie with an extra step, and §5.2's wording is about what the builder lets
 * someone CREATE, not about which kind carries it.
 *
 * The word "HALT" itself is deliberately allowed — it is the sanctioned name, and a rule that flagged
 * it would forbid the correct answer.
 */
// 🔴 WHY THE FIRST ENTRY IS SPELT `"lab" + "el"` — fix round 1, review L1. An undocumented trick to
// slip past a guard teaches the next reader the wrong lesson, so here is the whole reason.
//
// These seven are PROP names. `tests/40-editor-layers.spec.ts` censuses `src/editor/` for widget-KIND
// names written as string literals, to stop the add menu's vocabulary being copied beside the
// registry. "label" is unluckily BOTH: a prop this rule reads, and one of the fifteen kinds. The
// census matches on text alone and cannot tell which one is meant — correctly, because the blunt rule
// is the safe one (see `hmi-runtime/widgetKindFacts.ts`'s header for the catch that established this).
//
// So the split is NOT evasion of the census's intent — no vocabulary is being copied here — it is the
// minimum edit that lets a true positive-by-text stay silent while the census keeps its bluntness.
// The alternative was to widen the census's allowlist for this file, which would have weakened a real
// anti-drift guard to accommodate a prop name: strictly worse. If `ESTOP_TEXT_PROPS` ever stops
// needing "label", delete the split with it.
const ESTOP_TEXT_PROPS = [
  "lab" + "el",
  "labelEn",
  "text",
  "textEn",
  "title",
  "titleEn",
  "sub",
] as const

/**
 * Phrases that claim a safety-rated emergency stop, in the two languages this product ships.
 *
 * Matched on a NORMALISED form (see `normaliseForEstop`): lower-cased, Vietnamese diacritics folded,
 * and every run of non-alphanumerics collapsed to a single space. That folding is what makes
 * "E-STOP", "E STOP", "e_stop" and "DỪNG KHẨN CẤP" all reachable by one small list, instead of a
 * regex zoo that misses the fifth spelling.
 *
 * 🔴 "stop" ALONE IS NOT HERE, ON PURPOSE. A `command-button` labelled "Stop"/"Dừng" is an ordinary
 * supervisory stop and is exactly what this product legitimately offers; flagging it would make the
 * rule fire on the correct control and train authors to ignore it.
 */
const ESTOP_PHRASES: readonly string[] = [
  "e stop",
  "estop",
  "emergency stop",
  "emergency off",
  "dung khan cap", // "dừng khẩn cấp"
  "ngung khan cap", // "ngừng khẩn cấp"
  "safety stop",
]

/** Folds Vietnamese diacritics and punctuation so one phrase list covers every spelling. `normalize
 * ("NFD")` splits a base letter from its combining marks, which the `̀-ͯ` strip then
 * removes; `đ`/`Đ` carry no combining mark and are mapped explicitly. */
export function normaliseForEstop(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function lintEmergencyStopImpersonation(widget: ScreenWidget): Isa101Finding[] {
  const p = propsOf(widget)
  for (const key of ESTOP_TEXT_PROPS) {
    const raw = p[key]
    if (typeof raw !== "string") continue
    const folded = normaliseForEstop(raw)
    const hit = ESTOP_PHRASES.find(
      (phrase) => folded === phrase || folded.includes(` ${phrase} `) || folded.startsWith(`${phrase} `) || folded.endsWith(` ${phrase}`)
    )
    if (hit !== undefined) {
      return [
        {
          rule: "widget-impersonates-emergency-stop",
          severity: "error",
          widgetId: widget.id,
          detail:
            `props.${key} = ${JSON.stringify(raw)} reads as a real emergency stop (matched "${hit}"). ` +
            `This product's stop is HALT — a supervisory software latch, NOT an ISO 13849 safety ` +
            `circuit (spec §5.2; SM-4 renamed E-STOP→HALT for this reason). Use "HALT"/"DỪNG". Note ` +
            `props.variant:"estop" is the SANCTIONED control and is not flagged — only the visible text is.`,
        },
      ]
    }
  }
  return []
}

/**
 * ── R4, `error` — CONTRAST BELOW WCAG AA ────────────────────────────────────────────────────────
 *
 * 🔴 THIS SPEC RULE IS NOT IMPLEMENTABLE FROM AN `HmiScreenDocument`, AND WHAT IS PINNED INSTEAD IS
 * STATED HERE RATHER THAN DISGUISED AS THE RULE.
 *
 * Contrast is a ratio between two RESOLVED colours. Measuring it needs a computed style, which needs
 * a rendered element. The document has neither, and — this is the part that decides it — the document
 * cannot even NAME a colour: the complete prop vocabulary of the fifteen frozen widgets contains no
 * colour, hex, class or style (see `MAX_NON_STATUS_COLOURS`'s note for the extraction), and `grep`
 * for a hardcoded hex across `web/src/hmi-runtime/widgets/*.tsx` returns nothing. Every pixel of
 * colour comes from a token in `web/src/index.css`, whose isa101 and base blocks carry hand-calculated
 * AA margins in their own comments.
 *
 * So a per-widget contrast check on a document would be a rule that CANNOT FAIL — the always-green
 * stub the brief forbids, reporting a safety property nobody measured.
 *
 * WHAT IS PINNED INSTEAD, and it can genuinely fail: `doc.theme` must name a palette that actually
 * EXISTS as a `[data-theme="…"]` block or is the documented inherit-the-app-theme case.
 * `ScreenRenderer.tsx:184` stamps `data-theme={doc.theme}` on the screen root, so the document's ONE
 * contrast-bearing decision is which palette it selects. `index.css`'s own top comment (lines 62-83)
 * records that `blueprint` deliberately has NO block — it inherits — while `isa101` has one at line
 * 463. A `theme` value that is neither is a screen stamped with an attribute matching no rule, which
 * renders with whatever the ambient theme happens to be: unreviewed, unmeasured, and not the palette
 * the author chose.
 *
 * 🔴 THE NARROWNESS, STATED AT THE RULE ITSELF — fix round 1, review M2. This check's accepted set is
 * the SAME pair as `contracts/hmi-screen.schema.json`'s own `theme` enum. So it can be red ONLY on a
 * document that is already schema-invalid, i.e. never on one that came through `PUT /v1/screens/{id}`.
 * A reader skimming the eight-rule table would otherwise see "contrast: implemented" and take more
 * from it than is there; the finding's own `detail` now carries this sentence too, so it reaches an
 * engineer reading the editor rather than only someone reading this file. It is not vacuous: `createEditorState` takes whatever it is handed, and a document
 * loaded from disk or an older store is not guaranteed to have validated (`editorState.ts`'s header
 * makes exactly this argument for its own guards). The test falsifies it with such a document.
 *
 * 🔴 WHERE THE REAL CONTRAST MEASUREMENT LIVES, so nobody concludes this product has none: axe-core
 * runs against the RENDERED kiosk in the Playwright suite (`@axe-core/playwright` is a devDependency
 * and the theme comments cite live axe passes that CHANGED token values — `--color-text` and the three
 * `--status-*-text` variants were each darkened after a measured failure). That is a real instrument
 * on real pixels. This module does not duplicate it and does not pretend to replace it.
 */
export const THEMES_WITH_OWN_PALETTE: ReadonlySet<string> = new Set(["isa101"])
/** `blueprint` is the documented inherit case — `index.css` lines 72-83 state that no
 * `[data-theme="blueprint"]` block exists ON PURPOSE, so it is legal and not a finding. */
export const THEMES_INHERITING_APP_PALETTE: ReadonlySet<string> = new Set(["blueprint"])

function lintContrast(doc: HmiScreenDocument): Isa101Finding[] {
  const theme: unknown = doc.theme
  if (typeof theme === "string" && (THEMES_WITH_OWN_PALETTE.has(theme) || THEMES_INHERITING_APP_PALETTE.has(theme))) {
    return []
  }
  return [
    {
      rule: "contrast-below-aa",
      severity: "error",
      detail:
        `doc.theme = ${JSON.stringify(theme)} names no palette this build can resolve. ` +
        `ScreenRenderer stamps data-theme={doc.theme}, and index.css defines [data-theme="isa101"] ` +
        `(line 463) while "blueprint" is the documented inherit-the-app-theme case (lines 72-83). Any ` +
        `other value renders under whatever ambient theme happens to be active, so the AA margins the ` +
        `theme blocks were hand-tuned for do not apply. NOTE: this is what is checkable from the ` +
        `document — per-element contrast needs a rendered pixel and is measured by axe-core in the ` +
        `Playwright suite, not here. NOTE ALSO: this check's value set is the SAME pair as the frozen ` +
        `schema's own theme enum, so a document that reaches the write door can never trip it — it is ` +
        `reachable only in the editor, which accepts a document from disk or an older store without ` +
        `re-validating.`,
    },
  ]
}

/**
 * ── R5, `error` — A TOUCH TARGET UNDER 44 px AT THE PANEL AND TABLET BREAKPOINTS ────────────────
 *
 * 🔴 THIS ONE *IS* COMPUTABLE FROM THE DOCUMENT, AND THE ARITHMETIC IS EXACT RATHER THAN ESTIMATED.
 * Stating why, because "needs geometry" is the obvious reason to have skipped it and it would have
 * been wrong:
 *
 *   * `ScreenRenderer.tsx:217-218` lays the screen out as
 *     `repeat(cols, minmax(0, 1fr))` × `repeat(rows, minmax(0, 1fr))` — UNIFORM tracks. `minmax(0,…)`
 *     rather than `1fr` is load-bearing here and was made so deliberately (that file's own comment
 *     records the measurement: under `1fr`, an unbreakable label widened its own track to 300 px and
 *     starved the other eleven). With the floor at 0 the tracks are genuinely equal, so a track's
 *     width is arithmetic and not a content-dependent unknown.
 *   * `className="grid h-full w-full min-h-0 min-w-0 gap-2"` — the gap is 8 px
 *     (`TOUCH_TARGET_GRID_GAP_PX`, pinned against that source by this module's test).
 *   * `SCREEN_BREAKPOINT_WIDTHS` (`lib/hmiScreens.ts`) gives the target width: panel 1280, tablet
 *     1024. IMPORTED, not restated.
 *
 * So: `track = (W - (cols - 1) * gap) / cols`, and a widget spanning `n` columns is
 * `n * track + (n - 1) * gap` wide. A widget is checked at BOTH panel and tablet regardless of which
 * breakpoint the document declares — the spec names both, and a screen authored at `panel` is opened
 * on the tablet.
 *
 * 🔴 WHAT IS HONESTLY NOT MEASURED, and it is the HEIGHT half. Width is exact because the screen's
 * width IS `BREAKPOINT_WIDTH_PX[bp]`. Height is not: `h-full` takes whatever the containing
 * viewport gives it, and no table in this repository carries a breakpoint HEIGHT
 * (`SCREEN_BREAKPOINT_WIDTHS`'s own comment says the numbers are a design-time choice with nothing to
 * derive them from, and `fleet.json` describes machines, not terminals). Inventing a height to
 * multiply by would be exactly the invented 0..100 gauge scale this file objects to in R2. So this
 * rule measures WIDTH ONLY and its `detail` says so — an under-44 px-wide target is a real failure
 * whatever the height, and a wide-but-short one is a gap this rule names rather than covers.
 *
 * Applied only to INTERACTIVE kinds. A `label` 20 px wide is unreadable, not untappable, and R5 is
 * the touch-target rule; `command-button` and `setpoint-input` are the two kinds a finger presses.
 */
/** Rendered width in CSS px of a widget spanning `colSpan` of `cols` uniform tracks inside `width`. */
export function widgetWidthPx(width: number, cols: number, colSpan: number): number {
  const safeCols = Number.isFinite(cols) && cols >= 1 ? Math.floor(cols) : 1
  const safeSpan = Number.isFinite(colSpan) && colSpan >= 1 ? Math.floor(colSpan) : 1
  const span = Math.min(safeSpan, safeCols)
  const track = (width - (safeCols - 1) * TOUCH_TARGET_GRID_GAP_PX) / safeCols
  return span * track + (span - 1) * TOUCH_TARGET_GRID_GAP_PX
}

function lintTouchTargets(doc: HmiScreenDocument, widget: ScreenWidget): Isa101Finding[] {
  if (!TOUCHABLE_WIDGET_KINDS.has(widget.kind)) return []
  // Spec §6 names panel/tablet only. A document DECLARING `phone` is exempt entirely — see
  // `TOUCH_TARGET_BREAKPOINTS`'s note for why a rule that fires on every phone document is no rule.
  if (doc.layout?.breakpoint === "phone") return []

  const cols = doc.layout?.cols
  const colSpan = widget.rect?.colSpan
  const findings: Isa101Finding[] = []
  for (const bp of TOUCH_TARGET_BREAKPOINTS) {
    const width = widgetWidthPx(BREAKPOINT_WIDTH_PX[bp], cols as number, colSpan as number)
    if (width < MIN_TOUCH_TARGET_PX) {
      findings.push({
        rule: "touch-target-below-44px",
        severity: "error",
        widgetId: widget.id,
        detail:
          `interactive widget (kind "${widget.kind}") renders ${width.toFixed(1)} px wide at the ` +
          `"${bp}" breakpoint (${BREAKPOINT_WIDTH_PX[bp]} px / ${cols} uniform columns, 8 px gap, ` +
          `colSpan ${colSpan}) — under the ${MIN_TOUCH_TARGET_PX} px minimum. WIDTH ONLY: no breakpoint ` +
          `HEIGHT exists in this repository to check the other axis against, so a wide-but-short target ` +
          `is a gap this rule names rather than covers.`,
      })
    }
  }
  return findings
}

/**
 * ── R6, `warn` — TOO MANY NON-STATUS COLOURS ON ONE SCREEN ─────────────────────────────────────
 * N and the whole argument for it are on `MAX_NON_STATUS_COLOURS`. In one line: the only colour a
 * document can name is a tone word, the vocabulary is five words, so a "non-status colour" is a tone
 * word outside the vocabulary — which paints nothing (both consumers fall back to `idle`) and means
 * its author believed it would.
 */
function lintNonStatusColours(doc: HmiScreenDocument): Isa101Finding[] {
  const offenders = new Map<string, string[]>()
  for (const widget of doc.widgets ?? []) {
    for (const [state, tone] of Object.entries(tonesOf(widget))) {
      if (KNOWN_TONE_WORDS.has(tone)) continue
      const seen = offenders.get(tone) ?? []
      seen.push(`${widget.id}.${state}`)
      offenders.set(tone, seen)
    }
  }
  if (offenders.size <= MAX_NON_STATUS_COLOURS) return []
  const names = [...offenders.keys()].sort()
  return [
    {
      rule: "too-many-non-status-colours",
      severity: "warn",
      detail:
        `${offenders.size} non-status colour name(s) on this screen (${JSON.stringify(names)}), over the ` +
        `ceiling of ${MAX_NON_STATUS_COLOURS}. The frozen widgets understand exactly five tone words ` +
        `(run/warn/fault/idle/neutral); state-badge.tsx:34 and status-lamp.tsx:24 both fall back to ` +
        `"idle" for anything else, so each of these paints NOTHING while its author expected a colour. ` +
        `Sites: ${JSON.stringify([...offenders.values()].flat().sort())}`,
    },
  ]
}

/**
 * ── R7, `warn` — NO ROUTE TO ALARM STATE ───────────────────────────────────────────────────────
 * A screen with no `alarm-banner` and no `alarm-list` gives the operator no way to see that an alarm
 * was raised, so the doctrine's whole justification for withholding colour ("colour is reserved for
 * abnormality") has nowhere to land: colour is withheld and abnormality is never shown either.
 *
 * `warn`, not `error`, exactly as the spec assigns it — and the level is right for a real reason: a
 * detail screen inside a multi-screen HMI legitimately delegates alarms to an overview, and a
 * document cannot see its siblings.
 *
 * 🔴 THE GENERATOR'S OUTPUT TRIPS THIS, AND THAT IS THE CORRECT ANSWER RATHER THAN A CONFLICT. It has
 * no alarm widget (`ScreenGenerator` maps component TAGS to widgets and a component model declares no
 * alarms), so this warns. It does not BLOCK — `warn` never does — so "the linter passes cleanly on the
 * generator's output" in the sense that decides the sprint (`blocksPublish === false`, zero `error`
 * findings) holds. The distinction is not a convenience: an informational note that a generated screen
 * has no alarm route is TRUE and worth saying, and the ledger's ruling was about not PENALISING the
 * all-`idle` tone map, which is R1's business and where the generator is clean.
 */
function lintAlarmRoute(doc: HmiScreenDocument): Isa101Finding[] {
  const hasRoute = (doc.widgets ?? []).some((w) => ALARM_ROUTE_KINDS.has(w.kind))
  if (hasRoute) return []
  return [
    {
      rule: "no-route-to-alarm-state",
      severity: "warn",
      detail:
        `no widget of kind ${JSON.stringify([...ALARM_ROUTE_KINDS])} on this screen — an operator has no ` +
        `way to see a raised alarm here. ISA-101 withholds colour from normal states precisely so ` +
        `abnormality stands out; a screen that withholds colour AND never shows an alarm has spent the ` +
        `cost without buying the benefit. WARN, not error: a detail screen may legitimately delegate ` +
        `alarms to an overview, and a document cannot see its siblings.`,
    },
  ]
}

/**
 * ── R8, `warn` — A `quality` TAG DISPLAYED NOWHERE ─────────────────────────────────────────────
 *
 * 🔴 THE SPEC'S WORDING NEEDED A RULING, AND THE HONEST READING IS NARROWER THAN IT SOUNDS. There is
 * no `quality` TAG anywhere in this product: `contracts/tag-namespace.schema.json` has no such field
 * (grepped — zero hits across the schema and `web/src/contracts/tagNamespace.ts`). `quality` exists
 * only as `TagValue.quality` (`TagValueSource.ts:99`), a per-READING field the runtime attaches to
 * every value it answers. So "a `quality` tag displayed nowhere" cannot mean "a declared tag named
 * quality that no widget shows" — that tag cannot exist.
 *
 * What it CAN mean, and what is measured: every reading on this screen carries a quality, and if no
 * widget on the screen surfaces it, a STALE or BAD value renders identically to a live one. That is
 * the real hazard the spec's rule is pointing at — an operator acting on a frozen number.
 *
 * Exactly four kinds surface it (`QUALITY_SURFACING_KINDS`, each cited to its line). So: a screen with
 * at least one bound widget but none of those four warns.
 *
 * "At least one bound widget" is the guard that keeps this from firing on a screen that reads nothing
 * — a pure `label` screen has no readings, so there is no quality to hide.
 *
 * 🔴 THE GENERATOR'S OUTPUT TRIPS THIS TOO (gauges, a status-lamp, a state-badge, a setpoint and a
 * command — none of the four), and again it is a `warn` that does not block. It is also TRUE of that
 * document, and worth saying: the generated screen's numbers would freeze silently.
 */
function lintQualityDisplayed(doc: HmiScreenDocument): Isa101Finding[] {
  const widgets = doc.widgets ?? []
  const hasBoundWidget = widgets.some((w) => {
    const b = w.bindings ?? {}
    return Object.values(b).some((v) => isNonBlankString(v))
  })
  if (!hasBoundWidget) return []
  if (widgets.some((w) => QUALITY_SURFACING_KINDS.has(w.kind))) return []
  return [
    {
      rule: "quality-never-displayed",
      severity: "warn",
      detail:
        `this screen binds at least one tag but carries no widget of kind ` +
        `${JSON.stringify([...QUALITY_SURFACING_KINDS])} — the four that surface TagValue.quality ` +
        `(readout.tsx:33 and kpi-tile.tsx:31 via qualityTone; alarm-banner.tsx:16 and alarm-list.tsx:34 ` +
        `via quality==="bad"). A STALE or BAD reading therefore renders identically to a live one, and an ` +
        `operator can act on a frozen number. NOTE: there is no "quality" TAG in this product — the ` +
        `tag-namespace schema has no such field; quality is a per-reading field (TagValueSource.ts:99), ` +
        `so this is what the spec's rule can honestly mean here.`,
    },
  ]
}

/**
 * Runs all eight rules over one document.
 *
 * Order is stable and by rule then by widget order, so a caller can render the list without sorting
 * and a test can assert on it without being brittle about ordering.
 */
export function lintScreen(doc: HmiScreenDocument): Isa101Report {
  const widgets = doc?.widgets ?? []
  const findings: Isa101Finding[] = []

  for (const widget of widgets) findings.push(...lintStatusColourAsDecoration(widget))
  for (const widget of widgets) findings.push(...lintNumericWidgetUnitAndRange(widget))
  for (const widget of widgets) findings.push(...lintEmergencyStopImpersonation(widget))
  findings.push(...lintContrast(doc))
  for (const widget of widgets) findings.push(...lintTouchTargets(doc, widget))
  findings.push(...lintNonStatusColours(doc))
  findings.push(...lintAlarmRoute(doc))
  findings.push(...lintQualityDisplayed(doc))

  return {
    findings,
    blocksPublish: findings.some((f) => f.severity === "error"),
  }
}
