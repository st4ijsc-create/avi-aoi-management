/**
 * WS-HMI-2 Task 13 fix round 1 (task-13-review.md HIGH-1) — "does this screenId belong to a machine's
 * OPERATOR PANEL, and if so, which machine and what does that machine show today?"
 *
 * ── THE DEFECT THIS EXISTS TO ANSWER ─────────────────────────────────────────────────────────────
 * `/editor/machine-aoi-01` is a legal URL, and Task 13 is precisely what turned it from a named dead
 * end into a working "start building this screen" flow. An engineer who opens it, adds one widget and
 * publishes has REPLACED `AOI-01`'s operator panel — the shipped `aoi-overview` document — for the
 * life of the store, and before this round the product offered neither a warning nor a way back:
 *
 *   * there is no DELETE route (`HmiScreenEndpoints` maps five, verified);
 *   * `POST .../rollback` appends an EARLIER VERSION of the same screenId, and the shipped document
 *     was never a version of `machine-aoi-01` — so there is no version 1 to go back to;
 *   * the `machine-` prefix is a BROWSER-SIDE CONVENTION. Nothing at the write door reserves it,
 *     nothing checks the suffix names a real machine, and `PUT /v1/screens/{id}` is `Policies.Engineer`
 *     like every other screen.
 *
 * 🔴 THE FIX DELIBERATELY ADDS NO ENDPOINT AND NO RULE AT THE WRITE DOOR. A write-door rule would put
 * a browser-side naming convention into the engine's contract, where it would then need a roster
 * lookup on every publish and a story for a machine that leaves the roster. What this module does
 * instead is give the editor the two things it was missing, both built on machinery that already
 * exists: it can SAY what a publish here will cost (naming the machine), and it can UNDO it the same
 * append-only way everything else happens — by publishing the shipped document as a new version.
 *
 * The recovery is CONTENT restoration, not un-publishing, and that distinction is not cosmetic: the
 * store cannot un-publish, so `machine-aoi-01` keeps existing and the kiosk keeps reading it. What
 * changes is that its current version once again holds exactly what `web/screens/aoi-overview.json`
 * holds, under the panel's own id — so the operator's screen is the shipped one again, and the whole
 * detour is visible in the version history rather than erased from it.
 *
 * Plain `.ts`, no JSX — but it imports JSON (through `shippedScreens.ts`) and mounts a hook, so Node
 * cannot `import()` it under `node --test`. The pure, executable half is
 * `hmi-runtime/publishedScreen.ts`'s `machineScreenId`/`machineForScreenId`, pinned by
 * `runtime-tests/screenJoin.test.mjs`; what is left here is the bundle lookup and the hook, and
 * those are pinned in a browser by `tests/43-editor-acceptance.spec.ts`.
 */
import type { HmiScreenDocument } from "@/contracts/hmiScreen"
import { machineForScreenId } from "@/hmi-runtime/publishedScreen"
import { SHIPPED_SCREEN_DOCS } from "@/hmi-runtime/shippedScreens"
import { useFleetRoster, type DeviceClass } from "@/lib/api"

export type ShadowedPanel = {
  /** The machine whose operator panel this screenId is, in the roster's own spelling. */
  machineCode: string
  deviceClass: DeviceClass
  /**
   * The document that machine's kiosk shows when nothing is published for it — the SHIPPED screen,
   * with its `screenId` rewritten to the panel's id.
   *
   * The rewrite is not a liberty: `PUT /v1/screens/{id}` answers 409 when a body names a different
   * identity from the route (WS-HMI-0b HIGH-1's rule), so restoring the shipped CONTENT under this
   * panel's id is the only shape the write door accepts, and it is the shape that puts the right
   * screen back in front of the operator.
   */
  shippedDoc: HmiScreenDocument
}

/**
 * Resolves a screenId against the LIVE ROSTER, never by string surgery on the id.
 *
 * `machineScreenId` is the one direction that is defined — a machine code produces at most one panel
 * id — and inverting it by stripping the prefix would be wrong in a way that matters: the derivation
 * lowercases, and the roster's spelling is the one an engineer has to be shown ("this is AOI-01's
 * panel", not "this is aoi-01's panel"). Comparing derived ids makes the roster the authority for
 * both the existence of the machine and the spelling of its code.
 *
 * Returns `undefined` for every screenId that is not some machine's panel — which is the ordinary
 * case, and the case in which the editor must say nothing at all.
 */
export function shadowedPanelOf(
  screenId: string | undefined,
  machines: readonly { code: string; deviceClass: DeviceClass }[] | undefined
): ShadowedPanel | undefined {
  if (!screenId || !machines) return undefined
  const machine = machineForScreenId(screenId, machines)
  if (!machine) return undefined
  const shipped = SHIPPED_SCREEN_DOCS[machine.deviceClass]
  // A device class the bundle has no shipped document for is not a crash and not a silent
  // `undefined` panel: it means this machine has no shipped screen to shadow OR restore, so there is
  // nothing to warn about and nothing to offer. `Record<DeviceClass, …>` makes it unreachable today;
  // handled because a fourth class arriving with no document is a real future state.
  if (!shipped) return undefined
  return {
    machineCode: machine.code,
    deviceClass: machine.deviceClass,
    shippedDoc: { ...shipped, screenId },
  }
}

/**
 * The hook both editor surfaces use — the not-declared state (which warns BEFORE the first publish)
 * and the publish panel (which warns and offers the way back).
 *
 * `useFleetRoster` is the fleet query WITHOUT a poll, and the editor already mounts it for the tag
 * picker's machine chooser, so on this route the two share one cache entry and this costs no request.
 */
export function useShadowedPanel(screenId: string | undefined): ShadowedPanel | undefined {
  const roster = useFleetRoster()
  return shadowedPanelOf(screenId, roster.data?.machines)
}
