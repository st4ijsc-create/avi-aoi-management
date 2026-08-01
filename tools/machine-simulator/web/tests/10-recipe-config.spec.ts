import { expect, test, type APIRequestContext } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL } from "./support/engine"
import { gotoRecipeConfig, gotoRecipeConfigDetail } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/**
 * Recipe Config (Task C6) — the System A (automation/IoT machine parameters) recipe workspace's list
 * + editor. Every assertion below reads from the REAL, seeded `ProductConfigStore` (`SCREWDRIVE-M4`:
 * active, torque/speed payload — see `ProductConfigStore.SeedRecipes`), same "no mocks" contract as
 * `08-product-config.spec.ts`.
 *
 * Task C8 fix: `SCREWDRIVE-M4`'s version used to be hardcoded ("v2") — matching the raw seed value
 * (`SeedRecipes()`: version 2) ONLY as long as nobody had ever saved a real edit to it on this dev
 * engine's `recipes.json` (which — same as `08-product-config.spec.ts`'s own MODEL-A issue — persists
 * across `dotnet run` restarts and across repeated `npm run test:e2e` runs against a reused engine
 * process). `fetchRecipeVersion` below reads the ACTUAL current version right before each assertion,
 * so this spec holds regardless of the store's mutation history.
 *
 * The create/edit/save/delete lifecycle test uses a FRESH throwaway recipe rather than editing
 * `SCREWDRIVE-M4` directly, so this spec never depends on (or mutates) the shared seeded catalog's
 * state — same isolation idiom as `08-product-config.spec.ts`'s own `THROWAWAY_CODE`.
 */
const THROWAWAY_CODE = "E2E-C6-TEST"

async function deleteThrowawayIfPresent(request: APIRequestContext): Promise<void> {
  await request.delete(`${ENGINE_URL}/v1/recipes/${THROWAWAY_CODE}`)
}

/** Reads the REAL current `version` + `payload` for recipe `code` straight off the engine — see the
 * file doc comment above for why the spec can't just hardcode these. `payload` values in particular
 * are NOT just a dev-mutation risk: `02-machine-detail.spec.ts`'s own SCRW-01 test legitimately PULLS
 * this exact recipe from the (deliberately diverged) simulated ecosystem as part of its real Task C7
 * coverage — since every spec file shares ONE engine process for the whole suite run (workers: 1,
 * fixed numeric file order — see `playwright.config.ts`'s own doc comment) and `02-*` runs before
 * `10-*`, `torqueTarget` is 1.40 (the ecosystem's value), not the raw seed's 1.35, by the time this
 * spec's own tests run — a fresh engine included, not just a mutated dev box. */
async function fetchRecipe(
  request: APIRequestContext,
  code: string
): Promise<{ version: number; payload: Record<string, unknown> }> {
  const res = await request.get(`${ENGINE_URL}/v1/recipes/${code}`)
  if (!res.ok()) throw new Error(`GET /v1/recipes/${code} failed: ${res.status()}`)
  const body = (await res.json()) as { version: number; payload: Record<string, unknown> }
  return { version: body.version, payload: body.payload }
}

test.describe("recipe config — list, search/filter, detail, create/edit/save/delete lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
  })

  test("lists the seeded catalog with status badge, machine type, version, and checksum; search and status filter narrow it", async ({
    page,
    request,
  }) => {
    const { version } = await fetchRecipe(request, "SCREWDRIVE-M4")

    await gotoRecipeConfig(page)

    await expect(page.getByRole("cell", { name: "SCREWDRIVE-M4", exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: /SCREWDRIVE-M4/ }).getByText(viDict.recipeStatus.active)).toBeVisible()
    await expect(page.getByRole("row", { name: /SCREWDRIVE-M4/ }).getByRole("cell", { name: "SCREWDRIVE", exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: /SCREWDRIVE-M4/ }).getByText(`v${version}`)).toBeVisible()

    const initialRows = await page.getByRole("row").count()

    // Search narrows by code, name, or machine type.
    const searchInput = page.getByLabel(viDict.recipeConfig.search.label)
    await searchInput.fill("does-not-exist-xyz")
    await expect(page.getByText(viDict.recipeConfig.empty.noMatchTitle)).toBeVisible()

    await page.getByRole("button", { name: viDict.recipeConfig.filters.clear }).click()
    await expect(searchInput).toHaveValue("")
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    // Status filter narrows to a single status value.
    await page.getByLabel(viDict.recipeConfig.filters.status).selectOption({ label: viDict.recipeStatus.active })
    await expect(page.getByRole("cell", { name: "SCREWDRIVE-M4", exact: true })).toBeVisible()

    await page.getByRole("button", { name: viDict.recipeConfig.filters.clear }).click()
    await expect(page.getByRole("row")).toHaveCount(initialRows)

    await assertNoSeriousA11yViolations(page)
  })

  test("clicking SCREWDRIVE-M4 opens its editor with typed payload fields populated, an 'other' field, and a sync tab", async ({
    page,
    request,
  }) => {
    const { version, payload } = await fetchRecipe(request, "SCREWDRIVE-M4")

    await gotoRecipeConfigDetail(page, "SCREWDRIVE-M4")

    await expect(page.getByRole("heading", { name: "SCREWDRIVE-M4", level: 1 })).toBeVisible()
    await expect(page.getByText(viDict.recipeStatus.active).first()).toBeVisible()
    await expect(page.getByText(`v${version}`)).toBeVisible()

    // Typed SCREWDRIVE fields — real ACTUAL values (not the raw seed's) since this recipe may have
    // already been pulled from the ecosystem's deliberately-diverged copy by an earlier spec in this
    // same suite run — see fetchRecipe's own doc comment.
    await expect(page.getByRole("spinbutton", { name: /Tốc độ/ })).toHaveValue(String(payload.speedRpm))
    await expect(page.getByRole("spinbutton", { name: /Mô-men xiết mục tiêu/ })).toHaveValue(String(payload.torqueTarget))
    await expect(page.getByRole("spinbutton", { name: /Dung sai mô-men xiết/ })).toHaveValue(String(payload.torqueTolerance))
    await expect(page.getByRole("textbox", { name: /Đơn vị mô-men xiết/ })).toHaveValue(String(payload.torqueUnit))

    // "notes" has no typed spec — it renders in the generic "other fields" grid instead.
    await expect(page.getByText("notes", { exact: true })).toBeVisible()

    // Sync tab — SEAM FOR C7: real recipe drift-check against the live C2/C3 engine, resolved by
    // machine type (not this specific recipe code).
    await page.getByRole("tab", { name: viDict.recipeConfigDetail.tabs.sync }).click()
    await page.getByLabel(viDict.recipeConfigDetail.sync.machineLabel).selectOption("SCRW-01")
    await page.getByRole("button", { name: viDict.recipeConfigDetail.sync.checkBtn }).click()
    await expect(page.getByText(viDict.recipeConfigDetail.sync.resultResolvedCode)).toBeVisible({ timeout: 10_000 })

    await assertNoSeriousA11yViolations(page)
  })

  test("create → appears in list → edit a typed field + add a custom key → save → version/checksum update and persist across reload → delete removes it", async ({
    page,
    request,
  }) => {
    await gotoRecipeConfig(page)

    // Scoped to `main` — the toolbar trigger and the dialog's own submit button share the exact same
    // label ("Tạo recipe"), same ambiguity `08-product-config.spec.ts` documents for its own dialog.
    const openCreateDialog = () => page.locator("main").getByRole("button", { name: viDict.recipeConfig.createBtn }).click()
    const dialog = () => page.getByRole("dialog")

    await openCreateDialog()
    await expect(dialog()).toBeVisible()

    await page.getByLabel(viDict.recipeConfig.createDialog.codeLabel).fill(THROWAWAY_CODE)
    await page.getByRole("textbox", { name: viDict.recipeConfig.form.nameLabel }).fill("E2E Test Recipe")
    await dialog().getByRole("button", { name: viDict.recipeConfig.createDialog.submit }).click()

    await expect(page.getByText(viDict.toast.recipeCreated({ code: THROWAWAY_CODE }))).toBeVisible()
    await expect(page.getByRole("cell", { name: THROWAWAY_CODE, exact: true })).toBeVisible()
    // Default machine type (DEFAULT_RECIPE_MACHINE_TYPE) — a concrete example, not a blank/generic one.
    await expect(page.getByRole("row", { name: THROWAWAY_CODE }).getByRole("cell", { name: "SCREWDRIVE", exact: true })).toBeVisible()

    // Open the new recipe and edit it.
    await page.getByRole("row", { name: THROWAWAY_CODE }).click()
    await expect(page.getByRole("heading", { name: THROWAWAY_CODE, level: 1 })).toBeVisible({ timeout: 15_000 })

    const saveButton = page.getByRole("button", { name: viDict.recipeConfigDetail.info.save })
    await expect(saveButton).toBeDisabled()
    await expect(page.getByText(viDict.recipeConfigDetail.info.clean)).toBeVisible()

    // A brand-new draft's payload is empty — the typed SCREWDRIVE field renders with no value yet.
    const speedField = page.getByRole("spinbutton", { name: /Tốc độ/ })
    await speedField.fill("300")
    await expect(page.getByText(viDict.recipeConfigDetail.info.dirty)).toBeVisible()

    // Add a custom key via the generic key/value grid.
    await page.getByLabel(viDict.recipeConfigDetail.payload.addKeyLabel).fill("testKey")
    await page.getByLabel(viDict.recipeConfigDetail.payload.addValueLabel).fill("testValue")
    await page.getByRole("button", { name: viDict.recipeConfigDetail.payload.addBtn }).click()
    await expect(page.getByText("testKey", { exact: true })).toBeVisible()

    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByText(viDict.toast.recipeSaved)).toBeVisible()
    await expect(page.getByText(viDict.recipeConfigDetail.info.clean)).toBeVisible()

    // Version bumped 1 → 2 (the store leaves version fully to the caller — see RecipeEditorTab's own
    // doc comment — this UI bumps it by 1 on every real save) and the server recomputed a real
    // checksum for the new payload — verified against the REAL engine response, not just the DOM.
    const saved = await request.get(`${ENGINE_URL}/v1/recipes/${THROWAWAY_CODE}`)
    expect(saved.ok()).toBe(true)
    const savedBody = await saved.json()
    expect(savedBody.version).toBe(2)
    expect(savedBody.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(savedBody.payload.speedRpm).toBe(300)
    expect(savedBody.payload.testKey).toBe("testValue")
    await expect(page.getByText(viDict.recipeConfigDetail.versionBadge({ version: 2 }))).toBeVisible()

    // Reload — proves the PUT actually persisted server-side, not just client cache optimism.
    await gotoRecipeConfigDetail(page, THROWAWAY_CODE)
    await expect(page.getByRole("spinbutton", { name: /Tốc độ/ })).toHaveValue("300")
    await expect(page.getByText("testKey", { exact: true })).toBeVisible()
    await expect(page.getByRole("textbox", { name: /Giá trị của testKey|Value of testKey/ })).toHaveValue("testValue")

    // Delete — confirm dialog, then back on the list without the throwaway row.
    await page.getByRole("button", { name: viDict.recipeConfigDetail.info.deleteBtn }).click()
    await expect(
      page.getByRole("dialog", { name: viDict.recipeConfigDetail.info.deleteConfirmTitle({ code: THROWAWAY_CODE }) })
    ).toBeVisible()
    await page.getByRole("button", { name: viDict.recipeConfigDetail.info.deleteConfirmSubmit }).click()

    await expect(page).toHaveURL(/\/recipes$/)
    await expect(page.getByText(viDict.toast.recipeDeleted({ code: THROWAWAY_CODE }))).toBeVisible()
    await expect(page.getByRole("cell", { name: THROWAWAY_CODE, exact: true })).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })

  test("a row is keyboard-activatable with Enter", async ({ page }) => {
    await gotoRecipeConfig(page)
    const row = page.getByRole("row", { name: /SCREWDRIVE-M4/ })
    await row.focus()
    await row.press("Enter")
    await expect(page.getByRole("heading", { name: "SCREWDRIVE-M4", level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto("/recipes")
    await expect(page.getByRole("heading", { name: en.recipeConfig.title, level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: en.recipeConfig.table.code })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("cell", { name: "SCREWDRIVE-M4", exact: true })).toBeVisible()
    await expect(page.getByRole("table").getByText(en.recipeStatus.active)).toBeVisible()

    // A leftover `t()` typo renders the raw dot-path string — this regex is deliberately generic so it
    // would catch a typo in ANY key on this screen (same idiom as 08-product-config.spec.ts's own check).
    await expect(page.getByText(/recipeConfig\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
