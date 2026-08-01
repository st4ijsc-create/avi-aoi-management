import { expect, test } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { REQUEST_ROUND_TRIP_MS } from "./support/deadlines"
import { gotoUsers } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-D-D7 — `/users` (Admin-only account management, `routes/Users.tsx`) + the TopBar's real Logout
 * affordance (`shell/TopBar.tsx`'s `UserMenu`). Runs against the shared demo engine
 * (`ST4I_DEMO_ENABLED=true` — see `playwright.config.ts`), whose `DemoAutoLoginMiddleware` signs a
 * real `demo-admin` (`Roles.Admin`) in on the very first request — so every test below reaches this
 * Admin-only screen with zero manual login, same as every other spec in this suite (see
 * `17-auth.spec.ts`'s own top comment for the full mechanism).
 *
 * There is no `DELETE /v1/users/{id}` endpoint (out of this task's scope — disable/enable covers
 * account lifecycle instead), so the create-user test mints a UNIQUE username every run (a timestamp
 * suffix) rather than a fixed throwaway one used elsewhere in this suite — the roster only ever
 * grows across repeated runs, but that keeps this spec independently re-runnable without ever
 * tripping the 409 duplicate-username guard (`UserEndpointsTests.Create_DuplicateUsername_Gets409`'s
 * server-side counterpart).
 */

test.describe("users — admin roster management + TopBar logout affordance", () => {
  test("Admin can open /users, see the roster table, and create a new user which appears in it", async ({ page }) => {
    await gotoUsers(page)

    const username = `e2e-user-${Date.now()}`

    await page.getByRole("button", { name: viDict.users.addUser }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    await page.getByLabel(viDict.users.createDialog.usernameLabel).fill(username)
    await page.getByLabel(viDict.users.createDialog.passwordLabel).fill("E2ePassword123!")
    await dialog.getByRole("button", { name: viDict.users.createDialog.submit }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible()

    // The new row's role Select defaults to "Operator" (CreateUserDialog's own default) — a light
    // proof the create actually landed the right role, not just SOME row with a matching username.
    await expect(page.getByRole("row", { name: new RegExp(username) }).getByText("Operator")).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("the TopBar user menu shows the signed-in demo-admin + role, with a real Logout affordance", async ({ page }) => {
    await gotoUsers(page)

    const trigger = page.getByRole("button", { name: viDict.auth.userMenu.signedInAs({ username: "demo-admin" }) })
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(page.getByText(viDict.auth.userMenu.signedInAs({ username: "demo-admin" }))).toBeVisible()
    await expect(page.getByText(viDict.auth.userMenu.role({ role: "Admin" }))).toBeVisible()

    const logoutItem = page.getByRole("menuitem", { name: viDict.auth.userMenu.logout })
    await expect(logoutItem).toBeVisible()

    // Exercise the REAL click-through (not just a direct API call, which `17-auth.spec.ts` already
    // covers) — proves the wiring from this menu item all the way to `useAuth().logout()` →
    // `POST /v1/auth/logout` actually fires. The shared demo engine's own auto-login seam immediately
    // re-establishes a fresh demo-admin session on the very next request (see `17-auth.spec.ts`'s own
    // top comment for why that's the expected, not a failed, outcome here) — so this only asserts the
    // real request happened and succeeded, not that the user stays logged out afterward.
    const logoutResponsePromise = page.waitForResponse(
      (res) => res.url().endsWith("/v1/auth/logout") && res.request().method() === "POST",
      { timeout: REQUEST_ROUND_TRIP_MS }
    )
    await logoutItem.click()
    const logoutResponse = await logoutResponsePromise
    expect(logoutResponse.ok()).toBeTruthy()
  })
})
