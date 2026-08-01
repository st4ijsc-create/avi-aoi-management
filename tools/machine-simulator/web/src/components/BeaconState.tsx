import { Radio } from "lucide-react"

import { useT } from "@/i18n"
import type { RelayInstanceState } from "@/lib/notificationsApi"
import { StatusBadge } from "@/components/ui/status-badge"

type TFunc = ReturnType<typeof useT>

/**
 * 🔴 Task C-8 — C-6's carried constraint, rendered in one place so the Engineer screen
 * (`routes/Notifications.tsx`) and the Operator panel (`components/AlarmAnnunciator.tsx`) cannot drift
 * apart on the one wording this batch cares most about.
 *
 * **`energised` has THREE states and only one of them is "off".**
 *
 * - `true` with **nothing latched** = this product asked for the beacon to go OUT and the write did not
 *   succeed (most often the HALT latch refusing it). **It is still lit.** This is the condition the whole
 *   relay channel exists to make visible, so it gets the danger tone.
 * - `true` with alarms latched = on, as intended.
 * - `false` = off — commanded off, and that write was applied. **The only state that may say "off".**
 * - `null` = **UNKNOWN**. This product does not know what the beacon is doing: a fresh process that has
 *   commanded nothing, or a write that came back `Indeterminate`, after which nobody knows whether the
 *   coil moved. Rendering this as "off" is how a lit beacon becomes invisible on a screen.
 *
 * The engine also ships a rendered English sentence per state (`annunciatorState`). Both are shown: the
 * badge so a Vietnamese operator gets the distinction in their own language, and the engine's sentence
 * beneath it so the authoritative wording is never paraphrased away by a UI label.
 */
export function beaconBadge(
  state: RelayInstanceState,
  t: TFunc,
): { tone: "ok" | "warn" | "danger" | "neutral"; text: string } {
  if (state.energised === true && state.latchedAlarms === 0) {
    return { tone: "danger", text: t("notifications.beacon.stillLit") }
  }
  if (state.energised === true) {
    return { tone: "warn", text: t("notifications.beacon.on") }
  }
  if (state.energised === false) {
    return { tone: "ok", text: t("notifications.beacon.off") }
  }
  // 🔴 null — UNKNOWN. Never "off".
  return { tone: "neutral", text: t("notifications.beacon.unknown") }
}

export function BeaconState({ state }: { state: RelayInstanceState }) {
  const t = useT()
  const badge = beaconBadge(state, t)
  return (
    <div className="flex flex-col gap-1" data-testid={`beacon-${state.instance}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="size-3.5 text-text-muted" aria-hidden="true" />
        <span className="font-mono text-xs text-text-body">{state.instance}</span>
        <StatusBadge status={badge.tone}>{badge.text}</StatusBadge>
        <span className="font-numeric text-[11px] text-text-muted">
          {t("notifications.beacon.latched", { count: state.latchedAlarms })}
        </span>
      </div>
      {/* The engine's own sentence, verbatim — the authoritative wording, never paraphrased. */}
      <p className="text-[11px] text-text-muted">{state.annunciatorState}</p>
    </div>
  )
}
