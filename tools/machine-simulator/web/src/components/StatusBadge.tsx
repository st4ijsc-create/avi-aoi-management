import { cn } from "@/lib/utils"
import { traceStatusTone, type ApiTraceEvent } from "@/lib/inspector"
import { StatusBadge as StatusChip } from "@/components/ui/status-badge"

interface StatusBadgeProps {
  event: Pick<ApiTraceEvent, "status" | "error">
  className?: string
}

/**
 * One API Inspector row's HTTP status chip — a thin wrapper over the design system's
 * `StatusBadge` (dot + tint from `src/index.css`'s status tokens), mapping the trace event's
 * numeric status/transport-error onto its tone via `traceStatusTone` (2xx → ok, 4xx/5xx/transport
 * error → danger, HttpStatus 0 "queued, no round-trip yet" → warn). Renamed on import at call sites
 * to avoid colliding with the generic chip it wraps.
 */
export function StatusBadge({ event, className }: StatusBadgeProps) {
  const tone = traceStatusTone(event)
  return (
    <StatusChip status={tone} className={cn("font-numeric tabular-nums", className)}>
      {event.status}
    </StatusChip>
  )
}
