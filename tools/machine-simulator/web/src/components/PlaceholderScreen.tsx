import type * as React from "react"
import { motion } from "framer-motion"

import { fadeSlideUp } from "@/theme/motion"
import { Card, CardContent } from "@/components/ui/card"

interface PlaceholderScreenProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  task: string
}

/** Shared "not built yet" screen for the nav slots this task only stubs out (Machines list, machine
 * detail, Onboarding, API Inspector, Scenario, Settings) — every real Shell nav target needs SOME
 * route or Sidebar/CommandPalette navigation 404s, but building those screens themselves is later
 * tasks' scope. */
export function PlaceholderScreen({ icon: Icon, title, description, task }: PlaceholderScreenProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 items-center justify-center p-8"
    >
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          {/* `bg-navy-600/10`/`text-primary-text` (not `bg-navy-50`/`text-navy-600`) — dark-mode-adaptive
              tint, see Dashboard.tsx's EmptyState icon badge for the same fix + rationale. */}
          <div className="flex size-12 items-center justify-center rounded-full bg-navy-600/10">
            <Icon className="size-6 text-primary-text" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text-strong">{title}</h1>
          <p className="text-sm text-text-muted">{description}</p>
          {/* Plain `text-text-muted` (not `/80`) — the faded variant measured 3.49:1 against
              `surface-card` (axe `color-contrast`), under AA's 4.5:1 floor for this 12px caption;
              full-opacity `text-text-muted` is the token index.css already tuned to clear 4.5:1. */}
          <span className="mt-1 text-xs font-medium tracking-wide text-text-muted uppercase">
            {task}
          </span>
        </CardContent>
      </Card>
    </motion.div>
  )
}
