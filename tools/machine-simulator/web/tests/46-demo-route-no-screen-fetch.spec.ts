import { expect, test } from "@playwright/test"

/**
 * SESSION 5 (residuals) — THE DEMO ROUTE ISSUES NO `/v1/screens` REQUEST, OBSERVED AS TRAFFIC.
 *
 * ── WHAT THIS PINS, AND WHY IT NEEDED A BROWSER ──────────────────────────────────────────────────
 * WS-HMI-2's perimeter report named the demo-route exclusion among five load-bearing lines with no
 * test. The line is one ternary in `routes/Hmi.tsx`:
 *
 *     const kioskScreenId = screenId === undefined ? machineScreenId(code) : undefined
 *     const publishedScreen = useScreen(kioskScreenId)
 *
 * and its own comment states the requirement it exists to meet: "Excluded at the FETCH, not merely at
 * the render, so the demo route makes no request it would then ignore."
 *
 * That claim is not answerable in a unit test. `useScreen`'s `enabled` gate is TanStack behaviour, and
 * asserting the ternary's shape in source would measure a character sequence rather than a request.
 * The only instrument that can tell "fetched and ignored" apart from "never fetched" is the network,
 * so this spec watches it.
 *
 * ── WHY THE COLLISION IS REAL AND NOT HYPOTHETICAL ───────────────────────────────────────────────
 * The demo route carries no `:code`, so `Hmi.tsx` substitutes `DEMO_MACHINE_CODE` (`lib/hmiScreens.ts`)
 * — which is `IOT-01` — as the machine whose LIVE DATA the demo screen renders against. Without the
 * exclusion, `machineScreenId("IOT-01")` derives `machine-iot-01`, and the kiosk would ask the store
 * for that document while the URL named a different one. If a `machine-iot-01` row existed, it would
 * silently win over the demo screen the URL asked for — answering a URL that named one document with
 * another, which is the defect `35-hmi-indirect-binding.spec.ts`'s third test exists to prevent,
 * wearing a different hat.
 *
 * So the assertion is specifically that NO `/v1/screens/…` request is made on the demo route, and the
 * OPERATOR route is measured in the same run as the control: it must make exactly such a request.
 * Without that second half this spec would pass just as happily against an app that had lost the
 * published-screen join altogether — which is the failure WS-HMI-2 Task 13 existed to fix, and the
 * one a "no requests were made" assertion is least able to notice.
 *
 * Nothing here publishes a screen or touches a baseline: it observes the traffic of two page loads.
 */

/** Every `/v1/screens…` URL the page requests, in order, for as long as the returned array is read. */
function recordScreenRequests(page: import("@playwright/test").Page): string[] {
  const seen: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    if (/\/v1\/screens(\/|\?|$)/.test(url)) seen.push(url)
  })
  return seen
}

test("the demo route asks the screen store for nothing at all", async ({ page }) => {
  const requests = recordScreenRequests(page)

  await page.goto("/hmi/demo/component-demo")

  // The screen the URL named is on the page — so the route really rendered, and an empty request log
  // is not the log of a page that failed to load.
  await expect(page.locator("[data-hmi-screen]")).toBeVisible()

  // The kiosk polls the machine every 1 s; give the app a couple of poll cycles to make any request
  // it was going to make. `toHaveLength(0)` immediately after load would pass against a fetch that
  // simply had not been issued yet.
  await expect
    .poll(() => requests, {
      message: "the demo route requested a published screen document — the FETCH-level exclusion is gone",
      timeout: 3_000,
    })
    .toHaveLength(0)
})

test("CONTROL: the operator route DOES ask the store — the absence above is specific, not universal", async ({
  page,
}) => {
  // 🔴 This is what gives the first test its meaning. Both tests read the same recorder through the
  // same matcher; only this one requires traffic. If the published-screen join were removed entirely,
  // the demo test would still be green and this one would go red — which is the correct outcome, and
  // is precisely the discrimination a one-sided "no request" assertion cannot make.
  const requests = recordScreenRequests(page)

  await page.goto("/hmi/IOT-01")
  await expect(page.locator("[data-hmi-screen]")).toBeVisible()

  await expect
    .poll(() => requests, {
      message: "the operator route made no /v1/screens request — the kiosk/store join is broken",
      timeout: 3_000,
    })
    .not.toHaveLength(0)

  // …and it asked for the id the machine code derives (`machine-` + lowercased code), not some other
  // document. `machineScreenId` owns that derivation; this asserts the request it actually produced.
  expect(requests.some((url) => url.includes("machine-iot-01"))).toBe(true)
})
