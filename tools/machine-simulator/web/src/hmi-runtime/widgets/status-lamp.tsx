import { StatusLamp, type StatusLampState } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, readBinding } from "./shared.ts"

const KNOWN_STATES = new Set<StatusLampState>(["run", "warn", "fault", "idle"])

/**
 * `kind: "status-lamp"` — wraps `StatusLamp` (small `size="sm"` variant by default — see
 * `line-state.tsx` for the `size="lg"` whole-line counterpart).
 *
 * Binding: `state`, expected to resolve to one of `StatusLampState`'s four words. A resolved value
 * outside that set does NOT crash the widget — a screen document from anywhere unexpected must still
 * render (plan §5-bis) — it falls back to `"idle"` and says so in the visible `sub` line instead of
 * silently mis-colouring the lamp.
 *
 * Example: `contracts/fixtures/valid/screen-overview-minimal.json`'s "state" widget.
 */
export function StatusLampWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const tv = readBinding(props, "state")
  const raw = typeof tv?.value === "string" ? tv.value : undefined
  const recognized = raw !== undefined && KNOWN_STATES.has(raw as StatusLampState)
  const state: StatusLampState = recognized ? (raw as StatusLampState) : "idle"
  const label = typeof p.label === "string" ? p.label : widget.id
  const sub =
    raw !== undefined && !recognized
      ? `unrecognized state "${raw}"`
      : typeof p.sub === "string"
        ? p.sub
        : undefined

  return <StatusLamp state={state} label={label} sub={sub} live={state === "run"} size={p.size === "lg" ? "lg" : "sm"} />
}
