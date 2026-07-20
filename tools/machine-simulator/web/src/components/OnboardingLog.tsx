import * as React from "react"
import { motion } from "framer-motion"

import { useT } from "@/i18n"
import { LogTag, type LogLevel } from "@/components/industrial"
import { cn } from "@/lib/utils"
import { rowEnter } from "@/theme/motion"

export type LogTone = "ok" | "danger" | "info" | "neutral"

export interface LogEntry {
  id: string
  time: Date
  message: string
  tone: LogTone
}

const TONE_TO_LEVEL: Record<LogTone, LogLevel> = {
  ok: "ok",
  danger: "error",
  info: "info",
  neutral: "info",
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

/**
 * Scrolling status log — every onboarding API call (register/poll/claim/enroll/paste-key), success or
 * failure, appends one line here so the wizard's network activity stays visible instead of only
 * flashing through the step indicator. Newest entry at the bottom, auto-scrolled into view.
 *
 * Same `LogTag` + monospace register as the HMI operator panel's `SystemLog` (spec §5) — this wizard's
 * activity feed is the same kind of instrument (time · level tag · message), just fed by local
 * mutations instead of the WS trace stream, so it reads as the same system rather than a separate
 * card-UI notification list.
 */
export function OnboardingLog({ entries, className }: OnboardingLogProps) {
  const t = useT()
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
      aria-label={t("onboarding.log.ariaLabel")}
      // Keyboard-focusable (axe `scrollable-region-focusable`, same fix as `TraceTable.tsx`'s and
      // `Machines.tsx`'s own scroll containers): this div IS the actual scroll container, so a
      // keyboard-only user needs to be able to Tab into it and scroll with arrow keys/Page Down — a
      // scrollable region with no host element in the tab order is otherwise unreachable without a
      // mouse/touch. H3c regression — the pre-restyle log had a fixed `max-h-64` but was never
      // tabbable either; this was already a latent gap the axe check didn't happen to catch until the
      // restyle's own `assertNoSeriousA11yViolations` run down this exact wizard flow surfaced it.
      tabIndex={0}
      className={cn(
        "hmi-scroll min-h-0 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]",
        className
      )}
    >
      {entries.length === 0 ? (
        <p className="flex h-full min-h-24 items-center justify-center text-center text-sm text-text-muted">
          {t("onboarding.log.empty")}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <motion.li
              key={entry.id}
              initial="hidden"
              animate="visible"
              variants={rowEnter}
              className="flex items-start gap-2 border-b border-border/60 px-1 py-1.5 text-[11px] last:border-0"
            >
              <span className="w-[64px] shrink-0 font-mono tabular-nums text-text-muted">
                {timeFormatter.format(entry.time)}
              </span>
              <LogTag level={TONE_TO_LEVEL[entry.tone]} />
              <span
                className={cn(
                  "min-w-0 flex-1 font-mono break-words",
                  entry.tone === "danger" ? "text-danger-text" : "text-text-body"
                )}
              >
                {entry.message}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}
