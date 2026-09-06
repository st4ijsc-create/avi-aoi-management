import * as React from "react"

import type { PolicyResolution } from "./widgets/shared.ts"

/**
 * 🔴 Session S1 (S-6) — the context CHANNEL that carries the engine's per-session write verdict to the
 * two write widgets, plus the hook that reads it.
 *
 * <b>Why this is a separate, JSX-free `.ts` file from `WritePermissionContext.tsx`.</b> The providers
 * are components; this is a context object and a hook. Keeping them in one file makes that file export
 * both a component and a non-component, which `oxlint`'s `react(only-export-components)` correctly flags
 * (fast refresh degrades). Splitting also means the two widgets import their hook from a module with no
 * JSX in it at all, consistent with the discipline `widgets/shared.ts` already keeps.
 *
 * <b>The default is RUNTIME-UNRESOLVED, and that direction is deliberate.</b> A write widget rendered
 * with no provider above it gets `{state: "pending"}` — disabled, with a visible reason — rather than
 * design time. The safe default must be the one that CLOSES; design time is opt-in, declared by a mount
 * that knows it has no machine (`DesignTimePermissionProvider`).
 *
 * <b>No role comparison lives here, or anywhere on this path.</b> The `ROLE_RANK`/`meetsMinRole`
 * hierarchy now has exactly ONE home, `lib/roleRank.ts` (Session 5 hoisted the eight identical copies
 * that used to be scattered across routes and the shell; `runtime-tests/roleRank.test.mjs` pins that a
 * ninth cannot appear). This file does not import it and must not: the entire point of resolving in
 * the engine is that this tier consumes a boolean somebody else computed.
 */
export const WritePermissionContext = React.createContext<PolicyResolution>({ state: "pending" })

/** The design-time value, defined once so the editor's provider and any test agree on the same object. */
export const DESIGN_TIME_RESOLUTION: PolicyResolution = { state: "design-time" }

/**
 * 🔴 SECURITY REVIEW M-2, fix round 1 — turns a FULFILLED response body into a `PolicyResolution`,
 * treating the body as UNTRUSTED.
 *
 * <b>Why this is here and not inline in the provider's `useMemo`.</b> It is the same reasoning that
 * keeps `policyGate` in a plain `.ts`: a pure function in a JSX-free module can be imported and
 * EXECUTED directly by `widgetRegistry.test.mjs` under `node --test`, so the malformed-body cases are
 * pinned against real behaviour rather than a source-text pattern match. Left inside the component,
 * the only way to test it would be to render React, which this suite deliberately cannot do.
 *
 * <b>What it defends against.</b> `lib/api.ts`'s `request` ends in `return (await res.json()) as T` —
 * an unchecked cast, with no runtime validation anywhere on this path. A 200 whose body lacks
 * `permissions` (a proxy rewriting the body, a half-deployed engine, a truncated response) previously
 * threw a TypeError inside the provider's `useMemo`, i.e. DURING RENDER. Measured: the only error
 * boundary in the whole web tree is `WidgetErrorBoundary`, mounted per-widget INSIDE `ScreenRenderer`
 * and therefore strictly BELOW the provider — so nothing could catch it and the entire kiosk page
 * unmounted. Closed for safety (no control renders) but OPEN for availability, and on a machine HMI a
 * blank screen is its own hazard: the operator loses every read-only widget and all its live data
 * during a partial engine fault.
 *
 * <b>Every rejection is `unavailable`</b> — the same state as a rejected query, because it is the same
 * fact: the engine did not give a usable answer. Consistent with every other seam in this tree
 * (`ScreenRenderer`'s unknown-`kind` degradation, `asRecord`, `policyGate`'s `unknown` typing), all of
 * which are built on the position that what reaches the renderer is not trusted.
 *
 * `body` is typed `unknown` on purpose — narrowing it to the DTO would make these branches look
 * unreachable to `tsc` while remaining perfectly reachable at runtime, which is exactly how the
 * pre-S1 truthiness gate survived several reviews.
 */
export function resolutionFromBody(body: unknown): PolicyResolution {
  if (body === null || typeof body !== "object") return { state: "unavailable" }

  const permissions = (body as { permissions?: unknown }).permissions
  if (!Array.isArray(permissions)) return { state: "unavailable" }

  const permitted: Partial<Record<"machine.setpoint" | "machine.command", boolean>> = {}
  const reasons: Partial<Record<"machine.setpoint" | "machine.command", string>> = {}

  for (const entry of permissions) {
    // A non-object row would throw on property access. Skipping leaves its action unmentioned in
    // `permitted`, and an unmentioned action is a denial (`policyGate` requires `=== true`) — so
    // skipping fails CLOSED rather than silently granting.
    if (entry === null || typeof entry !== "object") continue

    const { policyAction, permitted: rawPermitted, message } = entry as {
      policyAction?: unknown
      permitted?: unknown
      message?: unknown
    }
    if (policyAction !== "machine.setpoint" && policyAction !== "machine.command") continue

    // `=== true`, not truthiness: the wire is untrusted, and `policyGate` strict-compares too. A
    // "yes" or a 1 from a malformed body is not a permit.
    permitted[policyAction] = rawPermitted === true

    // The engine's own sentence names the required role — the one thing that tells a denied operator
    // who CAN do this. Carried only for denials, and only when it really is a string.
    if (rawPermitted !== true && typeof message === "string") reasons[policyAction] = message
  }

  return { state: "resolved", permitted, reasons }
}

/**
 * Read by `command-button.tsx`/`setpoint-input.tsx` and handed straight to `policyGate` as DATA — so the
 * gate itself stays a pure, JSX-free, directly-testable function that `widgetRegistry.test.mjs` can keep
 * executing under `node --test`.
 */
export function useWritePermissionResolution(): PolicyResolution {
  return React.useContext(WritePermissionContext)
}
