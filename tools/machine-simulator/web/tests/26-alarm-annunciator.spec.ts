import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL, resetEstop } from "./support/engine"
import { gotoAlarmCenter } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Task C-5 (`.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-5-brief.md`) — the
 * browser half of local annunciation: `lib/annunciator.tsx` + `components/AlarmAnnunciator.tsx`, the
 * only alarm channel in Đợt C that still works with the network gone.
 *
 * ## What is real here and what is stubbed, and why the split is where it is
 *
 * Two of these tests run against the REAL engine with no stubbing at all — the SSE transport (a real
 * browser `EventSource` against a real `GET /v1/alarms/annunciations` through Vite's dev proxy and the
 * real cookie session) and the honest NEGATIVE (a real Critical alarm, raised through the real API,
 * annunciates nothing while the channel is unconfigured).
 *
 * The rest stub `EventSource` and `AudioContext` at the browser level, and that is a deliberate
 * boundary rather than a convenience:
 *  - **The engine's local-annunciation channel cannot be enabled from this harness.** C-2 made
 *    `NotificationConfigStore` the only enable mechanism and C-7 — not C-5 — owns the HTTP endpoints
 *    that write it, so there is no supported way for a Playwright run to configure the channel. The
 *    engine end of the chain is therefore proved where it CAN be driven: `AlarmAnnunciationStreamTests`
 *    raises a real alarm through the real host and reads the real SSE frame off the wire.
 *  - **Autoplay is a browser DECISION, and both of its answers must be handled.** Depending on Chromium's
 *    launch flags to be in one of those states makes the test assert whichever answer this runner
 *    happens to give. Substituting the decision makes both answers testable, deterministically, which is
 *    what the brief asks for ("including the autoplay-blocked path").
 *
 * The seam between the two halves is the SSE frame shape, and it is pinned on both sides: the C# suite
 * asserts the serialised payload is single-line and carries no `alarm.id`, and `theRealStream` below
 * asserts a real browser parses the real server's `ready` frame.
 */

// ─────────────────────────────────────────────────────────────────────────
// Harness — replaces the two browser APIs whose behaviour is under test.
// ─────────────────────────────────────────────────────────────────────────

interface Harness {
  audio: {
    /** What a freshly constructed AudioContext reports. `"suspended"` is what a browser gives a page
     * that has had no user gesture — the autoplay-blocked case. */
    state: "running" | "suspended"
    /** Whether `resume()` is permitted to actually start the context. A real browser permits it only
     * with user activation, which is exactly what the "enable sound" button's own click supplies. */
    allowResume: boolean
    resumeCalls: number
    /** Counts real `OscillatorNode.start()` calls — the proof a tone was actually scheduled rather
     * than the UI merely claiming it was. */
    oscillatorStarts: number
  }
}

async function installHarness(
  page: Page,
  audio: { state: "running" | "suspended"; allowResume: boolean }
): Promise<void> {
  await page.addInitScript(
    ({ state, allowResume }) => {
      const harness = {
        audio: { state, allowResume, resumeCalls: 0, oscillatorStarts: 0 },
        sources: [] as Array<{ emit: (type: string, data: unknown) => void }>,
      }
      ;(window as unknown as { __annunciator: typeof harness }).__annunciator = harness

      class FakeEventSource {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSED = 2
        readyState = FakeEventSource.OPEN
        onopen: (() => void) | null = null
        onerror: (() => void) | null = null
        private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()

        readonly url: string

        constructor(url: string) {
          this.url = url
          harness.sources.push(this)
          setTimeout(() => this.onopen?.(), 0)
        }

        addEventListener(type: string, fn: (event: MessageEvent<string>) => void) {
          const existing = this.listeners.get(type) ?? []
          existing.push(fn)
          this.listeners.set(type, existing)
        }

        removeEventListener() {}

        close() {
          this.readyState = FakeEventSource.CLOSED
        }

        emit(type: string, data: unknown) {
          for (const fn of this.listeners.get(type) ?? []) {
            fn({ data: JSON.stringify(data) } as MessageEvent<string>)
          }
        }
      }
      ;(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource

      class FakeAudioContext {
        currentTime = 0
        destination = {}
        get state() {
          return harness.audio.state
        }
        resume() {
          harness.audio.resumeCalls++
          if (harness.audio.allowResume) harness.audio.state = "running"
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
        createOscillator() {
          return {
            type: "",
            frequency: { value: 0 },
            connect: (node: unknown) => node,
            start: () => {
              harness.audio.oscillatorStarts++
            },
            stop: () => {},
          }
        }
        createGain() {
          return {
            gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
            connect: (node: unknown) => node,
          }
        }
      }
      ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
    },
    { state: audio.state, allowResume: audio.allowResume }
  )
}

/** Pushes one frame into the page's open (fake) stream, exactly as the server would write it. */
async function push(page: Page, type: "ready" | "annunciation", data: unknown): Promise<void> {
  await page.evaluate(
    ({ type, data }) => {
      const harness = (window as unknown as {
        __annunciator: { sources: Array<{ emit: (t: string, d: unknown) => void }> }
      }).__annunciator
      harness.sources[harness.sources.length - 1].emit(type, data)
    },
    { type, data }
  )
}

function readHarness(page: Page): Promise<Harness> {
  return page.evaluate(() => (window as unknown as { __annunciator: Harness }).__annunciator)
}

const CRITICAL = {
  sequence: 1,
  edge: "Raised",
  atUtc: "2026-07-31T11:04:05Z",
  instance: "default",
  key: "DriverHealth|DOWN|MODBUS-01",
  source: "DriverHealth",
  code: "DOWN",
  priority: "Critical",
  state: "Active",
  message: "Driver MODBUS-01 mất kết nối",
  runbook: "Kiểm tra cáp mạng tới MODBUS-01.",
  targetId: "MODBUS-01",
  clearOnAck: false,
  count: 3,
  previousPriority: null,
  actor: null,
}

const ARMED_READY = { configured: true, enabled: true, minPriority: "High", heartbeatSeconds: 15 }

// ─────────────────────────────────────────────────────────────────────────
// Against the REAL engine — no stubbing.
// ─────────────────────────────────────────────────────────────────────────

test.describe("alarm annunciator — the real SSE transport", () => {
  /**
   * 🔴 A real browser `EventSource`, a real authenticated request through Vite's `/v1` dev proxy, and
   * a real `ready` frame off the real endpoint. This is what proves the SSE framing the C# side writes
   * is something a browser actually parses — a thing no xunit test and no stubbed test can see, and
   * the exact seam between this file's stubbed half and the engine suite's real half.
   */
  test("a real EventSource opens the stream and parses the engine's ready frame", async ({ page }) => {
    await gotoAlarmCenter(page)

    const result = await page.evaluate(
      () =>
        new Promise<{ opened: boolean; readyState: number; data: unknown }>((resolve) => {
          const source = new EventSource("/v1/alarms/annunciations", { withCredentials: true })
          const timer = setTimeout(() => {
            const readyState = source.readyState
            source.close()
            resolve({ opened: false, readyState, data: null })
          }, 15_000)
          source.addEventListener("ready", (event) => {
            clearTimeout(timer)
            const readyState = source.readyState
            const data = JSON.parse((event as MessageEvent<string>).data) as unknown
            source.close()
            resolve({ opened: true, readyState, data })
          })
        })
    )

    expect(result.opened, "the engine never sent a `ready` frame a browser could parse").toBe(true)
    expect(result.readyState).toBe(1) // EventSource.OPEN
    // The e2e engine has no notification channel configured, and the frame says so rather than
    // leaving the page to assume it is armed because the connection succeeded.
    expect(result.data).toMatchObject({ configured: false, enabled: false, minPriority: null })
    expect(result.data).toMatchObject({ heartbeatSeconds: 15 })
  })

  /**
   * 🔴 The honest negative, with a REAL Critical alarm. The local-annunciation channel is not
   * configured on this engine, so nothing must annunciate — and in particular the page must not
   * synthesise an annunciation from the alarm table it is already polling. A UI that "helpfully" did
   * that would be annunciating on a channel an operator never enabled.
   */
  test("a real Critical alarm annunciates nothing while the channel is unconfigured", async ({
    page,
    request,
  }) => {
    await gotoAlarmCenter(page)
    await expect(page.getByTestId("annunciator-status")).toBeVisible()

    // A real SAFETY_BLOCKED Critical Policy alarm: HALT latched, then a denied fleet start — the same
    // path `AlarmEndpointsTests` drives through the real pipeline.
    await request.post(`${ENGINE_URL}/v1/fleet/estop`)
    const denied = await request.post(`${ENGINE_URL}/v1/fleet/start`)
    expect(denied.status()).toBe(409)

    try {
      // Non-vacuity: the alarm really IS there, so "no annunciation" is about the channel rather than
      // about nothing having happened.
      await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId("alarm-annunciator")).toHaveCount(0)
      await expect(page.getByTestId("annunciator-status")).toContainText(
        viDict.annunciator.status.notConfigured
      )
    } finally {
      // Leave the shared engine as it was found: ack the (ClearOnAck) alarm and release the latch.
      const list = await request.get(`${ENGINE_URL}/v1/alarms`)
      for (const alarm of (await list.json()) as Array<{ id: number; code: string }>) {
        if (alarm.code === "SAFETY_BLOCKED") await request.post(`${ENGINE_URL}/v1/alarms/${alarm.id}/ack`)
      }
      await resetEstop(request)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// The annunciation surface itself.
// ─────────────────────────────────────────────────────────────────────────

test.describe("alarm annunciator — the in-page surface", () => {
  test("an annunciation raises the banner and really makes a sound", async ({ page }) => {
    await installHarness(page, { state: "running", allowResume: true })
    await gotoAlarmCenter(page)

    await push(page, "ready", ARMED_READY)
    await expect(page.getByTestId("annunciator-status")).toContainText(
      viDict.annunciator.status.armed({ priority: viDict.alarms.priority.High })
    )

    await expect(page.getByTestId("alarm-annunciator")).toHaveCount(0)
    await push(page, "annunciation", CRITICAL)

    const banner = page.getByTestId("alarm-annunciator")
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(CRITICAL.message)
    await expect(banner).toContainText(viDict.alarms.priority.Critical)
    await expect(banner).toContainText(CRITICAL.runbook)

    // 🔴 A tone was really scheduled. Without this the test would pass for a silent annunciator that
    // merely drew a box — which is the failure this whole task is about. Exact rather than `> 0`: one
    // Critical annunciation is three pulses (`TONE` in `lib/annunciator.tsx`), so the number pins the
    // severity ramp as well as the fact that something sounded at all.
    await expect.poll(async () => (await readHarness(page)).audio.oscillatorStarts).toBe(3)
    // The muted affordance must NOT be shown when the sound really played.
    await expect(banner).not.toContainText(viDict.annunciator.sound.blockedShort)

    await assertNoSeriousA11yViolations(page)
  })

  /**
   * 🔴 The autoplay-blocked path — the case the brief singles out, because a muted annunciator that
   * looks armed is worse than no annunciator at all.
   *
   * The alarm must still be VISIBLE (losing the alarm because the sound failed would be the worse
   * bug), the mute must be stated rather than swallowed, and the offered fix must actually work.
   */
  test("when the browser blocks audio the annunciation still shows, says it is muted, and the fix works", async ({
    page,
  }) => {
    await installHarness(page, { state: "suspended", allowResume: false })
    await gotoAlarmCenter(page)
    await push(page, "ready", ARMED_READY)
    await push(page, "annunciation", CRITICAL)

    const banner = page.getByTestId("alarm-annunciator")
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(CRITICAL.message)
    await expect(banner).toContainText(viDict.annunciator.sound.blocked)

    const blocked = await readHarness(page)
    expect(blocked.audio.resumeCalls, "the page never even tried to start the audio").toBeGreaterThan(0)
    expect(blocked.audio.oscillatorStarts, "a tone was scheduled into a suspended context").toBe(0)

    // The button's own click is the user gesture that permits audio — which is exactly why the fix is
    // offered as a button rather than attempted again automatically.
    await page.evaluate(() => {
      ;(window as unknown as { __annunciator: Harness }).__annunciator.audio.allowResume = true
    })
    await banner.getByRole("button", { name: viDict.annunciator.sound.enable }).click()

    // A confirmation tone, so "sound is on now" is something the operator HEARD.
    await expect.poll(async () => (await readHarness(page)).audio.oscillatorStarts).toBeGreaterThan(0)
    await expect(banner).not.toContainText(viDict.annunciator.sound.blocked)
    await expect(page.getByTestId("annunciator-status")).toContainText(viDict.annunciator.sound.on)

    await assertNoSeriousA11yViolations(page)
  })

  /**
   * ISA-18.2: an ack silences the horn (the alarm is still on, a human has taken it) and a clear
   * releases the latch. A banner that kept shouting through both is how an annunciator trains people
   * to ignore it.
   */
  test("an Acked or Cleared edge silences the banner for that alarm", async ({ page }) => {
    await installHarness(page, { state: "running", allowResume: true })
    await gotoAlarmCenter(page)
    await push(page, "ready", ARMED_READY)

    await push(page, "annunciation", CRITICAL)
    await push(page, "annunciation", { ...CRITICAL, sequence: 2, key: "NgRate|HIGH|fleet", code: "HIGH" })
    await expect(page.getByTestId("alarm-annunciator")).toContainText("DOWN")
    await expect(page.getByTestId("alarm-annunciator")).toContainText("HIGH")

    await push(page, "annunciation", { ...CRITICAL, sequence: 3, edge: "Acked", actor: "operator-7" })
    await expect(page.getByTestId("alarm-annunciator")).not.toContainText("DOWN")
    // The OTHER alarm is untouched — an ack silences one horn, not the panel.
    await expect(page.getByTestId("alarm-annunciator")).toContainText("HIGH")

    await push(page, "annunciation", {
      ...CRITICAL,
      sequence: 4,
      edge: "Cleared",
      key: "NgRate|HIGH|fleet",
      code: "HIGH",
    })
    await expect(page.getByTestId("alarm-annunciator")).toHaveCount(0)
  })

  /**
   * 🔴 The engine publishes once per configured INSTANCE, so a host with two enabled local-annunciation
   * instances sends the same edge twice to the same screen. `sequence` is the de-duplication key and the
   * client is required to use it.
   *
   * <p>The duplicate is pushed deliberately AFTER the 1.5s sound gate has expired, and that timing is
   * the whole test. Two other mechanisms already hide a duplicate that arrives immediately — the
   * standing list is keyed by alarm `key`, so a duplicate replaces rather than appends, and the sound
   * gate coalesces tones inside its window. A test that pushed both copies back to back therefore
   * passes with the de-duplication DELETED, which is exactly what the first version of this test did:
   * it was vacuous, and mutation is what said so. Beyond the gate, only identity-based de-duplication
   * can keep an operator from being sounded twice for one alarm.</p>
   *
   * <p>The counts are exact rather than `> 0`, for the same reason. One Critical annunciation is three
   * pulses (`TONE` in `lib/annunciator.tsx`), so three oscillator starts is one tone — and the number
   * also pins the severity ramp, which a `> 0` assertion could not see either.</p>
   */
  test("a duplicate sequence is annunciated once even after the sound gate has expired", async ({
    page,
  }) => {
    await installHarness(page, { state: "running", allowResume: true })
    await gotoAlarmCenter(page)
    await push(page, "ready", ARMED_READY)

    await push(page, "annunciation", { ...CRITICAL, edge: "Restored" })

    const banner = page.getByTestId("alarm-annunciator")
    await expect(banner).toBeVisible()
    // `Restored` is labelled as not-new: it was already standing before the engine restarted.
    await expect(banner).toContainText(viDict.annunciator.edge.restored)
    await expect
      .poll(async () => (await readHarness(page)).audio.oscillatorStarts)
      .toBe(3) // one Critical tone

    // Past the 1.5s gate — a real `waitForTimeout` because crossing that window IS the thing under test.
    await page.waitForTimeout(1_800)
    await push(page, "annunciation", { ...CRITICAL, edge: "Restored", instance: "second" })
    await page.waitForTimeout(300)

    expect(
      (await readHarness(page)).audio.oscillatorStarts,
      "the same edge sounded twice — `sequence` de-duplication is not doing its job"
    ).toBe(3)
    await expect(banner.getByText(CRITICAL.message)).toHaveCount(1)
  })

  /** A DIFFERENT edge after the gate really does sound again — the control that proves the test above
   * is about de-duplication rather than about the annunciator having gone quiet. */
  test("a different alarm after the sound gate really does sound again", async ({ page }) => {
    await installHarness(page, { state: "running", allowResume: true })
    await gotoAlarmCenter(page)
    await push(page, "ready", ARMED_READY)

    await push(page, "annunciation", CRITICAL)
    await expect
      .poll(async () => (await readHarness(page)).audio.oscillatorStarts)
      .toBe(3)

    await page.waitForTimeout(1_800)
    await push(page, "annunciation", {
      ...CRITICAL,
      sequence: 2,
      key: "NgRate|HIGH|fleet",
      code: "HIGH",
      priority: "High",
    })
    // High is two pulses, so 3 + 2 — which also pins that the severity ramp is audible as a count.
    await expect
      .poll(async () => (await readHarness(page)).audio.oscillatorStarts)
      .toBe(5)
  })

  /** The status strip must distinguish "configured and switched off" from "never configured" — they
   * are different operator actions with different fixes. */
  test("the status strip reports a configured-but-disabled channel as its own state", async ({ page }) => {
    await installHarness(page, { state: "running", allowResume: true })
    await gotoAlarmCenter(page)

    await push(page, "ready", { configured: true, enabled: false, minPriority: null, heartbeatSeconds: 15 })

    const strip = page.getByTestId("annunciator-status")
    await expect(strip).toContainText(viDict.annunciator.status.disabled)
    await expect(strip).not.toContainText(viDict.annunciator.status.notConfigured)
    // The reach is stated on every one of these states, so nobody reads "armed" as "you will be paged".
    await expect(strip).toContainText(viDict.annunciator.status.reach)
  })
})
