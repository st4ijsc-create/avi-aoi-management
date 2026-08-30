import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, readBinding } from "./shared.ts"

type Row = { id: string; label: string; labelEn?: string; binding: string }

function isRow(v: unknown): v is Row {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.id === "string" && typeof r.label === "string" && typeof r.binding === "string"
}

/**
 * `kind: "alarm-list"` — built fresh. The flat `bindings: Record<string,string>` shape
 * (`contracts/hmi-screen.schema.json`) has no per-row structure of its own, so a screen document lists
 * its rows in `props.rows: Array<{ id, label, labelEn?, binding }>`, where `binding` is a KEY into
 * `widget.bindings` (not a raw path) — every live path still flows through the same `bindings` map
 * every other widget uses; `props` stays purely static configuration.
 *
 * A row whose binding is absent or unresolved renders quietly (dim, no live reading) rather than being
 * dropped — an author can see the row exists even before its source is wired up.
 */
export function AlarmListWidget(props: WidgetProps) {
  const p = asRecord(props.widget.props)
  const rows = Array.isArray(p.rows) ? p.rows.filter(isRow) : []

  if (rows.length === 0) {
    return <p className="hmi-micro normal-case">no alarms configured</p>
  }

  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => {
        const tv = readBinding(props, row.binding)
        const raised = tv?.value === true || tv?.quality === "bad"
        return (
          <li
            key={row.id}
            className={
              raised
                ? "flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-status-fault bg-status-fault/10 px-2 py-1 text-[12px] text-danger-text"
                : "flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[12px] text-text-muted"
            }
          >
            <span className="truncate">{row.label}</span>
            {row.labelEn ? <span className="hmi-micro shrink-0">{row.labelEn}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}
