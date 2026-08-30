/**
 * WS-HMI-1 Task 3 — resolves the `{component}` template token in a `ScreenWidget.bindings` value down
 * to a real tag path, and looks up a component's `tagPrefix` from the frozen `ComponentModelDocument`
 * shape (`web/src/contracts/componentModel.ts`) that backs `{component}`'s "indirect binding" (spec
 * §3.4 / plan): a widget authored ONCE against `"{component}/torque"` gets reused against every
 * component instance of that type by pairing it with a different `ScreenWidget.component` id per widget
 * placement — `contracts/fixtures/valid/screen-screwdrive-full.json`'s "torque" widget
 * (`"component": "spindle"`, resolving through `components-screwdrive-cell.json`'s `spindle` node whose
 * `tagPrefix` is `"SCRW-01/spindle"`) is the worked example this module's tests reproduce.
 *
 * Plain `.ts`, NO JSX, NO React import — same reason `widgets/shared.ts` (Task 2) is plain: it lets
 * `web/runtime-tests/bindings.test.mjs` `import()` and EXECUTE this file directly under `node --test`
 * (real behaviour, not a source-text pattern match). `ScreenRenderer.tsx` (this same task) is the only
 * caller; nothing here depends on React or on how the renderer is wired.
 */
import type { ComponentNode } from "../contracts/componentModel.ts"

const COMPONENT_TOKEN = "{component}"

/**
 * Substitutes every occurrence of the literal `"{component}"` token in `binding` with
 * `componentTagPrefix`.
 *
 * - No `{component}` in `binding` at all → returned UNCHANGED; `componentTagPrefix` is never even
 *   consulted. Covers the direct-binding widgets in `screen-screwdrive-full.json` that already name a
 *   fully-qualified path (e.g. `"torque-trend"`'s `bindings.series: "SCRW-01/spindle/torque"`) — most
 *   screens will mix both styles on the same document, and a direct binding must not be rewritten just
 *   because SOME other widget on the screen happens to use `{component}`.
 * - `{component}` present but `componentTagPrefix` is `undefined` (the calling widget's
 *   `ScreenWidget.component` was never set, or it named a component id `components` does not contain —
 *   `componentTagPrefixOf` below treats both the same way) → `binding` is returned UNCHANGED and a
 *   `console.warn` names the exact problem. This function NEVER throws — that is the point: a screen
 *   document with one widget missing its `component` field must break at that ONE widget, not take the
 *   whole kiosk page down (plan §5-bis / this task's headline rule). The caller (a widget's
 *   `readBinding`, `widgets/shared.ts`) then looks the literal, still-templated string up in
 *   `TagValueSource`, which will not recognize it and returns `undefined` — so the on-screen RESULT is
 *   that widget's own ordinary "no data" placeholder, with the console warning underneath explaining
 *   WHY, not a second, different-looking failure mode.
 */
export function resolveBinding(binding: string, componentTagPrefix?: string): string {
  // Defensive, not decorative: `binding` arrives from a JSON document's `bindings` map at runtime with
  // no compile-time guarantee it is actually a string (same posture `TagValueSource.get`'s doc comment
  // already documents for `path`) — a malformed screen document must not crash the kiosk here either.
  if (typeof binding !== "string" || !binding.includes(COMPONENT_TOKEN)) return binding

  if (componentTagPrefix === undefined) {
    console.warn(
      `[hmi-runtime] binding "${binding}" contains {component}, but its widget declares no component ` +
        `(or names one that does not resolve to any component) — leaving it unresolved instead of ` +
        `throwing. Fix the screen document's "component" field for this widget.`
    )
    return binding
  }

  return binding.replaceAll(COMPONENT_TOKEN, componentTagPrefix)
}

/**
 * Looks up `componentId` in `components` and returns its `tagPrefix` — the value `resolveBinding` above
 * substitutes for `{component}`. Returns `undefined` for BOTH "no id was supplied" (a `ScreenWidget`
 * with no `component` field — the common, unremarkable case for a direct-binding widget) and "the id
 * names nothing in `components`" (a stale or typo'd reference — an actual document defect). Those two
 * inputs are deliberately NOT distinguished here: `resolveBinding` reacts identically to either
 * (unresolved-but-unchanged, plus a warning when a `{component}` token is actually present), because
 * from the resolver's perspective both mean the same thing — "no tag prefix is available for this
 * widget" — and a caller with a defect in `components` deserves the exact same fail-safe path as a
 * caller that simply never opted into indirect binding.
 */
export function componentTagPrefixOf(
  components: readonly ComponentNode[] | undefined,
  componentId: string | undefined
): string | undefined {
  if (!componentId || !components) return undefined
  return components.find((c) => c.id === componentId)?.tagPrefix
}
