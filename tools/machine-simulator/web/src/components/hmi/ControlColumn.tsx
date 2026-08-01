import { CONTROL_BUTTON_SIZE_CLASS, ControlButton, Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { useLanguage, useT } from "@/i18n"
import { cn } from "@/lib/utils"

/** `ControlButton.labelEn` is a fixed ENGLISH gloss (spec §6: "large condensed label + English
 * gloss"), not the active-language-swap `t()`/`gloss()` pairing `Readout`'s `label`/`labelEn` use —
 * omitted only once the label itself is already English (`useLanguage().language === "en"`), per that
 * prop's own doc comment. */
// SM-4/B-8 — the "estop" variant's own gloss is deliberately "HALT", not "E-STOP": this control is a
// supervisory software latch (`FleetHost.Estop`) that stops this software's own read pipeline and
// disconnects from the configured device(s). It is not, and cannot be, a safety device — not because no
// write path exists anymore (this product CAN write to a device now — Modbus/OPC-UA setpoints and
// commands, `POST /v1/machines/{code}/setpoint|command`, gated by role and by this same latch), but
// because HALT deliberately never calls that write path (README §1 explains why: a software "stop" that
// also touched the device would look more like a safety device while still not being one). The internal
// identifier ("estop", `FleetHost.Estop()`, the `/v1/fleet/estop` route) is kept unchanged; only the
// operator-facing text changed. A real E-STOP is a hardwired, safety-rated circuit per ISO 13849 —
// software must never borrow that name.
const EN_LABEL: Record<"start" | "pause" | "reset" | "estop", string> = {
  start: "START",
  pause: "PAUSE",
  reset: "RESET",
  estop: "HALT",
}

interface ControlColumnProps {
  estopEngaged: boolean
  isRunning: boolean
  startPending: boolean
  pausePending: boolean
  /** In-flight HALT request, not yet confirmed by the server (C-3) — grey the button out (classic
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
 * The physical control column (spec §6): START / PAUSE / HALT, plus RESET once latched. Locking is
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
    <Sheet className={className} compact title={t("hmi.controls.title")} titleEn={gloss("hmi.controls.title")} bodyClassName="flex flex-1 min-h-0 flex-col p-0">
      {/*
        H5 — layout gap 2: this rail is FULL HEIGHT (spec §8), RESET sits BESIDE HALT (same row,
        same idiom Start/Pause already use), not stacked below it.

        H5b — Start/Pause anchors to the TOP of the rail (`shrink-0`); the HALT/RESET/banner cluster
        anchors to the BOTTOM via `mt-auto` on its own wrapper, so it always sits the same distance
        from the rail's bottom edge.

        H5c — layout gap 5 (SAFETY REGRESSION, twice): H5b's own claim that mt-auto alone keeps
        HALT's position stable was WRONG under two conditions it didn't account for. (1) `mt-auto`
        only holds a fixed offset from the bottom edge while the block actually FITS the container —
        live-measured at 1280×800: unlatched the rail was `scrollHeight === clientHeight` (0px slack,
        already a hair-trigger fit), latched it needed the banner's extra height on top, overflowed by
        41px, and `mt-auto` on an overflowing flex child collapses to 0, so the block silently
        re-anchored to the TOP of its container instead of the bottom — HALT moved AND the rail
        became a scrolling region (the specific defect this pass fixes). (2) Even where the banner did
        fit, conditionally rendering it (and RESET) meant the bottom cluster's own height literally
        differed between states by construction — "the same distance from the bottom" was true only
        as long as nothing overflowed, which is exactly the assumption that broke.

        The structural fix: every element in this cluster now has a CONSTANT footprint in EVERY state.
        The banner slot and the RESET slot are always in the DOM at their real size — latched, real
        content; unlatched, a same-size invisible/`aria-hidden` placeholder (RESET's placeholder pulls
        its size from `CONTROL_BUTTON_SIZE_CLASS.reset`, the same map `ControlButton` itself renders
        from, so the two can never drift apart) — so the cluster's total height never changes and
        `mt-auto` never has anything to collapse. HALT's own `getBoundingClientRect()` is now
        provably identical whether idle/running/paused/latched, at a given viewport+class (regression
        test: `tests/12-hmi-safety-rail.spec.ts`).

        For this to also mean the rail genuinely never needs to scroll, the vertical budget upstream of
        this component (the third column's OutputCard+ControlColumn split, spec §8.5) was re-tuned so
        the ALWAYS-latched-size cluster fits with real margin at the 1280×800 floor — see `Hmi.tsx`'s
        own comment on that split. `hmi-scroll overflow-y-auto` stays on the outer wrapper as a
        defence-in-depth CSS fallback only (never actually engaged — the regression test asserts
        `scrollHeight <= clientHeight`), not as the mechanism relied on to reach RESET.
      */}
      {/* M-5 (mc-feature-review.md) — `data-testid` so `13-machine-settings.spec.ts`'s safety-rail test
          can select THIS specific `.hmi-scroll` region directly instead of a positional
          `document.querySelectorAll(".hmi-scroll")[1]` (fragile: `MachineSettingsPanel` renders its OWN
          `.hmi-scroll` on the Settings tab, shifting every subsequent index). */}
      <div data-testid="control-rail" className="hmi-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Task 4 — the tab rail (spec §8.1) claims 32px that used to belong to this row's own
            budget; `p-1`/`pt-1`/`gap-1` (trimmed from `p-1.5`/`pt-2`/`gap-2`) claw back the same
            order of magnitude directly from this column's own wrapper, per §8.5's "the control rail
            is the one region allowed to trim padding/gaps tighter when the worst-case fit demands
            it" — re-verified live (not computed blind) via the same slack formula
            `12-hmi-safety-rail.spec.ts` asserts: latched slack at 1280×800 went from -3px (broken)
            back to comfortably over the 10px floor. */}
        <div className="flex min-h-full w-full flex-col items-center p-1">
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

          {/* Bottom-anchored cluster — HALT (+ RESET) always ends up the same distance from the
              rail's bottom edge: every state now reserves the SAME height (banner + RESET slots are
              always present, real or placeholder — see the H5c comment above), so there is nothing
              left for `mt-auto` to collapse differently between states. */}
          <div className="mt-auto flex w-full flex-col items-center gap-1 pt-1">
            {/* H5 — `estopHint` (the RESET-instruction sub-line) stays defined in the i18n
                dictionaries for now but is no longer rendered here: with RESET itself visible right
                below this banner (beside HALT, not a separate stacked row), a second line spelling
                out "press RESET" is redundant with the button it's describing. */}
            <div
              className={cn(
                "flex w-full items-center justify-center border px-3 py-0.5 text-center",
                estopEngaged ? "border-status-fault bg-status-fault/10" : "border-transparent"
              )}
              aria-hidden={estopEngaged ? undefined : true}
            >
              {estopEngaged ? (
                <span className="font-heading text-sm font-semibold tracking-wide text-danger-text uppercase">
                  {t("hmi.controls.estopBanner")}
                </span>
              ) : (
                // Same font/line-height classes as the real banner text, so this placeholder's box is
                // pixel-identical to the real one -- U+00A0 (NOT a plain space, which whitespace-collapses to a
                // zero-width text node and measurably shrinks the line box -- live-reproduced as a 4px drift).
                <span className="font-heading text-sm font-semibold tracking-wide uppercase invisible" aria-hidden="true">
                  {" "}
                </span>
              )}
            </div>

            <div className="flex items-end justify-center gap-5">
              {/* I-7: `pressed` (not `disabled`) once latched — keeps the danger-tinted skin (SM-4 fix
                  round 1: flat, no dome — see `ControlButton.tsx`'s own remarks) and the button
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
                  variant="reset"
                  label={t("hmi.controls.reset")}
                  labelEn={enLabel("reset")}
                  disabled={resetPending}
                  onClick={onReset}
                />
              ) : (
                <div className={cn(CONTROL_BUTTON_SIZE_CLASS.reset, "shrink-0")} aria-hidden="true" />
              )}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
