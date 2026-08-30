import type { WidgetProps } from "../widgetRegistry.ts"
import { NO_DATA, asRecord, formatValue, readBinding, readThresholds } from "./shared.ts"

/**
 * `kind: "gauge"` — no existing industrial primitive renders a bounded-range gauge (`Readout`'s own
 * `gaugePct` donut is 0..100-only and always "fraction of a whole", not a `min..max` engineering-range
 * gauge with warn/fault bands) — built fresh, deliberately simple: a horizontal filled bar, not a
 * radial dial.
 *
 * Bindings: `value`. Props: `min`/`max` (default 0/100), `unit`, `label`/`labelEn`,
 * `thresholds: { warn?, fault? }` (values ON the min..max scale; the fill turns warn/fault-coloured
 * once `value` is AT OR ABOVE them).
 */
export function GaugeWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const tv = readBinding(props, "value")
  const min = typeof p.min === "number" ? p.min : 0
  const max = typeof p.max === "number" && p.max > min ? p.max : 100
  const unit = typeof p.unit === "string" ? p.unit : tv?.unit
  const label = typeof p.label === "string" ? p.label : widget.id
  const labelEn = typeof p.labelEn === "string" ? p.labelEn : undefined
  const thresholds = readThresholds(p)

  const numeric = typeof tv?.value === "number" ? tv.value : undefined
  const pct = numeric === undefined ? 0 : Math.max(0, Math.min(100, ((numeric - min) / (max - min)) * 100))
  const tone =
    numeric !== undefined && thresholds.fault !== undefined && numeric >= thresholds.fault
      ? "fault"
      : numeric !== undefined && thresholds.warn !== undefined && numeric >= thresholds.warn
        ? "warn"
        : "run"
  const fillColor = `var(--color-status-${tone})`

  return (
    <div className="flex flex-col gap-1">
      <div className="hmi-micro flex items-baseline justify-between gap-1.5">
        <span className="truncate">{label}</span>
        {labelEn ? <span className="shrink-0">{labelEn}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={numeric}
          aria-label={typeof label === "string" ? label : widget.id}
        >
          <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, backgroundColor: fillColor }} />
        </div>
        <span className="hmi-micro w-16 shrink-0 text-right tabular-nums normal-case">
          {tv ? formatValue(tv.value) : NO_DATA}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  )
}
