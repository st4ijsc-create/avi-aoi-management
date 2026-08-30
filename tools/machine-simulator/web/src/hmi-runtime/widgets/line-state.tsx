import { StatusLamp, type StatusLampState } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, readBinding } from "./shared.ts"

const KNOWN_LAMP_STATES = new Set<StatusLampState>(["run", "warn", "fault", "idle"])

/**
 * `kind: "line-state"` — wraps `StatusLamp` at `size="lg"`: exactly the "housed pilot-lamp treatment
 * ... the ONE place per screen a [state] is the thing the operator reads first" that `StatusLamp`'s own
 * doc comment describes, applied here to a whole PRODUCTION LINE rather than one machine/component
 * (`status-lamp`'s job, `size="sm"`).
 *
 * A line's real state vocabulary (PackML: IDLE/STARTING/EXECUTE/HOLDING/ABORTED/STOPPED/...) is much
 * wider than `StatusLampState`'s four words, so `props.tones: Record<string, StatusLampState>` maps the
 * raw bound word onto one of the four colour buckets while the RAW word is still what's shown as the
 * label text — an operator sees "EXECUTE", coloured as whichever bucket the author mapped it to
 * (falling back to "idle" for an unmapped word, same fail-safe posture `status-lamp.tsx` uses for its
 * own unrecognized-value case).
 *
 * Bindings: `state`; optional `sub` for a secondary line-level reading (e.g. the active recipe name).
 */
export function LineStateWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const tv = readBinding(props, "state")
  const subTv = readBinding(props, "sub")
  const raw = typeof tv?.value === "string" ? tv.value : undefined
  const tones = asRecord(p.tones)
  const mapped = raw !== undefined ? tones[raw] : undefined
  const state: StatusLampState =
    typeof mapped === "string" && KNOWN_LAMP_STATES.has(mapped as StatusLampState) ? (mapped as StatusLampState) : "idle"
  const label = raw ?? (typeof p.label === "string" ? p.label : widget.id)

  return (
    <StatusLamp
      state={state}
      label={label}
      sub={subTv ? String(subTv.value) : undefined}
      live={state === "run"}
      size="lg"
    />
  )
}
