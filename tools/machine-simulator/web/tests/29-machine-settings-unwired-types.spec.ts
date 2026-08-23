import { expect, test } from "@playwright/test"

import { ENGINE_URL, setFleetRunning, resetEstop } from "./support/engine"
import { gotoMachineDetailSettings } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * 🔴 BQ-1, 2026-08-24 — docs/owner-decisions.md ITEM 68.
 *
 * ── WHAT THIS EXISTS TO CATCH ────────────────────────────────────────────────────────────────────
 * The machine settings screen told a WELDER or DISPENSING operator, in the PRESENT and PAST tense,
 * that a value was "Hiệu lực" (in force) and that the machine was "Chỉnh theo máy" (already
 * adjusted). Neither is true for those two types: `SimulatorFactory.Create` builds `WelderSim` and
 * `DispensingSim` with NO config store, so `ResolveEffectiveConfig()` is null for the life of the
 * instance and the machine's real configuration is a private `const` block inside each sim.
 *
 * The screen's one machine-type-aware escape hatch — `notSupported` — CANNOT reach these two:
 * it renders only on HTTP 400, the only 400 of that shape comes from
 * `ConfigKindForMachineType(...) is null`, and `MachineParameterSchema` maps both
 * `["DISPENSING"]` and `["WELDER"]` to a real kind. So the screen had no way to say anything true
 * to them, and both machines ship in the default `fleet.json`.
 *
 * ── 🔴 THIS SPEC DOES NOT RUN IN THE GATE, AND THAT IS ITEM 60 ───────────────────────────────────
 * `scripts/verify-suites.sh` compiles no TypeScript and starts no browser; ZERO of its suites run
 * anything under `web/`. This file is therefore a witness that must be run BY HAND, from
 * `tools/machine-simulator/web`:
 *
 *     npm run test:e2e -- 29-machine-settings-unwired-types.spec.ts
 *
 * Wiring `web/` into the gate costs a second build ecosystem (Node/npm + a browser) and is item 60,
 * which waits on the OWNER for that price. Saying so here rather than letting a green local run be
 * mistaken for gate coverage is the same rule the gate applies to itself — declare what you do not
 * measure, at the place the result appears.
 *
 * ── WHY THE ASSERTIONS ARE TYPE-INDEPENDENT ──────────────────────────────────────────────────────
 * The fix is WORDING plus one honest limitation line, not a per-type badge. The client genuinely
 * cannot know which types are consumed: `MachineParameterSchema.IsConsumedBySimulator` exists but
 * reaches only `BuildPushMessage` on the push endpoint, which `web/src` never calls, and item 42
 * ruled deliberately that `MachineSettingsResponseDto` gains no field. So these tests assert that
 * the screen makes NO claim it cannot support — for the two unwired types AND for a wired one,
 * because a limitation shown only to the machines someone remembered to list is the same defect
 * one layer in.
 */
test.describe("Machine settings — the two types no spec touched (item 68)", () => {
  /**
   * 🔴 A WARM-UP FOR A DEFECT THIS FILE DID NOT CAUSE AND DOES NOT FIX — BQ-1, 2026-08-24.
   *
   * The FIRST `POST /v1/fleet/start` against a freshly-booted engine whose `.e2e-data` was just
   * wiped by `scripts/reset-engine-state.mjs` returns 500. Measured on this tree at 2530b94c:
   *
   *   System.UnauthorizedAccessException: Access to the path is denied.
   *     at MachineConfigStore.WriteAllTextAtomic (MachineConfigStore.cs:655)
   *     at MachineConfigStore.Save (:644)  ->  .Ensure (:199)
   *     at SimulatorBase..ctor (:121)  ->  ScrewdriveSim..ctor (:88)
   *     at SimulatorFactory.Create (:92)  ->  FleetCore.BuildStartPlan (FleetCore.cs:3295)
   *     at FleetCore.Start (:2606)  ->  FleetHost.Start (:352)
   *
   * Every subsequent start succeeds. It is NOT introduced by this file and NOT specific to it: the
   * pre-existing `13-machine-settings.spec.ts` fails ITS first test the same way, with the same
   * status, when that file is run on its own. A full ordered run hides it because
   * `00-visual-and-a11y.spec.ts` absorbs the first start.
   *
   * So this is a one-shot warm-up whose failure is deliberately SWALLOWED, and nothing else in this
   * file swallows anything — `beforeEach` below still asserts a real 200. Swallowing it here rather
   * than retrying inside `setFleetRunning` keeps the workaround visible at the file that needs it
   * instead of hiding a product defect inside a shared helper. Reported as a stopped defect in
   * BQ-1's task report; not repaired here, because it is nobody's item yet and repairing an engine
   * start path from a web spec is the wrong place to decide it.
   */
  test.beforeAll(async ({ request }) => {
    await request.post(`${ENGINE_URL}/v1/fleet/start`).catch(() => undefined)
  })

  test.beforeEach(async ({ request }) => {
    await resetEstop(request)
    await setFleetRunning(request, true)
  })

  // Both ship in the default fleet.json (`:25,28` DISP-01/DISPENSING and `:36,39` WELD-01/WELDER),
  // and before this file NO spec in web/tests mentioned either one — measured at BQ-1: zero
  // occurrences of "WELD" or "DISP" across all 28 spec files.
  for (const code of ["WELD-01", "DISP-01"] as const) {
    test(`${code}: the panel renders, and states its limitation instead of claiming effect`, async ({ page }) => {
      await gotoMachineDetailSettings(page, code)

      // (1) Non-vacuity FIRST. `notSupported` is unreachable for these types, so the parameter table
      //     must really be on screen — otherwise the assertions below would pass against an empty
      //     or error state and measure nothing at all.
      await expect(page.getByText(viDict.machineSettings.notSupported.title)).toHaveCount(0)
      await expect(page.locator("[data-machine-setting-row]").first()).toBeVisible()

      // (2) The limitation is present and readable.
      const limitation = page.getByTestId("machine-settings-limitation")
      await expect(limitation).toBeVisible()
      await expect(limitation).toContainText(viDict.machineSettings.limitation.body)

      // (3) 🔴 The retracted claims are GONE. These are the exact strings item 68 measured as false
      //     for this machine: a column head asserting the number is in force, and a provenance badge
      //     asserting the machine has been adjusted. Asserted as ABSENCE, and that is why (1) exists.
      await expect(page.getByText("Hiệu lực", { exact: true })).toHaveCount(0)
      await expect(page.getByText("Chỉnh theo máy", { exact: true })).toHaveCount(0)

      // (4) And the replacement actually renders — an absence assertion alone would also pass on a
      //     screen that lost its header row entirely.
      await expect(page.getByText(viDict.machineSettings.columns.value, { exact: true })).toBeVisible()
    })
  }

  // The control half. SCRW-01 IS consumed by its simulator (`ScrewdriveSim` takes a
  // `MachineConfigStore`), and the limitation is shown to it too — deliberately. If this test ever
  // has to be deleted to make the suite pass, the fix has drifted into the per-type badge item 42
  // refused, and that is the owner's call and not a test-file edit.
  test("SCRW-01: a WIRED type gets the same limitation, so the wording cannot go stale per type", async ({ page }) => {
    await gotoMachineDetailSettings(page, "SCRW-01")

    await expect(page.locator("[data-machine-setting-row]").first()).toBeVisible()
    await expect(page.getByTestId("machine-settings-limitation")).toBeVisible()
    await expect(page.getByText("Hiệu lực", { exact: true })).toHaveCount(0)
  })
})
