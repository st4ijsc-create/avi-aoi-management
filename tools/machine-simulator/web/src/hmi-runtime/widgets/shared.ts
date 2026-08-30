/**
 * Shared, JSX-free helpers used by every widget under `./` (`readout.tsx`, `gauge.tsx`, ...).
 *
 * Deliberately a PLAIN `.ts` file with NO React import and NO dependency — direct or transitive — on
 * any `.tsx` file: `web/runtime-tests/widgetRegistry.test.mjs` imports `policyGate` (below) DIRECTLY
 * under `node --test` to pin the §5 safety gate against real, EXECUTED logic rather than a source-text
 * pattern match. Node's native TypeScript loader strips plain `.ts` type syntax but cannot parse JSX at
 * all (measured, not assumed — see that test file's own header for the exact probe and error). Keeping
 * this module JSX-free is what makes that direct behavioural test possible; importing a `.tsx` file
 * here, even transitively, would break it.
 */
import type { ScreenWidget } from "../../contracts/hmiScreen.ts"
import type { TagValue } from "../TagValueSource.ts"
import type { WidgetProps } from "../widgetRegistry.ts"
import { formatMetric } from "../../lib/utils.ts"

export const NO_DATA = "—"

/** Narrows an `unknown` `props`/`props.*` value to a plain object, or `{}` — every widget reads
 * `widget.props` (schema type `Record<string, unknown>` — free-form, `contracts/hmi-screen.schema.json`
 * puts no further shape on it) and then digs into nested config (`thresholds`, `tones`, `rows`, ...)
 * that the TYPE doesn't guarantee is even an object. A malformed screen document must not throw here
 * (plan §5-bis: one bad widget fails alone, not the whole kiosk page). */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Resolves `widget.bindings?.[key]` through `resolve()` and looks it up in `source`. `undefined`
 * covers BOTH "this widget doesn't declare that binding key at all" and "the resolved path names
 * nothing `source` recognizes" — every widget here renders the same `NO_DATA` placeholder for either
 * case rather than treating a missing binding as a harder failure (plan §5-bis).
 */
export function readBinding(props: WidgetProps, key: string): TagValue | undefined {
  const raw = props.widget.bindings?.[key]
  if (typeof raw !== "string") return undefined
  return props.source.get(props.resolve(raw))
}

/** Renders a `TagValue.value` as display text — the only formatting this seam does today. Numbers use
 * the SAME scale-aware `formatMetric` every other numeric readout in this app already uses (`lib/
 * utils.ts`), not a second ad hoc `.toFixed()`. */
export function formatValue(value: TagValue["value"]): string {
  if (typeof value === "number") return formatMetric(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return value
}

/**
 * Maps a `TagValue.quality` onto the status-ramp `ReadoutTone` the industrial primitives use.
 * "good" → "neutral", NOT "run": a good reading isn't necessarily a RUNNING reading, and ISA-101 (plan
 * Task 4) reserves colour for the abnormal case, not the default one. "stale"/"bad" → the same
 * idle/fault buckets `ReadoutGrid.tsx`'s own tone tables already use for "no data yet" / "actually
 * wrong", reused rather than re-invented.
 */
export function qualityTone(quality: TagValue["quality"]): "neutral" | "idle" | "fault" {
  if (quality === "bad") return "fault"
  if (quality === "stale") return "idle"
  return "neutral"
}

export type Thresholds = { warn?: number; fault?: number }

/** Reads `props.thresholds` (used by `gauge.tsx`/`trend.tsx`) defensively — see `asRecord`'s doc
 * comment for why a free-form `props` value can't be trusted to already have this shape. */
export function readThresholds(props: Record<string, unknown>): Thresholds {
  const raw = asRecord(props.thresholds)
  return {
    warn: typeof raw.warn === "number" ? raw.warn : undefined,
    fault: typeof raw.fault === "number" ? raw.fault : undefined,
  }
}

export type PolicyGate = {
  /** True whenever `widget.policyAction` is absent — the ONLY input this gate looks at. It does NOT
   * (and at this seam CANNOT) check role, HALT state, or PolicyEngine's own rules — those are
   * server-side (`.claude/skills/st4i-machine-edition/SKILL.md` §3) and enforced again there
   * regardless of what this gate decides. This gate exists to satisfy one narrower, purely
   * client-side obligation: a document that never HAD a `policyAction` must never even offer an
   * enabled control, so a misconfigured or foreign screen document fails safe in the UI instead of
   * relying entirely on the server refusing the call after the fact. */
  disabled: boolean
  /** A human-visible explanation, always a non-empty string when `disabled` is true — `undefined`
   * otherwise. Never a silently-disabled control with no reason shown. */
  reason: string | undefined
}

/**
 * The ONE gate `setpoint-input.tsx` and `command-button.tsx` both call before deciding whether to
 * render an enabled control — kept here (plain `.ts`, no JSX) so `widgetRegistry.test.mjs` can pin its
 * behaviour by calling the SAME function the real widgets call, not a re-description of it.
 */
export function policyGate(widget: Pick<ScreenWidget, "policyAction" | "kind">): PolicyGate {
  if (widget.policyAction) return { disabled: false, reason: undefined }
  return {
    disabled: true,
    reason: `disabled — this "${widget.kind}" widget has no policyAction, so it could never reach the PolicyEngine gate`,
  }
}
