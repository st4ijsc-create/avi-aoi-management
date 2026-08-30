import { cn } from "@/lib/utils"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, formatValue, policyGate, readBinding } from "./shared.ts"

/**
 * `kind: "setpoint-input"` — no existing industrial primitive is a text input, so this one is built
 * fresh: a plain styled `<input>` matching this design system's border/radius/typography tokens rather
 * than a browser-default control.
 *
 * 🔴 SAFETY: identical gate to `command-button.tsx` (`policyGate`, `shared.ts`) — see that file's doc
 * comment for the full rationale. Absent `policyAction` renders the input `disabled` (the native
 * attribute — this is the plain "not applicable right now" case, not a latched control like HALT) AND a
 * visible, `aria-describedby`-linked reason paragraph; never a silently-inert-looking enabled box.
 *
 * Does NOT submit anywhere — see `command-button.tsx`'s matching note on why the actual write call is
 * out of this widget's scope.
 */
export function SetpointInputWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const gate = policyGate(widget)
  const tv = readBinding(props, "value")
  const label = typeof p.label === "string" ? p.label : widget.id
  const labelEn = typeof p.labelEn === "string" ? p.labelEn : undefined
  const unit = typeof p.unit === "string" ? p.unit : tv?.unit
  const reasonId = `${widget.id}-disabled-reason`

  return (
    <div className="flex flex-col gap-1">
      <div className="hmi-micro flex items-baseline gap-1.5">
        <span>{label}</span>
        {labelEn ? <span>{labelEn}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          defaultValue={tv ? formatValue(tv.value) : ""}
          disabled={gate.disabled}
          aria-describedby={gate.reason ? reasonId : undefined}
          className={cn(
            "w-24 rounded-[var(--radius-sm)] border px-2 py-1 text-[13px] tabular-nums",
            gate.disabled
              ? "cursor-not-allowed border-border bg-surface-muted text-text-muted"
              : "border-border-strong bg-surface-card text-text-strong"
          )}
        />
        {unit ? <span className="hmi-micro">{unit}</span> : null}
      </div>
      {gate.reason ? (
        <p id={reasonId} role="note" className="text-[11px] text-danger-text">
          {gate.reason}
        </p>
      ) : null}
    </div>
  )
}
