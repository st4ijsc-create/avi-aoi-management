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
 * That claim is not made by this comment. `tests/37-editor-canvas.spec.ts` measures it in a browser,
 * by changing widgets in the DOCUMENT and reading what the canvas draws: a `label`'s `props.text`
 * appears (so `widgetRegistry` dispatch really happened), a `readout` renders `Readout.tsx`'s own
 * `.hmi-readout-value` row carrying a value that came through `TagValueSource` (so the whole
 * binding→source→format pipeline really ran), a widget whose `kind` names nothing degrades to
 * `ScreenRenderer`'s own `unknown widget kind "…"` placeholder, a widget that throws is caught by
 * `ScreenRenderer`'s own per-widget error boundary while its siblings keep drawing, and a moved
 * `rect` produces `ScreenRenderer`'s own `col + 1` grid-line arithmetic. A canvas that drew its own
 * labelled boxes would satisfy none of those, which is exactly the point of choosing them.
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
