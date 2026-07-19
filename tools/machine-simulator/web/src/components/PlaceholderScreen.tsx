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
          <div className="flex size-12 items-center justify-center rounded-full bg-navy-50">
            <Icon className="size-6 text-navy-600" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text-strong">{title}</h1>
          <p className="text-sm text-text-muted">{description}</p>
          <span className="mt-1 text-xs font-medium tracking-wide text-text-muted/80 uppercase">
            {task}
          </span>
        </CardContent>
      </Card>
    </motion.div>
  )
}
