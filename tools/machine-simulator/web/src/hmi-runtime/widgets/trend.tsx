import * as React from "react"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, readBinding, readThresholds } from "./shared.ts"

const SAMPLE_LIMIT = 30

/**
 * `kind: "trend"` — no existing industrial primitive is a chart (Recharts is a dependency, but nothing
 * under `components/industrial` wraps it) — built fresh, deliberately narrow.
 *
 * 🔴 What this can and cannot honestly show: `TagValueSource.get()` (Task 1) only ever returns the
 * LATEST value at a path — there is no series-returning method on that seam. So this widget cannot draw
 * a machine's actual history; instead it `subscribe()`s and keeps its OWN rolling in-memory window
 * (last 30 samples) of whatever the bound path reported WHILE THIS WIDGET WAS MOUNTED. A freshly
 * mounted trend widget starts as a single flat point, not a pre-populated chart — an honest reflection
 * of what the seam can offer today, not a real historian. Cleans up its subscription on unmount (a
 * kiosk screen runs for days; a leaked subscription here is a real defect — see `TagValueSource.ts`'s
 * own doc comment).
 *
 * Binding key is `series` (matching `contracts/fixtures/valid/screen-screwdrive-full.json`'s
 * "torque-trend" widget), not `value` — a deliberate naming difference from every other numeric widget
 * here, since what's bound conceptually is the SAME kind of path a `readout`/`gauge` would also read,
 * just consumed as a would-be series rather than a single point.
 */
export function TrendWidget(props: WidgetProps) {
  const { widget, source, resolve } = props

  const [samples, setSamples] = React.useState<number[]>(() => {
    const tv = readBinding(props, "series")
    return typeof tv?.value === "number" ? [tv.value] : []
  })

  React.useEffect(() => {
    return source.subscribe(() => {
      const tv = readBinding({ widget, source, resolve }, "series")
      if (typeof tv?.value !== "number") return
      const next = tv.value
      setSamples((prev) => [...prev, next].slice(-SAMPLE_LIMIT))
    })
  }, [widget, source, resolve])

  const p = asRecord(widget.props)
  const unit = typeof p.unit === "string" ? p.unit : undefined
  const label = typeof p.label === "string" ? p.label : widget.id
  const thresholds = readThresholds(p)

  const bounds = [...samples]
  if (thresholds.warn !== undefined) bounds.push(thresholds.warn)
  if (thresholds.fault !== undefined) bounds.push(thresholds.fault)
  const min = bounds.length ? Math.min(...bounds) : 0
  const max = bounds.length ? Math.max(...bounds) : 1
  const span = max - min || 1
  const points = samples
    .map((v, i) => {
      const x = samples.length > 1 ? (i / (samples.length - 1)) * 100 : 100
      const y = 100 - ((v - min) / span) * 100
      return `${x},${y}`
    })
    .join(" ")

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="hmi-micro flex items-baseline justify-between gap-1.5">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums normal-case">
          {samples.length ? samples[samples.length - 1] : "—"}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full min-h-12 w-full" role="img" aria-label={typeof label === "string" ? label : widget.id}>
        {samples.length > 1 ? (
          <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    </div>
  )
}
