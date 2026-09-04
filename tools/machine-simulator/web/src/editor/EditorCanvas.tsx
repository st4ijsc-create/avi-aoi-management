import type { HmiScreenDocument } from "@/contracts/hmiScreen"
import { ScreenRenderer } from "@/hmi-runtime/ScreenRenderer"
import { createMachineDetailSource } from "@/hmi-runtime/TagValueSource"
import type { TagValueSource } from "@/hmi-runtime/TagValueSource"
import type { MachineDetail } from "@/lib/api"

/**
 * WS-HMI-2 Task 8 — the editor's canvas.
 *
 * ── THE ONE CLAIM THIS FILE EXISTS TO MAKE ────────────────────────────────────────────────────────
 * The canvas is the RUNTIME renderer. `<ScreenRenderer>` below is the very component `routes/Hmi.tsx`
 * mounts on the operator kiosk — the same import, not a copy, not an editor-flavoured variant with a
 * `designMode` prop. The plan calls this Phase 3's most expensive proposition and it is: an editor
 * that draws with its own code drifts from the runtime one widget at a time, and the engineer who
 * designed the screen finds out at the machine.
 *
 * That claim is not made by this comment, and — 🔴 FIX ROUND 1, task-8-review.md finding 1 — it is not
 * made by the browser spec either, which is what the round-0 version of this paragraph got wrong. It
 * ended "a canvas that drew its own labelled boxes would satisfy none of those, which is exactly the
 * point of choosing them", and that is true of a canvas drawing labelled BOXES and false of the thing
 * that actually happens. The reviewer measured it: a second renderer that reuses `widgetRegistry` and
 * `resolveBinding` — about 110 lines, importing nothing from this file — satisfies every one of those
 * behaviours, and with the runtime's two degrade sentences copied (two one-line edits) it passes all
 * three tests in `tests/37-editor-canvas.spec.ts`. So does a verbatim FORK of `ScreenRenderer.tsx`
 * dropped into this directory with `clampRectToLayout` deleted and the grid gap changed — a canvas
 * that provably lays screens out differently from the kiosk.
 *
 * 🔴 FIX ROUND 2, task-8-re-review.md §6 — the round-1 paragraph continued: *"No browser assertion can
 * catch a fork: it renders identically until it drifts, and the drift is invisible to a test that only
 * reads the DOM the fork produced."* **RETRACTED, over-broad, and it was the stated reason round 1
 * added no browser test.** A DIFFERENTIAL assertion catches a fork the moment it drifts — render the
 * same document through the kiosk route and through the editor route and compare what the renderer
 * produced. Impostor B's changed gap is a computed style on the container; that comparison reads it.
 * The defensible sentence is *no browser assertion can catch a fork that has not yet drifted*, and
 * that limit is narrower than it sounds: an undrifted copy is caught by the same test on the first day
 * `ScreenRenderer` changes and the copy does not, which is the only day it can hurt anyone.
 *
 * The round-1 paragraph also ended with a "pincer" — *"an impostor must emit [the hooks] to be green
 * [in the browser spec] … rename the hooks to slip the structural pin and the browser spec goes red;
 * keep them and the structural pin does."* **RETRACTED, measured false**: impostor C kept all three
 * hooks and the structural pin stayed green, because it attached them by spreading a helper's
 * `"data-hmi-widget"` constant instead of writing a literal attribute — and one space before the `=`
 * was enough on its own. No replacement general claim is offered here; each instrument states its own
 * reach below.
 *
 * The claim is carried by three things, in descending order of what they prove:
 *
 *   1. **`tests/37-editor-canvas.spec.ts`'s DIFFERENTIAL** — the primary instrument. The same document
 *      through the kiosk route and through this canvas; the container's theme, grid-track counts and
 *      gaps, every cell's id, `title` and four computed grid lines, and the element tree of every
 *      binding-free widget, compared. It does not care where a renderer lives or how it spells
 *      anything — only whether the two paths produce the same thing.
 *   2. **The same file's five behavioural assertions** — `props.text` on screen (so `widgetRegistry`
 *      dispatch happened), `Readout.tsx`'s own `.hmi-readout-value` row carrying a value that came
 *      through `TagValueSource`, the named placeholder for an unknown `kind`, a per-widget boundary
 *      catching a real throw, `col + 1` grid lines. A floor on BEHAVIOUR; each one names, in place,
 *      what it does not discriminate against.
 *   3. **`runtime-tests/editorCanvasSeam.test.mjs`** — a cheap early warning, not a proof of identity,
 *      and it says so about itself. AST queries, not substring scans: only `ScreenRenderer.tsx` may
 *      NAME a renderer DOM hook or DISPATCH `widgetRegistry` anywhere in `web/src/`, and every
 *      `doc`+`source` mount under `src/editor/` is `<ScreenRenderer>`. It runs in under a second,
 *      which is its whole reason for existing beside a ten-minute browser suite.
 *
 * ── WHY THE DESIGN-TIME SOURCE IS THE RUNTIME ADAPTER, NOT A SECOND ONE ───────────────────────────
 * `ScreenRenderer` needs a `TagValueSource`, and an editor has no machine bound to it. The obvious
 * move — write a small `createDesignTimeSource()` answering `cycles`/`passRate`/`telemetry/{name}`
 * with sample numbers — would put a SECOND copy of `TagValueSource.ts`'s path table in the tree, and
 * the second copy is the one nobody updates. It would also re-open, inside the editor, precisely the
 * defect this whole task is about: a value pipeline that agrees with the runtime today and drifts
 * from it later.
 *
 * So the design-time source is `createMachineDetailSource` — the runtime adapter, unmodified — handed
 * a frozen, fabricated `MachineDetail`. Every path the editor can answer is therefore exactly the set
 * the runtime answers, by construction, with no list to keep in step; every quality bit is computed by
 * the same `readPath`; every number is formatted by the same `formatValue`. When WS-HMI-0c's real
 * live-value contract lands and gets its own `TagValueSource`, this file changes by swapping one
 * constructor, the same as `Hmi.tsx`.
 *
 * ── WHAT IS FABRICATED HERE, SAID PLAINLY ─────────────────────────────────────────────────────────
 * `DESIGN_TIME_SNAPSHOT` is invented data. It is not a reading, it is not sampled from any machine,
 * and `createMachineDetailSource` reports most of it as `quality: "good"` because that is what the
 * adapter honestly says about a `MachineDetail` it was handed — the adapter is not lying, the SNAPSHOT
 * is synthetic. That is deliberate and it is not laundered: the quality bits are NOT overridden to
 * `"stale"` on the way out, because overriding them would give the canvas a tone map the runtime does
 * not have (`shared.ts`'s `qualityTone` maps `"stale"` → `"idle"` — muted text — where a live reading
 * renders `"neutral"` — strong text), i.e. it would make the editor render differently from the
 * runtime in order to look more honest. The honesty is carried where it belongs instead: `EditorRoute`
 * states in visible page chrome, on every load, that this canvas shows sample values and not a running
 * machine. See `editor.designMode` in `i18n/vi.ts`.
 *
 * `code` is the empty string ON PURPOSE and it is the one field with a behavioural job. It is the
 * bridge `widgets/faceplate.tsx` reads to call `useMachine(code)` for a real `CyclePlan`
 * (`TagValueSource.ts`'s own note on why `"code"` earned a path). Naming a real fleet machine here
 * would quietly wire a live 1s poll into a design surface; naming a fake one would fire a doomed
 * request every mount. `""` fails the `code.length > 0` guard every machine-scoped hook in `lib/api.ts`
 * and `lib/configApi.ts` already carries, so no request is made at all and `OperationOverviewFaceplate`
 * takes its own documented `if (!machine || !code) return null` path — a `faceplate` widget draws an
 * empty cell in the editor. That is a REAL LIMIT of this task, not a hidden one: an engineer laying out
 * a screen sees where the faceplate sits but not what it will contain. Closing it needs a design-time
 * `CyclePlan` fixture, which is a `faceplate` job, not a canvas job.
 *
 * Every value below is a fixed literal — no `Date.now()`, no `Math.random()`. A canvas that redraws
 * differently on each load is unusable as a design surface and unpinnable as a test subject.
 */
const DESIGN_TIME_SNAPSHOT: MachineDetail = {
  code: "",
  class: "Iot",
  driverKind: "design-time",
  statusText: "OK",
  passRate: 0.97,
  cycles: 128,
  spc: { values: [4.1, 4.2, 4.15, 4.22, 4.18], mean: 4.17, ucl: 4.5, lcl: 3.9 },
  telemetry: [
    { metric: "temperature", values: [21.4, 22.1, 22.8] },
    { metric: "humidity", values: [54.2, 55.0, 54.6] },
    { metric: "current", values: [1.8, 1.9, 1.85] },
  ],
  boardPoints: [],
  cycleLog: [{ time: "2026-01-01T00:00:00.000Z", serial: "SN-DESIGN-0001", verdict: "OK", keyMetric: "Torque=4.2Nm" }],
  driftState: "—",
  plan: null,
}

/**
 * ONE source for the whole module, not one per mount and emphatically not one per render.
 *
 * `widgets/trend.tsx` calls `source.subscribe(...)` inside a `useEffect` keyed on `source`, so a
 * source whose identity changed every render would tear down and re-register that subscription on
 * every render. `Hmi.tsx` gets away with constructing one per render because its snapshot genuinely
 * changes every poll; this one never changes, so a module constant is both stable and honest about
 * that. Nothing ever calls `.update()` here — the snapshot is frozen — so no subscriber is ever
 * notified, and the listener set only ever holds the widgets currently mounted (each `TrendWidget`
 * returns its own unsubscribe from that effect).
 */
const DESIGN_TIME_SOURCE: TagValueSource = createMachineDetailSource(DESIGN_TIME_SNAPSHOT)

export type EditorCanvasProps = {
  /** The document to draw. Read-only at this task: the canvas neither owns nor mutates it. WS-HMI-2
   * Task 9 adds selection/drag and will hand it `editorState.ts`'s `applyEdit` alongside — together
   * with its consumer, in one commit, the way `WidgetProps.components` was ruled on, rather than a
   * callback prop parked here now with nothing calling it. */
  doc: HmiScreenDocument
}

/**
 * Draws `doc` with the runtime renderer, inside a frame the editor owns.
 *
 * 🔴 `components` is NOT passed to `<ScreenRenderer>`, and its absence is a documented state rather
 * than an omission. `ScreenRendererProps.components` resolves `{component}` bindings through a
 * MACHINE's declared component tree (`GET /v1/components/{code}`), and a screen document under edit is
 * not bound to a machine — there is no code to fetch one for. `undefined` is exactly what that prop
 * documents as valid (plan §5-bis), so a `{component}` binding renders its named placeholder plus the
 * unresolved-binding warning in the cell's `title` tooltip, one widget at a time, while every direct
 * binding keeps working. WS-HMI-2 Task 10's tag picker is where a component model enters the editor,
 * because that is the task that has a machine to ask about.
 */
export function EditorCanvas({ doc }: EditorCanvasProps) {
  return (
    <div
      data-editor-canvas={doc.screenId}
      className="h-full min-h-0 w-full min-w-0 overflow-hidden border border-border-strong bg-surface-subtle p-3"
    >
      <ScreenRenderer doc={doc} source={DESIGN_TIME_SOURCE} />
    </div>
  )
}
