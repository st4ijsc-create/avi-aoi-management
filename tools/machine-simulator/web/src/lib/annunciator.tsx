/**
 * Task C-5 (`.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-5-brief.md`) — the
 * browser half of "báo tại chỗ": the only alarm notification channel in Đợt C that still works with
 * no network at all.
 *
 * Wire contract (`St4i.EngineApi.Hubs.AlarmAnnunciationStreamEndpoint` + `Alarms/AlarmAnnunciation.cs`):
 * `GET /v1/alarms/annunciations` is Server-Sent Events, Operator-authorised over the same cookie
 * session every `fetch` in `lib/api.ts` uses. It emits exactly three things — a `ready` event once at
 * connect (what this engine will and will not annunciate), an `annunciation` event per alarm EDGE, and
 * a `: keep-alive` comment every 15s while idle. There is deliberately no backfill and no
 * `Last-Event-ID` replay: an annunciator announces what is happening NOW, and replaying edges from
 * before the page opened would sound an alarm that was dealt with an hour ago. The standing state
 * after the fact is `GET /v1/alarms`, on the same screen.
 *
 * ## Why not the 4s poll that is already there
 * `useAlarms()` already polls, and for the alarm TABLE that is the right answer. It is not adequate
 * for an annunciator, for two reasons that are properties of browsers rather than preferences:
 *  - A poll is a `setTimeout`, and a background tab has its timers throttled to about one per minute
 *    (and to Chrome's "intensive throttling" after five minutes hidden with no audio playing). An
 *    annunciator exists precisely to reach somebody who is NOT looking at the tab, so the one
 *    situation it must work in is the one polling degrades worst in. An `EventSource` message is not
 *    a timer — it dispatches when the bytes arrive.
 *  - Polling sees STATE; this channel is built on EDGES (`AlarmNotifier`'s whole reason for existing
 *    is that the sources restate an unchanged alarm every 5s). A poller would have to re-derive edges
 *    by diffing snapshots, would miss any edge that opened and closed between two polls, and could
 *    not see `Escalated` at all.
 *
 * ## Sound, and the case that matters more than the sound
 * Browsers refuse to start audio without a user gesture. That is not an error to swallow: a muted
 * annunciator that LOOKS armed is worse than no annunciator, because somebody will rely on it. So
 * every play attempt reports back `"sounded"` or `"blocked"`, `"blocked"` is rendered as its own
 * visible state with a button that fixes it, and the button's own click is the gesture that resumes
 * the `AudioContext`. Nothing here ever fails silently.
 *
 * The tone is synthesised with an `OscillatorNode` rather than shipped as an audio file on purpose:
 * this product is deployed offline from a single self-contained package, and an oscillator has no
 * asset to fail to load, no codec to be unsupported and nothing to add to the bundle.
 */
import * as React from "react"

import { BASE_URL, type AlarmPriority, type AlarmSource, type AlarmState } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with Alarms/AlarmAnnunciation.cs + Hubs/AlarmAnnunciationStream.cs
// ─────────────────────────────────────────────────────────────────────────

/** `AlarmEdgeKind` (`Alarms/NotificationJob.cs`). Three of the five are NOT "an alarm is happening":
 * `Acked` and `Cleared` are the ISA-18.2 moments an annunciator STOPS, and `Restored` is an alarm
 * that was already standing before the engine process started. */
export type AlarmEdgeKind = "Raised" | "Escalated" | "Acked" | "Cleared" | "Restored"

export interface AlarmAnnunciation {
  /** `AlarmNotifier`'s per-process edge ordinal. THE de-duplication key — the engine publishes once
   * per configured instance, so a host with two enabled local-annunciation instances sends the same
   * edge twice to the same screen. Resets on engine restart, which is why the seen-set below is
   * dropped on every reconnect rather than kept forever. */
  sequence: number
  edge: AlarmEdgeKind
  atUtc: string
  instance: string
  key: string
  source: AlarmSource
  code: string
  priority: AlarmPriority
  state: AlarmState
  message: string
  runbook: string | null
  targetId: string | null
  clearOnAck: boolean
  count: number
  previousPriority: AlarmPriority | null
  actor: string | null
}

/** The `ready` frame — what this engine will and will not annunciate, told to the page at connect
 * time so it never claims to be armed when it is not. */
export interface AnnunciatorReady {
  configured: boolean
  enabled: boolean
  /** The most PERMISSIVE threshold among enabled instances — the least severe alarm that will
   * annunciate anywhere. `null` when nothing is enabled. */
  minPriority: AlarmPriority | null
  heartbeatSeconds: number
}

export type AnnunciatorConnection = "connecting" | "open" | "closed"

/** What the browser last told us about whether it will actually make a noise.
 *  - `idle` — nothing has been attempted yet, so nothing is known. Never rendered as "armed".
 *  - `sounded` — a tone really played.
 *  - `blocked` — the autoplay policy is holding the `AudioContext` suspended. Needs a click.
 *  - `unsupported` — this browser has no Web Audio at all. */
export type AnnunciatorSound = "idle" | "sounded" | "blocked" | "unsupported"

// ─────────────────────────────────────────────────────────────────────────
// Tone
// ─────────────────────────────────────────────────────────────────────────

const PULSE_MS = 140
const GAP_MS = 90
const PEAK_GAIN = 0.18

/** Severity ramp, deliberately audible as a COUNT rather than only as a pitch — a count survives a
 * cheap laptop speaker and a noisy shop floor, where two similar tones do not. */
const TONE: Record<AlarmPriority, { pulses: number; hz: number }> = {
  Critical: { pulses: 3, hz: 880 },
  High: { pulses: 2, hz: 740 },
  Medium: { pulses: 1, hz: 620 },
  Low: { pulses: 1, hz: 520 },
}

/** Minimum spacing between tones. `Restored` at engine start emits one edge per standing alarm, so
 * without this a restart with 40 standing alarms would fire 40 overlapping tones — noise that
 * annunciates nothing. The BANNER still lists every one of them; only the sound is coalesced. */
const SOUND_GATE_MS = 1_500

const RECONNECT_DELAY_MS = 3_000

/** How many `sequence` values to remember for de-duplication. Bounded because a long-lived exhibition
 * page must not grow a set forever; far larger than any realistic burst. */
const SEEN_LIMIT = 512

type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  return typeof window === "undefined" ? null : (window.AudioContext ?? null)
}

// ─────────────────────────────────────────────────────────────────────────
// The hook
// ─────────────────────────────────────────────────────────────────────────

export interface AnnunciatorValue {
  /** Alarms currently annunciating, newest first — one entry per alarm `key`. An `Acked` or `Cleared`
   * edge for a key REMOVES it (ISA-18.2: an ack silences the horn, a clear releases the latch), which
   * is why this is keyed state rather than a log. */
  standing: AlarmAnnunciation[]
  connection: AnnunciatorConnection
  /** The engine's `ready` frame, or `null` until one arrives. `null` is rendered as "unknown", never
   * as "armed". */
  ready: AnnunciatorReady | null
  sound: AnnunciatorSound
  /** MUST be called from a real user gesture — that gesture is what lets the browser resume audio.
   * Plays a short confirmation tone on success so the operator hears that it worked rather than
   * having to trust a label. */
  enableSound: () => Promise<void>
  /** Operator dismissal of one alarm's annunciation. Does NOT ack the alarm — acking is
   * `POST /v1/alarms/{id}/ack` on the Alarm Center, and conflating the two would let somebody silence
   * an alarm without taking responsibility for it. */
  dismiss: (key: string) => void
  dismissAll: () => void
}

const AnnunciatorContext = React.createContext<AnnunciatorValue | null>(null)

/**
 * Opens the SSE stream once for the whole app and keeps the annunciating set.
 *
 * `EventSource` reconnects by itself for an ordinary connection drop, honouring the server's own
 * `retry:` field — but it gives up permanently (readyState CLOSED) on a non-2xx response or a wrong
 * content type, which is exactly what a restarting engine or an expired session produces. So a manual
 * retry covers that case and only that case.
 */
export function AnnunciatorProvider({ children }: { children: React.ReactNode }) {
  const [standing, setStanding] = React.useState<AlarmAnnunciation[]>([])
  const [connection, setConnection] = React.useState<AnnunciatorConnection>("connecting")
  const [ready, setReady] = React.useState<AnnunciatorReady | null>(null)
  const [sound, setSound] = React.useState<AnnunciatorSound>(() =>
    audioContextCtor() === null ? "unsupported" : "idle"
  )

  const audioRef = React.useRef<AudioContext | null>(null)
  const lastToneAtRef = React.useRef(0)

  /** Lazily constructs the single `AudioContext`. Constructing one costs nothing and does not need a
   * gesture; STARTING it does, which is what `resume()` below is for. */
  const context = React.useCallback((): AudioContext | null => {
    if (audioRef.current !== null) return audioRef.current
    const Ctor = audioContextCtor()
    if (Ctor === null) return null
    try {
      audioRef.current = new Ctor()
      return audioRef.current
    } catch {
      return null
    }
  }, [])

  const emitTone = React.useCallback((ctx: AudioContext, priority: AlarmPriority) => {
    const { pulses, hz } = TONE[priority] ?? TONE.Low
    const start = ctx.currentTime
    for (let i = 0; i < pulses; i++) {
      const at = start + (i * (PULSE_MS + GAP_MS)) / 1000
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "square"
      osc.frequency.value = hz
      // A ramped envelope rather than a hard on/off — an abrupt gain step is an audible click, and a
      // clicking annunciator reads as a broken speaker rather than as an alarm.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + PULSE_MS / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + PULSE_MS / 1000 + 0.02)
    }
  }, [])

  /** Attempts a tone and REPORTS what happened. Never throws, never silently does nothing. */
  const play = React.useCallback(
    async (priority: AlarmPriority): Promise<AnnunciatorSound> => {
      const ctx = context()
      if (ctx === null) return "unsupported"

      if (ctx.state !== "running") {
        // Without a prior user gesture this either rejects or resolves with the context still
        // suspended — both are the SAME fact, and both must surface as "blocked" rather than as a
        // tone nobody hears.
        try {
          await ctx.resume()
        } catch {
          /* fall through to the state check, which is the authoritative answer */
        }
      }
      if (ctx.state !== "running") return "blocked"

      try {
        emitTone(ctx, priority)
        return "sounded"
      } catch {
        return "blocked"
      }
    },
    [context, emitTone]
  )

  const announce = React.useCallback(
    (priority: AlarmPriority) => {
      const now = Date.now()
      if (now - lastToneAtRef.current < SOUND_GATE_MS) return
      lastToneAtRef.current = now
      void play(priority).then(setSound)
    },
    [play]
  )

  const enableSound = React.useCallback(async () => {
    const ctx = context()
    if (ctx === null) {
      setSound("unsupported")
      return
    }
    try {
      await ctx.resume()
    } catch {
      /* the state check below is the authoritative answer */
    }
    if (ctx.state !== "running") {
      setSound("blocked")
      return
    }
    lastToneAtRef.current = Date.now()
    // A confirmation tone, so "sound is on now" is something the operator HEARD rather than read.
    try {
      emitTone(ctx, "High")
      setSound("sounded")
    } catch {
      setSound("blocked")
    }
  }, [context, emitTone])

  const dismiss = React.useCallback((key: string) => {
    setStanding((prev) => prev.filter((item) => item.key !== key))
  }, [])

  const dismissAll = React.useCallback(() => setStanding([]), [])

  React.useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    // 🔴 Review round 1 (M-6) — TWO generations, not one set that is emptied.
    //
    // A single set cleared at `SEEN_LIMIT` forgets everything at once, so an annunciation arriving in the
    // instant after the clear is re-announced even though it was seen a moment earlier. Rotating instead
    // means the youngest `SEEN_LIMIT` sequences are ALWAYS remembered (the previous generation is still
    // consulted), so the window never collapses to zero — the cost is at most 2 x SEEN_LIMIT numbers held.
    let seen = new Set<number>()
    let seenPrevious = new Set<number>()

    function apply(annunciation: AlarmAnnunciation) {
      if (seen.has(annunciation.sequence) || seenPrevious.has(annunciation.sequence)) return
      if (seen.size >= SEEN_LIMIT) {
        seenPrevious = seen
        seen = new Set<number>()
      }
      seen.add(annunciation.sequence)

      if (annunciation.edge === "Acked" || annunciation.edge === "Cleared") {
        // ISA-18.2: an ack silences the horn (the alarm is still on, a human has taken it), a clear
        // releases the latch. Neither makes a noise, and both must stop the one that is running.
        setStanding((prev) => prev.filter((item) => item.key !== annunciation.key))
        return
      }

      setStanding((prev) => [annunciation, ...prev.filter((item) => item.key !== annunciation.key)])
      announce(annunciation.priority)
    }

    function connect() {
      if (cancelled) return
      setConnection("connecting")
      // `withCredentials` is what carries the session cookie when `VITE_ENGINE_URL` points at a
      // genuinely cross-origin engine (the desktop-shell recipe); same-origin it is a no-op, and the
      // host's CORS policy already sets `AllowCredentials`.
      source = new EventSource(`${BASE_URL}/v1/alarms/annunciations`, { withCredentials: true })

      source.onopen = () => {
        if (!cancelled) setConnection("open")
      }

      source.addEventListener("ready", (event) => {
        if (cancelled) return
        try {
          setReady(JSON.parse((event as MessageEvent<string>).data) as AnnunciatorReady)
        } catch {
          /* a malformed frame must not take the stream down */
        }
      })

      source.addEventListener("annunciation", (event) => {
        if (cancelled) return
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as AlarmAnnunciation)
        } catch {
          /* same */
        }
      })

      source.onerror = () => {
        if (cancelled) return
        setConnection("closed")
        // readyState CONNECTING means EventSource is already retrying on its own (honouring the
        // server's `retry:`) — leave it alone. CLOSED means it has given up for good, which is what a
        // non-2xx or a wrong content type produces, and is the only case needing a manual retry.
        if (source?.readyState === EventSource.CLOSED) {
          source.close()
          // The engine's edge ordinals restart with the engine, so a fresh connection must not carry
          // a seen-set that would swallow the new process's first annunciations — including the
          // connect-time replay of what is standing, which is the whole reason a restart is annunciated
          // at all (see the C# endpoint's own I-2 note).
          seen = new Set<number>()
          seenPrevious = new Set<number>()
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      source?.close()
    }
  }, [announce])

  React.useEffect(() => {
    const ctx = audioRef.current
    return () => {
      void ctx?.close().catch(() => undefined)
    }
  }, [])

  const value = React.useMemo<AnnunciatorValue>(
    () => ({ standing, connection, ready, sound, enableSound, dismiss, dismissAll }),
    [standing, connection, ready, sound, enableSound, dismiss, dismissAll]
  )

  return <AnnunciatorContext.Provider value={value}>{children}</AnnunciatorContext.Provider>
}

/** Throws outside `<AnnunciatorProvider>` rather than returning a silent no-op value — a component
 * that thinks it is annunciating and is not is the exact failure this whole task is about. */
export function useAnnunciator(): AnnunciatorValue {
  const value = React.useContext(AnnunciatorContext)
  if (value === null) throw new Error("useAnnunciator must be used inside <AnnunciatorProvider>")
  return value
}
