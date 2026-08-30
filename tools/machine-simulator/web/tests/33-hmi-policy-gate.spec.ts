import { expect, test } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { gotoHmi } from "./support/screens"
import { assertScreenFixturesClean } from "./support/screenFixtures"

/**
 * WS-HMI-1 whole-branch review, finding M1 — `runtime-tests/widgetRegistry.test.mjs` pins §5's write
 * gate (`policyGate`, `widgets/shared.ts`) three ways, and all three stop at source text: it runs
 * `policyGate` for real, then asserts `command-button.tsx`/`setpoint-input.tsx` *contain the strings*
 * `"policyGate("`, `"gate.disabled"`, `"gate.reason"`. That file's own header says plainly (`:40-43`)
 * that whether the real DOM attribute is set, whether the reason text actually renders, and whether
 * `aria-describedby` actually points at it is "Playwright của Task 4/5" — and neither task's spec files
 * render either widget kind (`grep -rn "setpoint-input\|command-button\|policyAction" web/tests/` was
 * zero hits before this file). The deferral was written and never collected.
 *
 * This is that DOM proof. Technique reused verbatim from `tests/32-hmi-screen-wiring.spec.ts` (the
 * coordinator's own instruction): mutate a REAL shipped screen document on disk to add a fixture widget,
 * navigate a real browser, assert on the rendered DOM, restore in `finally`. Neither `setpoint-input` nor
 * `command-button` appears in any shipped document (`web/screens/*.json` — `faceplate` is the only kind
 * any of them use), so this file is what puts one on screen for the first time in this suite.
 *
 * Four fixture widgets, covering both kinds × both `policyAction` states — the schema REQUIRES
 * `policyAction` whenever `kind` is one of these two, but `ScreenRenderer`/the widgets themselves must
 * not assume every document that reaches them validated (plan §5-bis) — that is exactly the case
 * `policyGate` exists for, and exactly the case the two "blocked" fixtures below construct: a
 * schema-invalid document (missing the required field) reaching the live renderer anyway.
 *
 * 🔴 This spec does NOT re-prove `policyGate`'s own return value (that's
 * `widgetRegistry.test.mjs`, executed directly, real function, real assertions) or PolicyEngine/role/
 * HALT on the server (`.claude/skills/st4i-machine-edition/SKILL.md` §3 — out of a client-only branch's
 * reach entirely). It proves the ONE link nothing else in this repository proves: that `gate.disabled`
 * and `gate.reason` — once computed correctly — actually reach the rendered `<button>`/`<input>` and the
 * page a screen reader or a sighted operator actually sees.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SCREENS_DIR = join(HERE, "..", "screens")
const AUTOMATION_PATH = join(SCREENS_DIR, "automation-overview.json")

const PROBE_WIDGETS = [
  {
    id: "probe-cmd-blocked",
    kind: "command-button",
    rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    props: { label: "Probe Cmd Blocked", labelEn: "PROBE CMD BLOCKED" },
    // policyAction deliberately absent — the schema-invalid case this test exists for.
  },
  {
    id: "probe-cmd-allowed",
    kind: "command-button",
    rect: { col: 2, row: 0, colSpan: 2, rowSpan: 1 },
    props: { label: "Probe Cmd Allowed", labelEn: "PROBE CMD ALLOWED" },
    policyAction: "machine.command",
  },
  {
    id: "probe-setpoint-blocked",
    kind: "setpoint-input",
    rect: { col: 4, row: 0, colSpan: 2, rowSpan: 1 },
    props: { label: "Probe SP Blocked", labelEn: "PROBE SP BLOCKED" },
  },
  {
    id: "probe-setpoint-allowed",
    kind: "setpoint-input",
    rect: { col: 6, row: 0, colSpan: 2, rowSpan: 1 },
    props: { label: "Probe SP Allowed", labelEn: "PROBE SP ALLOWED" },
    policyAction: "machine.setpoint",
  },
]

test.describe("HMI §5 write gate — the DOM proof widgetRegistry.test.mjs deferred and never collected", () => {
  // final-fix-re-review.md N2 — refuses to run (loudly) rather than silently overwrite a dirty fixture.
  // See `support/screenFixtures.ts`'s own doc comment.
  test.beforeAll(() => {
    assertScreenFixturesClean(AUTOMATION_PATH)
  })

  test("command-button/setpoint-input without policyAction render disabled WITH a visible reason; with policyAction, enabled and reason-free", async ({ page }) => {
    const original = readFileSync(AUTOMATION_PATH, "utf8")
    const doc = JSON.parse(original)
    doc.widgets = [...doc.widgets, ...PROBE_WIDGETS]

    try {
      writeFileSync(AUTOMATION_PATH, JSON.stringify(doc, null, 2))
      await gotoHmi(page, "SCRW-01")

      // ── command-button, policyAction ABSENT ──────────────────────────────────────────────────
      const cmdBlocked = page.locator('[data-hmi-widget="probe-cmd-blocked"]')
      const cmdBlockedButton = cmdBlocked.getByRole("button", { name: /Probe Cmd Blocked/ })
      await expect(cmdBlockedButton).toBeVisible()
      await expect(cmdBlockedButton).toBeDisabled()
      const cmdBlockedReason = cmdBlocked.getByRole("note")
      await expect(cmdBlockedReason).toBeVisible()
      await expect(cmdBlockedReason).not.toBeEmpty()

      // ── command-button, policyAction PRESENT (counter-example, same fixture pass) ───────────
      const cmdAllowed = page.locator('[data-hmi-widget="probe-cmd-allowed"]')
      const cmdAllowedButton = cmdAllowed.getByRole("button", { name: /Probe Cmd Allowed/ })
      await expect(cmdAllowedButton).toBeVisible()
      await expect(cmdAllowedButton).toBeEnabled()
      await expect(cmdAllowed.getByRole("note")).toHaveCount(0)

      // ── setpoint-input, policyAction ABSENT ──────────────────────────────────────────────────
      const spBlocked = page.locator('[data-hmi-widget="probe-setpoint-blocked"]')
      const spBlockedInput = spBlocked.locator("input")
      await expect(spBlockedInput).toBeVisible()
      await expect(spBlockedInput).toBeDisabled()
      const spBlockedReason = spBlocked.getByRole("note")
      await expect(spBlockedReason).toBeVisible()
      await expect(spBlockedReason).not.toBeEmpty()
      // `setpoint-input.tsx`'s own doc comment claims the reason is `aria-describedby`-linked, not just
      // co-located — assert the actual attribute link, not just that both elements happen to exist.
      const describedBy = await spBlockedInput.getAttribute("aria-describedby")
      const reasonId = await spBlockedReason.getAttribute("id")
      expect(describedBy).toBe(reasonId)
      expect(describedBy).not.toBeNull()

      // ── setpoint-input, policyAction PRESENT (counter-example) ───────────────────────────────
      const spAllowed = page.locator('[data-hmi-widget="probe-setpoint-allowed"]')
      const spAllowedInput = spAllowed.locator("input")
      await expect(spAllowedInput).toBeVisible()
      await expect(spAllowedInput).toBeEnabled()
      await expect(spAllowedInput).not.toHaveAttribute("aria-describedby")
      await expect(spAllowed.getByRole("note")).toHaveCount(0)
    } finally {
      writeFileSync(AUTOMATION_PATH, original)
      await gotoHmi(page, "SCRW-01")
      await expect(page.locator('[data-hmi-widget="probe-cmd-blocked"]')).toHaveCount(0)
    }
  })
})
