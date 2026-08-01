import type { ReactNode } from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { staggerItem } from "@/theme/motion"
import { Readout, Sheet, type ReadoutTone } from "@/components/industrial"
import { Skeleton } from "@/components/ui/skeleton"

type DeltaStatus = "ok" | "warn" | "danger" | "info" | "neutral"

/** Maps the KPI's own delta vocabulary onto the status-ramp `ReadoutTone` every other instrument
 * reading in the app uses (spec §2) — `info` (a neutral connectivity-style note, not a machine
 * state) routes to `"neutral"` rather than any ramp colour, same reasoning `ReadoutGrid`/`Hmi.tsx`
 * already apply. */
const DELTA_TONE: Record<DeltaStatus, ReadoutTone> = {
  ok: "run",
  warn: "warn",
  danger: "fault",
  info: "neutral",
  neutral: "idle",
}

interface KpiTileProps {
  label: string
  /** English gloss (or Vietnamese, if the active language is English) — spec §3 bilingual register.
   * Callers own the i18n key, so they pass this via `useGloss()` themselves (same idiom
   * `ReadoutGrid` uses for its own tiles). */
  labelEn?: string
  value: string
  unit?: string
  delta?: { label: string; status: DeltaStatus }
  /** 0–100 — renders the donut gauge variant (e.g. first-pass yield), same as `<Readout>`. */
  gaugePct?: number
  children?: ReactNode
  className?: string
}

/** One instrument panel for the dashboard's top row — a `<Sheet>` housing a single `<Readout>`
 * (spec §5), replacing the earlier generic rounded KPI card. `delta` (if present) drives the
 * reading's tone AND doubles as the sub-note, rather than a separate colored pill beneath the
 * number — one state indicator per tile, not two disagreeing ones. */
export function KpiTile({ label, labelEn, value, unit, delta, gaugePct, children, className }: KpiTileProps) {
  const tone = delta ? DELTA_TONE[delta.status] : "neutral"

  return (
    <motion.div variants={staggerItem} className={cn("h-full", className)}>
      <Sheet className="h-full" bodyClassName="flex h-full flex-col justify-center gap-3">
        <Readout value={value} unit={unit} label={label} labelEn={labelEn} sub={delta?.label} tone={tone} gaugePct={gaugePct} />
        {children}
      </Sheet>
    </motion.div>
  )
}

export function KpiTileSkeleton({ className }: { className?: string }) {
  return (
    <Sheet className={cn("h-full", className)} bodyClassName="flex h-full flex-col justify-center gap-3">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </Sheet>
  )
}
