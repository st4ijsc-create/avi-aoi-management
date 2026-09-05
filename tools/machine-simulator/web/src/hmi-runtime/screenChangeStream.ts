/**
 * WS-HMI-2 whole-branch review H-2 — A PUBLISHED SCREEN REACHING A KIOSK THAT IS ALREADY OPEN.
 *
 * ── THE DEFECT, MEASURED ─────────────────────────────────────────────────────────────────────────
 * `useScreen` sets no `staleTime` and no `refetchInterval`, and the app-wide `QueryClient` sets
 * `refetchOnWindowFocus: false`. `routes/Hmi.tsx` mounts that query once and the component stays
 * mounted for the life of the page — so before this module the kiosk read its published document
 * **exactly once, at mount, and never again.** The reviewer measured it: publish v1, open the panel,
 * publish v2, wait eight seconds — the operator's panel keeps rendering v1 indefinitely, and only a
 * reload moves it. An engineer who corrects a mislabelled control and publishes has changed nothing
 * for anyone on shift, and nothing on either surface says so.
 *
 * This is the third instance of one shape on this branch: **the mechanism was built and the join was
 * not.** WS-HMI-0b Task 3 built `WS /v1/hmi/changes`, WS-HMI-2 Task 4 added `ScreenChanged` to it for
 * exactly this, and `HmiModelEvents.cs`'s own doc comment records — grepped, not assumed — that there
 * is no consumer of that lane anywhere under `web/`. Before Task 13 that did not matter, because
 * nothing rendered a published screen. After Task 13 it does. This module is the consumer.
 *
 * ── 🔴 THE RULING THIS IMPLEMENTS: ANNOUNCE, DO NOT SWAP ─────────────────────────────────────────
 * A screen that rearranges itself while somebody is working the equipment is exactly the surprise
 * this branch has been careful to avoid everywhere else — it is the same reasoning that stops a
 * background refetch overwriting an engineer's editing session (`EditorCanvasProps.doc`), applied at
 * the other end of the same pipe. So this hook **never refetches on its own**. It reports that a new
 * version exists, and `accept()` — a person, watching that machine, choosing a moment — is the only
 * thing that invalidates the query.
 *
 * The two halves are pinned separately in `tests/43-editor-acceptance.spec.ts`, because they fail
 * independently: the affordance appearing (cut the socket and it never does) and the screen holding
 * still until it is taken (auto-accept and the old widget is gone before anybody clicked).
 *
 * ── WHY POLLING IS STILL THE WRONG ANSWER, AND WHY THAT ARGUMENT WAS NEVER THE WHOLE ONE ─────────
 * `useScreen`'s own comment argues against polling and is right — ~86 000 requests a day for a
 * document that changes when a human presses a button. What that argument left out is that the
 * alternative to polling is not "never": it is the lane already built for it. Nothing here reinstates
 * a poll.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 *   * **No backfill, and none is needed.** The lane has no replay by design (`HmiChangeBus`), so a
 *     republish that happened while this socket was down is missed. The cost is bounded and is the
 *     state that already existed for every kiosk: the panel keeps showing what it has. A reconnect
 *     does NOT re-read, because re-reading on reconnect is the swap this ruling forbids.
 *   * **It does not treat an unrecognised `change` value as an error.** The lane's discriminator is a
 *     documented OPEN set; a consumer must ignore what it does not recognise rather than fail. This
 *     one filters to `screen` frames for its own screen id and ignores everything else, which is the
 *     narrower and safer reading of the same rule.
 *   * **It compares `screenId` verbatim.** The lane commits to publishing the CANONICAL spelling, the
 *     same one `GET` echoes, and `machineScreenId` produces a canonical id by construction — so there
 *     is nothing to normalise here and normalising would be a second copy of a rule.
 */
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { QUERY_KEYS } from "../lib/api.ts"

/** Same shape `HmiChangeStream` serialises (`HmiModelChangedEvent`), read defensively: this is a
 * frame off a socket, not a typed value, and every field is optional on the wire. */
type ScreenChangeFrame = {
  change?: unknown
  screenId?: unknown
  version?: unknown
}

/** The `Change` discriminator value `HmiModelEvents.ScreenChangeKind` publishes. A string literal on
 * this side by necessity — the C# constant lives in `St4i.EngineApi`, which no test assembly the web
 * tier can reach exports — and that limit is recorded in `HmiModelEvents.cs`'s own doc comment, which
 * says the evidence for this lane's mirrors is a grep rather than a suite. `43-editor-acceptance.spec.ts`
 * is the live check: it publishes for real and asserts the affordance appears, so a spelling change on
 * either side reddens in a browser. */
const SCREEN_CHANGE_KIND = "screen"

/** How long to wait before re-opening a dropped socket. Same value and same reasoning as
 * `lib/inspector.ts`'s reconnect delay: this lane publishes when a human presses Publish, so there is
 * nothing to be gained by reconnecting aggressively. */
const RECONNECT_DELAY_MS = 3000

/** Derives `ws(s)://<host>/v1/hmi/changes` exactly the way `lib/inspector.ts` derives its own URL —
 * same env var, same dev default, same production fallback to `window.location.origin`. Duplicated
 * shape rather than an exported helper because `inspector.ts`'s function bakes in that route's own
 * `skipBackfill` parameter, and this lane has no backfill to skip. */
function changeStreamUrl(): string {
  const base =
    (import.meta.env.VITE_ENGINE_URL as string | undefined) ??
    (import.meta.env.DEV ? "http://localhost:5199" : window.location.origin)
  const url = new URL(base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/v1/hmi/changes"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export type ScreenRepublished = {
  /**
   * The version the engine says this screen is now at, when that is NEWER than what this page is
   * showing — or `undefined` when there is nothing to take. Never a version this page already has:
   * `accept()` clears it, so the affordance cannot linger after the document it announced is on
   * screen.
   */
  pendingVersion: number | undefined
  /** Takes the announced version: invalidates the screen query so `useScreen` re-reads, and clears
   * the notice. The ONLY thing in this module that changes what the operator sees. */
  accept: () => void
}

/**
 * Watches `WS /v1/hmi/changes` for republishes of ONE screen id.
 *
 * `screenId === undefined` (the demo route, and any machine whose code cannot derive a legal screen
 * id) opens no socket at all — the same gate `useScreen` itself applies, so a page that reads no
 * published document does not hold a subscription it could never act on.
 */
export function useScreenRepublished(screenId: string | undefined): ScreenRepublished {
  const queryClient = useQueryClient()
  const [pendingVersion, setPendingVersion] = React.useState<number | undefined>(undefined)

  // A screen id change (navigating from one machine's panel to another) must not carry the previous
  // machine's pending notice across. React's own "adjust state when a prop changes" pattern, the same
  // device `EditorCanvas` and `PropertyPanel` use.
  const [watching, setWatching] = React.useState<string | undefined>(screenId)
  if (watching !== screenId) {
    setWatching(screenId)
    setPendingVersion(undefined)
  }

  React.useEffect(() => {
    if (screenId === undefined) return
    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (cancelled) return
      socket = new WebSocket(changeStreamUrl())

      socket.onmessage = (message) => {
        if (cancelled) return
        let frame: ScreenChangeFrame
        try {
          frame = JSON.parse(message.data as string) as ScreenChangeFrame
        } catch {
          // A malformed frame is ignored, never thrown: this socket must not be able to take an
          // operator's panel down, and an unreadable announcement is indistinguishable from one for
          // a screen this page does not care about.
          return
        }
        if (frame.change !== SCREEN_CHANGE_KIND) return
        if (frame.screenId !== screenId) return
        // `version` is `int?` on the wire and is only ever set for a screen frame. A frame without one
        // still means "this screen changed", so it is not dropped — it simply cannot name a number,
        // and the affordance says so by omission rather than by inventing one.
        setPendingVersion(typeof frame.version === "number" ? frame.version : -1)
      }

      socket.onclose = () => {
        if (cancelled) return
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
      // `onclose` always follows `onerror` for a WebSocket, so the reconnect is scheduled there and
      // this handler exists only to keep an unhandled error event off the console.
      socket.onerror = () => {}
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [screenId])

  const accept = React.useCallback(() => {
    setPendingVersion(undefined)
    if (screenId === undefined) return
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.screen(screenId) })
  }, [queryClient, screenId])

  return { pendingVersion, accept }
}
