/**
 * WS-HMI-1 Task 5, fix round 1 (task-5-review.md, findings HIGH #1 and HIGH #2) — pure, JSX-free
 * resolution logic for `widgets/faceplate.tsx`'s `"fp.overview.*"` ids. Pulled into its own module for
 * the same reason `bindings.ts`/`gridLayout.ts` (Task 3) and `widgets/shared.ts` (Task 2) already are:
 * Node's native `.ts` loader strips type syntax but cannot parse JSX at all, so this is the only way
 * `runtime-tests/overviewFaceplate.test.mjs` can `import()` and EXECUTE this logic directly under
 * `node --test` — proving, by running it, that a screen DOCUMENT's own `widgets[0].props` genuinely
 * determines what would render, not just that a plausible-looking value sits in a JSON file beside
 * TypeScript that ignores it.
 *
 * 🔴 What round 0 shipped, and why fix round 1 (`task-5-review.md`) rejected it — corrected numbering,
 * `task-5-re-review.md` finding N5: an earlier version of this comment called round 0's shape "round 1",
 * which is what THIS file's own fix actually is; fixed here rather than left to contradict
 * `ScreenRenderer.tsx`'s own (correct) numbering. Round 0's `FaceplateWidget` checked `props.faceplate`
 * for Set membership (`OVERVIEW_FACEPLATE_IDS.has(id)`) and then discarded the value —
 * `OperationOverviewFaceplate` re-derived `deviceClass` from the REAL `machine.class` and read the
 * schematic:readout ratio from `OVERVIEW_SCHEMATIC_READOUT_FLEX`, a `Record<DeviceClass, [number,
 * number]>` relocated verbatim from `Hmi.tsx`'s deleted `SCHEMATIC_READOUT_FLEX`. The round-1 review's
 * falsification: swap `"fp.overview.aoi"` and `"fp.overview.iot"` between the two documents and NOTHING
 * changes — the id was inert, and the "generic grid can't do a non-1:1 ratio" proof (real, and it holds
 * — see `faceplate.tsx`'s own header) was being used to justify a DIFFERENT, unforced decision: keeping
 * the proportions in TypeScript instead of in `props`. The schema puts no shape on `props`
 * (`hmi-screen.schema.json`'s `$defs/widget.props` is `{"type":"object"}`), and the widget already reads
 * `widget.props` — nothing stopped the ratio from living there too.
 *
 * The fix (this file, round 1): `resolveOverviewFaceplate` below reads BOTH the `deviceClass` (from the
 * id itself, via `FACEPLATE_DEVICE_CLASS`) AND the flex ratio (from `props.schematicFlex`/
 * `props.readoutFlex`) — both now genuinely travel from the JSON document to the rendered pixels, and
 * swapping either would visibly change what renders (this module's own tests demonstrate exactly that
 * swap, and `tests/32-hmi-screen-wiring.spec.ts` — round 2 — demonstrates it in a real rendered page).
 */
import type { DeviceClass } from "../../lib/api.ts"

export type OverviewFaceplateConfig = {
  deviceClass: DeviceClass
  schematicFlex: number
  readoutFlex: number
}

/**
 * The registry half of this module — analogous to `widgetRegistry.ts`'s own `kind → Component` map, NOT
 * a per-class LAYOUT table: it says which built-in cell drawing an id NAMES (`AutomationSchematic` vs.
 * `AoiSchematic` vs. `IotSchematic`, via `SchematicPanel`'s own `deviceClass` prop), nothing about how
 * big it is on screen — the SIZE comes from `schematicFlex`/`readoutFlex` below, read from the SAME
 * document's `props`, not from this table.
 *
 * This is what makes `props.faceplate` load-bearing rather than a Set-membership check that gets
 * discarded: `OperationOverviewFaceplate` (`faceplate.tsx`) passes THIS function's `deviceClass` to
 * `SchematicPanel`, not `machine.class` — so a document whose `faceplate` id names a DIFFERENT class
 * than the machine it happens to be shown for renders THAT class's drawing, not the machine's real one.
 * In normal operation `Hmi.tsx`'s `SCREEN_DOCS[machine.class]` always pairs a machine with the document
 * whose id names its own class, so this never diverges from `machine.class` in shipped behaviour and no
 * pixel moves — the divergence only shows up if someone edits a document to disagree with itself, which
 * is exactly the case this module's own test constructs.
 */
const FACEPLATE_DEVICE_CLASS: Record<string, DeviceClass> = {
  "fp.overview.automation": "Automation",
  "fp.overview.aoi": "AoiAvi",
  "fp.overview.iot": "Iot",
}

const DEFAULT_FLEX = 1

function readFlex(raw: unknown): number {
  // Defensive, not decorative — same posture every other widget prop reader in this tree takes
  // (`widgets/shared.ts`'s `asRecord`/`readThresholds`): a JSON document is not guaranteed to match its
  // declared shape at runtime, and a missing/non-numeric/non-positive ratio must fall back to an even
  // split, not throw or silently render a panel at zero width (plan §5-bis).
  //
  // 🔴 `task-5-re-review.md` N3 (round 2) — this fallback is why a DECLARED `1` and an ABSENT field are
  // indistinguishable from this function's own return value alone: `readFlex(1) === readFlex(undefined)
  // === 1`. That is correct behaviour for THIS function (the fallback is deliberate, same house style as
  // `asRecord`/`readThresholds`) — the finding was that `runtime-tests/screens.test.mjs`'s test claimed
  // to check the declared ratio while only checking the RESOLVED one, so deleting
  // `automation-overview.json`'s `schematicFlex`/`readoutFlex` entirely stayed green. Fixed at the test
  // (an explicit `Object.hasOwn` check on the raw document), not here — the fallback itself is correct
  // and unchanged.
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FLEX
}

/**
 * `widgetProps` is a screen document widget's already-parsed `props` (`asRecord(widget.props)` in the
 * caller). Returns `undefined` when `props.faceplate` is missing, not a string, or names nothing in
 * `FACEPLATE_DEVICE_CLASS` — `widgets/faceplate.tsx` falls back to the "not wired yet" placeholder for
 * that case, same as any other unrecognized `props.faceplate` id (`fp.motor.spindle` included).
 */
export function resolveOverviewFaceplate(widgetProps: Record<string, unknown>): OverviewFaceplateConfig | undefined {
  const faceplateId = typeof widgetProps.faceplate === "string" ? widgetProps.faceplate : undefined
  const deviceClass = faceplateId ? FACEPLATE_DEVICE_CLASS[faceplateId] : undefined
  if (!deviceClass) return undefined
  return {
    deviceClass,
    schematicFlex: readFlex(widgetProps.schematicFlex),
    readoutFlex: readFlex(widgetProps.readoutFlex),
  }
}
