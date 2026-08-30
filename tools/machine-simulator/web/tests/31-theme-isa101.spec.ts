import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { pullMachineConfig, resetEstop, setFleetRunning } from "./support/engine"
import { gotoDashboard, gotoHmi, gotoMachineDetail, gotoMachines, gotoProductConfigPoints } from "./support/screens"
import { primeAppStorage } from "./support/theme"

/**
 * WS-HMI-1 Task 4 — the `isa101` theme (docs/plans/2026-08-30-hmi-ws1-runtime-blueprint.md Task 4;
 * research: docs/HMI_BUILDER_DESIGN_2026-08-29.md §6). This file proves exactly the two things that
 * task's own brief asks for, and deliberately not a third, different way of proving them:
 *
 *  1. isa101 is a real, switchable 4th theme whose OWN `[data-theme="isa101"]` block is the one
 *     actually in effect — not a silent fall-through to `:root`'s Glass values (the failure mode a
 *     missing/typo'd selector would produce). `primeAppStorage` is the SAME mechanism
 *     `00-visual-and-a11y.spec.ts`/`11-hmi.spec.ts` already use to prove a theme "took" for
 *     glass/console/warmth — this file follows that established mold rather than inventing a
 *     UI-click-through flow no other theme in this suite is tested with either.
 *  2. axe AA is clean on isa101 SPECIFICALLY, not just inherited from the default theme's own pass —
 *     the brief's own risk flag ("a grey-on-grey palette is exactly where contrast quietly fails").
 *     Coverage mirrors `00-visual-and-a11y.spec.ts`'s own `MULTI_THEME_SLUGS` — the representative,
 *     contrast-risky screen set that file already widens to every OTHER theme (dashboard/machines/
 *     machine-detail/product-config-points) — plus the HMI operator panel across all 3 machine
 *     classes, isa101's actual target surface per §6's own table ("Mặc định cho máy sản xuất").
 *
 * Deliberately NO `toHaveScreenshot` anywhere in this file: Task 4's brief scope is "switches,
 * applies, axe AA clean" — not a new set of visual baselines, and `--update-snapshots` (the only way
 * to seed a first-run baseline for a theme that has never been captured before) is explicitly
 * forbidden for this task. This file also never touches `00-visual-and-a11y.spec.ts`/
 * `11-hmi.spec.ts` or any of their own `*-glass.png`/`*-console.png`/`*-warmth.png` baselines, so
 * there is zero risk of moving one of those either.
 */

test.describe("isa101 theme", () => {
  test("applies its own token values on <html>, not a silent fall-through to Glass", async ({ page, request }) => {
    await setFleetRunning(request, false)
    await primeAppStorage(page, { theme: "isa101" })
    await gotoDashboard(page)

    await expect(page.locator("html")).toHaveAttribute("data-theme", "isa101")

    // Literal (non-`var()`) custom properties only — a custom property's computed value keeps
    // whatever token stream was authored (no colour-space normalisation the way a real `color`
    // property gets), so these compare as plain strings. Each value below is distinct from every
    // one of Glass/Console/Warmth's own (`--color-bg`: #eef1f7/#12171f/#f4f1ea; `--radius`:
    // 8px/6px/5px; `--status-run`: #1f9d57/#2ee88f/#3f8c4f) — this is what actually distinguishes
    // "isa101's block is in effect" from "the attribute is stamped but nothing matched it."
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        bg: style.getPropertyValue("--color-bg").trim(),
        radius: style.getPropertyValue("--radius").trim(),
        statusRun: style.getPropertyValue("--status-run").trim(),
        glowRun: style.getPropertyValue("--glow-run").trim(),
      }
    })
    expect(tokens.bg).toBe("#c7cac8")
    expect(tokens.radius).toBe("0px")
    expect(tokens.statusRun).toBe("#2f7d4c")
    // The doctrine's own central claim, made checkable: a live "running" element must NOT glow on
    // this theme (Console's own signature) — colour/emphasis stays reserved for the status ramp
    // itself, never a decorative halo on a state that is already normal.
    expect(tokens.glowRun).toBe("none")
  })

  // The same representative, contrast-risky screen set `00-visual-and-a11y.spec.ts`'s own
  // `MULTI_THEME_SLUGS` already widens to Console/Warmth (see that file's top comment for why these
  // four and not all 14) — highest density of `--status-*`/`--ok/warn/danger/neutral` tokens, the
  // one `ControlButton`+`StatusLamp` screen, and the one `BoardCanvas` screen.
  const ISA101_SCREENS: { slug: string; visit: (page: Page) => Promise<void> }[] = [
    { slug: "dashboard", visit: (page) => gotoDashboard(page) },
    { slug: "machines", visit: (page) => gotoMachines(page) },
    { slug: "machine-detail", visit: (page) => gotoMachineDetail(page, "SCRW-01") },
    { slug: "product-config-points", visit: (page) => gotoProductConfigPoints(page, "MODEL-A") },
  ]

  // WS3-T3's own precondition discipline (00-visual-and-a11y.spec.ts's top comment): establish a
  // stopped fleet here rather than inheriting one from file order — `FleetHost.Stop()` is a no-op if
  // already stopped, so this doesn't depend on anything having run before this file.
  test.beforeEach(async ({ request }) => {
    await setFleetRunning(request, false)
  })

  for (const screen of ISA101_SCREENS) {
    test(`a11y (axe, wcag2a/2aa/21aa) — isa101 — ${screen.slug}`, async ({ page }) => {
      await primeAppStorage(page, { theme: "isa101" })
      await screen.visit(page)
      await assertNoSeriousA11yViolations(page)
    })
  }

  // The HMI operator panel — isa101's actual target surface (§6: "Mặc định cho máy sản xuất"), and
  // the one screen where the physical `ControlButton`/`StatusLamp` register and the living schematic
  // are simultaneously live. Same beforeEach/afterEach precondition `11-hmi.spec.ts` establishes for
  // itself, for the same reason: every test here wants a real running fleet, regardless of what the
  // ISA101_SCREENS loop above just left it as.
  test.describe("HMI operator panel", () => {
    test.beforeEach(async ({ request }) => {
      await pullMachineConfig(request, "AOI-01", "MODEL-A")
      await resetEstop(request)
      await setFleetRunning(request, true)
    })
    test.afterEach(async ({ request }) => {
      await resetEstop(request)
      await setFleetRunning(request, true)
    })

    const HMI_CODES = ["SCRW-01", "AOI-01", "IOT-01"]
    for (const code of HMI_CODES) {
      test(`a11y (axe, wcag2a/2aa/21aa) — isa101 — hmi ${code}`, async ({ page }) => {
        await primeAppStorage(page, { theme: "isa101" })
        await gotoHmi(page, code)
        await assertNoSeriousA11yViolations(page)
      })
    }
  })
})
