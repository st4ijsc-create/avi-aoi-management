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
import type { HmiScreenDocument } from "../contracts/hmiScreen.ts"

import componentDemo from "../../screens/demo/component-demo.json"

/**
 * The machine whose live data every `/hmi/demo/:screenId` screen renders against. See this module's
 * doc comment for why an IoT node and not the `SCRW-01` the brief's example used: `SCRW-01` is an
 * Automation machine and its `MachineDetail.telemetry` is empty, so no two component instances on it
 * can resolve to two distinct real readings today.
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
