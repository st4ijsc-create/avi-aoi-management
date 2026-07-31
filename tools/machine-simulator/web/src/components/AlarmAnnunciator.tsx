import { BellOff, BellRing, Siren, Volume2, VolumeX, X } from "lucide-react"

import { useT } from "@/i18n"
import { useAnnunciator, type AlarmAnnunciation } from "@/lib/annunciator"
import type { AlarmPriority } from "@/lib/api"
import { useAnnunciatorStatus } from "@/lib/notificationsApi"
import { BeaconState } from "@/components/BeaconState"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"

/**
 * Task C-5 — the in-page annunciation surface: the ONE thing in this product that tells an operator
 * about an alarm at the moment it happens, with no network involved.
 *
 * Two components, on purpose:
 *  - `AlarmAnnunciatorOverlay` is mounted once in `<Shell>` and renders on EVERY screen, because an
 *    annunciator that only works while you are already looking at the Alarm Center annunciates
 *    nothing. It renders **nothing at all** while nothing is annunciating — no persistent badge, no
 *    "armed" indicator. That is deliberate twice over: an idle annunciator has nothing to say, and an
 *    indicator that says "armed" is a claim this component genuinely cannot make on its own (the
 *    browser may be holding the sound muted, and the engine's channel may be disabled). The place
 *    that CAN make that claim honestly is the strip below, which has the engine's own `ready` frame.
 *  - `AnnunciatorStatusStrip` lives on `/alarms` and states the truth in full: whether the engine's
 *    local-annunciation channel is configured and enabled, from what severity up, and whether this
 *    browser will actually make a noise. The brief's rule — "a mute annunciator that looks armed is
 *    worse than none" — is what this exists for, and it is why every one of those facts is rendered
 *    separately instead of being collapsed into one green light.
 */

const PRIORITY_TONE: Record<AlarmPriority, "danger" | "warn" | "info"> = {
  Critical: "danger",
  High: "warn",
  Medium: "warn",
  Low: "info",
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString(undefined, { hour12: false })
}

// ─────────────────────────────────────────────────────────────────────────
// The overlay — every screen, only while something is annunciating.
// ─────────────────────────────────────────────────────────────────────────

function AnnunciationCard({
  item,
  onDismiss,
}: {
  item: AlarmAnnunciation
  onDismiss: () => void
}) {
  const t = useT()
  const restored = item.edge === "Restored"
  const escalated = item.edge === "Escalated"

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-1.5 border border-border-strong bg-surface-card p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <Siren className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={PRIORITY_TONE[item.priority]}>
              {t(`alarms.priority.${item.priority}`)}
            </StatusBadge>
            <span className="font-mono text-[11px] text-text-muted">{item.code}</span>
            <span className="font-numeric text-[11px] text-text-muted">{formatTime(item.atUtc)}</span>
          </div>
          <p className="text-sm text-text-strong">{item.message}</p>
          {/* Three of the five edge kinds are NOT "a new alarm just happened", and saying so is the
              difference between an operator running to a machine and an operator reading a line. */}
          {restored ? (
            <p className="text-[11px] text-text-muted">{t("annunciator.edge.restored")}</p>
          ) : null}
          {escalated && item.previousPriority !== null ? (
            <p className="text-[11px] text-text-muted">
              {t("annunciator.edge.escalated", {
                from: t(`alarms.priority.${item.previousPriority}`),
                to: t(`alarms.priority.${item.priority}`),
              })}
            </p>
          ) : null}
          {item.runbook ? <p className="text-[11px] text-text-body">{item.runbook}</p> : null}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label={t("annunciator.dismissOne", { code: item.code })}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

export function AlarmAnnunciatorOverlay() {
  const t = useT()
  const { standing, sound, enableSound, dismiss, dismissAll } = useAnnunciator()

  if (standing.length === 0) return null

  return (
    <div
      // `role="alert"` + `aria-live="assertive"`: this is the one place in the app where interrupting
      // a screen reader is the correct behaviour, which is exactly what "assertive" is reserved for.
      role="alert"
      aria-live="assertive"
      aria-label={t("annunciator.regionLabel")}
      data-testid="alarm-annunciator"
      className="pointer-events-none fixed top-3 right-3 z-50 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2"
    >
      {sound === "blocked" ? (
        // 🔴 The case the brief singles out. The alarm IS on screen, and the operator is told plainly
        // that it made no noise and what to do about it — rather than being left with an annunciator
        // that looks like it is working.
        <div className="pointer-events-auto flex items-center gap-2 border border-warn/40 bg-warn/10 p-2">
          <VolumeX className="size-4 shrink-0 text-warn-text" aria-hidden="true" />
          <span className="flex-1 text-[11px] text-warn-text">{t("annunciator.sound.blocked")}</span>
          <Button size="xs" variant="outline" onClick={() => void enableSound()}>
            <Volume2 className="size-3" aria-hidden="true" />
            {t("annunciator.sound.enable")}
          </Button>
        </div>
      ) : null}

      {standing.map((item) => (
        <AnnunciationCard key={item.key} item={item} onDismiss={() => dismiss(item.key)} />
      ))}

      {standing.length > 1 ? (
        <div className="pointer-events-auto flex justify-end">
          <Button size="xs" variant="outline" onClick={dismissAll}>
            {t("annunciator.dismissAll", { count: standing.length })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// The status strip — /alarms only, and the only place that claims anything about being armed.
// ─────────────────────────────────────────────────────────────────────────

export function AnnunciatorStatusStrip() {
  const t = useT()
  const { connection, ready, sound, enableSound } = useAnnunciator()

  // Every branch below is a DIFFERENT fact, and none of them is allowed to be rendered as another.
  // Collapsing "the stream is down", "the channel was never configured", "the channel is switched
  // off" and "this browser is muted" into one indicator is precisely how an annunciator ends up
  // looking armed while annunciating nothing.
  const armed = connection === "open" && ready?.enabled === true

  let channel: { tone: "ok" | "warn" | "danger" | "neutral"; text: string }
  if (connection !== "open" || ready === null) {
    channel = { tone: "danger", text: t("annunciator.status.disconnected") }
  } else if (!ready.configured) {
    channel = { tone: "warn", text: t("annunciator.status.notConfigured") }
  } else if (!ready.enabled) {
    channel = { tone: "warn", text: t("annunciator.status.disabled") }
  } else {
    channel = {
      tone: "ok",
      text: t("annunciator.status.armed", {
        priority: t(`alarms.priority.${ready.minPriority ?? "Low"}`),
      }),
    }
  }

  return (
    <div
      data-testid="annunciator-status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-border bg-surface-subtle px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-1.5">
        {armed ? (
          <BellRing className="size-3.5 text-ok-text" aria-hidden="true" />
        ) : (
          <BellOff className="size-3.5 text-text-muted" aria-hidden="true" />
        )}
        <span className="font-semibold tracking-wide text-text-strong uppercase">
          {t("annunciator.status.label")}
        </span>
      </span>

      <StatusBadge status={channel.tone}>{channel.text}</StatusBadge>

      {/* The sound state is reported SEPARATELY from the channel state and always, including while
          the channel is off — they fail independently, and an operator fixing one needs to know
          whether the other is also wrong. */}
      {sound === "unsupported" ? (
        <StatusBadge status="warn">{t("annunciator.sound.unsupported")}</StatusBadge>
      ) : sound === "sounded" ? (
        <StatusBadge status="ok">{t("annunciator.sound.on")}</StatusBadge>
      ) : (
        <span className="flex items-center gap-2">
          <StatusBadge status="warn">
            {sound === "blocked" ? t("annunciator.sound.blockedShort") : t("annunciator.sound.untested")}
          </StatusBadge>
          <Button size="xs" variant="outline" onClick={() => void enableSound()}>
            <Volume2 className="size-3" aria-hidden="true" />
            {t("annunciator.sound.enable")}
          </Button>
        </span>
      )}

      <span className="text-text-muted">{t("annunciator.status.reach")}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 Task C-8 — the OPERATOR's view of everything else that gets told
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 Task C-8 — what an operator is allowed to know about the outbound alarm channels.
 *
 * `AnnunciatorStatusStrip` above answers "will THIS PAGE make a noise?". This answers the two
 * questions beside it that an operator standing at a machine actually has: **is the beacon over my
 * head telling the truth**, and **is anybody else's screen attached**.
 *
 * It reads `GET /v1/notifications/annunciator` — the narrow **Operator** route C-8 added rather than
 * widening `GET /v1/notifications/status`, which C-7 gated at Engineer deliberately because it carries
 * every alarm recipient's e-mail address. Nothing here names a channel's configuration: no webhook
 * endpoint, no recipient, no machine code, no relay target. The route's handler cannot supply them.
 *
 * 🔴 The beacon badge has THREE states and only one of them is "off" — see `beaconBadge` in
 * `routes/Notifications.tsx`, which this shares so the two screens cannot drift apart. `null` is
 * **UNKNOWN**, which is not "off": collapsing them is how a lit beacon becomes invisible.
 */
export function OutboundReachPanel() {
  const t = useT()
  const { data, isError } = useAnnunciatorStatus()

  // A failed read of this route is itself worth saying — quietly, because the alarm table beside it is
  // the screen's job and this is context. Silence here would read as "no beacon is configured".
  if (isError) {
    return (
      <p className="border border-border bg-surface-subtle px-3 py-2 text-xs text-text-muted" role="status">
        {t("annunciator.reach.unavailable")}
      </p>
    )
  }

  if (!data) return null

  return (
    <div
      data-testid="outbound-reach"
      className="flex flex-col gap-2 border border-border bg-surface-subtle px-3 py-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-semibold tracking-wide text-text-strong uppercase">
          {t("annunciator.reach.label")}
        </span>
        <span className="font-numeric text-text-muted">
          {t("annunciator.reach.listeners", { count: data.listeners, max: data.maxListeners })}
        </span>
        {data.rejectedListeners > 0 ? (
          <StatusBadge status="warn">
            {t("annunciator.reach.rejected", { count: data.rejectedListeners })}
          </StatusBadge>
        ) : null}
      </div>

      {/* 🔴 A configuration this engine could not READ looks exactly like "nothing is configured", so
          the two are never allowed to render the same. This says which one it is. */}
      {!data.configurationReadable ? (
        <p className="border-l-2 border-danger pl-2 text-danger-text" role="alert" data-testid="reach-config-unreadable">
          {data.configurationDetail}
        </p>
      ) : null}

      {data.relays.length === 0 ? (
        <p className="text-text-muted">
          {data.configurationReadable ? t("annunciator.reach.noBeacon") : t("annunciator.reach.beaconUnknown")}
        </p>
      ) : (
        data.relays.map((relay) => <BeaconState key={relay.instance} state={relay} />)
      )}

      {data.attention.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {data.attention.map((item) => (
            <li key={item} className="border-l-2 border-warn pl-2 text-text-body" role="alert">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
