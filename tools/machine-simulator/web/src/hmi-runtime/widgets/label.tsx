import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, formatValue, readBinding } from "./shared.ts"

/**
 * `kind: "label"` — a plain static caption; no existing primitive matches this shape (`Sheet`'s own
 * `title` is for a panel header, not a free-standing caption).
 *
 * Text comes from `props.text`/`textEn` by default — author-authored, already-resolved strings, the
 * same convention every other widget's `label`/`labelEn` prop follows. An optional `text` BINDING
 * overrides it when a screen genuinely wants a dynamic caption (e.g. a value pulled live rather than
 * hard-coded), falling back to the static `props.text` when that binding is absent/unresolved.
 */
export function LabelWidget(props: WidgetProps) {
  const { widget } = props
  const p = asRecord(widget.props)
  const bound = readBinding(props, "text")
  const text = bound ? formatValue(bound.value) : typeof p.text === "string" ? p.text : widget.id
  const textEn = typeof p.textEn === "string" ? p.textEn : undefined

  return (
    <div className="hmi-micro flex items-baseline gap-1.5 normal-case">
      <span>{text}</span>
      {textEn ? <span>{textEn}</span> : null}
    </div>
  )
}
