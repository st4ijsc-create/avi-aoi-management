import { LogTag, type LogLevel } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { NO_DATA, formatValue, readBinding } from "./shared.ts"

const KNOWN_LEVELS = new Set<LogLevel>(["info", "ok", "warn", "error"])

/**
 * `kind: "log"` — wraps `LogTag` for the level chip.
 *
 * Bindings: `level` (one of `LogLevel`; falls back to `"info"` if absent/unrecognized), `message`.
 * `TagValueSource.get()` (Task 1) only ever answers the LATEST value at a path, never a series — so
 * this first pass renders the single latest bound entry, not a scrolling history. A real rolling-log
 * view needs a series-returning seam this branch doesn't build; see `trend.tsx`'s doc comment for the
 * same limitation applied to a chart instead of a list.
 */
export function LogWidget(props: WidgetProps) {
  const levelTv = readBinding(props, "level")
  const messageTv = readBinding(props, "message")
  const raw = typeof levelTv?.value === "string" ? levelTv.value : undefined
  const level: LogLevel = raw && KNOWN_LEVELS.has(raw as LogLevel) ? (raw as LogLevel) : "info"

  return (
    <div className="flex items-center gap-2">
      <LogTag level={level} />
      <span className="hmi-micro min-w-0 flex-1 truncate normal-case">
        {messageTv ? formatValue(messageTv.value) : NO_DATA}
      </span>
    </div>
  )
}
