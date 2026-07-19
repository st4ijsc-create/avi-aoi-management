import * as React from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { rowEnter } from "@/theme/motion"

export type LogTone = "ok" | "danger" | "info" | "neutral"

export interface LogEntry {
  id: string
  time: Date
  message: string
  tone: LogTone
}

const DOT_CLASS: Record<LogTone, string> = {
  ok: "bg-ok",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

interface OnboardingLogProps {
  entries: LogEntry[]
  className?: string
}

/** Scrolling status log — every onboarding API call (register/poll/claim/enroll/paste-key), success or
 * failure, appends one line here so the wizard's network activity stays visible instead of only
 * flashing through the step indicator. Newest entry at the bottom, auto-scrolled into view. */
export function OnboardingLog({ entries, className }: OnboardingLogProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label="Onboarding activity"
      className={cn(
        "flex max-h-64 min-h-[8rem] flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-surface-subtle p-3",
        className
      )}
    >
      {entries.length === 0 ? (
        <p className="m-auto text-sm text-text-muted">No activity yet — start with Register below.</p>
      ) : (
        entries.map((entry) => (
          <motion.div
            key={entry.id}
            initial="hidden"
            animate="visible"
            variants={rowEnter}
            className="flex items-start gap-2 text-xs"
          >
            <span
              aria-hidden="true"
              className={cn("mt-1 size-1.5 shrink-0 rounded-full", DOT_CLASS[entry.tone])}
            />
            <span className="font-numeric shrink-0 text-text-muted">{timeFormatter.format(entry.time)}</span>
            <span
              className={cn(
                "min-w-0 break-words",
                entry.tone === "danger" ? "text-danger-text" : "text-text-body"
              )}
            >
              {entry.message}
            </span>
          </motion.div>
        ))
      )}
    </div>
  )
}
