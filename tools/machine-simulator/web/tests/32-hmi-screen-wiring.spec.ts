import { expect, test } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { gotoHmi } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-HMI-1 Task 5, fix round 2 (task-5-re-review.md, finding N1) — closes the ONE gap the re-review
 * held the fix back on: every guard proving `Hmi.tsx` actually renders a screen DOCUMENT (rather than
 * hardcoded React) lived in `runtime-tests/`, and every one of those either (a) exercises
 * `resolveOverviewFaceplate` in isolation (`overviewFaceplate.test.mjs`, `screens.test.mjs` — real
 * proof the RESOLUTION logic is correct, no proof the APPLICATION calls it) or (b) matches `Hmi.tsx`'s
 * SOURCE TEXT (`hmiWiring.test.mjs` — real proof of intent, not of behaviour: the re-review defeated it
 * with four cosmetic edits — `@/` → relative import, a renamed constant, an added `readonly`, a comment
 * carrying the magic strings — while reverting the ENTIRE deliverable, and got 5/5 green). Coordinator's
 * instruction: make at least one guard BEHAVIOURAL — it must fail because the RENDERED RESULT stops
 * following the document, not because a string stopped appearing.
 *
 * This is that guard, chosen as option 1 of the three offered ("render the actual component... assert
 * the output reflects the document") — adapted to how THIS specific repo can execute it: `.tsx` cannot
 * be `import()`-ed under plain `node --test` (measured repeatedly across this tree — see
 * `widgetRegistry.test.mjs`'s header for the exact probe), so "render the actual component" here means
 * the SAME thing it already means everywhere else in this suite that needs a real DOM: a genuine
 * browser, via Playwright, actually running `Hmi.tsx` end to end. There is no jsdom (or any React
 * test-rendering package) anywhere in this repo's `devDependencies`, and adding one is a new npm
 * package the task's own constraints forbid — so option 1 in its "un-browsered" form (jsdom) was not
 * available; this is option 1 in the form this tree's OWN conventions already use for exactly this kind
 * of claim.
 *
 * The technique: mutate the REAL `web/screens/*.json` files on disk (the same experiment
 * `task-5-re-review.md` §A2 ran by hand to find the 46 776-pixel diff and the wrong-machine screenshot),
 * navigate a real browser to a real machine's HMI panel, and assert the RENDERED drawing follows the
 * (mutated) document rather than the machine's own `DeviceClass`. `workers: 1` / `fullyParallel: false`
 * (`playwright.config.ts`'s own header) makes this safe: no other test can read these files mid-mutation.
 * Restored in a `finally` — this suite already relies on Playwright running `finally` even past a test's
 * own timeout (`11-hmi.spec.ts`'s `matchThreshold` test makes the same claim and cites where it was
 * verified) — and this file is deliberately numbered LAST (`32-`) so nothing downstream of it can
 * observe a window where the files are mutated.
 *
 * 🔴 This spec does NOT re-prove the pixel-level claim `task-5-re-review.md` §A2 already made by hand
 * (the 46 776-pixel `toHaveScreenshot` diff) — that was a one-time falsification run, not something this
 * suite pins as an ongoing baseline (doing so would require a THIRD baseline set for a state this task
 * never ships). What this DOES pin, permanently, is the narrower, sufficient claim: the rendered
 * schematic's accessible identity (its `FIG. 01` caption, which the whole page — including every
 * `role="img"` a screen reader or an axe run would see — keys off) tracks the document, not the machine.
 * A regression that silently re-hardcoded `deviceClass` from `machine.class` (`overviewFaceplate.ts`'s
 * fix round 1, or a straight revert to round 0) would fail this test with a real, rendered, wrong
 * caption — not a missing string in a source file.
 *
 * Also covers `task-5-re-review.md` finding N4 (fixed the same round this spec was added,
 * `faceplate.tsx`'s `readoutMachine`): at the time N4 was filed, the schematic half followed the
 * DOCUMENT while the readout half still followed the REAL machine, so a swap produced "half document,
 * half machine" — the re-review's own swap run showed IOT-01 with the AOI/AVI drawing beside IoT
 * readout tiles. `OperationOverviewFaceplate` now derives BOTH halves from the same resolved
 * `config.deviceClass`, so this spec's assertions below check both: the schematic identity AND the
 * readout tile set change together on a swap, not one without the other.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SCREENS_DIR = join(HERE, "..", "screens")
const AOI_PATH = join(SCREENS_DIR, "aoi-overview.json")
const IOT_PATH = join(SCREENS_DIR, "iot-overview.json")

test.describe("HMI screen wiring — the rendered panel follows the document, not just its own source text", () => {
  test("swapping aoi-overview.json ⇄ iot-overview.json's CONTENTS swaps which drawing each machine renders", async ({ page }) => {
    const aoiOriginal = readFileSync(AOI_PATH, "utf8")
    const iotOriginal = readFileSync(IOT_PATH, "utf8")

    // Sanity, BEFORE any mutation: each machine renders its OWN class's drawing AND its own class's
    // readout tiles today — the baseline this test's own falsification is measured against, not an
    // assumption.
    await gotoHmi(page, "AOI-01")
    await expect(page.getByRole("img", { name: /AOI \/ AVI CELL/ })).toBeVisible()
    await expect(page.getByRole("img", { name: /IOT SENSOR NODE/ })).toHaveCount(0)
    await expect(page.getByText(viDict.hmi.readout.boards)).toBeVisible()
    await expect(page.getByText(viDict.hmi.readout.packets)).toHaveCount(0)

    try {
      // The exact mutation `task-5-re-review.md` §A2 performed by hand: swap the two files' whole
      // CONTENTS (not just `props.faceplate` — the real experiment, reproduced as a permanent test).
      writeFileSync(AOI_PATH, iotOriginal)
      writeFileSync(IOT_PATH, aoiOriginal)

      // AOI-01 is still an AoiAvi-class machine — `machine.class` did not change, only the DOCUMENT
      // `Hmi.tsx`'s `SCREEN_DOCS[machine.class]` now resolves to did. A fresh navigation (not a live
      // HMR update to an already-open page) is what makes this deterministic: Vite's dev server always
      // serves the CURRENT on-disk module graph to a new request, so there is nothing to poll for.
      await gotoHmi(page, "AOI-01")

      // The rendered drawing is now the IoT sensor-node cell, NOT the AOI/AVI cell — the document won,
      // not the machine. This is the behavioural half of the claim `overviewFaceplate.test.mjs`'s swap
      // test already makes at the resolution layer: same swap, this time observed through a real DOM.
      await expect(page.getByRole("img", { name: /IOT SENSOR NODE/ })).toBeVisible()
      await expect(page.getByRole("img", { name: /AOI \/ AVI CELL/ })).toHaveCount(0)

      // The readout grid ALSO switched to the IoT tile set (N4's fix, `faceplate.tsx`'s
      // `readoutMachine`) — "Gói tin / Packets" replaces "Số bo mạch / Boards", not left behind on the
      // real machine's own AoiAvi tiles. Both halves of the panel now move together on a swap.
      await expect(page.getByText(viDict.hmi.readout.packets)).toBeVisible()
      await expect(page.getByText(viDict.hmi.readout.boards)).toHaveCount(0)

      // The readout panel's own heading — `t("hmi.readoutPanel.title")` — stays FIXED regardless (it
      // does not read `doc.title`, per `task-5-re-review.md` §B — this line pins that as a KNOWN,
      // deliberate gap, not a silent one the swap could paper over; see `ScreenRenderer.tsx`'s own note
      // on why `title`/`titleEn` are validated but not rendered).
      await expect(page.getByRole("heading", { name: viDict.hmi.readoutPanel.title })).toBeVisible()
    } finally {
      writeFileSync(AOI_PATH, aoiOriginal)
      writeFileSync(IOT_PATH, iotOriginal)
      // Confirm the restore actually took — a `finally` that fires but reverts the FS write behind an
      // already-loaded page (or a Vite dev-server cache) wrong would leave the repo clean but the
      // NEXT test running against a stale served module; this is the check that it does not.
      await gotoHmi(page, "AOI-01")
      await expect(page.getByRole("img", { name: /AOI \/ AVI CELL/ })).toBeVisible()
    }
  })
})
