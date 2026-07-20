import { cn } from "@/lib/utils"

export type LogLevel = "info" | "ok" | "warn" | "error"

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  ok: "OK",
  warn: "WARN",
  error: "ERROR",
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "border-info/40 bg-info/10 text-info-text",
  ok: "border-status-run/40 bg-status-run/10 text-ok-text",
  warn: "border-status-warn/40 bg-status-warn/10 text-warn-text",
  error: "border-status-fault/40 bg-status-fault/10 text-danger-text",
}

export interface LogTagProps {
  level: LogLevel
  className?: string
}

/** Fixed-width coloured level tag for log/event lists (spec §5) — monospace, square, always the
 * same width regardless of level so a log column stays aligned. */
export function LogTag({ level, className }: LogTagProps) {
  return (
    <span
      className={cn(
        "inline-block w-14 shrink-0 border px-1 py-0.5 text-center font-mono text-[10px] font-semibold tracking-wide",
        LEVEL_CLASS[level],
        className
      )}
    >
      {LEVEL_LABEL[level]}
    </span>
  )
}
