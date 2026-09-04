/**
 * WS-HMI-2 Task 13 fix round 1 (task-13-review.md HIGH-1) — the three SHIPPED operator screens, in
 * ONE place, because there are now TWO consumers.
 *
 * ── WHY THIS TABLE MOVED OUT OF `routes/Hmi.tsx` ─────────────────────────────────────────────────
 * It lived there deliberately: `runtime-tests/hmiWiring.test.mjs` reads `Hmi.tsx`'s own source text
 * for the three `screens/*-overview.json` imports, as a cheap guard against a revert of WS-HMI-1
 * Task 5, and `lib/hmiScreens.ts`'s header says in as many words that moving it "would defeat a guard
 * that exists to catch a revert".
 *
 * HIGH-1 gave the EDITOR a reason to read the same three documents: publishing to `machine-aoi-01`
 * shadows `AOI-01`'s shipped panel permanently (the store has no DELETE and rollback only appends to
 * an id that never had the shipped document as a version), so the way back has to be a publish OF the
 * shipped document — which means the editor needs its bytes. The alternative was a SECOND table built
 * from the same three files, i.e. exactly the "two places to keep in step" defect this branch has
 * spent a fortnight removing. So the table moved, and the guard moved WITH it rather than being
 * loosened: `hmiWiring.test.mjs` now reads the three imports HERE and additionally asserts that
 * `Hmi.tsx` still imports this module, so the chain a revert would break is still checked end to end.
 *
 * 🔴 Still STATICALLY imported (build-time), not `fetch`ed — the limit `Hmi.tsx`'s own header has
 * always named is unchanged by this move: editing `web/screens/*.json` on a deployed kiosk needs a
 * rebuild. What DOES now reach a kiosk without a rebuild is a PUBLISHED screen (`publishedScreen.ts`),
 * which is the whole point of the join; these three remain the fallback for a machine nobody has
 * published to.
 *
 * Plain `.ts`, but — unlike its neighbours — NOT `import()`-able under `node --test`: it imports JSON,
 * and Node requires an import attribute for that (measured in this tree; see `lib/hmiScreens.ts`'s
 * own note, and `35-hmi-indirect-binding.spec.ts`'s third test for the same limit reached from the
 * other side). `runtime-tests/screenJoin.test.mjs` therefore does not import it; the documents' own
 * validity is covered by `runtime-tests/screens.test.mjs`, which reads them off disk.
 */
import type { DeviceClass } from "../lib/api.ts"
import type { HmiScreenDocument } from "../contracts/hmiScreen.ts"

import automationOverview from "../../screens/automation-overview.json"
import aoiOverview from "../../screens/aoi-overview.json"
import iotOverview from "../../screens/iot-overview.json"

/**
 * One document per `DeviceClass`. `Record<DeviceClass, …>` is exhaustive in BOTH directions at compile
 * time — a fourth device class is a missing-property error here, and a name the union lacks is an
 * excess-property error — so this table cannot silently fall out of step with the enum it is keyed on.
 */
export const SHIPPED_SCREEN_DOCS: Record<DeviceClass, HmiScreenDocument> = {
  Automation: automationOverview as HmiScreenDocument,
  AoiAvi: aoiOverview as HmiScreenDocument,
  Iot: iotOverview as HmiScreenDocument,
}
