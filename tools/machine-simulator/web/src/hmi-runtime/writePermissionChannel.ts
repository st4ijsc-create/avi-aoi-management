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
 * <b>No role comparison lives here, or anywhere on this path.</b> `web/src/` already holds eight
 * identical copies of the `ROLE_RANK`/`meetsMinRole` hierarchy; the entire point of resolving in the
 * engine is that this tier consumes a boolean somebody else computed. There is no ninth copy.
 */
export const WritePermissionContext = React.createContext<PolicyResolution>({ state: "pending" })

/** The design-time value, defined once so the editor's provider and any test agree on the same object. */
export const DESIGN_TIME_RESOLUTION: PolicyResolution = { state: "design-time" }

/**
 * Read by `command-button.tsx`/`setpoint-input.tsx` and handed straight to `policyGate` as DATA — so the
 * gate itself stays a pure, JSX-free, directly-testable function that `widgetRegistry.test.mjs` can keep
 * executing under `node --test`.
 */
export function useWritePermissionResolution(): PolicyResolution {
  return React.useContext(WritePermissionContext)
}
