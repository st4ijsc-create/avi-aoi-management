import { expect, type Page, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { SERVER_BOUNDED_OP_MS } from "./support/deadlines"
import { gotoConnectors } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) —
 * `/connectors` (`routes/Connectors.tsx`), the web page over the new `POST/DELETE /v1/connectors`,
 * `GET /v1/connectors/configured`, `POST /v1/connectors/test` endpoints (`ConnectorEndpoints.cs`).
 *
 * Runs against the shared demo engine (`ST4I_DEMO_ENABLED=true`, `workers: 1`/`fullyParallel: false` —
 * see `playwright.config.ts`), which every OTHER spec in this suite also runs against, sequentially, in
 * the SAME process for the whole run. Same conservative posture `21-site.spec.ts` already takes for its
 * own Engineer-gated Save control (never actually clicked, only "Discover" — a read-only probe): this
 * spec exercises the read-only "Test connection" probe (`POST /v1/connectors/test`, which persists
 * nothing and registers nothing — see `ConnectorEndpoints.TestConnectorAsync`'s own doc comment) but
 * deliberately never clicks "Save" — a real `POST /v1/connectors` here would durably persist a fake
 * Modbus connector into the SAME shared engine every other spec in this suite runs against, and add a
 * roster member for the rest of the run (see `FleetHost.RegisterMachine`'s own "no unregister"
 * constraint) — exactly the kind of cross-test pollution this suite's `workers: 1` design was set up to
 * avoid, not invite.
 *
 * 🔴 **Task D-7b (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7b-brief.md) — the multidrop
 * cases below MOCK `GET /v1/connectors/configured`**, the same `page.route` idiom `25-machine-write.spec.ts`
 * already established for exactly this reason and with exactly this justification: a real RS-485 bus saved
 * here would persist N rows and add N roster members that nothing can remove for the rest of the run.
 *
 * **What that mocking does and does not prove, stated because the gate does not run this file at all.**
 * It proves what an OPERATOR can see and do: that a bus renders as one line with distinguishable devices,
 * that the confirmation names the device it is about to remove, and that the app asks the server to remove
 * THAT INSTANCE and not its protocol. It does not prove the server then removes the right row — that is
 * asserted separately, against a real store, a real `ConnectorRegistry` and a real roster, by
 * `ConnectorRtuBusEndpointTests.DeletingOneDeviceOfATwoDeviceBus_RemovesExactlyThatOne_AndLeavesItsSiblingRunning`
 * (which is inside the gate). The two halves together are the claim; neither is it alone.
 *
 * 🔴 **One assertion in here has a dependency on the harness that is invisible from the assertion itself, and
 * it is written down rather than left to be discovered** (fix round 1, review M-3). The duplicate-React-key
 * witness in the first multidrop test reads `console.error`, and React emits that message **only in a
 * development build**. `playwright.config.ts`'s own `webServer` runs `npm run dev` (Vite, unminified React),
 * so it holds today — but repointing that command at `vite preview` or any production build would **silently
 * disarm the assertion with no test failure**, which is the exact "a green number that means something
 * different on a different machine" shape `verify-suites.sh` exists to refuse. If that webServer ever changes,
 * this witness must be replaced (the honest alternative is asserting on reconciliation behaviour across a list
 * update, which is what a duplicate key actually corrupts), not deleted.
 */

const NOW = new Date().toISOString()

/** Two devices on ONE RS-485 line — the shape that broke the old page. Both are `kind: "Modbus"`, which
 * is precisely why keying the list (and the DELETE URL) on `kind` could not tell them apart. */
const BUS_DEVICES = [
  {
    kind: "Modbus",
    machineCode: "RTU-A",
    host: "COM3",
    port: null,
    updatedAtUtc: NOW,
    instanceId: "line1:unit1",
    busInstanceId: "line1",
    source: "Seeded",
    writeCapability: null,
  },
  {
    kind: "Modbus",
    machineCode: "RTU-B",
    host: "COM3",
    port: null,
    updatedAtUtc: NOW,
    instanceId: "line1:unit2",
    busInstanceId: "line1",
    source: "Seeded",
    writeCapability: null,
  },
]

async function mockConfigured(page: Page, body: unknown, onRequest?: () => void): Promise<void> {
  await page.route("**/v1/connectors/configured", async (route) => {
    onRequest?.()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })
}

test.describe("connectors — configured-connectors list + add-connector form", () => {
  test("configured list renders, Engineer+ (demo-admin) sees the add-connector form, and a connection test against an unreachable target fails within a bounded time", async ({
    page,
  }) => {
    await gotoConnectors(page)

    // demo-admin (Roles.Admin) satisfies this screen's Engineer+ gate, so the add-connector form
    // renders (not the read-only note).
    await expect(page.getByRole("heading", { name: viDict.connectorConfig.form.title, level: 3 })).toBeVisible()
    await expect(page.getByRole("tab", { name: viDict.connectorConfig.form.kindModbus })).toBeVisible()
    await expect(page.getByLabel(viDict.connectorConfig.form.hostLabel)).toBeVisible()

    // Fill in a deliberately-unreachable target plus a minimal, syntactically-valid Modbus register
    // map, then run the read-only connectivity probe — this persists nothing (see this file's own
    // header comment for why "Save" itself is out of scope here).
    await page.getByLabel(viDict.connectorConfig.form.hostLabel).fill("127.0.0.1")
    const mapJson = JSON.stringify({
      machineCode: "PLAYWRIGHT-CONN-TEST",
      pollIntervalMs: 50,
      registers: [{ address: 0, type: "Holding", dataType: "UInt16", scale: 1, metric: "temperature" }],
    })
    await page.getByLabel(viDict.connectorConfig.form.mapJsonLabel).fill(mapJson)

    await page.getByRole("button", { name: viDict.connectorConfig.form.test }).click()
    // Bounded — the server-side test endpoint never hangs past its own timeout (ConnectorEndpoints.
    // ConnectionTestTimeout), so this must resolve well before Playwright's own default action timeout.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: SERVER_BOUNDED_OP_MS })

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/connectors")
    await expect(page.getByRole("heading", { name: en.connectorConfig.title, level: 1 })).toBeVisible()
    await expect(page.getByText(en.connectorConfig.list.title)).toBeVisible()

    await expect(page.getByText(/connectorConfig\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})

test.describe("connectors — a Modbus RTU multidrop bus (D-7b)", () => {
  test("a bus renders as ONE line with devices an operator can tell apart", async ({ page }) => {
    // 🔴 React's own duplicate-key detection, on a different axis from every DOM assertion below — and it is
    // here because a mutation putting the list's key back on `kind` SURVIVED all of them: two rows of kind
    // "Modbus" still render, so nothing visible changes until the list updates and React reconciles state
    // onto the wrong sibling. The framework sees the collision even when the page does not, so the console
    // is the witness that discriminates.
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") consoleErrors.push(msg.text())
    })

    await mockConfigured(page, BUS_DEVICES)
    await gotoConnectors(page)

    // The line is named once, as a property of the segment — and as `COM3`, never `COM3:0`: the server
    // writes null into `port` for a serial bus precisely so this cannot render as a dialable address.
    await expect(page.getByText(viDict.connectorConfig.list.bus.title({ bus: "line1" }))).toBeVisible()
    await expect(page.getByText(viDict.connectorConfig.list.bus.deviceCount({ count: 2 }))).toBeVisible()
    await expect(page.getByText("COM3:0")).toHaveCount(0)

    // The two devices are distinguishable BY WHAT THEY ARE — position on the wire and the machine each
    // serves — not by a row index or a DOM position.
    await expect(page.getByText("unit1", { exact: true })).toBeVisible()
    await expect(page.getByText("unit2", { exact: true })).toBeVisible()
    await expect(page.getByText("RTU-A", { exact: true })).toBeVisible()
    await expect(page.getByText("RTU-B", { exact: true })).toBeVisible()

    // 🔴 Blueprint §9 + D-7a's backoff reporting: the operator is told where the backed-off-versus-quiet
    // distinction is actually published, rather than being shown a badge that would have to guess.
    await expect(page.getByText(viDict.connectorConfig.list.bus.quietVersusBackedOff)).toBeVisible()

    expect(consoleErrors.filter((m) => /same key|duplicate key/i.test(m))).toEqual([])

    await assertNoSeriousA11yViolations(page)
  })

  test("removing ONE device of a bus targets that device's instance — the sibling survives", async ({ page }) => {
    let configuredHits = 0
    let deleted = false
    let deleteUrl: string | null = null

    // First response: both devices. Every response after the DELETE: only unit1 — i.e. what the server
    // would return once it had removed exactly the device that was asked for.
    await page.route("**/v1/connectors/configured", async (route) => {
      configuredHits += 1
      const body = deleted ? [BUS_DEVICES[0]] : BUS_DEVICES
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    })

    await page.route("**/v1/connectors/*", async (route, request) => {
      if (request.method() !== "DELETE") {
        await route.fallback()
        return
      }
      deleteUrl = new URL(request.url()).pathname
      deleted = true
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ kind: "line1:unit2", message: "removed" }),
      })
    })

    await gotoConnectors(page)
    await expect(page.getByText("RTU-B", { exact: true })).toBeVisible()

    // The Remove button is addressed by its accessible name, which carries the instance id — so this
    // click cannot silently land on the wrong row the way a positional `.nth(1)` could.
    await page
      .getByRole("button", {
        name: viDict.connectorConfig.list.table.removeAria({ id: "line1:unit2", machineCode: "RTU-B" }),
      })
      .click()

    // 🔴 The confirmation NAMES what is about to go. On the pre-D-7b page this text could not exist: the
    // removal flow carried a protocol kind, and both devices have the same one.
    await expect(
      page.getByText(
        viDict.connectorConfig.removeConfirm.deviceTarget({ id: "line1:unit2", machineCode: "RTU-B", bus: "line1" }),
      ),
    ).toBeVisible()

    await page.getByRole("button", { name: viDict.connectorConfig.removeConfirm.submit, exact: true }).click()

    // 🔴 The request the operator's click actually produced. `/v1/connectors/Modbus` — what the page sent
    // before this task — would delete a connector that is not either of these devices, or nothing at all.
    await expect.poll(() => deleteUrl).toBe("/v1/connectors/line1%3Aunit2")

    // …and the consequence an operator sees: the sibling is still on the line, the removed device is gone.
    await expect(page.getByText("RTU-A", { exact: true })).toBeVisible()
    await expect(page.getByText("RTU-B", { exact: true })).toHaveCount(0)
    expect(configuredHits).toBeGreaterThan(0)
  })

  test("a device that failed to start reads differently from one that is simply configured", async ({ page }) => {
    await mockConfigured(page, BUS_DEVICES)
    // GET /v1/connectors is keyed by connector INSTANCE id (and has been since D-1) — so on a bus it can
    // name the exact device whose factory refused its configuration.
    await page.route("**/v1/connectors", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "line1:unit2", error: "COM3 could not be opened" }]),
      })
    })

    await gotoConnectors(page)

    await expect(page.getByText(viDict.connectorConfig.list.state.failedToStart)).toHaveCount(1)
    // The other device is NOT reported as failed — an issue list rendered per bus rather than per device
    // would light up both rows and send the operator to the wrong slave address.
    await expect(page.getByText(viDict.connectorConfig.list.state.notInRoster)).toHaveCount(1)
  })

  test("the RS-485 tab asks for the one thing a bus cannot do without, and states both honest limits", async ({
    page,
  }) => {
    await gotoConnectors(page)
    await page.getByRole("tab", { name: viDict.connectorConfig.form.kindModbusRtu }).click()

    await expect(page.getByLabel(viDict.connectorConfig.form.busIdLabel)).toBeVisible()
    // 🔴 Blueprint §9's limit and §10 item 3, where the operator forms the belief rather than only in a
    // plan document: automatic-DE adapters only, no frame has crossed a real port yet, and "Applied" is an
    // acknowledgement rather than physical proof.
    await expect(page.getByText(viDict.connectorConfig.form.rtuHardwareLimit)).toBeVisible()
    await expect(page.getByText(viDict.connectorConfig.form.appliedIsNotProof)).toBeVisible()

    // Save stays disabled until the line has a name — a bus has no default id, and the server refuses one
    // without it; disabling here is what stops the operator discovering that by being rejected.
    await page.getByLabel(viDict.connectorConfig.form.mapJsonLabel).fill('{"transport":"rtu-serial"}')
    await expect(page.getByRole("button", { name: viDict.connectorConfig.form.save, exact: true })).toBeDisabled()
    await page.getByLabel(viDict.connectorConfig.form.busIdLabel).fill("line1")
    await expect(page.getByRole("button", { name: viDict.connectorConfig.form.save, exact: true })).toBeEnabled()

    // The connection probe has no concept of a bus and says so rather than reporting a fan-out parse
    // failure as "cannot reach the device".
    await expect(page.getByRole("button", { name: viDict.connectorConfig.form.test })).toBeDisabled()
    await expect(page.getByText(viDict.connectorConfig.form.testUnavailableForBus)).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("English strings for the bus surfaces render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await mockConfigured(page, BUS_DEVICES)
    await page.goto("/connectors")

    await expect(page.getByText(en.connectorConfig.list.bus.title({ bus: "line1" }))).toBeVisible()
    await page.getByRole("tab", { name: en.connectorConfig.form.kindModbusRtu }).click()
    await expect(page.getByText(en.connectorConfig.form.rtuHardwareLimit)).toBeVisible()

    await expect(page.getByText(/connectorConfig\.[a-zA-Z.]+/)).toHaveCount(0)
  })
})
