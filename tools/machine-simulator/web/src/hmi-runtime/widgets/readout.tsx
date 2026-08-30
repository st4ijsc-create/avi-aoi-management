import { Readout } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { NO_DATA, asRecord, formatValue, qualityTone, readBinding } from "./shared.ts"

/**
 * `kind: "readout"` — wraps the industrial `Readout` primitive (spec-owned, axe AA, visual-pinned).
 * Do not re-implement it; this widget only translates a bound `TagValue` into `Readout`'s props.
 *
 * Bindings: `value` (required for a live reading — `NO_DATA` placeholder when absent/unresolved).
 * Props: `label`/`labelEn` (already-resolved display strings — a screen JSON document supplies its own
 * text; this widget never resolves an i18n key itself, unlike the hand-written HMI screens it
 * eventually replaces), `unit` (overrides the bound `TagValue.unit`), `valueType` ("numeric" default |
 * "text", forwarded to `Readout` unchanged).
 *
 * Example: `contracts/fixtures/valid/screen-screwdrive-full.json`'s "torque" widget.
 */
export function ReadoutWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const tv = readBinding(props, "value")
  const label = typeof p.label === "string" ? p.label : widget.id
  const labelEn = typeof p.labelEn === "string" ? p.labelEn : undefined
  const unit = typeof p.unit === "string" ? p.unit : tv?.unit
  const valueType = p.valueType === "text" ? "text" : "numeric"

  return (
    <Readout
      value={tv ? formatValue(tv.value) : NO_DATA}
      unit={unit}
      label={label}
      labelEn={labelEn}
      valueType={valueType}
      tone={tv ? qualityTone(tv.quality) : "idle"}
    />
  )
}
