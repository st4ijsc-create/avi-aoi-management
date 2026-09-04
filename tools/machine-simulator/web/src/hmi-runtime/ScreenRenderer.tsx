import { Component, type ErrorInfo, type ReactNode } from "react"
import type { ComponentNode } from "../contracts/componentModel.ts"
import type { HmiScreenDocument, ScreenWidget } from "../contracts/hmiScreen.ts"
import { componentTagPrefixOf, resolveBinding, unresolvedComponentBindingWarning } from "./bindings.ts"
import { clampRectToLayout } from "./gridLayout.ts"
import type { TagValueSource } from "./TagValueSource.ts"
import { widgetRegistry } from "./widgetRegistry.ts"

export type ScreenRendererProps = {
  doc: HmiScreenDocument
  source: TagValueSource
  /** The component model this screen's widgets bind against — a `{component}`-templated `bindings`
   * value resolves through here (`widget.component` id → `ComponentNode.tagPrefix`, `bindings.ts`).
   * `undefined`/omitted is a valid state, not an error (plan §5-bis: no screen is a valid state to fail
   * hard on) — every widget then behaves exactly as if it had no `component` at all: a `{component}`
   * binding passes through unresolved with a visible warning, one widget at a time, never a page-level
   * crash. Shaped as `ComponentNode[]` (not the full `ComponentModelDocument`) because that id→tagPrefix
   * lookup is the ONLY thing this renderer needs from the component model; `types`/`states` belong to
   * whichever widget (e.g. `faceplate`) actually interprets them. */
  components?: readonly ComponentNode[]
}

type PlaceholderProps = { widgetId: string; reason: string }

/**
 * The one fallback UI every degrade-in-place case in this renderer shares: an unrecognized `kind`, or a
 * widget that threw while rendering. Named per this task's headline rule — "each must degrade to a
 * visible placeholder NAMING THE PROBLEM" — never a blank tile, never a page-level crash.
 */
function WidgetPlaceholder({ widgetId, reason }: PlaceholderProps) {
  return (
    <div
      role="alert"
      data-hmi-widget-error={widgetId}
      className="flex h-full min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-status-fault bg-status-fault/10 p-2 text-center text-[11px] text-danger-text"
    >
      <span>
        <strong>{widgetId}</strong>: {reason}
      </span>
    </div>
  )
}

type BoundaryProps = { widgetId: string; kind: string; children: ReactNode }
type BoundaryState = { error: Error | null }

/**
 * A REAL React error boundary — `getDerivedStateFromError`/`componentDidCatch` — not a `try/catch`
 * wrapped around a render function. A synchronous `try/catch` inside `RenderedWidget`'s own body would
 * NOT catch an error thrown while rendering a CHILD component: `<Widget .../>` below only creates a
 * React element description here, the widget's own function body actually runs later, on React's own
 * call stack, outside any `try` this file could wrap around the JSX. A class component's error-boundary
 * lifecycle is the one mechanism React provides that intercepts errors thrown anywhere in a descendant
 * subtree during render.
 *
 * `ScreenRenderer` (below) wraps EACH widget in its OWN `WidgetErrorBoundary` — not one boundary around
 * the whole widget list — specifically so that a single widget's crash unmounts only that widget's own
 * subtree and React continues rendering every sibling normally. One misconfigured widget must not take
 * the kiosk page down; a single boundary around the whole grid would make every widget's fate depend on
 * the worst-behaved one.
 *
 * 🔴 What this class's presence proves, and what it does NOT: that this file uses the
 * React-documented error-boundary mechanism (not a no-op `try/catch`) is true by construction and
 * checked structurally by `bindings.test.mjs`. Whether the DOM genuinely keeps every sibling widget
 * alive when one throws is a claim about ACTUAL CLIENT RENDERING, and verifying it needs a real
 * browser: `.tsx` cannot be `import()`-ed under `node --test` at all (Task 2 measured this —
 * `ERR_UNKNOWN_FILE_EXTENSION`, see `widgetRegistry.test.mjs`'s header), and this task additionally
 * tried, and rejected, proving it via `react-dom/server` under plain `node --test` instead: React 19's
 * `renderToString`/`renderToPipeableStream` do NOT recover through an error boundary the way client
 * rendering does — a descendant that throws fails the ENTIRE server render (the `onError`/`onShellError`
 * path fires; `getDerivedStateFromError` is never reached, `componentDidCatch` never runs), the exact
 * OPPOSITE of the real `createRoot`/client-side behaviour this component actually runs under in the
 * browser. A test built on that SSR path would report "the boundary works" while measuring a code path
 * that behaves backwards from production — actively misleading, not merely incomplete. Real proof that
 * one widget's crash leaves its siblings alive is Task 4/5's Playwright job.
 */
class WidgetErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[hmi-runtime] widget "${this.props.widgetId}" (kind "${this.props.kind}") threw while rendering:`,
      error,
      info.componentStack
    )
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <WidgetPlaceholder
          widgetId={this.props.widgetId}
          reason={`crashed while rendering: ${this.state.error.message}`}
        />
      )
    }
    return this.props.children
  }
}

function RenderedWidget({
  widget,
  source,
  components,
}: {
  widget: ScreenWidget
  source: TagValueSource
  components?: readonly ComponentNode[]
}) {
  const Widget = widgetRegistry[widget.kind]
  if (!Widget) {
    // A JSON document is not guaranteed to match the `WidgetKind` TYPE at runtime — schema validation
    // happens at authoring/publish time (`contracts/README.md`), not here. `widgetRegistry[widget.kind]`
    // returning `undefined` degrades to a named placeholder instead of the widget crashing the whole
    // screen with "X is not a function" one line down.
    return <WidgetPlaceholder widgetId={widget.id} reason={`unknown widget kind "${widget.kind}"`} />
  }
  const tagPrefix = componentTagPrefixOf(components, widget.component)
  const resolve = (binding: string) => resolveBinding(binding, tagPrefix)
  // 🔴 WS-HMI-2 Task 5, controller ruling — `components` is CONSUMED here (the two lines above) and
  // deliberately NOT forwarded to the widget. The round-1 fix did forward it and no widget read it; an
  // unread prop on `WidgetProps` is a false affordance, because `resolve` is exactly the seam that
  // exists so a widget never holds the model and never repeats the id→tagPrefix lookup. See
  // `widgetRegistry.ts`'s `resolve` doc comment for the full reasoning and for what re-adding it would
  // have to come with.
  return <Widget widget={widget} source={source} resolve={resolve} />
}

/**
 * Reads an `HmiScreenDocument` and lays its widgets onto a CSS grid — `display: grid` sized from
 * `layout.cols`/`layout.rows` (proportional `1fr` tracks, not fixed pixel tracks), each widget placed
 * via `grid-column`/`grid-row` line spans computed from its (clamped) `rect`.
 *
 * Deliberately NOT absolute/pixel positioning. `ScreenBreakpoint` (`contracts/hmiScreen.ts`) declares
 * three shapes — `"panel" | "tablet" | "phone"` — that the SAME screen document is meant to render
 * across; a `1fr`-track CSS grid lets the exact same `col`/`row`/`colSpan`/`rowSpan` integers reflow at
 * a different physical size for free, because they describe grid CELLS, not screen coordinates. Pixel
 * positioning would have to be hand-recomputed per breakpoint.
 *
 * 🔴 WS-HMI-1 Task 5 fix round 1 (task-5-review.md MEDIUM) — this paragraph used to claim this grid
 * "exists to replace [the hand-written, per-machine-class layout work] `SCHEMATIC_READOUT_FLEX` in
 * today's `Hmi.tsx` with one JSON document." That was stale even at the moment it was written (Task 5
 * round 0 kept the ratio in a TypeScript table, `faceplate.tsx`'s `OVERVIEW_SCHEMATIC_READOUT_FLEX` —
 * the review caught the same defect this comment's claim would have papered over). As of round 1 it is
 * true, but NOT because of anything in THIS file: `schematicFlex`/`readoutFlex` now live in each
 * `web/screens/*-overview.json`'s own `widgets[0].props`, read by `hmi-runtime/widgets/faceplate.tsx`'s
 * `OperationOverviewFaceplate` — `ScreenRenderer` itself stays agnostic to what any widget's `props`
 * mean, same as every other widget-specific value. What this grid genuinely provides, and the only
 * claim this file can make about itself, is the reflow-for-free property above; a widget author choosing
 * to put layout numbers in `props` (as `faceplate` now does) is what actually gets them out of
 * TypeScript, not a property of the grid alone.
 *
 * Grid placement is CLAMPED, never dropped: a widget whose `rect` would overflow `layout.cols`/
 * `layout.rows` is resized to fit (`gridLayout.ts`'s `clampRectToLayout`) and a warning is emitted
 * (`console.warn` plus a `title` tooltip on the placed cell) rather than the widget vanishing from the
 * screen or spilling past the declared grid.
 *
 * 🔴 Fix round 1, Finding 2: the SAME `title` tooltip also carries an unresolved-`{component}`-binding
 * warning (`bindings.ts`'s `unresolvedComponentBindingWarning`) when a widget's `bindings` use
 * `{component}` but no tag prefix resolved — `resolveBinding`'s own `console.warn` is real but is not
 * something an operator at a kiosk with no devtools open will ever see; this is the on-screen echo of
 * the exact same condition, computed statically per widget (no interception of `resolve()` calls
 * needed) and folded into the one tooltip idiom this renderer already uses, not a second one.
 */
export function ScreenRenderer({ doc, source, components }: ScreenRendererProps) {
  // 🔴 `task-5-re-review.md` §B (round 2) — `doc.title`/`doc.titleEn` are validated by the schema
  // (`required: [..., "title"]`, `titleEn` optional) but DELIBERATELY not read here: `title`/`titleEn`
  // are authoring-time metadata — a screen's own name, for a future editor's document list or a
  // publish-time human label (WS-HMI-2) — not an on-screen element this runtime renders. No widget's
  // heading derives from them, and none should without a deliberate design decision to add one (a
  // heading appearing where there was none before is a pixel change, not a wiring fix, and none of
  // this task's screens are authorised to move a baseline). This is a chosen, documented gap, not an
  // oversight: the alternative — silence — is how the NEXT author would conclude an unread schema field
  // is honoured just because it validates. `data-hmi-screen={doc.screenId}` two lines below is the one
  // `doc` field this component DOES surface, as a DOM hook, not for display either.
  const { layout, widgets } = doc
  return (
    <div
      data-hmi-screen={doc.screenId}
      data-theme={doc.theme}
      // WS-HMI-1 Task 5 fix round 1 (task-5-review.md LOW) — `min-w-0 min-h-0` added: this div is now
      // (Task 5) a flex ITEM of `Hmi.tsx`'s tabpanel row, and a flex item's default `min-width`/
      // `min-height: auto` uses its min-CONTENT size as a floor, ignoring `w-full`/`h-full` — harmless
      // at the suite's real tested viewport (`devices["Desktop Chrome"]`'s 1280×720 — see
      // `faceplate.tsx`'s own N2 note; `task-5-re-review.md` caught this file's comment repeating the
      // same wrong-viewport claim — the content already fits there, so the floor never binds and no
      // pixel moves), but a real overflow risk at a narrower `ScreenBreakpoint`, where the flex row this
      // replaced always carried its own `min-w-0`.
      className="grid h-full w-full min-h-0 min-w-0 gap-2"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, layout.cols)}, 1fr)`,
        gridTemplateRows: `repeat(${Math.max(1, layout.rows)}, 1fr)`,
      }}
    >
      {widgets.map((widget) => {
        const { rect, warning: clampWarning } = clampRectToLayout(widget.rect, layout, widget.id)
        const tagPrefix = componentTagPrefixOf(components, widget.component)
        const bindingWarning = unresolvedComponentBindingWarning(widget, tagPrefix)
        const title = [clampWarning, bindingWarning].filter((w): w is string => Boolean(w)).join(" | ") || undefined
        return (
          <div
            key={widget.id}
            data-hmi-widget={widget.id}
            title={title}
            style={{
              gridColumn: `${rect.col + 1} / span ${rect.colSpan}`,
              gridRow: `${rect.row + 1} / span ${rect.rowSpan}`,
            }}
          >
            <WidgetErrorBoundary widgetId={widget.id} kind={widget.kind}>
              <RenderedWidget widget={widget} source={source} components={components} />
            </WidgetErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}
