/**
 * WS-HMI-2 Task 5 — which screen DOCUMENT an HMI route renders, for the routes that are not keyed on
 * a machine's `DeviceClass`.
 *
 * `Hmi.tsx`'s `SCREEN_DOCS` (still in that file, deliberately — `runtime-tests/hmiWiring.test.mjs`
 * reads `Hmi.tsx`'s own source text for the three `screens/*-overview.json` imports, and moving them
 * here would defeat a guard that exists to catch a revert) answers the operator route
 * `/hmi/:code`: one document per `DeviceClass`, three shipped screens, no screen id in the URL. This
 * module answers the OTHER shape — `/hmi/demo/:screenId`, an ENGINEERING route that names a document
 * directly and is not part of any machine's default panel (plan §5-bis: the default fleet stays
 * exactly as it was).
 *
 * ── Why a demo screen exists at all, and why it is in THIS task ───────────────────────────────────
 * `{component}` indirect binding (`hmi-runtime/bindings.ts`, WS-HMI-1 Task 3) has been fully built and
 * fully unit-tested since that task, and NOTHING in the product ever exercised it: none of the three
 * shipped documents uses a `{component}` binding, and `Hmi.tsx` never passed `ScreenRenderer` the
 * `components` prop those bindings resolve through. A test for the fix therefore needs a document that
 * actually uses the feature. Editing a shipped screen to add one is not available — `11-hmi.spec.ts`
 * and `00-visual-and-a11y.spec.ts` pin those three screens' pixels — so the demo screen gets its own
 * document and its own route, which is also the route WS-HMI-2 Task 6 extends to cover every widget
 * kind.
 *
 * ── The demo machine, and why it is an IoT node ───────────────────────────────────────────────────
 * The demo route carries no machine code, so it names one. `DEMO_MACHINE_CODE` is an IoT sensor node
 * for a measured reason, not a preference: the ONLY `TagValueSource` implementation that exists today
 * (`hmi-runtime/TagValueSource.ts`'s `createMachineDetailSource`, reading `MachineDetail`) answers a
 * fixed path table, and `telemetry/{metric}` is the only family in it with more than one live member —
 * and only `IotSensorSim` produces any telemetry at all (`temperature`, `humidity`, `current`; an
 * Automation/AOI machine's `telemetry` array is empty). Two component instances that resolve to two
 * DIFFERENT real readings is the whole point of the demo — the same value in both tiles would pass an
 * implementation that ignored `widget.component` entirely — and this is the one machine class on which
 * that is achievable without fabricating a reading.
 */
import type { HmiScreenDocument, ScreenBreakpoint } from "../contracts/hmiScreen.ts"

import componentDemo from "../../screens/demo/component-demo.json"

/**
 * The machine whose live data every `/hmi/demo/:screenId` screen renders against. See this module's
 * doc comment for why an IoT node and not the `SCRW-01` the brief's example used: `SCRW-01` is an
 * Automation machine and its `MachineDetail.telemetry` is empty, so no two component instances on it
 * can resolve to two distinct real readings today.
 *
 * 🔴 CONTROLLER RULING, WS-HMI-2 Task 5 fix round 1 (task-5-review.md LOW-4) — **this stays a
 * hardcoded fleet code, deliberately unpinned. Do not re-open it.** The obvious "improvement" is a test
 * asserting this code is present in `fleet.json`; that test would pin a FLEET ROSTER the owner is
 * entitled to change, turning an ordinary roster edit into a red suite in a file about screens. The
 * failure mode without it was measured and is loud, not silent: if this machine ever leaves the roster,
 * `35-hmi-indirect-binding.spec.ts`'s own `expect.poll` on `GET /v1/machines/IOT-01` returns `"not-ok"`
 * and times out with the message it wrote for itself, and the route renders the not-found kiosk. A loud
 * failure with a written explanation is the whole benefit a pin would have bought.
 */
export const DEMO_MACHINE_CODE = "IOT-01"

/**
 * `screenId` → document, for the engineering demo route only. Keyed by the id INSIDE each document
 * (not by filename) so a URL can never name a screen whose `screenId` says something else.
 */
export const DEMO_SCREEN_DOCS: Readonly<Record<string, HmiScreenDocument>> = {
  [(componentDemo as HmiScreenDocument).screenId]: componentDemo as HmiScreenDocument,
}

/** The document `screenId` names, or `undefined` when it names nothing — an unknown id is a 404-shaped
 * state for the caller to render, never a throw: a mistyped URL must not take the kiosk shell down. */
export function resolveDemoScreen(screenId: string | undefined): HmiScreenDocument | undefined {
  if (!screenId) return undefined
  return Object.hasOwn(DEMO_SCREEN_DOCS, screenId) ? DEMO_SCREEN_DOCS[screenId] : undefined
}

/**
 * ── WS-HMI-2 Task 12: WHAT EACH `ScreenBreakpoint` LOOKS LIKE, IN PIXELS, AT DESIGN TIME ─────────
 *
 * `contracts/hmi-screen.schema.json` freezes the three NAMES (`$defs/layout.properties.breakpoint`)
 * and says nothing about what any of them measures — deliberately, because `ScreenRenderer` places
 * widgets on a FLUID `repeat(cols, minmax(0, 1fr))` grid that fills whatever box it is given. Nothing
 * at runtime is bound to a number below: a `phone` document rendered on a 4K panel fills the 4K
 * panel. That is the contract, and this table does not change it.
 *
 * What the table IS for: the editor has to answer "does this layout still read at the width this
 * document says it is for?", and it cannot answer that by asking the browser — the browser is showing
 * the ENGINEER's window, not the target device's. So the canvas is previewed inside a frame of this
 * width, and changing the chooser changes both the document's `layout.breakpoint`
 * (`editorState.ts`'s `set-breakpoint`) and the width it is drawn at. Two things at once, on purpose:
 * an editor that changed only the preview would let someone lay a screen out at 1 280 px and publish
 * it declaring `phone`.
 *
 * 🔴 THE NUMBERS ARE A DESIGN-TIME CHOICE, NOT A MEASUREMENT, AND ARE DELIBERATELY NOT PINNED TO
 * ANYTHING. There is nothing in this repository to derive them from — no device roster carries a
 * screen width, and `fleet.json` describes machines, not the terminals they are watched from. So they
 * are stated here with their reasoning and are free to change:
 *
 *   * `panel` 1280 — the resolution of the 15" industrial panel PCs this product is built for
 *     (1280×800 is the long-standing default of that class). Also, and not by accident, wider than
 *     any canvas frame the editor can currently give it inside a 1280 px browser window, so at the
 *     default breakpoint the preview frame is inert and the canvas keeps every pixel it had before
 *     this task.
 *   * `tablet` 1024 — a 10" tablet held landscape, the second surface an operator reaches for.
 *   * `phone` 390 — a phone held portrait. Deliberately narrow enough that a 12-column layout
 *     visibly stops working, because a preview that flatters every layout is not a preview.
 *
 * `Record<ScreenBreakpoint, number>` is exhaustive in BOTH directions at compile time — a fourth
 * breakpoint added to the frozen contract is a missing-property error here, and a name the contract
 * lacks is an excess-property error — so this table cannot silently fall out of step with the enum,
 * which `scripts/check-contracts.mjs` already holds equal to the schema file itself.
 */
export const SCREEN_BREAKPOINT_WIDTHS: Readonly<Record<ScreenBreakpoint, number>> = {
  panel: 1280,
  tablet: 1024,
  phone: 390,
}
