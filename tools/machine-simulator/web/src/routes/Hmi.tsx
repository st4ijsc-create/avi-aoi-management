import * as React from "react"
import { Link, useParams } from "wouter"

import { type StatusLampState } from "@/components/industrial"
import { ControlColumn } from "@/components/hmi/ControlColumn"
import { Nameplate } from "@/components/hmi/Nameplate"
import { OutputCard } from "@/components/hmi/OutputCard"
import { SettingsTab } from "@/components/hmi/SettingsTab"
import { SystemLog, type HmiLocalLogEvent } from "@/components/hmi/SystemLog"
import { TabRail, type HmiTabId } from "@/components/hmi/TabRail"
import { useT } from "@/i18n"
import {
  EngineApiError,
  useEstopFleet,
  useFleetEstopEngaged,
  useFleetIsRunning,
  useMachine,
  useMachineComponents,
  useResetEstop,
  useScreen,
  useStartFleet,
  useStopFleet,
  type DeviceClass,
} from "@/lib/api"
import { useInspectorStream } from "@/lib/inspector"
import { DEMO_MACHINE_CODE, resolveDemoScreen } from "@/lib/hmiScreens"
import { ScreenRenderer } from "@/hmi-runtime/ScreenRenderer"
import { machineScreenId, renderableScreen } from "@/hmi-runtime/publishedScreen"
import { createMachineDetailSource } from "@/hmi-runtime/TagValueSource"
import type { HmiScreenDocument } from "@/contracts/hmiScreen"

// WS-HMI-1 Task 5 — the corrigendum at the top of `docs/plans/2026-08-30-hmi-ws1-runtime-blueprint.md`:
// what deletes is the HAND-WRITTEN layout (the `SCHEMATIC_READOUT_FLEX` proportions table that used to
// live here, the `if`-branch that picked a schematic by `DeviceClass`, the panel order nailed into this
// file's JSX) — not the three living-twin drawings themselves, which survive as `kind: "faceplate"`
// widget implementations (`src/hmi-runtime/widgets/faceplate.tsx`). This file's only remaining job for
// the operator's main panel is picking WHICH document describes this machine's class and handing it to
// `<ScreenRenderer>` — no proportions, no schematic-selection branch, no fixed panel order live here
// anymore.
//
// 🔴 Statically imported (build-time), not `fetch()`ed — see `resolveJsonModule` in
// `tsconfig.app.json`. This satisfies the plan's "the renderer reads JSON at RUNTIME" rule (
// `<ScreenRenderer>` still interprets the generic `HmiScreenDocument` structure in the browser, at
// render time — no build step turns this JSON into hand-written React for these three screens) but it
// does NOT satisfy the plan's stronger, separate aspiration in the same paragraph — "an engineer at the
// factory must be able to fix the screen without rebuilding the app" — since a static import bundles
// these three files' bytes into the JS output; editing `web/screens/*.json` on a deployed kiosk needs a
// rebuild until something (this route, or a future WS-HMI-2 "publish" flow) actually fetches them from
// disk at runtime instead. Named here explicitly rather than silently claimed — see task-5-report.md.
import automationOverview from "../../screens/automation-overview.json"
import aoiOverview from "../../screens/aoi-overview.json"
import iotOverview from "../../screens/iot-overview.json"

/**
 * The SHIPPED screen for each device class — and, since WS-HMI-2 Task 13, the FALLBACK rather than
 * the answer. See `resolveKioskScreen` below for what now comes first and why this table must stay
 * exactly as it is.
 */
const SCREEN_DOCS: Record<DeviceClass, HmiScreenDocument> = {
  Automation: automationOverview as HmiScreenDocument,
  AoiAvi: aoiOverview as HmiScreenDocument,
  Iot: iotOverview as HmiScreenDocument,
}

let localEventSeq = 0
function nextLocalId(): string {
  localEventSeq += 1
  return `local-${localEventSeq}`
}

function LoadingKiosk() {
  return (
    <div className="flex h-svh w-full items-center justify-center bg-surface-subtle">
      <div className="hmi-micro">Loading…</div>
    </div>
  )
}

function ErrorKiosk({ title, description }: { title: string; description: string }) {
  const t = useT()
  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-3 bg-surface-subtle px-6 text-center">
      <h1 className="font-heading text-2xl font-semibold text-text-strong">{title}</h1>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      <Link
        href="/machines"
        className="mt-2 border border-border-strong px-3 py-1.5 text-sm text-text-body hover:border-navy-600 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      >
        {t("machines.title")}
      </Link>
    </div>
  )
}

/**
 * H2 — the HMI operator panel (`/hmi/:code`, docs/HMI_DESIGN_SPEC.md §4/§6/§7/§8). Renders OUTSIDE
 * `<Shell>` (see `App.tsx`) — a genuine full-screen kiosk shell, not the app's own sidebar/topbar
 * chrome, matching a real machine's operator panel. The page itself never scrolls (`h-svh
 * overflow-hidden`); the schematic/readout column and the system log each scroll internally.
 */
export default function Hmi() {
  // WS-HMI-2 Task 5 — this component serves TWO routes (`App.tsx`): the operator panel `/hmi/:code`,
  // and the engineering demo `/hmi/demo/:screenId`. The demo route carries no `:code` at all, so the
  // machine whose LIVE DATA its screen renders against is named by `lib/hmiScreens.ts` instead of by
  // the URL. Everything below this pair of lines is identical on both routes — same kiosk chrome, same
  // machine poll, same control rail; only WHICH document reaches `<ScreenRenderer>` differs.
  const { code: routeCode, screenId } = useParams<{ code?: string; screenId?: string }>()
  const code = screenId === undefined ? routeCode : DEMO_MACHINE_CODE
  const demoScreen = resolveDemoScreen(screenId)
  const t = useT()

  /**
   * ── WS-HMI-2 TASK 13 — THE JOIN: THE KIOSK READS WHAT THE EDITOR PUBLISHED ─────────────────────
   *
   * Measured at `20f78b8d`, before this line existed: nothing outside `src/editor/` called
   * `/v1/screens`, so twelve tasks of screen store, publish/version/rollback door and visual editor
   * wrote into a store the operator panel never opened. This is the one request that closes it.
   *
   * `machineScreenId` (`hmi-runtime/publishedScreen.ts`) derives the id — `machine-` + the lowercased
   * machine code — and that module's own doc comment carries the reasoning for the reserved prefix
   * and for `undefined` on a code that cannot make a legal screenId. Nothing here re-states it.
   *
   * 🔴 THE DEMO ROUTE IS DELIBERATELY EXCLUDED (`screenId === undefined` is the operator route).
   * `/hmi/demo/{screenId}` NAMES a document; answering a URL that named one document with a different
   * one is exactly the defect `35-hmi-indirect-binding.spec.ts`'s third test exists to prevent, and a
   * published `machine-iot-01` row silently winning over the demo screen would be that defect wearing
   * a different hat. Excluded at the FETCH, not merely at the render, so the demo route makes no
   * request it would then ignore.
   */
  const kioskScreenId = screenId === undefined ? machineScreenId(code) : undefined
  const publishedScreen = useScreen(kioskScreenId)

  const { data: machine, isPending, isError, error } = useMachine(code)
  // WS-HMI-2 Task 5 — the component tree this machine's screen resolves its `{component}` bindings
  // through. DELIBERATELY not destructured into an `isPending`/`isError` pair the way `useMachine` is
  // above, and deliberately NOT gating anything below: plan §5-bis makes "this machine has declared no
  // components" a valid product state, and the in-flight first fetch is indistinguishable from it as
  // far as the renderer is concerned. Both arrive at `<ScreenRenderer>` as `undefined`, which is what
  // `ScreenRendererProps.components` documents as valid, so the screen renders either way — direct
  // bindings live, `{component}` bindings showing a named placeholder until (or unless) a model exists.
  // A spinner or an error kiosk here would turn a valid state into a blocked page.
  const componentModel = useMachineComponents(code)
  const fleetIsRunning = useFleetIsRunning()
  // C-2: server-owned, shared across every panel/tab — no longer this component instance's own React
  // state, so navigating to another machine's panel (or an F5) can no longer silently drop an active
  // HALT the way local state did.
  const estopEngaged = useFleetEstopEngaged()
  const startFleet = useStartFleet()
  const stopFleet = useStopFleet()
  const estopFleet = useEstopFleet()
  const resetEstop = useResetEstop()

  // H5 — opened ONCE here and shared by the nameplate's connectivity chip AND the system log (both
  // used to open their own independent WS connection to the same endpoint before this).
  const { events: traceEvents, connectionState } = useInspectorStream()

  const [localEvents, setLocalEvents] = React.useState<HmiLocalLogEvent[]>([])
  // Task 4 — the tab rail's own selection. Resets to OPERATION on a fresh machine code for the same
  // reason `localEvents` does below (a different machine's panel shouldn't inherit "I was looking at
  // settings" from whatever the previous machine's panel was showing).
  const [activeTab, setActiveTab] = React.useState<HmiTabId>("operation")

  // A fresh machine code (navigating from one HMI straight to another) must not inherit the previous
  // machine's LOCAL log — `wouter` reuses this component instance across a param change since it's the
  // same route/component, so this doesn't happen for free. The HALT latch itself is intentionally
  // NOT reset here anymore (C-2): it's fleet-wide state (a software latch, not a safety device — SM-4),
  // and an active HALT on one machine's panel must still be in force when an operator switches to
  // another machine's panel.
  React.useEffect(() => {
    setLocalEvents([])
    setActiveTab("operation")
  }, [code])

  const running = fleetIsRunning && !estopEngaged

  // WS-HMI-1 Task 5 — everything the operator panel's main content used to derive here for the
  // schematic/readout pair (config-drift worst-wins across products, the AOI product's real
  // measurement-point positions, the per-cycle NG aggregate, the parsed IoT key metric) moved to
  // `src/hmi-runtime/widgets/faceplate.tsx`'s `OperationOverviewFaceplate` — the ONE widget each of
  // `SCREEN_DOCS` below now names. It re-derives all of it itself off the SAME `useMachine(code)` (and
  // sibling) TanStack Query hooks, sharing this component's own cache entries rather than duplicating
  // a fetch. See that file's own header comment for why this moved as a single unit instead of being
  // decomposed into the 15 generic widget kinds.

  function pushLocalEvent(level: HmiLocalLogEvent["level"], viMsg: string, enMsg: string) {
    setLocalEvents((prev) => [...prev.slice(-199), { id: nextLocalId(), at: Date.now(), level, vi: viMsg, en: enMsg }])
  }

  function handleStart() {
    startFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("ok", t("hmi.log.fleetStarted"), "Fleet started"),
    })
  }

  function handlePause() {
    stopFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("warn", t("hmi.log.fleetPaused"), "Fleet paused"),
    })
  }

  function handleEstop() {
    // C-2/C-3 — a real, confirmed, server-latched stop of THIS SOFTWARE's read pipeline (spec: "it
    // really stops the engine" — the engine, not the machine; SM-4: this is a supervisory software
    // latch, not a safety device — see README §1). The mutation's `onSuccess` firing IS the
    // confirmation the pipeline actually stopped; the previous version latched and logged success
    // unconditionally on a fire-and-forget POST with no `onError`, so a failed request still told the
    // operator the software was safely stopped.
    estopFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("error", t("hmi.log.estopEngaged"), "HALT — fleet stopped, controls locked"),
      onError: () =>
        pushLocalEvent("error", t("hmi.log.estopFailed"), "HALT COMMAND FAILED — engine did not confirm the stop"),
    })
  }

  function handleReset() {
    resetEstop.mutate(undefined, {
      onSuccess: () => pushLocalEvent("ok", t("hmi.log.estopReset"), "RESET — HALT cleared"),
      onError: () => pushLocalEvent("error", t("hmi.log.estopResetFailed"), "RESET FAILED — HALT still latched"),
    })
  }

  if (!code) return <ErrorKiosk title={t("common.connectivityError")} description="" />
  // WS-HMI-2 Task 5 — `/hmi/demo/<something nobody authored>`. A mistyped screen id is a not-found
  // state, not a crash and not a silent fall-through to the machine's own class screen: rendering
  // `SCREEN_DOCS[machine.class]` here would answer a URL that named one document with a different one.
  if (screenId !== undefined && !demoScreen) {
    return <ErrorKiosk title={t("machineDetail.notFoundState.title")} description={screenId} />
  }
  if (isPending) return <LoadingKiosk />
  // WS-HMI-2 Task 13 — wait for the STORE's answer before drawing anything, on the operator route.
  // Not a nicety: without this, a machine that HAS a published screen would render its class's
  // shipped document for one frame and then swap, i.e. an operator's panel would flash a screen
  // nobody authored for that machine. The wait costs nothing extra — this query was started at the
  // top of the component, in parallel with `useMachine`, so both are already in flight — and it
  // cannot hang: `useScreen` does not retry a confirmed 404 (`lib/api.ts`), which is the answer this
  // gate gets for every machine that has never been published to. Guarded on the id rather than on
  // the query, because a DISABLED query stays `isPending` forever (the demo route, and any machine
  // code that cannot make a legal screenId) and gating on that would be a spinner that never ends.
  if (kioskScreenId !== undefined && publishedScreen.isPending) return <LoadingKiosk />
  if (isError) {
    const notFound = error instanceof EngineApiError && error.status === 404
    return notFound ? (
      <ErrorKiosk title={t("machineDetail.notFoundState.title")} description={t("machineDetail.notFoundState.description", { code })} />
    ) : (
      <ErrorKiosk title={t("common.connectivityError")} description="" />
    )
  }
  if (!machine) return <LoadingKiosk />

  // H2c SAFETY FIX — spec §2: "Status colours are for state only." The nameplate lamp is the ONE
  // glance-able indicator on the whole screen for this software's own run state; it must reflect
  // whether the FLEET'S READ PIPELINE is halted (the HALT latch — a supervisory software condition,
  // not a claim about the physical machine, SM-4), not the QUALITY VERDICT of whatever board/cycle it
  // last judged. The previous
  // version keyed `lampState` off `machine.statusText` (Idle/OK/WARN/FAIL/TELEMETRY — the LAST
  // CYCLE'S pass/fail result, same enum the "Status" readout tile below uses) — a machine that just
  // judged one NG board wore the fault-red dome and the label "Lỗi" while its own sub-line correctly
  // said "Đang vận hành" (Running), a direct contradiction an operator must never see: red means
  // "stop, this machine needs help," not "the last part happened to fail inspection." The last
  // cycle's verdict still needs a home — it lives in the readout grid (`ReadoutGrid.tsx`'s "Status"/
  // AOI's now-added verdict tile), never on the lamp.
  const lampState: StatusLampState = estopEngaged ? "fault" : running ? "run" : "idle"
  const lampLabel = estopEngaged ? t("hmi.status.estop") : running ? t("hmi.status.sub.run") : t("hmi.status.sub.idle")
  const lampSub = estopEngaged ? t("hmi.status.sub.fault") : undefined

  // WS-HMI-1 Task 5 — the seam `ScreenRenderer`'s widgets read live values through
  // (`src/hmi-runtime/TagValueSource.ts`, Task 1). Recreated each render off the SAME `machine` this
  // component's own `useMachine(code)` just resolved — cheap (a handful of closures, no work done
  // eagerly), and behaviourally identical to the seam's own documented "one stable identity + call
  // `.update()` per poll" pattern for THIS integration specifically, because nothing downstream calls
  // `source.subscribe()` today (`ScreenRenderer`/every widget only ever calls `.get()`, driven by
  // React's own re-render on each poll, same as every other live value on this page). A future widget
  // that DOES need push notifications independent of a re-render would need this reconsidered.
  const source = createMachineDetailSource(machine)

  /**
   * WS-HMI-2 Task 13 — WHICH DOCUMENT THIS PANEL DRAWS, in priority order, each step with its reason:
   *
   *  1. `demoScreen` — the engineering route named a document by URL. Unchanged by this task.
   *  2. the PUBLISHED screen for this machine, if one exists AND is one the renderer can lay out.
   *     `renderableScreen` returns `undefined` for the small set of shapes that would throw or
   *     collapse the grid, so a bad row (a legacy document restored by a rollback, which does not
   *     re-validate) costs this machine its published screen, never its whole panel — see that
   *     function's own doc comment, and note that everything a merely ODD document contains
   *     (an unknown widget kind, an out-of-range rect, an unresolved `{component}`) is still handled
   *     by `ScreenRenderer` itself, one widget at a time. That net is untouched.
   *  3. `SCREEN_DOCS[machine.class]` — the shipped screen, exactly as before this task.
   *
   * 🔴 STEP 3 IS WHY THE 31 VISUAL BASELINES CANNOT MOVE, and the argument is a grep rather than a
   * hope: `useScreen` answers 404 for an id nobody ever `PUT`, `renderableScreen(undefined)` is
   * `undefined`, and NOTHING in this repository writes `machine-scrw-01`, `machine-aoi-01` or
   * `machine-iot-01` — the ids the three baseline machines derive. So for those three the expression
   * below evaluates to the SAME object it evaluated to before this task, and `<ScreenRenderer>` is
   * handed byte-identical input. §5-bis's "an undeclared screen changes nothing" is delivered by the
   * fallback, not asserted about it.
   */
  const kioskDoc = demoScreen ?? renderableScreen(publishedScreen.data) ?? SCREEN_DOCS[machine.class]

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-surface-subtle text-text-body">
      <Nameplate
        code={machine.code}
        deviceClass={machine.class}
        driverKind={machine.driverKind}
        lampState={lampState}
        lampLabel={lampLabel}
        lampSub={lampSub}
        lampLive={running}
        connectionState={connectionState}
      />

      {/* Task 4 — the tab rail HMI_DESIGN_SPEC.md §8.1 has always reserved this row for, directly
          under the nameplate, ahead of the main row below. */}
      <TabRail active={activeTab} onChange={setActiveTab} />

      {/*
        H5 — Scheme A, three-column SCADA layout (layout spec §8, closing gap 1/3/4): the schematic
        and the readout grid are now SIBLING columns (read side-by-side, not schematic-above-readouts
        in one shared column) and the third column is a fixed-width, FULL-HEIGHT control rail — the
        output card sits at ITS top (gap 3: promoted out of the old 29px footer), `ControlColumn`
        fills the rest (gap 2: no longer squeezed to less height than the log). The system log itself
        moves OUT of this row entirely into its own full-width band below (gap 2/reference §1.2's
        "alarm banner" convention) — a tab rail belongs directly under the nameplate, ahead of this
        row, once a later task adds one (spec §8 note); this row's own `min-h-0` + each child's
        internal `hmi-scroll` is what keeps the WHOLE PAGE from ever scrolling (spec §9) at any of the
        three device classes' proportions.

        H5b — row:log ratio changed 5:1 → 5:1.5 (spec §8.1's own note: "do not shrink the row's share
        below this without re-verifying the control rail's worst-case fit" — this pass DID
        re-verify, live, with an engine `evaluate()` measuring `ControlColumn`'s own `scrollHeight` vs
        `clientHeight` at 1280×800: 5:2 left the rail short by 45px even BEFORE the HALT-engaged
        banner added more, i.e. it broke §8.3's fit in the NORMAL state, not just the latched one —
        5:1.5, combined with `ControlColumn.tsx`'s own trimmed padding, is the loosest ratio that keeps
        the rail's unlatched content fitting with real margin at the 1280×800 floor. The old 5:1 log
        band was ~2 visible rows there — not a "persistent band" an operator would actually glance at,
        just a sliver; 5:1.5 gets it to ~3. The H5b schematic fix (this same pass) makes the schematic
        column look "full" via FILL PERCENTAGE, not raw pixels, so giving the log some height back
        doesn't reopen the empty-canvas regression this pass fixes.
      */}
      <div className="flex min-h-0 flex-[6.5] gap-3 p-3 pb-0">
        {/* Task 4 — the two tabs share this row's flexible left region; the physical control rail
            (below, in the fixed 336px column) stays mounted UNCHANGED regardless of which tab is
            active — spec §8.3's position-stability rule ("HALT never moves/disappears" — a
            reliability requirement, not a safety-circuit one) only holds if switching tabs never
            touches that column at all, so this conditional is scoped to ONLY the schematic+readouts
            vs. settings region, never the rail beside it. */}
        {activeTab === "operation" ? (
          <div
            id="hmi-tabpanel-operation"
            role="tabpanel"
            aria-labelledby="hmi-tab-operation"
            tabIndex={0}
            className="flex min-h-0 min-w-0 flex-1 gap-3 outline-none"
          >
            {/* WS-HMI-1 Task 5 — this used to be `<SchematicPanel>` + `<Sheet><ReadoutGrid/></Sheet>`
                hand-placed side by side with a `DeviceClass`-keyed flex-grow ratio computed right here
                in this file (`SCHEMATIC_READOUT_FLEX`). Both the ratio and the schematic-selection
                branch moved to `src/hmi-runtime/widgets/faceplate.tsx`'s `OperationOverviewFaceplate` —
                this file now only picks WHICH of the three static `HmiScreenDocument`s (`SCREEN_DOCS`)
                describes `machine.class`'s screen and hands it to the generic renderer. No layout
                decision keyed on `DeviceClass` is made in THIS file anymore. */}
            {/* WS-HMI-2 Task 5 — `components` is the prop that was left empty here from the day
                `<ScreenRenderer>` grew it. `bindings.ts` (`resolveBinding`/`componentTagPrefixOf`,
                WS-HMI-1 Task 3) implemented `{component}` in full and was fully unit-tested, and this
                was the ONE line standing between that and the product: with nothing passed, every
                `{component}` binding in every document resolved to itself, braces and all, and every
                widget bound through one showed the same "no data" placeholder. Measured before the fix
                — see `35-hmi-indirect-binding.spec.ts` for the observed-in-a-browser version.
                `?.components` (not a `??  []`) keeps "no declared model" as `undefined` all the way
                down, which is the exact state §5-bis says must stay valid. */}
            {/* WS-HMI-2 Task 13 — `kioskDoc` (computed above, with the priority order and the
                baseline argument written out there) replaced `demoScreen ?? SCREEN_DOCS[machine.class]`
                here. That expression is the line this whole workstream turned out to be missing: the
                editor published, and this panel read three documents compiled into the bundle. */}
            <ScreenRenderer
              doc={kioskDoc}
              source={source}
              components={componentModel.data?.components}
            />
          </div>
        ) : (
          <SettingsTab
            className="min-h-0 min-w-0 flex-1"
            machineCode={machine.code}
            deviceClass={machine.class}
          />
        )}

        <div className="flex w-[336px] shrink-0 flex-col gap-1.5">
          <OutputCard
            className="shrink-0"
            deviceClass={machine.class}
            cycles={machine.cycles}
            passRate={machine.class === "Iot" ? null : machine.passRate}
          />
          <ControlColumn
            className="min-h-0 flex-1"
            estopEngaged={estopEngaged}
            isRunning={fleetIsRunning}
            startPending={startFleet.isPending}
            pausePending={stopFleet.isPending}
            estopPending={estopFleet.isPending}
            resetPending={resetEstop.isPending}
            onStart={handleStart}
            onPause={handlePause}
            onEstop={handleEstop}
            onReset={handleReset}
          />
        </div>
      </div>

      <SystemLog
        className="hmi-system-log-band m-3 min-h-0 flex-[1.6]"
        machineCode={machine.code}
        localEvents={localEvents}
        events={traceEvents}
        connectionState={connectionState}
      />
    </div>
  )
}
