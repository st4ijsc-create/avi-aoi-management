import * as React from "react"

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

  // H5b — live-reproduced: at the 1280×800 floor the rail's own worst-case (E-STOP-latched) content
  // is a few px taller than the `hmi-scroll` container's fallback viewport, same class of gap §8.3
  // already anticipates ("scrolls rather than silently overlapping"). But a PASSIVE fallback isn't
  // enough on its own — loading `/hmi/:code` directly into an already-latched fleet (a real scenario:
  // another operator's panel or a page refresh mid-fault) left RESET clipped below the visible area
  // with the container un-scrolled, and `elementFromPoint` at RESET's own centre hit something else
  // entirely (confirmed live, not hypothetical). Scrolling RESET into view the instant the rail KNOWS
  // it's latched — on mount if already latched, or the moment it becomes latched — means an operator
  // never has to discover on their own that they need to scroll to find it.
  const resetRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (estopEngaged) {
      resetRef.current?.scrollIntoView({ block: "nearest" })
    }
  }, [estopEngaged])

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
        ROW's worth of height (~92px), only the banner's (~50px), which comfortably fits.

        H5b — layout gap 3 (dead space + E-STOP muscle-memory): the previous build centred this whole
        cluster with `m-auto`, which left a large uniform blank band above AND below it once the rail
        got tall (~500px at 1600×1000, buttons occupying only its middle third) — AND, worse, meant
        E-STOP's own on-screen position was NOT stable: growing the block by the latch banner's height
        shifted the WHOLE centred block down, moving E-STOP by roughly half the banner's height every
        time it latched — exactly the "operators build muscle memory for its position" failure mode
        the spec calls out. Fix: Start/Pause anchors to the TOP of the rail (`shrink-0`, right under
        the header); E-STOP (+ RESET, + the banner) anchors to the BOTTOM via `mt-auto` on its own
        wrapper. Because E-STOP/RESET is the LAST element in that bottom-anchored wrapper, the banner
        appearing above it only grows the wrapper UPWARD — E-STOP's own distance from the rail's
        bottom edge never changes, latched or not, on any machine class. The gap this opens up between
        the two clusters is real, useful space, not a leftover margin. `hmi-scroll overflow-y-auto` +
        `min-h-full` on the inner wrapper is kept as the same defensive fallback as before (scrolls
        rather than clipping/overlapping if a future control ever doesn't fit at the panel-PC floor).

        H5b — outer padding trimmed `p-3`→`p-2` and the bottom cluster's `pt-6`→`pt-4` (spec §8.5:
        "the control rail is the one region allowed to trim padding/gaps tighter when the worst-case
        fit demands it") — reclaims the ~16px `ControlColumn` needed once the log band (this same
        pass) took some of the main row's height back; re-verified via a live `scrollHeight`/
        `clientHeight` check at 1280×800 in both the normal and E-STOP-latched states.
      */}
      <div className="hmi-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-full w-full flex-col items-center p-2">
          <div className="flex shrink-0 items-end justify-center gap-5">
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

          {/* Bottom-anchored cluster — E-STOP (+ RESET) always ends up the same distance from the
              rail's bottom edge, regardless of whether the banner above it is present. */}
          <div className="mt-auto flex w-full flex-col items-center gap-3 pt-4">
            {/* H5 — `estopHint` (the RESET-instruction sub-line) stays defined in the i18n
                dictionaries for now but is no longer rendered here: with RESET itself visible right
                below this banner (beside E-STOP, not a separate stacked row), a second line spelling
                out "press RESET" is redundant with the button it's describing. */}
            {estopEngaged ? (
              <div className="flex w-full items-center justify-center border border-status-fault bg-status-fault/10 px-3 py-1 text-center">
                <span className="font-heading text-sm font-semibold tracking-wide text-danger-text uppercase">
                  {t("hmi.controls.estopBanner")}
                </span>
              </div>
            ) : null}

            <div className="flex items-end justify-center gap-5">
              {/* I-7: `pressed` (not `disabled`) once latched — keeps the dome red and the button
                  focusable; `onClick` is simply omitted while latched so a stray click/Enter/Space is
                  a no-op. */}
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
                  ref={resetRef}
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
      </div>
    </Sheet>
  )
}
