import { motion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"

import { useT } from "@/i18n"
import type { FleetTile } from "@/lib/api"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"
import { staggerItem } from "@/theme/motion"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Sparkline } from "@/components/Sparkline"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

// StatusText is the ENGINE's own verdict label (MachineState.cs) — authoritative, not re-derived
// client-side. "Idle" is the pre-first-cycle default.
const STATUS_META: Record<string, { status: BadgeStatus; key: string }> = {
  Idle: { status: "neutral", key: "status.idle" },
  OK: { status: "ok", key: "status.ok" },
  WARN: { status: "warn", key: "status.warn" },
  FAIL: { status: "danger", key: "status.fail" },
  TELEMETRY: { status: "info", key: "status.telemetry" },
}

function ringColor(tokens: ChartTokens, passRate: number): string {
  if (passRate >= 0.95) return tokens.ok
  if (passRate >= 0.8) return tokens.warn
  return tokens.danger
}

/**
 * Compact circular pass-rate gauge — deliberately tiny (44px), a "vital sign" read at a glance.
 *
 * `applicable=false` is for IoT sensors: MachineState.PassRate excludes Telemetry readings from
 * the judged count entirely (server-side comment: "Telemetry readings are excluded entirely"), so
 * a telemetry-only device's `passRate` is permanently `0` — not a failing score, just "not judged."
 * Rendering that as a red 0% ring would misrepresent a perfectly healthy sensor as failing.
 */
function PassRateRing({ passRate, applicable }: { passRate: number; applicable: boolean }) {
  const t = useT()
  const chartTokens = useChartTokens()
  const radius = 17
  const circumference = 2 * Math.PI * radius

  if (!applicable) {
    return (
      <div
        className="relative flex size-11 shrink-0 items-center justify-center"
        role="img"
        aria-label={t("machineCard.passRateNotApplicableAria")}
      >
        <svg viewBox="0 0 40 40" className="size-11" aria-hidden="true">
          <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--border)" strokeWidth="4" />
        </svg>
        <span aria-hidden="true" className="absolute text-[11px] font-semibold text-text-muted">
          —
        </span>
      </div>
    )
  }

  const pct = Math.round(passRate * 100)
  const clamped = Math.max(0, Math.min(1, passRate))
  const offset = circumference * (1 - clamped)

  return (
    <div
      className="relative flex size-11 shrink-0 items-center justify-center"
      role="img"
      aria-label={t("machineCard.passRateAria", { pct })}
    >
      <svg viewBox="0 0 40 40" className="size-11 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={ringColor(chartTokens, passRate)}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease" }}
        />
      </svg>
      <span aria-hidden="true" className="font-numeric absolute text-[11px] font-semibold text-text-strong">
        {pct}%
      </span>
    </div>
  )
}

interface MachineCardProps {
  machine: FleetTile
  isRunning: boolean
  onOpen: (code: string) => void
}

export function MachineCard({ machine, isRunning, onOpen }: MachineCardProps) {
  const t = useT()
  const meta = STATUS_META[machine.statusText]
  const status = meta?.status ?? "neutral"
  const label = meta ? t(meta.key) : machine.statusText
  const isActive = isRunning && machine.cycles > 0

  return (
    <motion.div variants={staggerItem}>
      <button
        type="button"
        onClick={() => onOpen(machine.code)}
        className="block w-full rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-navy-600/50"
      >
        <Card className="h-full cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={status} pulse={isActive && status === "ok"}>
                {label}
              </StatusBadge>
              <Badge variant="outline" className="shrink-0">
                {t(`driverKind.${machine.driverKind}`)}
              </Badge>
            </div>

            <div className="flex flex-col">
              <span className="text-lg font-semibold text-text-strong">{machine.code}</span>
              <span className="text-xs font-medium tracking-wide text-text-muted uppercase">
                {t(`deviceClass.${machine.deviceClass}`)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <PassRateRing passRate={machine.passRate} applicable={machine.deviceClass !== "Iot"} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] text-text-muted">{t("machineCard.cycleTrend")}</span>
                <Sparkline data={machine.spark} height={28} />
              </div>
            </div>

            <div className="flex flex-col gap-0.5 border-t border-border pt-2.5">
              <span className="font-numeric text-sm font-semibold text-text-strong">
                {machine.cycles.toLocaleString()}{" "}
                <span className="font-sans text-xs font-normal text-text-muted">{t("machineCard.cyclesUnit")}</span>
              </span>
              <span className="truncate text-xs text-text-muted" title={machine.lastCycleSummary}>
                {machine.lastCycleSummary}
              </span>
            </div>
          </CardContent>
        </Card>
      </button>
    </motion.div>
  )
}

export function MachineCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <Skeleton className="h-7 flex-1" />
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      </CardContent>
    </Card>
  )
}
