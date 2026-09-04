import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"

import type { HmiScreenDocument, ScreenLayout, ScreenWidget, WidgetRect } from "@/contracts/hmiScreen"
import { clampRectToLayout } from "@/hmi-runtime/gridLayout"
import { ScreenRenderer } from "@/hmi-runtime/ScreenRenderer"
import { createMachineDetailSource } from "@/hmi-runtime/TagValueSource"
import type { TagValueSource } from "@/hmi-runtime/TagValueSource"
import { useT } from "@/i18n"
import type { MachineDetail } from "@/lib/api"
import { applyEdit, createEditorState, undo, type EditorRefusalCode, type EditorState } from "./editorState"
import { gridPitch, movedRect, resizedRect, snapToCells, type CellDelta, type GridPitch } from "./gridGeometry"

/**
 * WS-HMI-2 Task 8 — the editor's canvas. WS-HMI-2 Task 9 — the canvas that EDITS.
 *
 * ── THE ONE CLAIM THIS FILE EXISTS TO MAKE ────────────────────────────────────────────────────────
 * The canvas is the RUNTIME renderer. `<ScreenRenderer>` below is the very component `routes/Hmi.tsx`
 * mounts on the operator kiosk — the same import, not a copy, not an editor-flavoured variant with a
 * `designMode` prop. The plan calls this Phase 3's most expensive proposition and it is: an editor
 * that draws with its own code drifts from the runtime one widget at a time, and the engineer who
 * designed the screen finds out at the machine.
 *
 * 🔴 TASK 9 CHANGED NOTHING ABOUT THAT, AND THE SHAPE IT ADDED WAS PRE-CLEARED. Selection, dragging
 * and resizing are drawn by an OVERLAY that sits above the renderer's output and draws no widget: it
 * emits none of the renderer's DOM hooks, dispatches nothing through `widgetRegistry`, and reads no
 * widget's content. `runtime-tests/editorCanvasSeam.test.mjs`'s §4 asserts — permanently, and as a
 * PASS rather than a rejection — that exactly this shape (a value-qualified `[data-hmi-widget="…"]`
 * selector and a `gridColumn`-positioned ghost) satisfies the pin, because Task 8's round-1 rule
 * forbade both and told the author a fork existed. If any of that ever goes red again, the note there
 * says it plainly: fix the rule, not the drag layer.
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
 *      anything — only whether the two paths produce the same thing. 🔴 Task 9's overlay is a SIBLING
 *      of the renderer's root and injects nothing into any widget cell, which is why that comparison
 *      still holds byte for byte with an editing canvas — and `tests/38-editor-drag.spec.ts` pins the
 *      other half of the same seam: the overlay's own grid geometry is compared, cell by cell, against
 *      the renderer's, so an overlay that drifts out of alignment with the screen it is editing
 *      reddens rather than silently snapping drags to the wrong cell.
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
 *
 * 🔴 Task 9 makes this matter more than it did: the canvas now re-renders on every snapped cell of
 * every drag, and a per-render source would re-subscribe every `trend` widget on the screen each time.
 */
const DESIGN_TIME_SOURCE: TagValueSource = createMachineDetailSource(DESIGN_TIME_SNAPSHOT)

/**
 * Refusal codes this layer deliberately SWALLOWS, as a set it switches on rather than a sentence it
 * matches.
 *
 * `editorState.ts` added `EditorRefusalCode` for exactly this consumer (its own fix round 1 note:
 * *"the Task 8 drag layer had no way to tell a refused no-op … from a refused invalid rect except by
 * string-matching prose"*), and these are the three that mean "you asked for nothing", not "you asked
 * for something impossible":
 *
 *   * `no-op` — the drag ended in the cell it started in, or a resize snapped back to its own span.
 *     `applyEdit` refuses it so it cannot consume a step of a bounded undo history; surfacing it as an
 *     error would put a warning on screen for the single most ordinary thing an engineer does with a
 *     mouse. `tests/38-editor-drag.spec.ts` pins BOTH halves: nothing is announced, and one `Ctrl+Z`
 *     after a real move followed by a dropped-in-place drag still reaches the ORIGINAL rect — which is
 *     only true if the no-op pushed no history.
 *   * `nothing-to-undo` / `nothing-to-redo` — the bottom of the stack. An ordinary boundary, reached
 *     by holding `Ctrl+Z` one beat too long.
 *
 * Everything else means the layer built an edit the document cannot take, which is a defect in THIS
 * file rather than a user mistake. Clamping (`gridGeometry.ts`) is supposed to make every one of them
 * unreachable from a pointer, so the effect below reports them to the console instead of to the
 * engineer — a visible refusal surface belongs to the first task that can actually PRODUCE one from
 * the UI, and inventing one here would ship a message no test in this tree can make appear.
 */
const HARMLESS_REFUSALS: Partial<Record<EditorRefusalCode, true>> = {
  "no-op": true,
  "nothing-to-undo": true,
  "nothing-to-redo": true,
}

/** What a pointer is doing to one widget between `pointerdown` and `pointerup`. */
type DragMode = "move" | "resize"

type DragSession = {
  readonly widgetId: string
  readonly mode: DragMode
  /** Only the pointer that opened the session may drive or end it — a second finger on a touch panel
   * must not steer someone else's drag. */
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
  /**
   * Measured ONCE, at `pointerdown`, from the overlay that is on screen. The grid cannot resize
   * mid-drag (the canvas is a fixed-size frame and no edit this session can make changes `layout`), so
   * re-measuring on every `pointermove` would buy nothing and would make the snap depend on when the
   * browser last did layout.
   */
  readonly pitch: GridPitch
  /**
   * The rect the drag started from — the CLAMPED one, i.e. what the renderer actually drew, not what
   * the document literally says. A widget whose stored rect hangs off the grid is drawn by
   * `clampRectToLayout` at its clamped position, and an engineer dragging it is dragging what they can
   * see. Starting from the raw rect would make the widget jump on the first pixel of movement.
   */
  readonly base: WidgetRect
  /** The live snapped displacement, in whole cells. */
  readonly delta: CellDelta
}

type CanvasState = {
  /** The document this session was opened on. See `EditorCanvas` for why it is compared on every
   * render. */
  readonly screenId: string
  readonly editor: EditorState
  readonly selectedId?: string
  readonly drag?: DragSession
}

function openSession(doc: HmiScreenDocument): CanvasState {
  return { screenId: doc.screenId, editor: createEditorState(doc) }
}

/** The rect the runtime renderer will actually place this widget at — the editor's overlay must agree
 * with it cell for cell, so it asks the renderer's own function rather than re-deriving it. */
function placedRectOf(widget: ScreenWidget, layout: ScreenLayout): WidgetRect {
  return clampRectToLayout(widget.rect, layout, widget.id).rect
}

/** `ScreenRenderer`'s own 1-based translation of a 0-based rect, applied to the overlay so a ghost and
 * a hit target land on the same lines as the cell they stand for. */
function gridPlacement(rect: WidgetRect): CSSProperties {
  return {
    gridColumn: `${rect.col + 1} / span ${rect.colSpan}`,
    gridRow: `${rect.row + 1} / span ${rect.rowSpan}`,
  }
}

/** Where a drag would land if the pointer were released now. */
function previewRectOf(drag: DragSession, layout: ScreenLayout): WidgetRect {
  return drag.mode === "move" ? movedRect(drag.base, drag.delta, layout) : resizedRect(drag.base, drag.delta, layout)
}

/**
 * `Ctrl+Z` is the browser's own text-undo inside a field. This layer takes the shortcut only when the
 * keystroke is not addressed to one — Task 10's tag picker and Task 11's property panel both put real
 * inputs on this page, and stealing their undo would be a regression introduced by a canvas that was
 * not even focused.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/** The selection outline. Inline rather than a Tailwind class so the exact width/style is a value this
 * file states and `38-editor-drag.spec.ts` reads back out of `getComputedStyle`, and `var(--focus)` so
 * it is the same accent every other selection affordance in the app uses (see `index.css`'s token
 * block — never a hex literal in a component). */
/** One cell in each direction, keyed by `KeyboardEvent.key`. A table rather than a switch so the set
 * of keys this layer claims is readable in one line — everything else falls through to the page. */
const ARROW_STEPS: Record<string, CellDelta | undefined> = {
  ArrowLeft: { dCol: -1, dRow: 0 },
  ArrowRight: { dCol: 1, dRow: 0 },
  ArrowUp: { dCol: 0, dRow: -1 },
  ArrowDown: { dCol: 0, dRow: 1 },
}

const SELECTION_OUTLINE: CSSProperties = {
  outline: "2px solid var(--focus)",
  outlineOffset: "-2px",
  backgroundColor: "color-mix(in srgb, var(--focus) 10%, transparent)",
}

export type EditorCanvasProps = {
  /**
   * The document to open an editing session ON. Read once, at mount: from then on the canvas owns the
   * document (`editorState.ts`'s `createEditorState` deep-copies it), because an in-progress edit that
   * a background refetch could overwrite is worse than a stale one.
   *
   * 🔴 A REAL, DOCUMENTED LIMIT of this task: `useScreen` is an ordinary React Query hook, so a
   * refetch (window focus, a manual invalidation) that brings a NEWER document is silently ignored
   * while this session is open. Reconciling a concurrent write is a SAVE concern — it needs the
   * version the session was opened at, which is exactly what `PUT /v1/screens/{id}`'s append-a-version
   * contract carries — and it belongs to the task that adds the save button, not to the one that adds
   * dragging. What IS handled here is a different document arriving because the ROUTE changed; see
   * `EditorCanvas`.
   */
  doc: HmiScreenDocument
}

/**
 * Draws `doc` with the runtime renderer, inside a frame the editor owns, under an overlay that edits.
 *
 * ── HOW SELECTION AND DRAGGING WORK WITHOUT TOUCHING THE RENDERER ────────────────────────────────
 * The overlay is a sibling of `<ScreenRenderer>`'s root, absolutely positioned over it, carrying a CSS
 * grid with the SAME track counts and the same gutters. It holds one transparent hit target per
 * widget, placed on the same lines the renderer placed the widget on (`clampRectToLayout`, called
 * here, is the renderer's own clamp — not a copy of it), plus the selected widget's resize handle and,
 * mid-drag, a ghost at the rect the drop would produce.
 *
 * That the overlay's grid really does line up with the renderer's is not left to this comment: the
 * spec compares the overlay's computed track counts, gaps and per-cell grid lines against the
 * renderer's own, cell by cell. A drag layer that snapped to a grid half a gutter out of step from the
 * screen underneath it would still "work" — every rect it produced would be a legal integer — and
 * would put widgets one cell away from where the engineer dropped them.
 *
 * Every widget cell is covered by a hit target, so a `command-button` widget on a screen under edit
 * cannot be pressed. That is deliberate: at design time a widget is a thing you MOVE, and a canvas
 * where dragging a button sometimes fires it instead is the standard defect of editors that hit-test
 * through to live content.
 *
 * 🔴 FIX ROUND 1, task-9-review.md F1 — those hit targets are `<button>`s with `aria-label`s, and in
 * round 0 their only handlers were pointer events: a keyboard or screen-reader user could focus
 * "Select widget X", press Enter and get nothing. They are operable now — `Enter`/`Space` select,
 * arrow keys nudge by one cell through the SAME `movedRect`/`resizedRect`/`applyEdit` the pointer path
 * uses, so no clamp, minimum span, refusal rule or history behaves differently for a keyboard. See
 * `nudge`. This is not full keyboard editing and does not claim to be; it is the operability the
 * controls were already advertising.
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
  const t = useT()
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [canvas, setCanvas] = useState<CanvasState>(() => openSession(doc))

  // React's own documented "adjust state when a prop changes" pattern (no effect, no extra commit):
  // the route component stays mounted across `/editor/a` → `/editor/b`, so without this the second
  // screen would be edited through the first screen's session — its widget ids, its undo stack. The
  // comparison is on `screenId` rather than object identity on purpose: a refetch of the SAME screen
  // hands us a new object every time and must NOT discard work in progress (see `EditorCanvasProps`).
  if (canvas.screenId !== doc.screenId) setCanvas(openSession(doc))

  const edited = canvas.editor.doc
  const layout = edited.layout
  const refusal = canvas.editor.lastRefusal

  useEffect(() => {
    if (!refusal || HARMLESS_REFUSALS[refusal.code]) return
    // Reported, not rendered — see `HARMLESS_REFUSALS`. `code` first so a reader greps for the branch
    // rather than for the prose.
    console.error(`[editor] edit refused (${refusal.code}): ${refusal.message}`)
  }, [refusal])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== "z") return
      if (isTextEntry(event.target)) return
      event.preventDefault()
      // 🔴 There is exactly ONE history, and it is `editorState.ts`'s. This handler calls `undo` and
      // stores what it returns; it keeps no stack of its own, pushes nothing on drop, and cannot get
      // out of step with `applyEdit`'s own `past`/`future` because it does not have anything to get
      // out of step with. `38-editor-drag.spec.ts` measures the consequence rather than the intent: a
      // no-op drag between two real edits does not consume a `Ctrl+Z`.
      setCanvas((prev) => ({ ...prev, editor: undo(prev.editor) }))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  function beginDrag(event: ReactPointerEvent<HTMLElement>, widget: ScreenWidget, mode: DragMode) {
    const overlay = overlayRef.current
    if (!overlay || event.button !== 0) return
    // Stops the overlay's own background handler from immediately clearing the selection this click
    // just made, and stops the browser from starting a text/image drag of its own.
    event.stopPropagation()
    event.preventDefault()
    const box = overlay.getBoundingClientRect()
    const style = window.getComputedStyle(overlay)
    const pitch = gridPitch({ width: box.width, height: box.height }, layout, {
      x: Number.parseFloat(style.columnGap),
      y: Number.parseFloat(style.rowGap),
    })
    // Pointer CAPTURE, not window listeners: the element keeps receiving `pointermove`/`pointerup`
    // even once the pointer has left it (which it does immediately — a drag that never leaves its own
    // widget is a drag of zero cells), and the browser tears the capture down for us if the pointer is
    // cancelled or the element unmounts.
    event.currentTarget.setPointerCapture(event.pointerId)
    // `preventDefault()` above suppresses the focus a press would otherwise give a `<button>`, so it is
    // given back explicitly: without it, clicking a widget and then pressing an arrow key would nudge
    // whatever the browser happened to have focused instead — the pointer and keyboard paths have to
    // agree about which control is live (F1).
    event.currentTarget.focus()
    setCanvas((prev) => ({
      ...prev,
      selectedId: widget.id,
      drag: {
        widgetId: widget.id,
        mode,
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        pitch,
        base: placedRectOf(widget, layout),
        delta: { dCol: 0, dRow: 0 },
      },
    }))
  }

  function trackDrag(event: ReactPointerEvent<HTMLElement>) {
    setCanvas((prev) => {
      const drag = prev.drag
      if (!drag || drag.pointerId !== event.pointerId) return prev
      const delta = snapToCells({ x: event.clientX - drag.originX, y: event.clientY - drag.originY }, drag.pitch)
      // Re-rendering on every pixel of a drag that has not yet crossed a cell boundary would redraw
      // the whole screen — every widget, through the real renderer — dozens of times per cell.
      if (delta.dCol === drag.delta.dCol && delta.dRow === drag.delta.dRow) return prev
      return { ...prev, drag: { ...drag, delta } }
    })
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setCanvas((prev) => {
      const drag = prev.drag
      if (!drag || drag.pointerId !== event.pointerId) return prev
      // CLAMPED HERE, on the way in — `applyEdit` refuses an illegal rect, it never repairs one
      // (`editorState.ts`'s header). `previewRectOf` is the same call the ghost was drawn from, so the
      // widget lands exactly where the ghost said it would.
      const rect = previewRectOf(drag, prev.editor.doc.layout)
      // A refused edit returns the SAME `doc`/`past`/`future` references, so adopting the result
      // unconditionally is a pure state swap that keeps the refusal legible to the effect above.
      return { ...prev, drag: undefined, editor: applyEdit(prev.editor, { kind: "move", widgetId: drag.widgetId, rect }) }
    })
  }

  function cancelDrag(event: ReactPointerEvent<HTMLElement>) {
    setCanvas((prev) => (prev.drag && prev.drag.pointerId === event.pointerId ? { ...prev, drag: undefined } : prev))
  }

  /**
   * The KEYBOARD half of the same two edits — 🔴 FIX ROUND 1, task-9-review.md F1.
   *
   * Round 0 put a `<button>` with an `aria-label` over every widget cell and gave it pointer handlers
   * only. A keyboard or screen-reader user could focus "Select widget drag-me", press Enter, and get
   * nothing: an affordance that announces itself and does not work, once per widget on the screen. The
   * review's verdict was the right one — make them operable or stop giving them button semantics — and
   * operable is the better answer, because the arithmetic for it already exists and is already pinned.
   *
   * An arrow key is a one-cell `delta` through the SAME `movedRect`/`resizedRect` the pointer path uses
   * and the same `applyEdit`, so keyboard and mouse cannot diverge: the clamps, the minimum span, the
   * no-op refusal at a grid edge and the single undo history are all inherited rather than re-stated.
   * This is not full keyboard editing (there is no keyboard route to a widget's PROPERTIES, and Tab
   * order is document order with no grouping) — it is the operability the buttons already claimed.
   */
  function nudge(widgetId: string, mode: DragMode, delta: CellDelta) {
    setCanvas((prev) => {
      const widget = prev.editor.doc.widgets.find((candidate) => candidate.id === widgetId)
      if (!widget) return prev
      const layoutNow = prev.editor.doc.layout
      const base = placedRectOf(widget, layoutNow)
      const rect = mode === "move" ? movedRect(base, delta, layoutNow) : resizedRect(base, delta, layoutNow)
      return { ...prev, selectedId: widgetId, editor: applyEdit(prev.editor, { kind: "move", widgetId, rect }) }
    })
  }

  /** Arrow keys nudge; `Enter`/`Space` reach `onClick`, which selects. Anything else is left to the
   * page — in particular `Ctrl+Z`, which the window-level handler owns. */
  function onControlKeyDown(event: ReactKeyboardEvent<HTMLElement>, widgetId: string, mode: DragMode) {
    const step = ARROW_STEPS[event.key]
    if (!step || event.ctrlKey || event.metaKey || event.altKey) return
    // Without this the page scrolls under the engineer while the widget moves.
    event.preventDefault()
    nudge(widgetId, mode, step)
  }

  const dragging = canvas.drag
  const preview = dragging ? previewRectOf(dragging, layout) : undefined
  const selectedWidget = edited.widgets.find((widget) => widget.id === canvas.selectedId)

  return (
    <div
      data-editor-canvas={edited.screenId}
      className="h-full min-h-0 w-full min-w-0 overflow-hidden border border-border-strong bg-surface-subtle p-3"
    >
      {/*
        🔴 FIX ROUND 1, task-9-review.md F3 — a `<div hidden data-editor-document={JSON.stringify(doc)}>`
        stood here in round 0 so `38-editor-drag.spec.ts` could run `validate.mjs` over the object the
        canvas holds. It is DELETED, and the reasoning belongs in the file it was cut from: it was an
        always-on OUTPUT serialising every authored widget into production DOM on every render, for
        every viewer, with a test as its only consumer — materially the `window.__widgetKinds` global
        this programme already refused, at a different address. The precedent cited for it,
        `widgets/label.tsx`'s `__testOnlyThrow`, does not carry it: that is an opt-in INPUT hook, inert
        unless a document sets it, and it publishes nothing.

        Nothing was lost. `applyEdit` already refuses any edit whose result would break the frozen
        schema, so the assertion it fed could not fail for anything this layer can produce — measured,
        with `movedRect`'s clamp deleted every one of those calls still returned `[]`. The property is
        pinned where it has teeth: `runtime-tests/editorState.test.mjs` runs `applyEdit` and the real
        `validate.mjs` against each other over a corpus, and `runtime-tests/editorGeometry.test.mjs`
        validates every rect this task's geometry can produce. The spec now reads rects off the
        renderer's own grid lines; see `rectOnScreen` there for how the renderer's clamp warning is used
        to prove that what is drawn IS what the document says.
      */}
      <div className="relative h-full min-h-0 w-full min-w-0">
        <ScreenRenderer doc={edited} source={DESIGN_TIME_SOURCE} />
        <div
          ref={overlayRef}
          data-editor-overlay={edited.screenId}
          // The renderer's own grid, mirrored — same `Math.max(1, …)` guard, same `gap-2`. Mirrored
          // rather than measured because an overlay has to be laid out before anything can be measured
          // off it; that the mirror HOLDS is asserted against the renderer's computed styles in the
          // spec, which is where a divergence would actually show up.
          className="absolute inset-0 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, layout.cols)}, 1fr)`,
            gridTemplateRows: `repeat(${Math.max(1, layout.rows)}, 1fr)`,
          }}
          onPointerDown={(event) => {
            // Only a press on the overlay's own background clears the selection. A press on a hit
            // target stops propagating before it reaches here.
            if (event.target !== event.currentTarget) return
            setCanvas((prev) => ({ ...prev, selectedId: undefined }))
          }}
        >
          {edited.widgets.map((widget) => {
            const placed = placedRectOf(widget, layout)
            const selected = canvas.selectedId === widget.id
            return (
              <button
                key={widget.id}
                type="button"
                data-editor-widget={widget.id}
                data-editor-selected={selected ? "true" : "false"}
                aria-pressed={selected}
                aria-label={t("editor.selectWidget", { widgetId: widget.id })}
                className="cursor-move touch-none appearance-none border-0 bg-transparent p-0"
                style={{ ...gridPlacement(placed), ...(selected ? SELECTION_OUTLINE : undefined) }}
                onPointerDown={(event) => beginDrag(event, widget, "move")}
                onPointerMove={trackDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                // `Enter`/`Space` on a focused `<button>` arrive here as a click. This is what makes the
                // control do what its label says (F1); it is idempotent, so a mouse click running it
                // after `beginDrag` already selected costs nothing.
                onClick={() => setCanvas((prev) => ({ ...prev, selectedId: widget.id }))}
                onKeyDown={(event) => onControlKeyDown(event, widget.id, "move")}
              />
            )
          })}

          {/*
            The resize handle is a SIBLING of its widget's hit target, not a child of it: a button
            inside a button is invalid HTML and gives assistive technology two overlapping controls
            where there is one affordance. Placed on the same grid lines and pinned to the cell's
            bottom-right corner by `justify-self`/`align-self`, which is where the industry puts it and
            which needs no pixel arithmetic to stay attached as the grid reflows.
          */}
          {selectedWidget ? (
            <button
              type="button"
              data-editor-resize={selectedWidget.id}
              aria-label={t("editor.resizeWidget", { widgetId: selectedWidget.id })}
              className="h-4 w-4 cursor-nwse-resize touch-none appearance-none justify-self-end self-end border border-[var(--focus)] bg-[var(--focus)] p-0"
              style={gridPlacement(placedRectOf(selectedWidget, layout))}
              onPointerDown={(event) => beginDrag(event, selectedWidget, "resize")}
              onPointerMove={trackDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
              onKeyDown={(event) => onControlKeyDown(event, selectedWidget.id, "resize")}
            />
          ) : null}

          {/*
            The ghost — where the drop would land, on the same lines the widget will actually take.
            `pointer-events-none` so it never becomes the target of the very drag it is describing.
          */}
          {dragging && preview ? (
            <div
              data-editor-ghost={dragging.widgetId}
              className="pointer-events-none border-2 border-dashed border-[var(--focus)] bg-[color-mix(in_srgb,var(--focus)_12%,transparent)]"
              style={gridPlacement(preview)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
