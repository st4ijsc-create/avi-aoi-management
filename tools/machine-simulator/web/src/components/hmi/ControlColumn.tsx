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
    <Sheet className={className} title={t("hmi.controls.title")} titleEn={gloss("hmi.controls.title")} bodyClassName="flex flex-col items-center gap-4 p-4">
      {estopEngaged ? (
        <div className="flex w-full flex-col items-center gap-1 border border-status-fault bg-status-fault/10 px-3 py-2 text-center">
          <span className="font-heading text-sm font-semibold tracking-wide text-danger-text uppercase">
            {t("hmi.controls.estopBanner")}
          </span>
          <span className="hmi-micro">{t("hmi.controls.estopHint")}</span>
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

      {/* I-7: `pressed` (not `disabled`) once latched — keeps the dome red and the button focusable;
          `onClick` is simply omitted while latched so a stray click/Enter/Space is a no-op. */}
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
    </Sheet>
  )
}
