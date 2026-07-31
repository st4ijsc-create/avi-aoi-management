import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoAlarmCenter, gotoHmi, gotoNotifications } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * 🔴 Task C-8 (`.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-8-brief.md`) —
 * `/notifications`, the screen Đợt C's four channels never had, plus the Operator-tier beacon panel on
 * `/alarms`.
 *
 * ## What is real here, what is stubbed, and why the split is where it is
 *
 * The screen renders against the REAL engine — a real `GET /v1/notifications/channels`, a real
 * `/status`, a real `/annunciator`, through the real cookie session. What is stubbed, and only where
 * necessary:
 *
 *  - **The role difference.** `playwright.config.ts` boots the engine with `ST4I_DEMO_ENABLED`, and
 *    `DemoAutoLoginMiddleware` signs every request in as a demo **Admin**. There is no supported way for
 *    this harness to become an Engineer, so `17-auth.spec.ts`'s own header records that role branches
 *    belong at the C# level. That is true of ENFORCEMENT — and `RbacPolicyTests` proves the relay routes
 *    are Admin, in both directions, against the real pipeline. It is NOT true of the UI's own rendering
 *    decision, which no C# test can see: whether an Engineer is shown the relay configuration with an
 *    explanatory sentence in place of the Save control, or is shown nothing at all. That is this file's
 *    job, and it is done by stubbing `GET /v1/auth/me` — the single request the UI's role gate reads.
 *  - **The beacon states.** A relay instance believed ON with nothing latched, and one in the UNKNOWN
 *    state, are exactly the two renderings this batch cares most about, and neither can be produced from
 *    a Playwright run: the first needs a real machine write to be REFUSED by the HALT latch, the second
 *    needs a relay configured against a real device. So `/v1/notifications/annunciator` is stubbed for
 *    those two tests. The server-side rendering of the same three states is asserted directly against
 *    `NotificationEndpoints.DescribeAnnunciator` in the C# suite; what is asserted here is the half that
 *    lives in the browser — that the badge derived from the raw `energised` field never says "off" for
 *    `null`.
 *
 * Nothing in this file writes a notification configuration to the shared engine: a saved webhook or SMTP
 * row would outlive the test and change what every later spec's engine looks like. The save PATH is
 * proven by stubbing the PUT and asserting the request body, which is also the only way to assert the
 * thing that actually matters — see the credential tests below.
 */

/** Replaces the signed-in user's role. `lib/auth.ts` reads `GET /v1/auth/me` with a raw `fetch`, and it
 * is the only source of `user.role` in the app, so this is the whole of the UI's role input. */
async function signInAs(page: Page, role: "Operator" | "Engineer" | "Admin"): Promise<void> {
  await page.route("**/v1/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        username: `e2e-${role.toLowerCase()}`,
        role,
        mustChangePassword: false,
      }),
    })
  })
}

/** Stubs the Operator-tier annunciator read with a chosen set of relay instances. */
async function stubAnnunciator(
  page: Page,
  relays: Array<{
    instance: string
    latchedAlarms: number
    energised: boolean | null
    annunciatorState: string
  }>,
  overrides: Partial<{ configurationReadable: boolean; configurationDetail: string }> = {},
): Promise<void> {
  await page.route("**/v1/notifications/annunciator", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configurationReadable: overrides.configurationReadable ?? true,
        configurationDetail:
          overrides.configurationDetail ??
          "This engine can read its alarm-notification configuration.",
        localAnnunciationRunning: true,
        listeners: 1,
        maxListeners: 32,
        rejectedListeners: 0,
        relays: relays.map((r) => ({ ...r, lastAttemptUtc: new Date().toISOString() })),
        attention: [],
      }),
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────
// The screen exists, and says what the product can now do
// ─────────────────────────────────────────────────────────────────────────

test("the notifications screen renders all four channels", async ({ page }) => {
  await gotoNotifications(page)

  await expect(page.getByTestId("notification-card-webhook")).toBeVisible()
  await expect(page.getByTestId("notification-card-smtp")).toBeVisible()
  await expect(page.getByTestId("notification-card-local")).toBeVisible()
  await expect(page.getByTestId("notification-card-relay")).toBeVisible()

  // The store health is shown beside the counters rather than on a page of its own, because a failed
  // read returns exactly what "nothing is configured" returns.
  await expect(page.getByTestId("notification-store-health")).toBeVisible()
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The credential traps — the reason this form has the shape it does
// ─────────────────────────────────────────────────────────────────────────

test("a webhook cannot be saved without re-entering its URL, and the form says why", async ({ page }) => {
  await gotoNotifications(page)

  // 🔴 The URL field is empty on load and the Save control is disabled with a STATED reason. The engine
  // deliberately cannot re-read the stored URL (it is an encrypted bearer capability), so a form that
  // pre-filled it would be lying about what it is about to send.
  await expect(page.locator("#webhook-url")).toHaveValue("")
  await expect(page.getByTestId("webhook-save")).toBeDisabled()
  await expect(page.getByTestId("webhook-url-required")).toBeVisible()

  await page.locator("#webhook-url").fill("https://hooks.example.test/services/abc")
  await expect(page.getByTestId("webhook-save")).toBeEnabled()
  await expect(page.getByTestId("webhook-url-required")).toHaveCount(0)
})

test("🔴 an untouched secret field defaults to KEEP and sends no value at all", async ({ page }) => {
  await gotoNotifications(page)

  // 🔴 THE trap. `absent = keep, "" = clear, value = replace` — so a form that posts an empty string for
  // a password box the operator never touched DELETES the credential on every save. The control defaults
  // to KEEP, and KEEP must contribute no key whatsoever.
  await expect(page.getByTestId("webhook-signing-secret-mode-keep")).toHaveAttribute("aria-checked", "true")
  await expect(page.getByTestId("webhook-auth-token-mode-keep")).toHaveAttribute("aria-checked", "true")

  let body: Record<string, unknown> | null = null
  await page.route("**/v1/notifications/webhook", async (route) => {
    body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: null, configStore: { available: true, readFailures: 0, writeFailures: 0, detail: "ok" } }),
    })
  })

  await page.locator("#webhook-url").fill("https://hooks.example.test/services/abc")
  await page.locator("#webhook-auth-header").fill("X-Api-Key")
  await page.getByTestId("webhook-save").click()

  await expect.poll(() => body).not.toBeNull()
  const sent = body as unknown as Record<string, unknown>

  // 🔴 Absent, not empty-string. This is the whole assertion, and it is guarded in both directions
  // below so that a future edit which starts sending `""` fails here rather than in production.
  expect(Object.hasOwn(sent, "signingSecret")).toBe(false)
  expect(Object.hasOwn(sent, "authToken")).toBe(false)
  expect(sent.signingSecret).toBeUndefined()
  expect(sent.authToken).toBeUndefined()

  // 🔴 And `authHeaderName` IS re-sent, because omitting it clears the header name AND deletes the
  // stored token with it — the one field whose omission destroys a credential it says nothing about.
  expect(sent.authHeaderName).toBe("X-Api-Key")
})

test("🔴 choosing CLEAR sends an empty string, and says out loud that it deletes", async ({ page }) => {
  // 🔴 CLEAR is only offered when a credential is actually STORED — you cannot delete what is not there,
  // and offering the option on an empty field would make "clear" the answer to a question nobody asked.
  // So this test has to stand up a webhook that HAS a signing secret. It is stubbed rather than saved,
  // because a real save would outlive this test in the shared engine.
  await page.route("**/v1/notifications/channels", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        channels: [
          {
            channel: "Webhook",
            instance: "default",
            enabled: true,
            minPriority: "High",
            updatedAtUtc: new Date().toISOString(),
            webhook: {
              endpoint: "hooks.example.test",
              urlFingerprint: "ab12cd34",
              label: "Ops Slack",
              hasUrl: true,
              hasSigningSecret: true,
              authHeaderName: "X-Api-Key",
              hasAuthToken: true,
            },
          },
        ],
        configStore: { available: true, readFailures: 0, writeFailures: 0, detail: "ok" },
      }),
    })
  })

  await gotoNotifications(page)

  // The current destination is printed beside the (empty, mandatory) URL field so an operator can
  // confirm they are re-entering the SAME one without ever being handed it.
  await expect(page.getByTestId("webhook-current-fingerprint")).toContainText("ab12cd34")

  // The control makes "delete my credential" something an operator had to pick, and states the effect.
  await page.getByTestId("webhook-signing-secret-mode-clear").click()
  await expect(page.getByTestId("webhook-signing-secret-effect")).toContainText(
    viDict.notifications.secret.effectClear,
  )
  // Both directions: the CLEAR wording must be distinguishable from the KEEP wording, or the control
  // conveys nothing.
  expect(viDict.notifications.secret.effectClear).not.toEqual(viDict.notifications.secret.effectKeep)

  let body: Record<string, unknown> | null = null
  await page.route("**/v1/notifications/webhook", async (route) => {
    body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: null, configStore: { available: true, readFailures: 0, writeFailures: 0, detail: "ok" } }),
    })
  })

  await page.locator("#webhook-url").fill("https://hooks.example.test/services/abc")
  await page.getByTestId("webhook-save").click()

  await expect.poll(() => body).not.toBeNull()
  const sent = body as unknown as Record<string, unknown>
  expect(sent.signingSecret).toBe("")
  // The token was left on KEEP, so it must still be absent — clearing one secret must not clear another.
  expect(Object.hasOwn(sent, "authToken")).toBe(false)
})

test("the server's own error sentence reaches the operator verbatim", async ({ page }) => {
  await gotoNotifications(page)

  // 🔴 Every 400/409/429/500/503 on this surface names the real problem and what to do. Replacing any of
  // them with a generic "save failed" is how an operator ends up with a channel that posts unsigned.
  const serverSentence =
    "The webhook notification configuration was saved, but the signing secret did NOT commit."
  await page.route("**/v1/notifications/webhook", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: serverSentence }),
    })
  })

  await page.locator("#webhook-url").fill("https://hooks.example.test/services/abc")
  await page.getByTestId("webhook-save").click()

  await expect(page.getByTestId("webhook-error")).toContainText(serverSentence)
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The relay — the role difference, rendered rather than flattened
// ─────────────────────────────────────────────────────────────────────────

test("🔴 an Engineer sees the relay configuration but is told Admin is required to save it", async ({ page }) => {
  await signInAs(page, "Engineer")
  await gotoNotifications(page)

  // The card renders in full: hiding it would tell an Engineer the beacon does not exist.
  await expect(page.getByTestId("notification-card-relay")).toBeVisible()
  await expect(page.locator("#relay-machine")).toBeVisible()

  // 🔴 The actuator is SWAPPED for a sentence — not merely disabled, which would read as "broken" — and
  // the sentence names the role and the reason.
  await expect(page.getByTestId("relay-save")).toHaveCount(0)
  const note = page.getByTestId("relay-admin-required")
  await expect(note).toBeVisible()
  await expect(note).toContainText(/QUẢN TRỊ/i)

  // 🔴 Guarded in both directions: the note must not be a bare "no permission" — it must say WHY the
  // relay is the one channel at a higher tier, or the difference reads as an inconsistency.
  await expect(note).toContainText(/tự động/i)
})

test("🔴 an Admin gets the relay Save control", async ({ page }) => {
  await signInAs(page, "Admin")
  await gotoNotifications(page)

  // The control, without which the test above would also pass on a build where the relay card were
  // simply broken for everyone.
  await expect(page.getByTestId("relay-save")).toBeVisible()
  await expect(page.getByTestId("relay-admin-required")).toHaveCount(0)
})

test("🔴 the relay card states that it is not a safety device and goes dark under HALT", async ({ page }) => {
  await gotoNotifications(page)

  const warning = page.getByTestId("relay-not-safety")
  await expect(warning).toBeVisible()
  // Both halves are required. "Not a safety device" alone does not tell an operator that the beacon is
  // OFF during the one event they would most expect it to be on.
  await expect(warning).toContainText(/không phải thiết bị an toàn/i)
  await expect(warning).toContainText(/HALT/)
  await expect(warning).toContainText(/đấu cứng/i)
})

test("🔴 picking a Command relay target warns that it cannot release the beacon", async ({ page }) => {
  await gotoNotifications(page)

  // Absent until it applies — a warning that is always on screen is one nobody reads.
  await expect(page.getByTestId("relay-command-warning")).toHaveCount(0)

  await page.locator("#relay-target-kind").click()
  await page.getByRole("option", { name: viDict.notifications.relay.kind.Command }).click()

  await expect(page.getByTestId("relay-command-warning")).toBeVisible()
  // The energise/de-energise value fields belong to a Point target and must disappear, because the API
  // refuses a Command target that carries them.
  await expect(page.locator("#relay-on-value")).toHaveCount(0)
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The two channels with no send test, and the reason on screen
// ─────────────────────────────────────────────────────────────────────────

test("🔴 the relay and local annunciation state why they have no send test", async ({ page }) => {
  await gotoNotifications(page)

  // Both refusals are decisions, and a missing button with no explanation reads as an unfinished screen.
  await expect(page.getByTestId("relay-no-test")).toContainText(/đèn sáng/i)
  await expect(page.getByTestId("local-no-test")).toContainText(/giả/i)

  await expect(page.getByTestId("notification-test-Relay")).toHaveCount(0)
  await expect(page.getByTestId("notification-test-LocalAnnunciation")).toHaveCount(0)
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The beacon states — the rendering that must never say "off" for null
// ─────────────────────────────────────────────────────────────────────────

test("🔴 an UNKNOWN beacon never renders as off", async ({ page }) => {
  await stubAnnunciator(page, [
    {
      instance: "default",
      latchedAlarms: 0,
      energised: null,
      annunciatorState:
        "UNKNOWN — the last write to this annunciator returned INDETERMINATE, so nobody knows whether the coil moved. This is NOT the same as off.",
    },
  ])
  await gotoAlarmCenter(page)

  const beacon = page.getByTestId("beacon-default")
  await expect(beacon).toBeVisible()

  // 🔴 The claim, in both directions. Wider than today's exact wording (a regex on the concept), and
  // narrower than the false claim being forbidden (the word "off" as a state, not as a substring of the
  // engine's own "NOT the same as off" sentence, which is asserted separately below).
  await expect(beacon).toContainText(new RegExp(viDict.notifications.beacon.unknown, "i"))
  await expect(beacon.getByText(viDict.notifications.beacon.off, { exact: true })).toHaveCount(0)

  // And the engine's own sentence is shown verbatim beneath it — the authoritative wording, never
  // paraphrased away by a UI label.
  await expect(beacon).toContainText("NOT the same as off")
})

test("🔴 a beacon believed lit with nothing latched is shown as still lit, not as on", async ({ page }) => {
  await stubAnnunciator(page, [
    {
      instance: "default",
      latchedAlarms: 0,
      energised: true,
      annunciatorState:
        "ON, and no alarm is latched — this product asked for it to go OUT and the write did not succeed. The annunciator is still lit.",
    },
  ])
  await gotoAlarmCenter(page)

  const beacon = page.getByTestId("beacon-default")
  await expect(beacon).toContainText(new RegExp(viDict.notifications.beacon.stillLit, "i"))
  await expect(beacon).toContainText("still lit")

  // The control: this must be a DIFFERENT rendering from an ordinary lit beacon, or the distinction the
  // whole relay channel exists to surface is invisible.
  expect(viDict.notifications.beacon.stillLit).not.toEqual(viDict.notifications.beacon.on)
})

test("🔴 a configuration the engine could not read does not render as nothing configured", async ({ page }) => {
  await stubAnnunciator(page, [], {
    configurationReadable: false,
    configurationDetail:
      "This engine has failed to READ its alarm-notification configuration since it started.",
  })
  await gotoAlarmCenter(page)

  await expect(page.getByTestId("reach-config-unreadable")).toBeVisible()
  // 🔴 The two must not read the same. An empty beacon list means either "no beacon is configured" or
  // "this product cannot tell", and an operator deciding whether to trust the lamp needs to know which.
  await expect(page.getByTestId("outbound-reach")).toContainText(
    viDict.annunciator.reach.beaconUnknown,
  )
  await expect(page.getByTestId("outbound-reach")).not.toContainText(
    viDict.annunciator.reach.noBeacon,
  )
  expect(viDict.annunciator.reach.beaconUnknown).not.toEqual(viDict.annunciator.reach.noBeacon)
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The counter wordings that exist because a review found the short form lied
// ─────────────────────────────────────────────────────────────────────────

test("🔴 Unheard is rendered with its full meaning, not as \"alarms nobody was told about\"", async ({ page }) => {
  await gotoNotifications(page)

  const meaning = page.getByTestId("unheard-meaning")
  await expect(meaning).toBeVisible()

  // The engine ships the full sentence in the payload precisely so a screen cannot invent a shorter one.
  // Asserted on the CONCEPTS rather than the exact sentence, so the engine may reword it.
  await expect(meaning).toContainText(/no browser session was attached/i)
  await expect(meaning).toContainText(/replayed to the next page/i)
  // 🔴 The false reading, forbidden as an assertion — the correction itself contains the phrase inside a
  // denial, so this asserts the denial is present rather than banning the substring.
  await expect(meaning).toContainText(/NOT "alarms nobody was told about"/i)
  // And what genuinely remains untold is named, so the correction is not merely a denial.
  await expect(meaning).toContainText(/cleared before anyone connected/i)
})

test("an empty attention list says so rather than rendering as a blank panel", async ({ page }) => {
  await gotoNotifications(page)

  const attention = page.getByTestId("notification-attention")
  await expect(attention).toBeVisible()
  // A blank space could equally mean "not loaded". Empty is the normal state and it is stated.
  await expect(attention).toContainText(viDict.notifications.status.attentionNone)
})

// ─────────────────────────────────────────────────────────────────────────
// 🔴 The honest limitations, on the screen rather than only in the README
// ─────────────────────────────────────────────────────────────────────────

test("🔴 the honest limitations are on the screen", async ({ page }) => {
  await gotoNotifications(page)

  const limits = page.getByTestId("notification-limitations")
  await expect(limits).toBeVisible()

  // The four an operator can be hurt by, each asserted on its fact rather than its phrasing.
  await expect(limits).toContainText(/không phải thiết bị an toàn/i)
  await expect(limits).toContainText(/KHÔNG chứng minh mật khẩu/i)
  await expect(limits).toContainText(/465/)
  await expect(limits).toContainText(/KHÔNG có kênh SMS/i)
})

test("🔴 the HMI kiosk screen says it is not annunciated", async ({ page }) => {
  // A real machine from the demo roster — the note renders inside the kiosk shell, which only mounts
  // once `useMachine(code)` has resolved, so an unknown code would assert nothing.
  await gotoHmi(page, "SCRW-01")
  const note = page.getByTestId("hmi-not-annunciated")
  await expect(note).toBeVisible()
  // Both halves: the limitation, and the fact that the shipped desktop package is not affected — without
  // the second, this reads as a defect in the product rather than in one deployment shape.
  await expect(note).toContainText(/KHÔNG hiện thẻ cảnh báo/i)
  await expect(note).toContainText(/desktop/i)
})

// ─────────────────────────────────────────────────────────────────────────
// Language + accessibility, the closing pair every screen spec in this suite carries
// ─────────────────────────────────────────────────────────────────────────

test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("st4i-sim-language", "en"))
  await page.goto("/notifications")

  await expect(page.getByRole("heading", { name: "Outbound Notifications", level: 1 })).toBeVisible()
  await expect(page.getByTestId("notification-card-relay")).toBeVisible()
  await expect(page.getByTestId("relay-not-safety")).toContainText(/NOT A SAFETY DEVICE/i)

  await expect(page.getByText(/notifications\.[a-zA-Z.]+/)).toHaveCount(0)
  await expect(page.getByText(/annunciator\.[a-zA-Z.]+/)).toHaveCount(0)

  await assertNoSeriousA11yViolations(page)
})
