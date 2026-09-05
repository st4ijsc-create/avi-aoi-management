/**
 * Session 3 (WS-HMI-4) — WHAT EACH FROZEN WIDGET KIND ACTUALLY DOES WITH ITS BOUND VALUE.
 *
 * Four facts per kind, each a claim about the RUNTIME rather than a taxonomy, and each cited below to
 * the line of the widget that makes it true. `editor/isa101Linter.ts` is the only consumer today; the
 * table lives HERE, next to the fifteen `.tsx` files it describes, for two reasons that agree:
 *
 *   1. IT IS A FACT ABOUT THE RUNTIME, NOT ABOUT THE EDITOR. "Does `readout` surface
 *      `TagValue.quality`?" is answered by `readout.tsx:33` and by nothing in `src/editor/`. A reader
 *      checking one of these booleans opens the widget beside it, not a linter two directories away.
 *   2. 🔴 `tests/40-editor-layers.spec.ts` censuses `src/editor/` and forbids any module there from
 *      writing a widget-kind name as a string literal — because the add menu's vocabulary must come
 *      from `widgetRegistry.ts`, and a second list of kind names beside it is a thing to drift. The
 *      first draft of the linter declared these sets inline as `new Set<WidgetKind>(["gauge", …])` and
 *      that census caught it: 295 passed, 1 failed, correctly. The test cannot distinguish "a second
 *      copy of the menu's vocabulary" from "a rule saying which kinds it applies to", and it is right
 *      not to try — the safe rule is the blunt one.
 *
 *      Moving the table here is not a way around that pin. `src/hmi-runtime/` is where kind names
 *      legitimately live (`widgetRegistry.ts` is the registry the census points AT), and the table is
 *      held to a stronger check than the census would have applied: see `KIND_FACTS` below.
 *
 * ── THE PROPERTY THAT REPLACES THE CENSUS FOR THIS FILE ──────────────────────────────────────────
 * `Record<WidgetKind, KindFacts>` is EXHAUSTIVE IN BOTH DIRECTIONS at compile time — a sixteenth kind
 * added to the frozen contract is a missing-property error here, and a name the contract does not
 * have is an excess-property error. That is strictly stronger than the four `Set`s it replaced, which
 * would have silently ignored a new kind and left every rule quietly not applying to it. Being caught
 * by the census is what produced this shape; it is the better one on the merits.
 *
 * `runtime-tests/isa101Linter.test.mjs` additionally pins the table against the registry itself, so
 * "exhaustive over `WidgetKind`" is checked against the real fifteen rather than against this file's
 * own idea of them.
 */
import type { WidgetKind } from "../contracts/hmiScreen.ts"

/** What each rule needs to know about a kind. One row per kind, one column per question. */
export type KindFacts = {
  /** R2 — the bound value is a NUMBER, so a unit (and for some, a range) is owed. */
  readonly numeric: boolean
  /** R7 — this kind is a route to alarm state. */
  readonly alarmRoute: boolean
  /** R8 — this kind surfaces `TagValue.quality`. */
  readonly surfacesQuality: boolean
  /** R5 — a finger presses this. */
  readonly touchable: boolean
  /** R2, the range half — a declared engineering band is a real concept for this kind. The two kinds
   * that qualify fail for DIFFERENT reasons and are reported differently; see the linter's
   * "the two range cases". */
  readonly needsRange: boolean
}

const NONE: KindFacts = {
  numeric: false,
  alarmRoute: false,
  surfacesQuality: false,
  touchable: false,
  needsRange: false,
}

/**
 * The one table. Every `true` is cited to the line that makes it true:
 *
 *   * `numeric` — `gauge.tsx:26` divides by `(max - min)`; `readout`/`kpi-tile` format a numeric
 *     `TagValue` against a `unit`; `setpoint-input` types a number into a write path; `trend` plots a
 *     numeric series. `status-lamp`, `state-badge` and `line-state` are NOT numeric — their bound
 *     value is a STRING (`typeof tv?.value === "string"`), and `ScreenGenerator` explicitly removes
 *     `unit` for them, so demanding a unit would penalise the generator for being correct.
 *   * `surfacesQuality` — `readout.tsx:33` and `kpi-tile.tsx:31` pass `qualityTone(tv.quality)` into
 *     the primitive's tone; `alarm-banner.tsx:16` and `alarm-list.tsx:34` treat `quality === "bad"` as
 *     a raised alarm. `gauge.tsx` reads `tv.value`/`tv.unit` and never looks at quality, which is why
 *     a screen of nothing but gauges genuinely does hide it.
 *   * `alarmRoute` — those same two alarm kinds; nothing else in the frozen fifteen shows an alarm.
 *   * `touchable` — the two kinds a finger presses. A `label` 20 px wide is unreadable, not
 *     untappable, and R5 is the touch-target rule.
 *   * `needsRange` — `gauge` DRAWS against the band (and invents `0..100` without one,
 *     `gauge.tsx:18-19`); `setpoint-input` is a WRITE path whose operator has nothing to be checked
 *     against without one. Measured: `setpoint-input.tsx` reads neither `min` nor `max` — a grep for
 *     `p.min`/`p.max` across all fifteen widgets returns `gauge.tsx` and nothing else.
 */
export const KIND_FACTS: Record<WidgetKind, KindFacts> = {
  readout: { numeric: true, alarmRoute: false, surfacesQuality: true, touchable: false, needsRange: false },
  gauge: { numeric: true, alarmRoute: false, surfacesQuality: false, touchable: false, needsRange: true },
  trend: { numeric: true, alarmRoute: false, surfacesQuality: false, touchable: false, needsRange: false },
  log: NONE,
  faceplate: NONE,
  label: NONE,
  sheet: NONE,
  "status-lamp": NONE,
  "state-badge": NONE,
  "line-state": NONE,
  "alarm-banner": { numeric: false, alarmRoute: true, surfacesQuality: true, touchable: false, needsRange: false },
  "alarm-list": { numeric: false, alarmRoute: true, surfacesQuality: true, touchable: false, needsRange: false },
  "kpi-tile": { numeric: true, alarmRoute: false, surfacesQuality: true, touchable: false, needsRange: false },
  "setpoint-input": { numeric: true, alarmRoute: false, surfacesQuality: false, touchable: true, needsRange: true },
  "command-button": { numeric: false, alarmRoute: false, surfacesQuality: false, touchable: true, needsRange: false },
}

/** `gauge`, as the one kind a caller must be able to name directly — R2's two range-owing kinds fail
 * for different reasons and their MESSAGES differ, so the linter distinguishes them by name. Exported
 * from here so the linter needs no kind literal of its own. */
export const GAUGE_KIND: WidgetKind = "gauge"

/** Reads one column of the table as a set — how every rule asks its question, so a kind's
 * classification has exactly one place it can be wrong. */
export function kindsWhere(column: keyof KindFacts): ReadonlySet<WidgetKind> {
  return new Set((Object.keys(KIND_FACTS) as WidgetKind[]).filter((kind) => KIND_FACTS[kind][column]))
}
