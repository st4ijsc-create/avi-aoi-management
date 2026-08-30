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

  // 🔴 WS-HMI-1 whole-branch review, finding M2 — a permanent, narrowly-scoped hook so
  // `tests/34-hmi-widget-error-boundary.spec.ts` can force a REAL widget to crash deterministically, in
  // a real browser, instead of the reviewer's own one-off manual patch-then-revert probe (which proved
  // the CURRENT behaviour correct but left nothing mechanical behind it — see that finding). `label` is
  // the widget chosen because it is the one every reviewer already reaches for as "nothing happens
  // here" — a reader auditing `LabelWidget` cannot mistake this for a real feature. Fires ONLY when
  // `props.__testOnlyThrow === true` (a boolean, not a string — no plausible authored value collides
  // with it by accident); the schema treats `props` as a free-form `{"type":"object"}`, and no shipped
  // screen document sets this key, so this is inert for every real document. Left in production code
  // (not conditionally compiled out) on purpose: a build-time strip would make the very test this
  // exists for stop proving anything about the SHIPPED bundle.
  if (p.__testOnlyThrow === true) {
    throw new Error("PROBE: deliberate widget crash (tests/34-hmi-widget-error-boundary.spec.ts)")
  }

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
