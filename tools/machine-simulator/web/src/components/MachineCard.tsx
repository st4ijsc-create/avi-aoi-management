import { motion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { FleetTile } from "@/lib/api"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"
import { staggerItem } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Badge } from "@/components/ui/badge"
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
 *
 * Branch-review — the same "zero/absent data rendered as a fault colour" class as the HMI's FPY
 * tile fix: a machine that has never cycled ALSO has `passRate === 0` (the engine's
 * `_judgedCount == 0 ? 0.0 : …` default), indistinguishable from "0% of boards passed" by value
 * alone — a fresh, never-run machine on the roster should not wear a red ring. `cycles === 0` gets
 * the same neutral placeholder treatment as `!applicable`.
 */
function PassRateRing({ passRate, applicable, cycles }: { passRate: number; applicable: boolean; cycles: number }) {
  const t = useT()
  const chartTokens = useChartTokens()
  const radius = 17
  const circumference = 2 * Math.PI * radius

  if (!applicable || cycles === 0) {
    return (
      <div
        className="relative flex size-11 shrink-0 items-center justify-center"
        role="img"
        aria-label={applicable ? t("machineCard.passRateNoDataAria") : t("machineCard.passRateNotApplicableAria")}
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
  const gloss = useGloss()
  const meta = STATUS_META[machine.statusText]
  const status = meta?.status ?? "neutral"
  const label = meta ? t(meta.key) : machine.statusText
  const isActive = isRunning && machine.cycles > 0

  return (
    <motion.div variants={staggerItem}>
      <button
        type="button"
        onClick={() => onOpen(machine.code)}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {/* Flat hairline highlight on hover/focus — no lift/shadow (ground rule §1: no drop shadows
            outside the physical controls). */}
        <Sheet className="h-full cursor-pointer transition-colors hover:border-navy-600/70" bodyClassName="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={status} pulse={isActive && status === "ok"}>
              {label}
            </StatusBadge>
            <Badge variant="outline" className="shrink-0">
              {t(`driverKind.${machine.driverKind}`)}
            </Badge>
          </div>

          <div className="flex flex-col">
            <span className="font-heading text-xl leading-none font-semibold tracking-tight text-text-strong">
              {machine.code}
            </span>
            <span className="hmi-micro mt-1.5">{t(`deviceClass.${machine.deviceClass}`)}</span>
          </div>

          <div className="flex items-center gap-3">
            <PassRateRing passRate={machine.passRate} applicable={machine.deviceClass !== "Iot"} cycles={machine.cycles} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Stacked, not inline — same H3c fix as Machines.tsx's filter labels: both languages
                  uppercase in one line read as a single garbled string. */}
              <span className="flex flex-col gap-0.5">
                <span className="truncate text-[11px] leading-tight font-medium text-text-body">{t("machineCard.cycleTrend")}</span>
                <span className="hmi-micro truncate">{gloss("machineCard.cycleTrend")}</span>
              </span>
              <Sparkline data={machine.spark} height={28} />
            </div>
          </div>

          <div className="flex flex-col gap-0.5 border-t border-border pt-2.5">
            <span className="font-numeric text-sm font-semibold text-text-strong">
              {machine.cycles.toLocaleString()}{" "}
              <span className="hmi-micro normal-case">{t("machineCard.cyclesUnit")}</span>
            </span>
            <span className="truncate text-xs text-text-muted" title={machine.lastCycleSummary}>
              {machine.lastCycleSummary}
            </span>
          </div>
        </Sheet>
      </button>
    </motion.div>
  )
}

export function MachineCardSkeleton() {
  return (
    <Sheet className="h-full" bodyClassName="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 shrink-0" />
        <Skeleton className="h-7 flex-1" />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
    </Sheet>
  )
}
