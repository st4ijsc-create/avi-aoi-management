import { Readout, Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"

interface OutputCardProps {
  deviceClass: DeviceClass
  cycles: number
  /** [0,1] running pass rate — `null` for IoT (not a judged metric, see `machineDetail.overview`'s
   * own "—" convention this mirrors). */
  passRate: number | null
  className?: string
}

/**
 * H5 — layout gap 3: a first-class production/output card (spec §8), promoted from the previous
 * build's 29px footer strip (`ProductionProgress.tsx`, now folded into this component) to a full
 * `<Sheet>` at the TOP of the control rail, same visual weight as the readout grid's own tiles (built
 * on the same `<Readout>` primitive, so `.hmi-readout-value`'s existing visual-regression mask already
 * covers its live numbers — no new mask hook needed). Counts are derived from the real
 * `cycles`/`passRate` fields (`Math.round(cycles * passRate)`), not a separate engine counter — the
 * engine reports no distinct pass/fail tally.
 */
export function OutputCard({ deviceClass, cycles, passRate, className }: OutputCardProps) {
  const t = useT()
  const gloss = useGloss()

  if (passRate === null) {
    return (
      <Sheet className={className} title={t("hmi.progress.title")} titleEn={gloss("hmi.progress.title")} bodyClassName="flex flex-col gap-2 p-2.5">
        <Readout
          value={cycles.toLocaleString()}
          label={t("hmi.progress.packetsLabel")}
          labelEn={gloss("hmi.progress.packetsLabel")}
          tone="neutral"
        />
        <div className="hmi-output-bar flex h-2.5 w-full border border-border bg-surface-muted">
          <div className="h-full w-full bg-status-idle/50" />
        </div>
      </Sheet>
    )
  }

  const okCount = Math.round(cycles * passRate)
  const ngCount = Math.max(0, cycles - okCount)
  const okPct = cycles > 0 ? (okCount / cycles) * 100 : 0
  // Branch-review — the same "zero/absent data rendered as a fault colour" class as the HMI's FPY
  // tile fix: with `cycles === 0`, `okPct` is 0 by construction (nothing judged yet, not "0% judged
  // OK"), which would otherwise fill this ENTIRE bar solid fault-red for a machine that has simply
  // never run.
  const hasData = cycles > 0
  const subtitleKey = deviceClass === "AoiAvi" ? "machineDetail.tabs.board" : "machineDetail.tabs.spc"

  return (
    <Sheet
      className={className}
      title={t("hmi.progress.title")}
      titleEn={gloss("hmi.progress.title")}
      headerRight={<span className="hmi-micro">{t(subtitleKey)}</span>}
      bodyClassName="flex flex-col gap-2 p-2.5"
    >
      <Readout value={cycles.toLocaleString()} label={t("hmi.progress.totalLabel")} labelEn={gloss("hmi.progress.totalLabel")} tone="neutral" />
      <div className="grid grid-cols-2 gap-3">
        <Readout
          value={okCount.toLocaleString()}
          label={t("hmi.progress.okLabel")}
          labelEn={gloss("hmi.progress.okLabel")}
          tone={hasData ? "run" : "idle"}
        />
        <Readout
          value={ngCount.toLocaleString()}
          label={t("hmi.progress.ngLabel")}
          labelEn={gloss("hmi.progress.ngLabel")}
          tone={hasData ? "fault" : "idle"}
        />
      </div>
      <div className="hmi-output-bar flex h-2.5 w-full border border-border bg-surface-muted">
        {hasData ? (
          <>
            <div className="h-full bg-status-run" style={{ width: `${okPct}%` }} />
            <div className="h-full bg-status-fault" style={{ width: `${100 - okPct}%` }} />
          </>
        ) : (
          <div className="h-full w-full bg-status-idle/50" />
        )}
      </div>
    </Sheet>
  )
}
