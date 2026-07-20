import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"

interface ProductionProgressProps {
  deviceClass: DeviceClass
  cycles: number
  /** [0,1] running pass rate — `null` for IoT (not a judged metric, see `machineDetail.overview`'s
   * own "—" convention this mirrors). */
  passRate: number | null
  className?: string
}

/** Flat, square, segmented progress strip (spec §8 "production progress") — OK/NG proportion for
 * judged classes (Automation/AOI), a plain fill for IoT (packet count only, no pass/fail concept).
 * Counts are derived from the real `cycles`/`passRate` fields (`Math.round(cycles * passRate)`), not a
 * separate engine counter — the engine reports no distinct pass/fail tally. */
export function ProductionProgress({ deviceClass, cycles, passRate, className }: ProductionProgressProps) {
  const t = useT()

  if (passRate === null) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between px-5 py-1.5">
          <span className="hmi-micro">{t("hmi.progress.title")}</span>
          <span className="font-mono text-[11px] tabular-nums text-text-body">
            {cycles.toLocaleString()} {t("hmi.progress.packetsLabel")}
          </span>
        </div>
        <div className="h-2.5 w-full border-t border-border bg-surface-muted">
          <div className="h-full w-full bg-status-idle/50" />
        </div>
      </div>
    )
  }

  const okCount = Math.round(cycles * passRate)
  const ngCount = Math.max(0, cycles - okCount)
  const okPct = cycles > 0 ? (okCount / cycles) * 100 : 0
  // Branch-review — the same "zero/absent data rendered as a fault colour" class as the HMI's FPY
  // tile fix: with `cycles === 0`, `okPct` is 0 by construction (nothing judged yet, not "0% judged
  // OK"), which used to fill this ENTIRE strip solid fault-red for a machine that has simply never
  // run — the loudest fault-red element on the whole footer, for a machine sitting idle.
  const hasData = cycles > 0

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-5 py-1.5">
        <span className="hmi-micro">
          {t("hmi.progress.title")} — {deviceClass === "AoiAvi" ? t("machineDetail.tabs.board") : t("machineDetail.tabs.spc")}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-text-body">
          <span className={hasData ? "text-ok-text" : "text-text-muted"}>
            {okCount.toLocaleString()} {t("hmi.progress.okLabel")}
          </span>
          {" · "}
          <span className={hasData ? "text-danger-text" : "text-text-muted"}>
            {ngCount.toLocaleString()} {t("hmi.progress.ngLabel")}
          </span>
          {" · "}
          {cycles.toLocaleString()} {t("hmi.progress.totalLabel")}
        </span>
      </div>
      <div className="flex h-2.5 w-full border-t border-border bg-surface-muted">
        {hasData ? (
          <>
            <div className="h-full bg-status-run" style={{ width: `${okPct}%` }} />
            <div className="h-full bg-status-fault" style={{ width: `${100 - okPct}%` }} />
          </>
        ) : (
          <div className="h-full w-full bg-status-idle/50" />
        )}
      </div>
    </div>
  )
}
