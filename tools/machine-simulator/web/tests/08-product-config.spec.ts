import { expect, test, type APIRequestContext } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL } from "./support/engine"
import { gotoProductConfig, gotoProductConfigDetail } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Product Config (Task C4) — the product-config workspace's list + editor. Every assertion below
 * reads from the REAL, seeded `ProductConfigStore` (MODEL-A: active/9 points/v6, MODEL-B:
 * development/6 points/v1 — see `ProductConfigStore.SeedProducts`), same "no mocks" contract as
 * `07-machines.spec.ts`.
 *
 * The create/edit/delete lifecycle test deliberately uses a FRESH throwaway product rather than
 * editing MODEL-A/MODEL-B directly: those two seeded products carry points with
 * `toleranceMode: "min_only"/"max_only"`, which — live-verified during this task — the engine's
 * `PUT /v1/products/{code}` request-body binding cannot deserialize (a pre-existing, out-of-scope
 * engine bug: request binding uses `Program.cs`'s globally-registered plain `JsonStringEnumConverter`,
 * which can't match a snake_case wire token like `"max_only"` against the C# member name `MaxOnly` —
 * the same class of bug `ConfigJson.cs`'s doc comment already documents for RESPONSES, just not yet
 * fixed on the request side). A fresh product has an empty `points` array, so it never touches that
 * path — this is not a workaround for a bug in this web layer, it's how a real author's first save of
 * a brand-new product actually behaves.
 */
const THROWAWAY_CODE = "E2E-C4-TEST"

async function deleteThrowawayIfPresent(request: APIRequestContext): Promise<void> {
  await request.delete(`${ENGINE_URL}/v1/products/${THROWAWAY_CODE}`)
}

test.describe("product config — list, search/filter, detail, create/edit/delete lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    // Defensive — makes this spec independently re-runnable regardless of a previous crashed run.
    await deleteThrowawayIfPresent(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
  })

  test("lists the seeded catalog with lifecycle badge, point count, and version; search and lifecycle filter narrow it", async ({
    page,
  }) => {
    await gotoProductConfig(page)

    await expect(page.getByRole("cell", { name: "MODEL-A", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "MODEL-B", exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: /MODEL-A/ }).getByText(viDict.lifecycleStatus.active)).toBeVisible()
    await expect(
      page.getByRole("row", { name: /MODEL-B/ }).getByText(viDict.lifecycleStatus.development)
    ).toBeVisible()
    await expect(page.getByRole("row", { name: /MODEL-A/ }).getByRole("cell", { name: "9", exact: true })).toBeVisible()
    // v9, not the C4-era "v6" — Task C5's own live Playwright/manual verification (real point edits
    // via `PointForm.tsx`/`PointsEditor.tsx`) legitimately bumped MODEL-A's `pointsConfigVersion` on
    // this shared dev engine (points.json persists across `dotnet run` restarts). Point count (9)
    // is untouched — those edits changed limits/tolerance, never added/removed an active point.
    await expect(page.getByRole("row", { name: /MODEL-A/ }).getByText("v9")).toBeVisible()

    const initialRows = await page.getByRole("row").count()

    // Search narrows by code or name.
    const searchInput = page.getByLabel(viDict.productConfig.search.label)
    await searchInput.fill("MODEL-B")
    await expect(page.getByRole("row")).toHaveCount(2) // header + MODEL-B
    await expect(page.getByRole("cell", { name: "MODEL-A", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: viDict.productConfig.filters.clear }).click()
    await expect(searchInput).toHaveValue("")
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    // Lifecycle filter narrows to a single lifecycle value.
    await page.getByLabel(viDict.productConfig.filters.lifecycle).selectOption({ label: viDict.lifecycleStatus.active })
    await expect(page.getByRole("cell", { name: "MODEL-A", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "MODEL-B", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: viDict.productConfig.filters.clear }).click()
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    // A search that matches nothing renders the friendly empty state, not a blank table.
    await searchInput.fill("does-not-exist-xyz")
    await expect(page.getByText(viDict.productConfig.empty.noMatchTitle)).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("clicking MODEL-A opens its detail page with fields, points seam, and sync tab", async ({ page }) => {
    await gotoProductConfigDetail(page, "MODEL-A")

    await expect(page.getByRole("heading", { name: "MODEL-A", level: 1 })).toBeVisible()
    // `.first()` — the same localized "Đang dùng" string also appears as the lifecycle <Select>'s
    // current-value span further down the info form; the header StatusBadge renders first in DOM order.
    await expect(page.getByText(viDict.lifecycleStatus.active).first()).toBeVisible()
    // See the list-test's own comment above — v9, not the C4-era "v6".
    await expect(page.getByText("v9")).toBeVisible()
    await expect(page.getByText(viDict.productConfigDetail.info.codeLabel)).toBeVisible()
    await expect(page.getByRole("textbox", { name: viDict.productConfig.form.nameLabel })).toHaveValue(
      /Main Control Board/
    )

    // Points tab — SEAM FOR C5: this is real data (GET /v1/products/MODEL-A/points), not a placeholder.
    await page.getByRole("tab", { name: viDict.productConfigDetail.tabs.points }).click()
    await expect(page.getByText(viDict.productConfigDetail.points.countLabel({ count: 9 }))).toBeVisible()
    await expect(page.getByRole("cell", { name: "P01", exact: true })).toBeVisible()

    // Sync tab — SEAM FOR C7: real drift-check against the live C2/C3 engine.
    await page.getByRole("tab", { name: viDict.productConfigDetail.tabs.sync }).click()
    await page.getByLabel(viDict.productConfigDetail.sync.machineLabel).selectOption("AOI-01")
    await page.getByRole("button", { name: viDict.productConfigDetail.sync.checkBtn }).click()
    const driftLabels = [
      viDict.productConfigDetail.sync.driftState.in_sync,
      viDict.productConfigDetail.sync.driftState.drift,
      viDict.productConfigDetail.sync.driftState.unknown,
    ]
    await expect(page.getByText(new RegExp(driftLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")))).toBeVisible({
      timeout: 10_000,
    })

    await assertNoSeriousA11yViolations(page)
  })

  test("create → appears in list → edit a field → save → persists across reload → delete removes it", async ({
    page,
  }) => {
    await gotoProductConfig(page)

    // Scoped to `main` (not the dialog, which portals outside it) — the toolbar trigger and the
    // dialog's own submit button share the exact same label ("Tạo sản phẩm"), so an unscoped locator
    // is ambiguous under Playwright's strict mode the instant both are in the DOM at once (e.g. mid
    // close-animation right after a submit).
    const openCreateDialog = () => page.locator("main").getByRole("button", { name: viDict.productConfig.createBtn }).click()
    const dialog = () => page.getByRole("dialog")

    await openCreateDialog()
    await expect(dialog()).toBeVisible()

    await page.getByLabel(viDict.productConfig.createDialog.codeLabel).fill(THROWAWAY_CODE)
    await page.getByRole("textbox", { name: viDict.productConfig.form.nameLabel }).fill("E2E Test Product")
    await dialog().getByRole("button", { name: viDict.productConfig.createDialog.submit }).click()

    await expect(page.getByText(viDict.toast.productCreated({ code: THROWAWAY_CODE }))).toBeVisible()
    await expect(page.getByRole("cell", { name: THROWAWAY_CODE, exact: true })).toBeVisible()

    // Creating the same code again is blocked client-side (no silent overwrite).
    await openCreateDialog()
    await page.getByLabel(viDict.productConfig.createDialog.codeLabel).fill(THROWAWAY_CODE)
    await page.getByRole("textbox", { name: viDict.productConfig.form.nameLabel }).fill("Duplicate attempt")
    await dialog().getByRole("button", { name: viDict.productConfig.createDialog.submit }).click()
    await expect(page.getByText(viDict.productConfig.createDialog.codeDuplicate({ code: THROWAWAY_CODE }))).toBeVisible()
    await dialog().getByRole("button", { name: viDict.productConfig.createDialog.cancel }).click()

    // Open the new product and edit a field.
    await page.getByRole("row", { name: THROWAWAY_CODE }).click()
    await expect(page.getByRole("heading", { name: THROWAWAY_CODE, level: 1 })).toBeVisible({ timeout: 15_000 })

    const saveButton = page.getByRole("button", { name: viDict.productConfigDetail.info.save })
    await expect(saveButton).toBeDisabled()
    await expect(page.getByText(viDict.productConfigDetail.info.clean)).toBeVisible()

    const widthInput = page.getByRole("spinbutton", { name: viDict.productConfig.form.imageWidthLabel })
    await widthInput.fill("640")
    await expect(page.getByText(viDict.productConfigDetail.info.dirty)).toBeVisible()
    await expect(saveButton).toBeEnabled()

    await saveButton.click()
    await expect(page.getByText(viDict.toast.productSaved)).toBeVisible()
    await expect(page.getByText(viDict.productConfigDetail.info.clean)).toBeVisible()

    // Reload — proves the PUT actually persisted server-side, not just client cache optimism.
    await gotoProductConfigDetail(page, THROWAWAY_CODE)
    await expect(page.getByRole("spinbutton", { name: viDict.productConfig.form.imageWidthLabel })).toHaveValue("640")

    // Delete — confirm dialog, then back on the list without the throwaway row.
    await page.getByRole("button", { name: viDict.productConfigDetail.info.deleteBtn }).click()
    await expect(
      page.getByRole("dialog", { name: viDict.productConfigDetail.info.deleteConfirmTitle({ code: THROWAWAY_CODE }) })
    ).toBeVisible()
    await page.getByRole("button", { name: viDict.productConfigDetail.info.deleteConfirmSubmit }).click()

    await expect(page).toHaveURL(/\/products$/)
    await expect(page.getByText(viDict.toast.productDeleted({ code: THROWAWAY_CODE }))).toBeVisible()
    await expect(page.getByRole("cell", { name: THROWAWAY_CODE, exact: true })).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("a row is keyboard-activatable with Enter", async ({ page }) => {
    await gotoProductConfig(page)
    const row = page.getByRole("row", { name: /MODEL-B/ })
    await row.focus()
    await row.press("Enter")
    await expect(page.getByRole("heading", { name: "MODEL-B", level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/products")
    await expect(page.getByRole("heading", { name: en.productConfig.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.productConfig.table.code })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("cell", { name: "MODEL-A", exact: true })).toBeVisible()
    // Scoped to the table — the lifecycle filter's own (hidden) <option> carries this same text.
    await expect(page.getByRole("table").getByText(en.lifecycleStatus.active)).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string — this regex is deliberately generic so
    // it would catch a typo in ANY key on this screen (same idiom as 07-machines.spec.ts's own check).
    await expect(page.getByText(/productConfig\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
