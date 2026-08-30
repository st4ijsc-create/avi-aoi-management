import { Readout, Sheet } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { NO_DATA, asRecord, formatValue, qualityTone, readBinding } from "./shared.ts"

/**
 * `kind: "kpi-tile"` — composes TWO wrap-mandated primitives (`Sheet` as the framed tile, `Readout` as
 * the number inside it), matching how the app's own `components/KpiTile.tsx` already builds a KPI tile
 * from exactly this pair — a KPI tile IS "a titled panel around one big reading", and both halves
 * already exist.
 *
 * Bindings: `value` (required), `sub` (an optional second reading, shown as `Readout`'s own `sub`
 * caption — e.g. a delta or a qualifier).
 */
export function KpiTileWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const tv = readBinding(props, "value")
  const subTv = readBinding(props, "sub")
  const label = typeof p.label === "string" ? p.label : widget.id
  const labelEn = typeof p.labelEn === "string" ? p.labelEn : undefined
  const unit = typeof p.unit === "string" ? p.unit : tv?.unit

  return (
    <Sheet className="h-full" bodyClassName="flex h-full flex-col justify-center gap-3">
      <Readout
        value={tv ? formatValue(tv.value) : NO_DATA}
        unit={unit}
        label={label}
        labelEn={labelEn}
        sub={subTv ? formatValue(subTv.value) : undefined}
        tone={tv ? qualityTone(tv.quality) : "idle"}
      />
    </Sheet>
  )
}
