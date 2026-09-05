import * as React from "react"

import { useWritePermissions } from "@/lib/api"
import type { PolicyResolution } from "./widgets/shared.ts"
import { DESIGN_TIME_RESOLUTION, WritePermissionContext } from "./writePermissionChannel.ts"

/**
 * 🔴 Session S1 (S-6) — the two PROVIDERS that decide which world a `ScreenRenderer` is drawing in.
 * The context object and its hook live next door in `writePermissionChannel.ts` (JSX-free); this file
 * holds only components. Two files rather than one because a module exporting both a component and a
 * hook degrades fast refresh — `oxlint`'s `react(only-export-components)` — and because the two widgets
 * should reach their hook through a module with no JSX in it, the same discipline `widgets/shared.ts`
 * keeps. The names differ by more than case, deliberately: on Windows, `writePermissionContext.ts`
 * beside `WritePermissionContext.tsx` is a TS1149 case-collision, measured.
 *
 * <b>Why a CONTEXT and not a prop.</b> The obvious shape would thread a `machineCode` prop through
 * `ScreenRenderer` into `RenderedWidget` into `WidgetProps`. That is not available: `ScreenRenderer.tsx`
 * is BYTE-FROZEN for this session, and `WidgetProps` deliberately carries no model data (its own doc
 * comment records the WS-HMI-2 ruling that an unread prop there is a "false affordance"). A context read
 * by exactly the two widgets that need it changes neither file, adds nothing to the shared widget
 * surface, and leaves every other widget untouched.
 */

/**
 * Wraps a KIOSK screen: subscribes to `GET /v1/machines/{code}/write-permissions` and publishes the
 * engine's answer to the write widgets below.
 *
 * `machineCode === undefined` resolves to `pending` (disabled), NOT to design time — a runtime mount
 * that has somehow lost its machine code is unresolved, which must fail closed. The editor declares
 * design time explicitly through {@link DesignTimePermissionProvider} instead.
 *
 * 🔴 §5-bis — a failed permissions query disables the write widgets WITH A REASON and does nothing else:
 * no error page, no empty grid, no spinner over the screen. Every read-only widget keeps rendering live
 * data, and the per-widget `WidgetErrorBoundary` is untouched.
 */
export function WritePermissionProvider({
  machineCode,
  children,
}: {
  machineCode: string | undefined
  children: React.ReactNode
}) {
  const query = useWritePermissions(machineCode)
  const { isError, isPending, data } = query

  const resolution = React.useMemo<PolicyResolution>(() => {
    if (machineCode === undefined || machineCode.length === 0) return { state: "pending" }
    // Error BEFORE pending: React Query reports `isPending` alongside an error while it backs off
    // between retries, and "the engine did not answer" is a more accurate thing to tell an operator than
    // "still checking" once a real failure has been seen. Both are disabled either way — this only
    // decides WHICH true sentence the operator reads.
    if (isError) return { state: "unavailable" }
    if (isPending || data === undefined) return { state: "pending" }

    const permitted: Partial<Record<"machine.setpoint" | "machine.command", boolean>> = {}
    const reasons: Partial<Record<"machine.setpoint" | "machine.command", string>> = {}
    for (const entry of data.permissions) {
      if (entry.policyAction === "machine.setpoint" || entry.policyAction === "machine.command") {
        permitted[entry.policyAction] = entry.permitted
        // The engine's own sentence names the required role, which is the one thing that tells a denied
        // operator who CAN do this. Carried only for denials — a permit needs no explanation.
        if (!entry.permitted) reasons[entry.policyAction] = entry.message
      }
    }
    return { state: "resolved", permitted, reasons }
  }, [machineCode, isError, isPending, data])

  return <WritePermissionContext.Provider value={resolution}>{children}</WritePermissionContext.Provider>
}

/**
 * 🔴 THE EDITOR'S BRANCH, and the trap this session had to avoid. `EditorCanvas.tsx` renders the VERY
 * SAME `ScreenRenderer` the kiosk does — deliberately, and an AST test pins it. An unconditional runtime
 * gate would therefore disable every `command-button` on the engineer's own canvas, because an Engineer
 * is not an Admin: a regression in the editor dressed up as a safety win.
 *
 * Design time is a SEPARATE ENABLED state, never the same branch as runtime-unresolved. The canvas has
 * no machine bound to it, nothing can dispatch from it, and authoring a control is not operating one.
 * Whichever default served the editor would otherwise serve the kiosk too — which is exactly how a
 * fail-closed rule gets quietly inverted.
 */
export function DesignTimePermissionProvider({ children }: { children: React.ReactNode }) {
  return (
    <WritePermissionContext.Provider value={DESIGN_TIME_RESOLUTION}>{children}</WritePermissionContext.Provider>
  )
}
