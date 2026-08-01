import { expect, test } from "@playwright/test"

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
 */

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
