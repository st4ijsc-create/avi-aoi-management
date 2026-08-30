import type { WidgetProps } from "../widgetRegistry.ts"
import { formatValue, readBinding } from "./shared.ts"

/**
 * `kind: "alarm-banner"` — no existing primitive is a full-width banner; built fresh.
 *
 * Bindings: `active` (truthy → alarm state; a "bad"-quality reading also counts as active), `message`
 * (text shown while active). Neither is required — `contracts/fixtures/valid/screen-screwdrive-full.json`'s
 * "alarms" widget sets NEITHER, and this widget's honest default for that shape is a quiet "no active
 * alarm" bar, not a blank space: ISA-101 (plan Task 4) reserves colour for the abnormal case, so the
 * QUIET state is also the DEFAULT one here, not an afterthought that only exists once alarms exist.
 */
export function AlarmBannerWidget(props: WidgetProps) {
  const activeTv = readBinding(props, "active")
  const messageTv = readBinding(props, "message")
  const active = activeTv?.value === true || activeTv?.quality === "bad"
  const message = messageTv ? formatValue(messageTv.value) : undefined

  return (
    <div
      role={active ? "alert" : undefined}
      className={
        active
          ? "flex items-center gap-2 rounded-[var(--radius-sm)] border border-status-fault bg-status-fault/15 px-3 py-1.5 text-[13px] font-semibold text-danger-text"
          : "flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-1.5 text-[13px] text-text-muted"
      }
    >
      {active ? (message ?? "ALARM") : "no active alarm"}
    </div>
  )
}
