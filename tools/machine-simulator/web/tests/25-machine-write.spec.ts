import { expect, type Page, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { gotoMachineDetailControl } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Task B-8 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-8-brief.md) —
 * `MachineControlPanel.tsx` (`MachineDetail.tsx`'s "Control"/"Điều khiển" tab), the first web surface
 * over the write path B-1 through B-7 built (`POST /v1/machines/{code}/setpoint`/`.../command`).
 *
 * Every network call this spec depends on is MOCKED via `page.route` (the same idiom
 * `04-onboarding.spec.ts` already established for its own register/poll/claim flow) — never a real
 * `POST /v1/connectors` against the shared demo engine every other spec in this suite also runs
 * against. That is deliberate, matching `24-connectors.spec.ts`'s own stated reason for never clicking
 * "Save" there: `FleetHost.RegisterMachine`/`ConnectorConfigStore` have no unregister, so a REAL write
 * capability persisted here would durably pollute every later spec in this `workers: 1` run. Mocking
 * `GET /v1/connectors/configured` (and the setpoint/command endpoints themselves) proves the UI renders
 * whatever the server returns correctly — which is this task's actual job — without needing a live
 * Modbus/OPC-UA device anywhere in this suite (the underlying write behavior itself is exhaustively
 * proven at the C# integration-test level already — `MachineWriteEndpointsTests.cs`,
 * `ModbusTcpDriverWriteTests.cs`, `OpcUaDriverWriteTests.cs`).
 *
 * `SCRW-01` is a real roster member of the shared demo fleet (`02-machine-detail.spec.ts` already uses
 * it) — only its `GET /v1/machines/SCRW-01` data is real; its write capability is entirely mocked.
 */

const MACHINE_CODE = "SCRW-01"

const CONFIGURED_CONNECTORS_BODY = [
  {
    kind: "OpcUa",
    machineCode: MACHINE_CODE,
    host: null,
    port: null,
    updatedAtUtc: new Date().toISOString(),
    writeCapability: {
      grantsWriteCapability: true,
      writablePoints: [
        { name: "speed", target: "ns=2;s=Speed", min: 0, max: 500 },
        { name: "enabled", target: "ns=2;s=Enabled", min: null, max: null },
      ],
      commands: [{ name: "StartCycle", target: "ns=2;s=Obj -> ns=2;s=StartCycle" }],
      fingerprint: "E2E-FINGERPRINT",
    },
  },
]

async function mockConfiguredConnectors(page: Page): Promise<void> {
  await page.route("**/v1/connectors/configured", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONFIGURED_CONNECTORS_BODY) })
  })
}

test.describe("machine write — MachineDetail's Control tab (setpoints + commands)", () => {
  test.beforeEach(async ({ page }) => {
    await mockConfiguredConnectors(page)
  })

  test("declared writable points and commands render with their bounds", async ({ page }) => {
    await gotoMachineDetailControl(page, MACHINE_CODE)

    await expect(page.getByText("speed", { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.machineDetail.control.points.boundsHint({ min: 0, max: 500 }))).toBeVisible()
    await expect(page.getByText("enabled", { exact: true })).toBeVisible()
    await expect(page.getByText(viDict.machineDetail.control.points.boolHint)).toBeVisible()
    await expect(page.getByText("StartCycle", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.machineDetail.control.commands.invoke })).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("a setpoint write renders Applied, and a later write renders Indeterminate as ITSELF — never folded into Rejected/Failed/success", async ({
    page,
  }) => {
    await gotoMachineDetailControl(page, MACHINE_CODE)

    const valueInput = page.getByLabel(viDict.machineDetail.control.points.valueLabel).first()

    await page.route("**/v1/machines/*/setpoint", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          machineCode: MACHINE_CODE,
          result: { point: "speed", outcome: "Applied", rejectionReason: null, detail: null },
        }),
      })
    })
    await valueInput.fill("123")
    await page.getByRole("button", { name: viDict.machineDetail.control.points.submit }).first().click()
    await expect(page.getByText(viDict.machineDetail.control.outcome.applied)).toBeVisible()

    // Re-registering the route swaps the mocked outcome for the NEXT request — Playwright dispatches to
    // the most-recently-registered matching handler first (same idiom as `04-onboarding.spec.ts`).
    await page.route("**/v1/machines/*/setpoint", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          machineCode: MACHINE_CODE,
          result: { point: "speed", outcome: "Indeterminate", rejectionReason: null, detail: "Timed out after 3000ms." },
        }),
      })
    })
    await valueInput.fill("456")
    await page.getByRole("button", { name: viDict.machineDetail.control.points.submit }).first().click()

    // Indeterminate must reach the operator as ITSELF — its own distinct wording, its own `role="alert"`
    // (Applied above rendered `role="status"`), and its own operator guidance — never re-labelled as
    // Applied/Rejected/Failed and never silently re-using the previous Applied banner.
    const indeterminateAlert = page.getByRole("alert").filter({ hasText: viDict.machineDetail.control.outcome.indeterminate })
    await expect(indeterminateAlert).toBeVisible()
    await expect(indeterminateAlert).toContainText(viDict.machineDetail.control.outcome.indeterminateGuidance)
    await expect(indeterminateAlert).toContainText("Timed out after 3000ms.")
    await expect(page.getByText(viDict.machineDetail.control.outcome.applied)).toHaveCount(0)
    await expect(page.getByText(viDict.machineDetail.control.outcome.rejected)).toHaveCount(0)
    await expect(page.getByText(viDict.machineDetail.control.outcome.failed)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("a command is never one click away — Invoke opens a confirmation, Cancel fires nothing, confirming fires exactly once", async ({ page }) => {
    await gotoMachineDetailControl(page, MACHINE_CODE)

    let commandCallCount = 0
    await page.route("**/v1/machines/*/command", async (route) => {
      commandCallCount += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          machineCode: MACHINE_CODE,
          result: { command: "StartCycle", outcome: "Applied", rejectionReason: null, detail: null },
        }),
      })
    })

    await page.getByRole("button", { name: viDict.machineDetail.control.commands.invoke }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(MACHINE_CODE)
    await expect(dialog).toContainText("StartCycle")
    expect(commandCallCount).toBe(0)

    await dialog.getByRole("button", { name: viDict.machineDetail.control.commands.cancel }).click()
    await expect(dialog).toBeHidden()
    expect(commandCallCount).toBe(0)

    await page.getByRole("button", { name: viDict.machineDetail.control.commands.invoke }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: viDict.machineDetail.control.commands.confirmSubmit }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    expect(commandCallCount).toBe(1)
    await expect(page.getByText(viDict.machineDetail.control.outcome.applied)).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("a not-available response (409 READ_ONLY) surfaces the server's own actionable message, not a generic failure", async ({ page }) => {
    await gotoMachineDetailControl(page, MACHINE_CODE)

    await page.route("**/v1/machines/*/setpoint", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "The live driver for machine 'SCRW-01' does not support writing.", reason: "READ_ONLY" }),
      })
    })
    await page.getByLabel(viDict.machineDetail.control.points.valueLabel).first().fill("50")
    await page.getByRole("button", { name: viDict.machineDetail.control.points.submit }).first().click()

    await expect(page.getByText("The live driver for machine 'SCRW-01' does not support writing.")).toBeVisible()
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    // Deliberately NOT `gotoMachineDetailControl` — that helper waits on the VI-language tab label,
    // same reasoning `24-connectors.spec.ts`'s own English-strings test documents for bypassing its
    // shared `gotoConnectors` helper.
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto(`/machines/${MACHINE_CODE}`)
    await expect(page.getByRole("heading", { name: MACHINE_CODE, level: 1 })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("tab", { name: en.machineDetail.tabs.control }).click()
    await expect(page.getByText(en.machineDetail.control.description)).toBeVisible({ timeout: 15_000 })

    await expect(page.getByRole("heading", { name: en.machineDetail.control.points.title, level: 3 })).toBeVisible()
    await expect(page.getByRole("heading", { name: en.machineDetail.control.commands.title, level: 3 })).toBeVisible()

    await expect(page.getByText(/machineDetail\.control\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
