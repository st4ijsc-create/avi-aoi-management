import * as React from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { staggerItem } from "@/theme/motion"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"

type DeltaStatus = "ok" | "warn" | "danger" | "info" | "neutral"

interface KpiTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  unit?: string
  delta?: { label: string; status: DeltaStatus }
  children?: React.ReactNode
}

/** One KPI card for the dashboard's top row — same shape as the reference showcase at `/tokens`. */
export function KpiTile({ icon: Icon, label, value, unit, delta, children }: KpiTileProps) {
  return (
    <motion.div variants={staggerItem} whileHover={{ scale: 1.01 }}>
      <Card className="h-full">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {label}
            </span>
            <Icon className="size-4 text-navy-500" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-numeric text-3xl font-semibold text-text-strong">{value}</span>
            {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
          </div>
          {delta ? (
            <StatusBadge status={delta.status} className="w-fit">
              {delta.label}
            </StatusBadge>
          ) : null}
          {children}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function KpiTileSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="size-4 rounded-full" />
        </div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </CardContent>
    </Card>
  )
}
