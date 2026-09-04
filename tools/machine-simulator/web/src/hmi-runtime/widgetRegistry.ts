/**
 * `kind` → component. Every value of the frozen `WidgetKind` union (`../contracts/hmiScreen.ts`) has an
 * entry here, and every entry here is a value of that union — both directions pinned by
 * `web/runtime-tests/widgetRegistry.test.mjs`.
 *
 * 🔴 That test does NOT `import()` this file as an ES module — several widgets below wrap `.tsx`
 * industrial primitives (`web/src/components/industrial/`), and Node's native `.ts` loader cannot parse
 * JSX at all (measured, not assumed — see the test file's own header for the exact probe). Instead the
 * test reads THIS FILE'S OWN SOURCE TEXT and extracts the quoted keys of the object literal below — the
 * same technique `web/contract-tests/contracts.test.mjs`'s `tsUnionMembers` already uses for the exact
 * same reason (a type/schema pin that must not require executing the thing it pins).
 *
 * Keep every entry on its OWN LINE as a quoted `"kind-string": Component` pair — quoted, even the seven
 * kinds that would be perfectly valid UNQUOTED TypeScript identifiers on their own (`readout`, `gauge`,
 * `trend`, `log`, `faceplate`, `label`, `sheet` — no hyphen, nothing stopping a bare `readout:` from
 * compiling). This is NOT an incidental property of the strings; it is a constraint the TEST imposes:
 * `widgetRegistry.test.mjs`'s `readRegisteredKinds()` extracts keys with `/^\s*"([^"]+)":/gm`, which
 * matches ONLY a quoted key. Unquote any one of those seven and it silently drops out of the extracted
 * set — the pin then reports that kind as "missing from the registry" (a loud, but WRONG-REASON,
 * failure: the registry is fine, the extraction just stopped seeing that line), exactly the kind of trap
 * an ordinary "TS cleanup" pass would walk into with neither `oxlint` nor `tsc` objecting. Keep ALL
 * FIFTEEN keys quoted, always — not because the strings need it, but because the pin does.
 */
import type { ReactElement } from "react"
import type { ComponentNode } from "../contracts/componentModel.ts"
import type { ScreenWidget, WidgetKind } from "../contracts/hmiScreen.ts"
import type { TagValueSource } from "./TagValueSource.ts"

import { ReadoutWidget } from "./widgets/readout"
import { StatusLampWidget } from "./widgets/status-lamp"
import { GaugeWidget } from "./widgets/gauge"
import { TrendWidget } from "./widgets/trend"
import { AlarmBannerWidget } from "./widgets/alarm-banner"
import { AlarmListWidget } from "./widgets/alarm-list"
import { LogWidget } from "./widgets/log"
import { FaceplateWidget } from "./widgets/faceplate"
import { LabelWidget } from "./widgets/label"
import { SheetWidget } from "./widgets/sheet"
import { KpiTileWidget } from "./widgets/kpi-tile"
import { StateBadgeWidget } from "./widgets/state-badge"
import { SetpointInputWidget } from "./widgets/setpoint-input"
import { CommandButtonWidget } from "./widgets/command-button"
import { LineStateWidget } from "./widgets/line-state"

export type WidgetProps = {
  widget: ScreenWidget
  source: TagValueSource
  /** Resolves an `{component}`-templated binding string to a concrete path — `bindings.ts` (Task 3) is
   * the real implementation; nothing in this file or `./widgets/*` depends on how it works, only on
   * this signature. */
  resolve: (binding: string) => string
  /**
   * WS-HMI-2 Task 5 — the component model this screen's widgets bind against, forwarded UNCHANGED from
   * `ScreenRendererProps.components` (read that field's own doc comment in `ScreenRenderer.tsx`: it is
   * the authority on the shape, and on why `ComponentNode[]` rather than the full
   * `ComponentModelDocument` — a second declaration of the same thing under a different type would be a
   * second source of truth, not a preference).
   *
   * `resolve` above already carries everything a widget needs to turn ITS OWN `{component}` bindings
   * into tag paths, so nothing under `./widgets/*` reads this today, and a widget that only reads
   * values must keep using `resolve` rather than re-deriving a prefix from here — there would then be
   * two implementations of one rule. What this exists for is the widget that needs the model as DATA
   * rather than as a lookup: a `faceplate` drawing a component's own children, a future editor palette
   * listing what a machine declares. `undefined`/omitted is a valid state at every level of this chain
   * (plan §5-bis), so a reader must handle it rather than assume a screen always has one.
   */
  components?: readonly ComponentNode[]
}

export type WidgetComponent = (props: WidgetProps) => ReactElement

export const widgetRegistry: Record<WidgetKind, WidgetComponent> = {
  "readout": ReadoutWidget,
  "status-lamp": StatusLampWidget,
  "gauge": GaugeWidget,
  "trend": TrendWidget,
  "alarm-banner": AlarmBannerWidget,
  "alarm-list": AlarmListWidget,
  "log": LogWidget,
  "faceplate": FaceplateWidget,
  "label": LabelWidget,
  "sheet": SheetWidget,
  "kpi-tile": KpiTileWidget,
  "state-badge": StateBadgeWidget,
  "setpoint-input": SetpointInputWidget,
  "command-button": CommandButtonWidget,
  "line-state": LineStateWidget,
}
