import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoOnboarding } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Onboarding happy path (Demo mode — the default, no live ST4I server needed): the full
 * Register → Approval → Claim → Done step flow, plus the independent "paste an existing mk_ key"
 * card. Every step below is a REAL `POST /v1/onboarding/*` call against `OnboardingService`'s demo
 * branch (fabricated results, but a real HTTP round trip) — nothing here is mocked.
 */
test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test.describe("onboarding — register → approve → claim → done", () => {
  test("completes the wizard in demo mode and reveals/copies the fabricated mk_ key", async ({ page }) => {
    await gotoOnboarding(page)

    // Unique per run so this test is safe to re-run without depending on any server-side dedup
    // (Demo mode is stateless per call anyway — this is just defensive hygiene).
    const serial = `SIM-E2E-${Date.now()}`

    // Step 0 — Register. Demo/Live toggle already defaults to Demo. Scoped to this screen's own
    // radiogroup (`aria-label`) — the TopBar's transport-mode segmented control is ALSO a
    // role="radiogroup" with its own "Demo" option, elsewhere on the same page.
    const demoLiveToggle = page.getByLabel(viDict.onboarding.demoLiveToggle.aria)
    await expect(demoLiveToggle.getByRole("radio", { name: "Demo", checked: true })).toBeVisible()
    await page.getByLabel(viDict.onboarding.register.serialLabel).fill(serial)
    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()

    // Step 1 — Approval (demo: instantly approvable on the first check). `exact: true` — the
    // paragraph above it ("Đang chờ quản trị viên duyệt…") contains this same word as a substring;
    // this targets the status badge specifically.
    await expect(page.getByText(viDict.onboarding.poll.pending, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: viDict.onboarding.poll.check }).click()

    // Step 2 — Claim (default sub-tab; demo ignores the token entirely).
    await expect(page.getByRole("tab", { name: viDict.onboarding.claim.tabClaim })).toBeVisible()
    await page.getByRole("button", { name: viDict.onboarding.claim.claimBtn }).click()

    // Step 3 — Done: a real mk_ key was fabricated and stored (DPAPI, engine-side) for this serial.
    // `exact: true` — the toast fired by this same success handler carries near-identical text
    // (same sentence plus a trailing period), which a substring match would also pick up.
    await expect(page.getByText(viDict.onboarding.done.savedFor({ code: serial }), { exact: true })).toBeVisible()
    const keyField = page.getByLabel("mk_ key")
    await expect(keyField).not.toHaveValue("")

    await page.getByRole("button", { name: viDict.onboarding.done.reveal }).click()
    await expect(keyField).toHaveValue(/^mk_[0-9a-f]{48}$/)

    await page.getByRole("button", { name: viDict.onboarding.done.copy }).click()
    await expect(page.getByText(viDict.toast.keyCopied)).toBeVisible()
    await expect(page.getByText(viDict.onboarding.done.copied)).toBeVisible()

    // Activity log accumulated one entry per step above (register, poll, claim) — each a direct
    // child <div> of the role="log" region; the empty state renders a <p> instead, so this count is
    // 0 until real entries exist.
    await expect.poll(() => page.getByRole("log").locator("> div").count()).toBeGreaterThanOrEqual(3)

    await assertNoSeriousA11yViolations(page)

    // "Register another" returns to a fresh step 0.
    await page.getByRole("button", { name: viDict.onboarding.done.registerAnother }).click()
    await expect(page.getByLabel(viDict.onboarding.register.serialLabel)).toBeVisible()
  })

  test("paste-an-existing-key card stores a key independently of the stepper", async ({ page }) => {
    await gotoOnboarding(page)

    const code = `SIM-PASTE-${Date.now()}`
    await page.getByLabel(viDict.onboarding.pasteCard.codeLabel).fill(code)
    await page.getByLabel(viDict.onboarding.pasteCard.keyLabel).fill("mk_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead")
    await page.getByRole("button", { name: viDict.onboarding.pasteCard.save }).click()

    // `exact: true` — the toast below ("Đã lưu khóa cho …") contains this same word as a substring.
    await expect(page.getByText(viDict.onboarding.pasteCard.saved, { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.toast.onboardingKeyStored({ code }))).toBeVisible()
  })
})
