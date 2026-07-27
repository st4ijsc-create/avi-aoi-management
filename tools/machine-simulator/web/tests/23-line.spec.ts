import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoLineControl } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * GĐ3 sub-4 LC-4 (`.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/
 * task-4-brief.md`) — `/line` (`routes/LineControl.tsx`), the operator UI over LC-3's supervisory
 * PackML state machine (`LineController`). Runs against the shared demo engine
 * (`ST4I_DEMO_ENABLED=true`). `LineController`'s own commanded state is a SEPARATE piece of process
 * state from `FleetHost`'s running/stopped flag — nothing before this file in the numbered suite ever
 * calls `POST /v1/line/{command}`, so the state badge deterministically still reads `Stopped`
 * (`LineController`'s own doc comment: "Initial commanded state is `PackMlState.Stopped`") regardless
 * of what order this file runs in relative to the fleet-level specs.
 *
 * Kept intentionally minimal per the brief ("Playwright best-effort... keep it minimal and
 * deterministic") — asserts the state badge renders with the deterministic `Stopped` state, that
 * `Start` (legal from Idle/Stopped) is enabled while `Hold`/`Unhold`/`Stop` (illegal from Stopped) are
 * disabled, that the always-enabled `Abort` emergency action is enabled, and the usual English-gloss
 * no-leaked-key check every other screen's own spec ends on.
 */

test.describe("line — PackML state badge + transition-gated command buttons", () => {
  test("the state badge shows Stopped and only the commands legal from Stopped are enabled", async ({ page }) => {
    await gotoLineControl(page)

    // The deterministic initial commanded state — see this file's own doc comment.
    await expect(page.getByText(viDict.line.state.Stopped, { exact: true })).toBeVisible({ timeout: 15_000 })

    // Matched by each button's own `aria-label` (`line.commands.*Aria`), not its short visible text —
    // TopBar's Fleet-level Stop button renders the SAME bare "Dừng" text as this page's own Line Stop
    // command, so a plain `getByRole("button", { name: "Dừng" })` would be ambiguous. `exact: true` is
    // also required here: Playwright's default name match is a case-insensitive SUBSTRING, and
    // "Dừng dây chuyền" (Stop) is itself a substring of "Tạm dừng dây chuyền" (Hold) — the same
    // "exact: true" discipline `20-assets.spec.ts`'s own URN-label assertion documents needing for an
    // analogous substring collision. See `LineControl.tsx`'s own `aria-label` comment for why the
    // buttons carry these fuller accessible names in the first place.
    // Legal from {Idle, Stopped} — enabled.
    await expect(page.getByRole("button", { name: viDict.line.commands.startAria, exact: true })).toBeEnabled()
    // Legal only from {Stopped, Aborted} — Reset is enabled from Stopped too.
    await expect(page.getByRole("button", { name: viDict.line.commands.resetAria, exact: true })).toBeEnabled()
    // Legal only from Execute — illegal from Stopped, disabled.
    await expect(page.getByRole("button", { name: viDict.line.commands.holdAria, exact: true })).toBeDisabled()
    // Legal only from Held — illegal from Stopped, disabled.
    await expect(page.getByRole("button", { name: viDict.line.commands.unholdAria, exact: true })).toBeDisabled()
    // Legal from {Execute, Held} — illegal from Stopped, disabled.
    await expect(page.getByRole("button", { name: viDict.line.commands.stopAria, exact: true })).toBeDisabled()
    // The always-enabled emergency action — brief: never greyed out.
    await expect(page.getByRole("button", { name: viDict.line.commands.abortAria, exact: true })).toBeEnabled()

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/line")
    await expect(page.getByRole("heading", { name: en.line.title, level: 1 })).toBeVisible()
    await expect(page.getByText(en.line.state.Stopped, { exact: true })).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/line\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
