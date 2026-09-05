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
import type { PolicyAction } from "../../contracts/tagNamespace.ts"
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
  /** True whenever `widget.policyAction` is absent OR is not one of the two actions the frozen
   * contract defines.
   *
   * 🔴 SESSION S1 (S-6) — and ALSO true, now, whenever the engine has not affirmatively said this
   * session may perform that action: query pending, engine unreachable, or an explicit deny. The
   * paragraph below described this seam's state BEFORE S1 and is preserved because its reasoning about
   * server-side enforcement still holds exactly — what changed is that the gate is no longer blind to
   * role and HALT, it is handed the engine's own verdict as data (`PolicyResolution`). It remains a UX
   * gate and never an authorisation: `MachineWriteEndpoints` re-evaluates every write regardless.
   *
   * It does NOT (and at this seam CANNOT) itself compute role, HALT state, or PolicyEngine's own
   * rules — those are server-side
   * (`.claude/skills/st4i-machine-edition/SKILL.md` §3) and enforced again there regardless of what
   * this gate decides. This gate exists to satisfy one narrower, purely client-side obligation: a
   * document that never HAD a usable `policyAction` must never even offer an enabled control, so a
   * misconfigured or foreign screen document fails safe in the UI instead of relying entirely on the
   * server refusing the call after the fact.
   *
   * 🔴 WS-HMI-2 Task 6, controller ruling — this used to be a TRUTHINESS check on the field, and the
   * sentence above used to say "absent" was the only input. Measured in that state: `policyAction:
   * "xyzzy"` rendered BOTH controls ENABLED with no reason shown, and so did `"  "` and
   * `"MACHINE.COMMAND"`. `ScreenRenderer` already states this project's stance that a document
   * reaching the renderer is NOT guaranteed schema-valid (validation happens at authoring/publish
   * time) and acts on it — an unknown `kind` degrades to a named placeholder. The policy gate faced
   * the same untrusted input and did the opposite: it opened. It is a membership check now. */
  disabled: boolean
  /** A human-visible explanation, always a non-empty string when `disabled` is true — `undefined`
   * otherwise. Never a silently-disabled control with no reason shown. */
  reason: string | undefined
}

/**
 * The closed vocabulary a `policyAction` may take, keyed BY the frozen contract type rather than
 * written down beside it. `PolicyAction` (`contracts/tagNamespace.ts`) is itself pinned two-way
 * against all three `contracts/*.schema.json` enums by `contract-tests/contracts.test.mjs`, so this
 * is the same closed vocabulary the schemas define, reached through the type instead of retyped.
 *
 * A `Record<PolicyAction, true>` is exhaustive in BOTH directions at COMPILE time: widening the
 * union without adding a member here is a missing-property error, and a member here that the union
 * does not have is an excess-property error. Two lists that can silently drift apart is the defect
 * this repository keeps writing comments about; this is deliberately not a third instance of it.
 */
const POLICY_ACTIONS: Record<PolicyAction, true> = {
  "machine.setpoint": true,
  "machine.command": true,
}

/** Membership, not truthiness. `value` is `unknown` on purpose: it arrives from a JSON document at
 * runtime with no guarantee it is even a string, let alone one of the two words the contract
 * defines — which is the entire case this gate exists for. */
function isPolicyAction(value: unknown): value is PolicyAction {
  return typeof value === "string" && Object.hasOwn(POLICY_ACTIONS, value)
}

/**
 * 🔴 Session S1 (S-6) — what the ENGINE said about this session, handed to `policyGate` as PLAIN DATA.
 *
 * <b>A data argument, deliberately not a hook.</b> This module is a plain `.ts` file with no React
 * import, because `web/runtime-tests/widgetRegistry.test.mjs` imports `policyGate` DIRECTLY under
 * `node --test` and executes the real function (Node's TS loader strips plain `.ts` types but cannot
 * parse JSX — see this file's own header). Calling `useWritePermissions()` inside the gate would make
 * that impossible and would replace an executed behavioural pin with a source-text pattern match. The
 * hook lives in the WIDGET; the decision lives here, pure and directly callable.
 *
 * The four states are deliberately separate rather than one nullable field, because they render
 * different sentences and — for `design-time` versus `pending` — opposite `disabled` values. Collapsing
 * them is precisely how a fail-closed gate becomes fail-open.
 */
export type PolicyResolution =
  /** 🔴 DESIGN TIME — the editor's canvas, which has NO machine bound to it. `EditorCanvas.tsx` renders
   * the very same `ScreenRenderer` the kiosk does (an AST test pins that), so an unconditional runtime
   * gate would disable every command button on the engineer's own canvas, because an Engineer is not an
   * Admin. This is a DISTINCT ENABLED branch, never shared with `pending`: nothing can dispatch from a
   * canvas, there is no machine to dispatch to, and authoring is not operating. */
  | { state: "design-time" }
  /** The permissions query has not answered yet. DISABLED — never optimistically enabled. */
  | { state: "pending" }
  /** The engine did not answer (network, 5xx, offline). DISABLED — absence of information is never a
   * grant. */
  | { state: "unavailable" }
  /** The engine answered. `permitted` is keyed by the SCREEN action word; a missing key means the engine
   * said nothing about that action, which is also a denial. */
  | { state: "resolved"; permitted: Partial<Record<PolicyAction, boolean>>; reasons?: Partial<Record<PolicyAction, string>> }

/**
 * 🔴 THE FAIL-CLOSED TABLE. Reached only once `action` is already a known member of the screen
 * vocabulary — membership is necessary and NOT sufficient, and this is the missing conjunct: "and this
 * session's role satisfies the obligation this action carries".
 *
 * `resolution === undefined` is treated as RUNTIME-UNRESOLVED (disabled), not as design time. That
 * direction matters: a caller that forgets to pass the resolution gets a safely disabled control and a
 * visible reason, rather than an enabled one. Design time must be requested EXPLICITLY, by a caller that
 * knows it has no machine — which is exactly what `EditorCanvas`'s renderer does.
 */
function resolvedGate(action: PolicyAction, resolution: PolicyResolution | undefined): PolicyGate {
  // 🔴 The editor's own canvas. The ONLY enabled branch that does not consult the engine, and it is
  // reachable only when a caller explicitly declares it has no machine context.
  if (resolution?.state === "design-time") return { disabled: false, reason: undefined }

  if (resolution === undefined || resolution.state === "pending") {
    return {
      disabled: true,
      reason:
        "đang kiểm tra quyền… / checking permissions… — this control stays disabled until the engine confirms this session may perform it",
    }
  }

  if (resolution.state === "unavailable") {
    return {
      disabled: true,
      reason:
        "không xác nhận được quyền — engine không trả lời / cannot confirm permission — the engine did not answer, so this control fails closed",
    }
  }

  if (resolution.permitted[action] === true) return { disabled: false, reason: undefined }

  // Explicit deny, OR the engine said nothing about this action. Both are refusals. The engine's own
  // sentence is preferred when it sent one — it names the required role, which is the one thing that
  // tells an operator who CAN do this — with a bilingual fallback when it did not.
  const engineReason = resolution.reasons?.[action]
  return {
    disabled: true,
    reason: engineReason
      ? `không đủ quyền / not permitted — ${engineReason}`
      : `không đủ quyền cho "${action}" / this session is not permitted to perform "${action}" on this machine`,
  }
}

/**
 * The ONE gate `setpoint-input.tsx` and `command-button.tsx` both call before deciding whether to
 * render an enabled control — kept here (plain `.ts`, no JSX) so `widgetRegistry.test.mjs` can pin its
 * behaviour by calling the SAME function the real widgets call, not a re-description of it.
 *
 * Three outcomes, not two, and the two disabled ones say DIFFERENT things on purpose — an author who
 * wrote nothing and an author who wrote something unrecognised need different next steps, and a
 * single shared message would send the second one looking for a missing field that is right there.
 *
 * 🔴 SESSION S1 (S-6) — MEMBERSHIP IS NO LONGER SUFFICIENT. Until S1 this function returned
 * `{disabled: false}` the moment `policyAction` was a member of the screen vocabulary, looking at no
 * other input — so an Operator opening a screen carrying a `command-button` saw an ENABLED button for
 * an action that requires Admin. The HMI told an operator a control was available when it was not.
 * A recognised action now additionally requires an affirmative permit from the ENGINE for THIS session
 * (`resolution`, above), and every path that lacks one renders disabled with a visible bilingual
 * reason. The one exception is `design-time`, which is the editor's canvas and is a distinct branch —
 * see `PolicyResolution` for why it must never share a branch with `pending`.
 *
 * The `resolution` argument is OPTIONAL for source compatibility with the pre-S1 call shape, and
 * omitting it fails CLOSED (disabled, "checking permissions…"), never open.
 *
 * `policyAction` is typed `unknown` here rather than `ScreenWidget["policyAction"]` because that is
 * the truth about where the value comes from. Narrowing it to the contract type would make the
 * unrecognised-value branch below look unreachable to `tsc` while remaining perfectly reachable at
 * runtime — a check the compiler believes cannot fire is exactly how the truthiness version survived.
 */
export function policyGate(
  widget: Pick<ScreenWidget, "kind"> & { policyAction?: unknown },
  resolution?: PolicyResolution
): PolicyGate {
  const action = widget.policyAction
  if (isPolicyAction(action)) return resolvedGate(action, resolution)
  if (action === undefined) {
    return {
      disabled: true,
      reason: `disabled — this "${widget.kind}" widget has no policyAction, so it could never reach the PolicyEngine gate`,
    }
  }
  // Names the offending value (JSON-quoted, so a whitespace-only or empty action is VISIBLE rather
  // than rendering as a blank gap in the sentence) and names what was expected.
  //
  // 🔴 task-6-review.md LOW-2 — this sentence used to end "an action the PolicyEngine has never heard
  // of could never be granted". That was FALSE, and it is corrected in place rather than quietly
  // deleted. MEASURED: the engine's own action vocabulary is `machine.setpoint.write` /
  // `machine.command.invoke` (`src/St4i.EngineApi/Policy/MachineWriteGate.cs:38,43`), the screen
  // contract's is `machine.setpoint` / `machine.command`, and the two sets are DISJOINT with no
  // translation layer anywhere in the tree. So the values this gate ACCEPTS are not, today, actions
  // the PolicyEngine knows either — a reader who believed the old sentence would reasonably pass
  // `widget.policyAction` straight to `POST /v1/machines/{code}/command` the day someone wires the
  // dispatch, and send a string the engine does not recognise.
  //
  // What this gate can see from the web tier, and therefore the only thing this message now claims,
  // is membership in the SCREEN CONTRACT's own vocabulary (`contracts/tagNamespace.ts`'s
  // `PolicyAction`, pinned two-way against all three `contracts/*.schema.json` enums). Whether the
  // two vocabularies should ever meet is an owner item; this string asserts nothing either way.
  return {
    disabled: true,
    reason: `disabled — this "${widget.kind}" widget declares policyAction ${JSON.stringify(action)}, which is not one of ${Object.keys(POLICY_ACTIONS)
      .map((known) => `"${known}"`)
      .join(" | ")} — the vocabulary this screen contract defines. A value outside it names nothing this document could validly have declared, so this control fails closed`,
  }
}
