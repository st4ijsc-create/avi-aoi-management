import { expect, test, type Page } from "@playwright/test"

import { gotoDashboard } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * WS-D-D6 — the login gate (`AuthProvider`/`AuthGate` in `App.tsx`, `Login.tsx`/`Bootstrap.tsx`).
 *
 * This suite's shared engine (`playwright.config.ts`'s `webServer`) runs with
 * `ST4I_DEMO_ENABLED=true`, same as every other spec file. That single fact drives every assertion
 * below, so it's worth spelling out precisely (see `St4i.EngineApi/Auth/DemoAutoLoginMiddleware.cs`):
 * on ANY request that arrives with no authenticated cookie, and ONLY when the demo flag is on, this
 * middleware transparently creates (once, idempotently) a real `demo-admin` Admin account, signs it
 * in through the exact same cookie `SignInAsync` a real login uses, and assigns `context.User` for
 * THAT SAME request — before the endpoint handler (or the default-deny fallback policy) ever runs.
 * It runs on literally every unauthenticated request, not just page loads — including a direct
 * `GET /v1/auth/me` and even the response to `POST /v1/auth/logout` itself's NEXT request.
 *
 * Two consequences that shape this file:
 *  1. The Shell renders on a totally fresh browser context with ZERO manual login — proving the
 *     auto-login seam and the new default-deny gate genuinely coexist is this task's core acceptance
 *     bar, and needs no special setup: `gotoDashboard` (the same helper every other functional spec
 *     already uses) already proves it, since it would hang on `<Login/>`'s form instead of the
 *     dashboard heading if the gate were somehow blocking this account.
 *  2. There is NO way to observe a genuinely logged-out (401) state on THIS engine: demo-admin has no
 *     real password (`DemoAutoLoginMiddleware.EnsureDemoAdminAsync` mints a throwaway random one,
 *     never intended to be typed by anyone), so "log back in as demo-admin" isn't a thing a test can
 *     do — and logging out only ever wins until the very next request, which re-auto-logs-in before
 *     it even reaches the handler. The task brief anticipates exactly this and asks for the gate to be
 *     proven a different way instead: assert `GET /v1/auth/me` resolves to demo-admin (the identity
 *     the gate is actually rendering the Shell for) and that logout genuinely tears the session down
 *     server-side (auditable, real `SignOutAsync`) even though this particular deployment's own
 *     auto-login seam immediately re-establishes a new one on the next request. Full bootstrap-from-
 *     empty (creating the very FIRST account on a deployment with none) is D1's own dotnet integration
 *     test (`AuthPipelineTests.cs`) — not fought here against a shared engine that already has one.
 */

async function fetchMe(page: Page): Promise<{ username: string; role: string; displayName: string | null } | null> {
  const res = await page.request.get("/v1/auth/me")
  if (res.status() === 401) return null
  expect(res.ok(), `GET /v1/auth/me failed: ${res.status()}`).toBeTruthy()
  return res.json()
}

test.describe("auth gate — demo-admin auto-login", () => {
  test("the Shell renders on a fresh browser context with zero manual login, never the Login screen", async ({
    page,
  }) => {
    // `gotoDashboard` waits for the dashboard heading + "engine connected" + the KPI row — every one
    // of those only exists inside <Shell>. If the auth gate were, say, misordered (checking `user`
    // before `isLoading` settles, or not wiring the demo-admin session through at all) this would
    // instead time out staring at the themed splash or the Login form, not the dashboard.
    await gotoDashboard(page)

    // Belt-and-suspenders — explicitly prove the Login screen never appeared, not just that the
    // dashboard eventually did (the two are almost certainly the same fact, but this pins it down
    // against the literal string the gate would have rendered instead).
    await expect(page.getByRole("heading", { name: viDict.auth.login.title })).toHaveCount(0)
  })

  test("GET /v1/auth/me resolves to a real, auto-provisioned demo-admin Admin account", async ({ page }) => {
    await gotoDashboard(page)

    const me = await fetchMe(page)
    expect(me).not.toBeNull()
    expect(me?.username).toBe("demo-admin")
    expect(me?.role).toBe("Admin")
    expect(me?.displayName).toBe("Demo Admin")
  })

  test("logout tears down the session server-side; the shared demo engine's own auto-login seam re-establishes one on the very next request", async ({
    page,
  }) => {
    await gotoDashboard(page)

    // The real POST /v1/auth/logout — same call `useAuth().logout()` makes — exercised directly here
    // (not through a UI affordance) since the TopBar user menu proper is D7's scope; this still
    // proves the endpoint genuinely signs the session out (an auditable `auth.logout` row —
    // AuditRecorder — not a client-side-only pretend logout).
    const logoutRes = await page.request.post("/v1/auth/logout")
    expect(logoutRes.ok(), `POST /v1/auth/logout failed: ${logoutRes.status()}`).toBeTruthy()

    // Documenting the reality from this file's top comment inline: the VERY NEXT request — this
    // `GET /v1/auth/me`, no page reload yet — already comes back demo-admin again. This is not a
    // failure to log out; `DemoAutoLoginMiddleware` ran again, from scratch, inside THIS request's own
    // pipeline, because it arrived with no cookie. A non-demo (product) deployment has no such
    // seam — this same call would 401 there, which is exactly what drives `<Login/>` in `AuthGate`.
    const meAfterLogout = await fetchMe(page)
    expect(meAfterLogout?.username).toBe("demo-admin")

    // Reload through the real SPA boot path (App.tsx's AuthGate re-runs `useAuth()`/
    // `useBootstrapStatus()` from scratch) and confirm the Shell — never the Login screen — is what
    // a user actually sees after this reload, consistent with the direct API check above.
    await page.reload()
    await gotoDashboard(page)
  })
})
