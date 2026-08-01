import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { ENGINE_URL } from "./support/engine"
import { gotoProductConfigPoints } from "./support/screens"
import { en } from "../src/i18n/en"
import { vi as viDict } from "../src/i18n/vi"

/** The Select primitive (`components/ui/select.tsx`) renders a `role="combobox"` trigger `<button>`,
 * not a native `<select>` — Playwright's `selectOption()` only works on the latter, so choosing an
 * option here is click-trigger → click-listbox-option, same as a real user. */
async function chooseSelectOption(page: Page, comboboxName: string, optionLabel: string): Promise<void> {
  await page.getByRole("combobox", { name: comboboxName }).click()
  await page.getByRole("option", { name: optionLabel }).click()
}

/**
 * Points editor (Task C5) — board image-overlay canvas + points list + full-spec point form +
 * fiducials/variants, `PointsEditor.tsx`/`BoardCanvas.tsx`/`PointForm.tsx`. Uses a FRESH throwaway
 * product (not MODEL-A/B) seeded via a direct `PUT /v1/products/{code}` — same isolation idiom as
 * `08-product-config.spec.ts`'s create/edit/delete lifecycle test, so this spec never depends on (or
 * mutates) the shared seeded catalog's state.
 */
const THROWAWAY_CODE = "E2E-C5-TEST"

const SEED_POINT = {
  code: "TP1",
  name: "Test Point One",
  description: "seed point for C5 e2e",
  measurementType: "DIMENSION",
  measurementTypeCode: null,
  unit: "mm",
  lowerLimit: 1,
  upperLimit: 5,
  nominalValue: 3,
  toleranceMode: "range",
  tolPlus: null,
  tolMinus: null,
  positionX: 200,
  positionY: 200,
  radius: 10,
  normalizedX: 0.2,
  normalizedY: 0.25,
  normalizedRadius: 0.01,
  cropWidth: 40,
  cropHeight: 40,
  orderIndex: 0,
  isActive: true,
  shape: "circle",
  geometry: null,
  cells: null,
  positionZ: null,
  heightMin: null,
  heightMax: null,
  heightNominal: null,
  heightUnit: null,
  areaMin: null,
  areaMax: null,
  areaNominal: null,
  areaUnit: null,
  volumeMin: null,
  volumeMax: null,
  volumeNominal: null,
  volumeUnit: null,
  coplanarityMax: null,
  warpageMax: null,
  voidPctMax: 10,
  offsetXMax: null,
  offsetYMax: null,
  tiltMax: null,
  thicknessMin: null,
  thicknessMax: null,
  criteria: null,
  lighting: [],
  lastModifiedAt: null,
  referenceImageUrl: null,
  deletedAt: null,
  deletedAtVersion: null,
}

async function deleteThrowawayIfPresent(request: APIRequestContext): Promise<void> {
  await request.delete(`${ENGINE_URL}/v1/products/${THROWAWAY_CODE}`)
}

async function seedThrowawayProduct(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/products/${THROWAWAY_CODE}`, {
    data: {
      code: THROWAWAY_CODE,
      name: "C5 E2E Test Board",
      lifecycleStatus: "development",
      referenceImageUrl: null,
      imageWidth: 1000,
      imageHeight: 800,
      imageHash: null,
      coordinateMode: "pixel",
      pointsConfigVersion: 1,
      fiducials: [],
      variants: [],
      points: [SEED_POINT],
    },
  })
  expect(res.ok(), `seed PUT failed: ${res.status()}`).toBeTruthy()
}

test.describe("points editor — board canvas + points list + full-spec form + fiducials/variants", () => {
  test.beforeEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
    await seedThrowawayProduct(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
  })

  test("canvas renders the seeded point as a marker aligned with the points list; selecting it populates the form", async ({
    page,
  }) => {
    await gotoProductConfigPoints(page, THROWAWAY_CODE)

    await expect(page.getByText(viDict.productConfigDetail.points.countLabel({ count: 1 }))).toBeVisible()
    await expect(page.getByRole("cell", { name: "TP1", exact: true })).toBeVisible()

    const marker = page.getByRole("button", { name: `Điểm đo TP1 — ${SEED_POINT.name}` })
    await expect(marker).toBeVisible()

    await marker.click()
    await expect(page.getByRole("heading", { name: `Chỉnh sửa TP1`, level: 2 })).toBeVisible()
    await expect(page.getByRole("textbox", { name: viDict.pointsEditor.form.codeLabel })).toHaveValue("TP1")
    await expect(page.getByRole("textbox", { name: viDict.pointsEditor.form.codeLabel })).toBeDisabled()
    await expect(page.getByRole("textbox", { name: viDict.pointsEditor.form.nameLabel })).toHaveValue(SEED_POINT.name)

    // Basic fiducials/variants sections are real, not stubs — even empty-state, they render.
    await expect(page.getByRole("heading", { name: viDict.pointsEditor.fiducials.title, level: 2 })).toBeVisible()
    await expect(page.getByText(viDict.pointsEditor.fiducials.empty)).toBeVisible()
    await expect(page.getByRole("heading", { name: viDict.pointsEditor.variants.title, level: 2 })).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("editing a limit + tolerance mode + a 3D field persists after reload (native validation doesn't silently block save)", async ({
    page,
  }) => {
    await gotoProductConfigPoints(page, THROWAWAY_CODE)
    await page.getByRole("button", { name: `Điểm đo TP1 — ${SEED_POINT.name}` }).click()

    await page.getByRole("spinbutton", { name: viDict.pointsEditor.form.limits.lowerLabel }).fill("1.5")
    await page.getByRole("spinbutton", { name: viDict.pointsEditor.form.limits.upperLabel }).fill("4.5")
    await chooseSelectOption(page, viDict.pointsEditor.form.limits.toleranceModeLabel, viDict.toleranceMode.min_only)
    await page.getByRole("spinbutton", { name: viDict.pointsEditor.form.threeD.voidPctMaxLabel }).fill("15")

    await expect(page.getByText(viDict.pointsEditor.form.dirtyHint)).toBeVisible()
    await page.getByRole("button", { name: viDict.pointsEditor.form.save }).click()
    await expect(page.getByText(viDict.toast.pointSaved)).toBeVisible()
    await expect(page.getByText(viDict.pointsEditor.form.cleanHint)).toBeVisible()

    // Reload — proves the PUT actually persisted server-side (this is the exact scenario a real,
    // live bug hid behind: a `step`-mismatched native number-input constraint silently blocked
    // submission with zero visible feedback — see PointForm.tsx's `noValidate` doc comment).
    await gotoProductConfigPoints(page, THROWAWAY_CODE)
    await page.getByRole("button", { name: `Điểm đo TP1 — ${SEED_POINT.name}` }).click()
    await expect(page.getByRole("spinbutton", { name: viDict.pointsEditor.form.limits.lowerLabel })).toHaveValue("1.5")
    await expect(page.getByRole("spinbutton", { name: viDict.pointsEditor.form.limits.upperLabel })).toHaveValue("4.5")
    await expect(page.getByRole("spinbutton", { name: viDict.pointsEditor.form.threeD.voidPctMaxLabel })).toHaveValue(
      "15"
    )
  })

  test("clicking empty canvas seeds a new point at that position; filling code/name/type and saving adds it to the map and list", async ({
    page,
  }) => {
    await gotoProductConfigPoints(page, THROWAWAY_CODE)

    const canvas = page.getByRole("group", { name: /Bản đồ điểm đo/ })
    const box = await canvas.boundingBox()
    if (!box) throw new Error("canvas has no bounding box")
    // Bottom-right quadrant — well clear of TP1's marker at normalized (0.2, 0.25).
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)

    await expect(page.getByRole("heading", { name: viDict.pointsEditor.form.newTitle, level: 2 })).toBeVisible()
    const nx = await page.getByRole("spinbutton", { name: viDict.pointsEditor.form.position.normalizedXLabel }).inputValue()
    expect(Number(nx)).toBeGreaterThan(0.7)

    await page.getByRole("textbox", { name: viDict.pointsEditor.form.codeLabel }).fill("TP2")
    await page.getByRole("textbox", { name: viDict.pointsEditor.form.nameLabel }).fill("Second point via canvas click")
    await chooseSelectOption(page, viDict.pointsEditor.form.typeLabel, viDict.measurementType.VISUAL)

    await page.getByRole("button", { name: viDict.pointsEditor.form.create }).click()
    await expect(page.getByText(viDict.toast.pointCreated({ code: "TP2" }))).toBeVisible()

    await expect(page.getByRole("button", { name: /Điểm đo TP2/ })).toBeVisible()
    await expect(page.getByRole("cell", { name: "TP2", exact: true })).toBeVisible()
    await expect(page.getByText(viDict.productConfigDetail.points.countLabel({ count: 2 }))).toBeVisible()

    await assertNoSeriousA11yViolations(page)
  })

  test("soft-deleting a point removes it from the active canvas/list; 'show deleted' surfaces it tagged", async ({
    page,
  }) => {
    await gotoProductConfigPoints(page, THROWAWAY_CODE)

    await page.getByRole("button", { name: viDict.pointsEditor.list.deleteAria({ code: "TP1" }) }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: viDict.pointsEditor.form.deleteConfirmSubmit }).click()

    await expect(page.getByText(viDict.toast.pointDeleted({ code: "TP1" }))).toBeVisible()
    await expect(page.getByRole("button", { name: /Điểm đo TP1/ })).toHaveCount(0)
    await expect(page.getByText(viDict.productConfigDetail.points.countLabel({ count: 0 }))).toBeVisible()

    // Toggling "show deleted" surfaces the tombstoned row (display-only, tagged, not selectable).
    // Not `exact: true` — the "Đã xóa" tag renders inside the same cell as the code, so the cell's
    // accessible name is "TP1 Đã xóa", not a bare "TP1".
    await page.getByRole("switch", { name: viDict.pointsEditor.includeDeletedLabel }).click()
    await expect(page.getByRole("cell", { name: /^TP1/ })).toBeVisible()
    await expect(page.getByText(viDict.pointsEditor.list.deletedTag, { exact: true })).toBeVisible()
  })

  test("English strings render with no raw i18n keys leaking through", async ({ page }) => {
    // Not `gotoProductConfigPoints` — that helper waits on Vietnamese text (`waitForEngineConnected`'s
    // "Đã kết nối engine"), same reason 08-product-config.spec.ts's own English test navigates
    // directly instead of through the shared vi-flavored helpers.
    await page.addInitScript(() => window.localStorage.setItem("st4i-sim-language", "en"))
    await page.goto(`/products/${THROWAWAY_CODE}`)
    await expect(page.getByRole("heading", { name: THROWAWAY_CODE, level: 1 })).toBeVisible()
    await page.getByRole("tab", { name: en.productConfigDetail.tabs.points }).click()

    await expect(page.getByRole("heading", { name: en.pointsEditor.title, level: 2 })).toBeVisible()
    await expect(page.getByRole("button", { name: `Point TP1 — ${SEED_POINT.name}` })).toBeVisible()
    await expect(page.getByRole("heading", { name: en.pointsEditor.fiducials.title, level: 2 })).toBeVisible()
    await expect(page.getByRole("heading", { name: en.pointsEditor.variants.title, level: 2 })).toBeVisible()

    // Deliberately generic — catches a leftover raw `t()` key anywhere on this screen (same idiom as
    // 08-product-config.spec.ts's own check).
    await expect(page.getByText(/pointsEditor\.[a-zA-Z.]+/)).toHaveCount(0)

    await assertNoSeriousA11yViolations(page)
  })
})
