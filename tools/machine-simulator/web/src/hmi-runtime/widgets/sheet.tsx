import { Sheet } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord } from "./shared.ts"

/**
 * `kind: "sheet"` — wraps the `Sheet` panel primitive as a purely decorative grouping frame: title +
 * the signature four corner marks, no live binding at all.
 *
 * A screen document overlaps a `sheet` widget's `rect` with the widgets it visually groups (CSS grid
 * items may share cells; `ScreenRenderer`, Task 3, controls DOM order/stacking) rather than nesting —
 * this schema has no widget TREE, only a flat `widgets: array` (`contracts/hmi-screen.schema.json`).
 * Props: `title`/`titleEn`, same already-resolved-string convention every other widget's label props
 * follow.
 */
export function SheetWidget(props: WidgetProps) {
  const p = asRecord(props.widget.props)
  const title = typeof p.title === "string" ? p.title : undefined
  const titleEn = typeof p.titleEn === "string" ? p.titleEn : undefined
  return <Sheet title={title} titleEn={titleEn} className="h-full" />
}
