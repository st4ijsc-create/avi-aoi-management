import { ControlButton, Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { useLanguage, useT } from "@/i18n"

/** `ControlButton.labelEn` is a fixed ENGLISH gloss (spec §6: "large condensed label + English
 * gloss"), not the active-language-swap `MicroLabel`/`Readout` use — omitted only once the label
 * itself is already English (`useLanguage().language === "en"`), per that prop's own doc comment. */
const EN_LABEL: Record<"start" | "pause" | "reset" | "estop", string> = {
  start: "START",
  pause: "PAUSE",
  reset: "RESET",
  estop: "E-STOP",
}

interface ControlColumnProps {
  estopEngaged: boolean
  isRunning: boolean
  startPending: boolean
  pausePending: boolean
  /** In-flight E-STOP request, not yet confirmed by the server (C-3) — grey the button out (classic
   * `disabled` skin) only for this brief transient window, distinct from `estopEngaged` itself. */
  estopPending: boolean
  resetPending: boolean
  onStart: () => void
  onPause: () => void
  onEstop: () => void
  onReset: () => void
  className?: string
}

/**
 * The physical control column (spec §6): START / PAUSE / E-STOP, plus RESET once latched. Locking is
 * total while `estopEngaged` — START and PAUSE both disable, so the only way off this screen's fault
 * state is the RESET button.
 */
export function ControlColumn({
  estopEngaged,
  isRunning,
  startPending,
  pausePending,
  estopPending,
  resetPending,
  onStart,
  onPause,
  onEstop,
  onReset,
  className,
}: ControlColumnProps) {
  const t = useT()
  const gloss = useGloss()
  const { language } = useLanguage()
  const enLabel = (variant: keyof typeof EN_LABEL) => (language === "en" ? undefined : EN_LABEL[variant])

  return (
    <Sheet className={className} title={t("hmi.controls.title")} titleEn={gloss("hmi.controls.title")} bodyClassName="flex flex-1 min-h-0 flex-col p-0">
      {/*
        H5 — layout gap 2: this rail is now FULL HEIGHT (spec §8). An earlier version of this fix
        stacked the E-STOP-engaged banner AND the RESET button VERTICALLY below the untouched
        Start/Pause/E-STOP cluster — a real overflow was reproduced live at 1280×800/1440×900 (the
        RESET button's own click target pushed down UNDER the system-log band's paint order, silently
        intercepting pointer events — `test:e2e`'s own RESET-click tests caught this). Real hardware
        panels don't get to scroll their E-STOP out of reach, so the fix is structural, not spacing:
        RESET now sits BESIDE E-STOP (same row, same idiom Start/Pause already use) instead of
        stacked below it — every control that existed before (Start/Pause always present, banner only
        while latched) is still exactly here, the latched state just no longer needs a WHOLE EXTRA
        ROW's worth of height (~92px), only the banner's (~50px), which comfortably fits. `m-auto` on
        the inner cluster is still a defensive fallback (vertically centres when it fits, scrolls
        rather than silently clipping/overlapping if it somehow still doesn't) for anything shorter
        than the panel-PC floor size this app targets.
      */}
      <div className="hmi-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="m-auto flex w-full flex-col items-center gap-3 p-3">
          {/* H5 — `estopHint` (the RESET-instruction sub-line) stays defined in the i18n dictionaries
              for now but is no longer rendered here: with RESET itself visible right below this
              banner (moved beside E-STOP, not a separate stacked row — see below), a second line
              spelling out "press RESET" is redundant with the button it's describing, and dropping it
              is what buys this banner back to a single fixed-height line instead of two. */}
          {estopEngaged ? (
            <div className="flex w-full items-center justify-center border border-status-fault bg-status-fault/10 px-3 py-1 text-center">
              <span className="font-heading text-sm font-semibold tracking-wide text-danger-text uppercase">
                {t("hmi.controls.estopBanner")}
              </span>
            </div>
          ) : null}

          <div className="flex items-end justify-center gap-5">
            <ControlButton
              variant="start"
              label={t("hmi.controls.start")}
              labelEn={enLabel("start")}
              disabled={estopEngaged || isRunning || startPending}
              onClick={onStart}
            />
            <ControlButton
              variant="pause"
              label={t("hmi.controls.pause")}
              labelEn={enLabel("pause")}
              disabled={estopEngaged || !isRunning || pausePending}
              onClick={onPause}
            />
          </div>

          <div className="flex items-end justify-center gap-5">
            {/* I-7: `pressed` (not `disabled`) once latched — keeps the dome red and the button
                focusable; `onClick` is simply omitted while latched so a stray click/Enter/Space is a
                no-op. */}
            <ControlButton
              variant="estop"
              label={t("hmi.controls.estop")}
              labelEn={enLabel("estop")}
              pressed={estopEngaged}
              disabled={estopPending}
              onClick={estopEngaged ? undefined : onEstop}
            />
            {estopEngaged ? (
              <ControlButton
                variant="reset"
                label={t("hmi.controls.reset")}
                labelEn={enLabel("reset")}
                disabled={resetPending}
                onClick={onReset}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
