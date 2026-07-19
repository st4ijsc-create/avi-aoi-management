import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoOnboarding } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Onboarding happy path (Demo mode — the default, no live ST4I server needed): the full
 * Register → Approval (real pending moment → explicit "approve" action) → Claim → Done step flow,
 * plus the independent "paste an existing mk_ key" card. Every step below is a REAL
 * `POST /v1/onboarding/*` call against `OnboardingService`'s demo branch (fabricated results, but a
 * real HTTP round trip) — nothing here is mocked.
 *
 * W1: Claim/Enroll now also join the newly-onboarded machine into the live simulated fleet
 * (`OnboardingFleetJoin`, E2) — this spec follows through on that all the way to `/machines/:code`
 * actually finding it, not just trusting the activity-log message that says so.
 */
test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test.describe("onboarding — register → approve → claim → done → joins the fleet", () => {
  test("completes the wizard in demo mode, joins the live fleet, and reveals/copies the fabricated mk_ key", async ({
    page,
  }) => {
    await gotoOnboarding(page)

    // Unique per run so this test is safe to re-run without depending on any server-side dedup
    // (Demo mode is stateless per call anyway — this is just defensive hygiene).
    const serial = `SIM-E2E-${Date.now()}`

    // Mode indicator (persistent across all 4 steps, not just Register) starts on Demo. Asserted via
    // its long, unique detail sentence — not the bare "Demo"/"Live" label text, which also appears
    // verbatim on the TopBar's own transport-mode radiogroup and the segmented toggle just below this
    // (three legitimate, unrelated matches for the same two words on this one screen).
    await expect(page.getByText(viDict.onboarding.modeHint.demo)).toBeVisible()

    // Step 0 — Register. Demo/Live toggle already defaults to Demo. Scoped to this screen's own
    // radiogroup (`aria-label`) — the TopBar's transport-mode segmented control is ALSO a
    // role="radiogroup" with its own "Demo" option, elsewhere on the same page.
    const demoLiveToggle = page.getByLabel(viDict.onboarding.demoLiveToggle.aria)
    await expect(demoLiveToggle.getByRole("radio", { name: viDict.onboarding.demoLiveToggle.demo, checked: true })).toBeVisible()

    // Default machine name is the VI-localized default (not the old hardcoded "Trạm vít demo" — it
    // just happens to be the same string in this dictionary; the language-switch test below proves
    // it actually tracks `t()`, not a lucky coincidence).
    await expect(page.getByLabel(viDict.onboarding.register.nameLabel)).toHaveValue(viDict.onboarding.register.defaultName)

    // Machine type is now a DROPDOWN, not free text (live-confirmed bug fix: the real ST4I server
    // rejects `POST /api/machine/register` with HTTP 400 unless machineType is EXACTLY one of its
    // enum values). Trigger is labelled via FormField's htmlFor/id, same association already proven
    // by Settings' language Select (`05-settings.spec.ts`) — defaults to a real, exact-cased value
    // ("AOI"), never the old "Automation" free text a case-sensitive Live server would 400 on. Opening
    // it here proves the popup genuinely renders grouped, exact-enum options.
    const typeSelect = page.getByLabel(viDict.onboarding.register.typeLabel)
    await expect(typeSelect).toContainText(viDict.onboarding.register.machineTypes.AOI)
    await typeSelect.click()
    await expect(page.getByText(viDict.onboarding.register.typeGroups.iot, { exact: true })).toBeVisible()
    await expect(page.getByRole("option", { name: viDict.onboarding.register.machineTypes.IOT_SENSOR })).toBeVisible()
    // Re-picking the already-selected option closes the popup without changing this run's type — the
    // dedicated IOT_SENSOR run below is the one that actually switches types.
    await page.getByRole("option", { name: viDict.onboarding.register.machineTypes.AOI }).click()

    await page.getByLabel(viDict.onboarding.register.serialLabel).fill(serial)
    // The value the browser actually POSTs — not just what the trigger displays — is the one thing a
    // free-text field could get subtly wrong. Captured before the click so the request is in flight by
    // the time this promise is awaited.
    const registerRequest = page.waitForRequest((req) => req.url().includes("/v1/onboarding/register") && req.method() === "POST")
    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()
    expect(JSON.parse((await registerRequest).postData() ?? "{}")).toMatchObject({ machineType: "AOI" })

    // Step 1 — Approval: a real pending moment (headline + "Pending" badge), not a silent jump.
    // `exact: true` on the badge — the description paragraph nearby contains the same word.
    await expect(page.getByText(viDict.onboarding.poll.pendingTitle)).toBeVisible()
    await expect(page.getByText(viDict.onboarding.poll.pending, { exact: true })).toBeVisible()
    // Demo's honest label — the presenter IS the simulated admin, the button says so.
    const approveButton = page.getByRole("button", { name: viDict.onboarding.poll.approveBtn })
    await expect(approveButton).toBeVisible()
    // Live-only guidance callout must NOT show while in Demo.
    await expect(page.getByText(viDict.onboarding.poll.liveInstruction)).toHaveCount(0)
    await approveButton.click()

    // Step 2 — Claim (default sub-tab; demo ignores the token entirely). Description now says the
    // machine is retrieving its configuration, not just "approved".
    await expect(page.getByText(viDict.onboarding.claim.description)).toBeVisible()
    await expect(page.getByRole("tab", { name: viDict.onboarding.claim.tabClaim })).toBeVisible()
    await page.getByRole("button", { name: viDict.onboarding.claim.claimBtn }).click()

    // Step 3 — Done: a real mk_ key was fabricated and stored (DPAPI, engine-side) for this serial,
    // AND the machine actually joined the simulated fleet (W1's headline fix — functional-audit.md
    // #2: the wizard used to promise this and not deliver). `exact: true` — the toast fired by this
    // same success handler carries near-identical text (same sentence plus a trailing period), which
    // a substring match would also pick up.
    await expect(page.getByText(viDict.onboarding.done.savedFor({ code: serial }), { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.onboarding.done.joinedFleet({ code: serial }))).toBeVisible()
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

    // "Xem máy vừa thêm" (View new machine) — jumps straight to the just-joined machine's own
    // detail page and proves the fleet-join is real, not just a log line. Asserted the same way
    // `02-machine-detail.spec.ts`'s "unknown machine code" test tells found from not-found: an <h1>
    // matching the machine CODE only ever renders once the machine is genuinely in the roster — the
    // not-found card's heading is a fixed i18n string instead (see `gotoMachineDetail`'s doc comment)
    // — so this fails loudly if the join didn't happen. Not using `gotoMachineDetail` itself here: it
    // does a fresh `page.goto`, which would only prove the ROUTE works, not that the wizard's own
    // button click (client-side navigation) actually lands there.
    await page.getByRole("button", { name: viDict.onboarding.done.viewMachine }).click()
    await expect(page.getByRole("heading", { name: serial, level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(viDict.machineDetail.notFoundState.title)).toHaveCount(0)

    // `OnboardingFleetJoin.Profiles["AOI"]` maps to `DeviceClass.AoiAvi` — the joined machine's own
    // detail page shows that resolved class, concrete proof the exact enum picked in the dropdown
    // drove which simulator this machine actually got (not a generic fallback).
    await expect(page.getByText(`${viDict.deviceClass.AoiAvi} · ${viDict.driverKind.Simulated}`)).toBeVisible()

    // Starting the fleet (the wizard's own click already requests a start) makes the newly-joined
    // machine cycle for real, not just sit idle in the roster. Same located-by-label-then-sibling
    // technique as `02-machine-detail.spec.ts`'s IoT pass-rate assertion — "Chu kỳ" (Cycles) is also
    // this screen's OWN header stat label (`HeaderStat`, a `<span>`, not a `<p>`), so scoping to
    // `p.text-xs.text-text-muted` is what keeps this pinned to the Overview tile specifically.
    const cyclesValue = page
      .locator("p.text-xs.text-text-muted", { hasText: viDict.machineDetail.overview.cycles })
      .locator("xpath=following-sibling::p[1]")
    await expect.poll(async () => Number(await cyclesValue.textContent()), { timeout: 20_000 }).toBeGreaterThan(0)
  })

  /** Second concrete run of the dropdown — this time switching AWAY from the AOI default — proves the
   * Select genuinely drives what gets sent (not just that the default happens to already be valid),
   * and exercises the OTHER end of `OnboardingFleetJoin.Profiles`: an IOT_SENSOR machine resolves to
   * `DeviceClass.Iot` (a different simulator family than AOI's `AoiAvi`), not a generic fallback. */
  test("registering as IOT_SENSOR through the dropdown sends the exact enum and joins the fleet as IoT", async ({ page }) => {
    await gotoOnboarding(page)
    const serial = `SIM-E2E-IOT-${Date.now()}`

    await page.getByLabel(viDict.onboarding.register.serialLabel).fill(serial)

    const typeSelect = page.getByLabel(viDict.onboarding.register.typeLabel)
    await typeSelect.click()
    await page.getByRole("option", { name: viDict.onboarding.register.machineTypes.IOT_SENSOR }).click()
    await expect(typeSelect).toContainText(viDict.onboarding.register.machineTypes.IOT_SENSOR)

    const registerRequest = page.waitForRequest((req) => req.url().includes("/v1/onboarding/register") && req.method() === "POST")
    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()
    expect(JSON.parse((await registerRequest).postData() ?? "{}")).toMatchObject({ machineType: "IOT_SENSOR" })

    await page.getByRole("button", { name: viDict.onboarding.poll.approveBtn }).click()

    const claimRequest = page.waitForRequest((req) => req.url().includes("/v1/onboarding/claim") && req.method() === "POST")
    await page.getByRole("button", { name: viDict.onboarding.claim.claimBtn }).click()
    expect(JSON.parse((await claimRequest).postData() ?? "{}")).toMatchObject({ machineType: "IOT_SENSOR" })

    await expect(page.getByText(viDict.onboarding.done.joinedFleet({ code: serial }))).toBeVisible()

    await page.getByRole("button", { name: viDict.onboarding.done.viewMachine }).click()
    await expect(page.getByRole("heading", { name: serial, level: 1 })).toBeVisible({ timeout: 15_000 })

    // `OnboardingFleetJoin.Profiles["IOT_SENSOR"]` maps to `DeviceClass.Iot` — concrete, observable
    // proof a non-default type resolved to the right simulator instead of silently falling back to a
    // generic Automation profile.
    await expect(page.getByText(`${viDict.deviceClass.Iot} · ${viDict.driverKind.Simulated}`)).toBeVisible()

    const cyclesValue = page
      .locator("p.text-xs.text-text-muted", { hasText: viDict.machineDetail.overview.cycles })
      .locator("xpath=following-sibling::p[1]")
    await expect.poll(async () => Number(await cyclesValue.textContent()), { timeout: 20_000 }).toBeGreaterThan(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("'register another machine' resets the wizard to a fresh step 0", async ({ page }) => {
    await gotoOnboarding(page)
    const serial = `SIM-E2E-RESET-${Date.now()}`

    const nameField = page.getByLabel(viDict.onboarding.register.nameLabel)
    const typeSelect = page.getByLabel(viDict.onboarding.register.typeLabel)
    await page.getByLabel(viDict.onboarding.register.serialLabel).fill(serial)
    await nameField.fill("Custom name for this run")

    // Switch machine type away from the default before completing this run, so the reset assertion
    // below actually proves `handleReset` restores DEFAULT_MACHINE_TYPE — not just that it was never
    // touched in the first place.
    await typeSelect.click()
    await page.getByRole("option", { name: viDict.onboarding.register.machineTypes.WELDER }).click()
    await expect(typeSelect).toContainText(viDict.onboarding.register.machineTypes.WELDER)

    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()
    await page.getByRole("button", { name: viDict.onboarding.poll.approveBtn }).click()
    await page.getByRole("button", { name: viDict.onboarding.claim.claimBtn }).click()
    await expect(page.getByText(viDict.onboarding.done.savedFor({ code: serial }), { exact: true })).toBeVisible()

    await page.getByRole("button", { name: viDict.onboarding.done.registerAnother }).click()
    const serialField = page.getByLabel(viDict.onboarding.register.serialLabel)
    await expect(serialField).toBeVisible()
    // Back at step 1 of 4, not stuck mid-flow or still showing the previous machine's key.
    await expect(page.getByRole("button", { name: viDict.onboarding.register.submit })).toBeVisible()
    await expect(page.getByText(viDict.onboarding.done.savedFor({ code: serial }))).toHaveCount(0)

    // Completion-review #5: serial/name/machineType/nameTouched are cleared on reset — re-running
    // "as is" used to re-submit the SAME serial (RegisterMachine's dup-check turns that into a silent
    // "already in the fleet" no-op join) and kept the PREVIOUS custom name pinned regardless of a later
    // language switch. Empty serial also means the submit button starts disabled again. machineType
    // resets to DEFAULT_MACHINE_TYPE (AOI) too — not left on whatever the previous run picked (WELDER).
    await expect(serialField).toHaveValue("")
    await expect(nameField).toHaveValue(viDict.onboarding.register.defaultName)
    await expect(typeSelect).toContainText(viDict.onboarding.register.machineTypes.AOI)
    await expect(page.getByRole("button", { name: viDict.onboarding.register.submit })).toBeDisabled()
  })

  test("register step default machine name tracks the UI language, and the mode indicator explains Demo vs Live", async ({
    page,
  }) => {
    // English, primed via localStorage before first paint — same technique as
    // `00-visual-and-a11y.spec.ts` (see `tests/support/theme.ts`), not a live click through Settings'
    // language selector (that flow is already covered by `05-settings.spec.ts`); this spec is about
    // the ONBOARDING wizard's own strings tracking whichever language is active. Not `gotoOnboarding`
    // — that helper's own ready-check waits on the VI heading text, which never renders once the
    // language is primed to English before first paint.
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/onboarding")
    await expect(page.getByRole("heading", { name: en.onboarding.title, level: 1 })).toBeVisible()
    await expect(page.getByText(en.shell.topBar.engineConnected)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(en.onboarding.register.serialLabel)).toBeVisible()

    await expect(page.getByLabel(en.onboarding.register.nameLabel)).toHaveValue(en.onboarding.register.defaultName)
    // The VI default text must NOT leak through regardless of language (functional-audit.md #4).
    await expect(page.getByLabel(en.onboarding.register.nameLabel)).not.toHaveValue(viDict.onboarding.register.defaultName)
    await expect(page.getByText(en.onboarding.modeHint.demo)).toBeVisible()

    // No raw i18n keys anywhere on the pristine step-0 screen (a leftover `t()` typo renders the raw
    // dot-path string, e.g. "onboarding.register.submit" — this regex is deliberately generic so it
    // would catch a typo in ANY key on this screen, not just the ones asserted by name above).
    await expect(page.getByText(/onboarding\.[a-zA-Z.]+/)).toHaveCount(0)

    // Machine type dropdown labels track the language too — the trigger already shows AOI's English
    // label (not the VI text, not a raw i18n key); opening the popup and checking one option's exact
    // English label (vs. its VI counterpart being absent) proves the OTHER 23 options translate the
    // same way, not just the one already-selected default.
    await expect(page.getByLabel(en.onboarding.register.typeLabel)).toContainText(en.onboarding.register.machineTypes.AOI)
    await page.getByLabel(en.onboarding.register.typeLabel).click()
    await expect(page.getByRole("option", { name: en.onboarding.register.machineTypes.IOT_SENSOR })).toBeVisible()
    await expect(page.getByRole("option", { name: viDict.onboarding.register.machineTypes.IOT_SENSOR })).toHaveCount(0)
    await page.keyboard.press("Escape")

    // Switching to Live surfaces the server-URL field and swaps the mode indicator's message — the
    // visible "this is the real integration" signal the brief asked for. The indicator's new text
    // depends on whatever `serverUrl` Settings happens to have saved in this environment (prefilled
    // automatically — see `Onboarding.tsx`'s settings-prefill effect), so this asserts the Demo
    // sentence is GONE rather than pinning an exact Live sentence this suite doesn't control.
    await page.getByLabel(en.onboarding.demoLiveToggle.aria).getByRole("radio", { name: en.onboarding.demoLiveToggle.live }).click()
    await expect(page.getByLabel(en.onboarding.register.serverUrlLabel)).toBeVisible()
    await expect(page.getByText(en.onboarding.modeHint.demo)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("live mode: a failed register call surfaces a friendly error, not a crash, and claim POSTs the pasted token + name + type", async ({
    page,
  }) => {
    await gotoOnboarding(page)
    const serial = `SIM-LIVE-${Date.now()}`

    await page.getByLabel(viDict.onboarding.demoLiveToggle.aria).getByRole("radio", { name: viDict.onboarding.demoLiveToggle.live }).click()
    await page.getByLabel(viDict.onboarding.register.serverUrlLabel).fill("http://127.0.0.1:59999")
    await page.getByLabel(viDict.onboarding.register.serialLabel).fill(serial)

    // Explicitly pick AUTOMATION (uppercase, the real server's exact enum) — proves the fix directly:
    // the OLD free-text field's default was "Automation" (mixed case), which a case-sensitive Live
    // server would 400 on. This run's claim payload (asserted below) carries the exact enum string.
    await page.getByLabel(viDict.onboarding.register.typeLabel).click()
    await page.getByRole("option", { name: viDict.onboarding.register.machineTypes.AUTOMATION }).click()

    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()

    // The real engine tried a real TCP connect to an unreachable port and caught the exception —
    // this round-trips through `OnboardingService.LiveRegisterAsync`'s own catch block, not a mock.
    // Friendly (readable, explains what happened) and non-fatal: the wizard stays on step 0, no
    // uncaught exception, no blank screen.
    await expect(page.getByText(/Register failed/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel(viDict.onboarding.register.serialLabel)).toBeVisible()

    // The rest of this test is about the SHAPE of what the wizard sends, not about reaching a real
    // server (there isn't one in this suite) — register/poll are now intercepted so the wizard can
    // progress to Claim, where the one contractually load-bearing request (E2 added `name`/
    // `machineType` to `OnboardingClaimRequest`; e2-report.md §3 flagged the web wizard as the one
    // place still not sending them) is captured and asserted directly, not inferred from the UI.
    await page.route("**/v1/onboarding/register", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ step: "Pending", machineCode: null, mkKey: null, isApproved: false, message: `Registered ${serial} — registrationStatus=pending` }),
      })
    })
    await page.route("**/v1/onboarding/poll", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ step: "Approved", machineCode: null, mkKey: null, isApproved: true, message: "Poll approval: approved (requiresClaim=true)" }),
      })
    })
    const claimRequest = page.waitForRequest((req) => req.url().includes("/v1/onboarding/claim") && req.method() === "POST")
    await page.route("**/v1/onboarding/claim", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          step: "Claimed",
          machineCode: serial,
          mkKey: `mk_${"a".repeat(48)}`,
          isApproved: false,
          message: `Claimed — mk_ key stored for ${serial}`,
        }),
      })
    })

    // Re-submit Register now that it (and Poll) are intercepted — advances past the pending moment
    // to Claim without depending on a real reachable server, which this suite doesn't have.
    await page.getByRole("button", { name: viDict.onboarding.register.submit }).click()
    await expect(page.getByText(viDict.onboarding.poll.liveInstruction)).toBeVisible()
    await page.getByRole("button", { name: viDict.onboarding.poll.liveCheckBtn }).click()

    await expect(page.getByLabel(viDict.onboarding.claim.claimTokenLabel)).toBeVisible()
    await expect(page.getByText(viDict.onboarding.claim.claimTokenHintLive)).toBeVisible()
    await page.getByLabel(viDict.onboarding.claim.claimTokenLabel).fill("mct_pasted_from_console")
    await page.getByRole("button", { name: viDict.onboarding.claim.claimBtn, exact: true }).click()

    const body = JSON.parse((await claimRequest).postData() ?? "{}")
    expect(body).toMatchObject({
      serialNumber: serial,
      claimToken: "mct_pasted_from_console",
      isDemo: false,
      serverUrl: "http://127.0.0.1:59999",
      name: viDict.onboarding.register.defaultName,
      // Exact server enum casing ("AUTOMATION"), not the OLD free-text default ("Automation") that a
      // case-sensitive Live server would reject with HTTP 400 — the bug this whole fix addresses.
      machineType: "AUTOMATION",
    })

    await expect(page.getByText(viDict.onboarding.done.savedFor({ code: serial }), { exact: true })).toBeVisible()
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
