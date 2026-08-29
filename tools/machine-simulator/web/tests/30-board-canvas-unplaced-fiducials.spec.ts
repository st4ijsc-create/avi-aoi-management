import { expect, test, type APIRequestContext } from "@playwright/test"

import { ENGINE_URL } from "./support/engine"
import { gotoProductConfigPoints } from "./support/screens"
import { vi as viDict } from "../src/i18n/vi"

/**
 * `BoardCanvas`'s fiducial placement and its `unplacedFiducialCount` — the witness that
 * `docs/owner-decisions.md` item 60 exists because nothing had.
 *
 * 🔴 WHY THIS FILE EXISTS, stated as the measurement that produced it rather than as an intention.
 * BW-1 (item 60 §60.7, 2026-08-24) priced direction B by MUTATING the product fix BN-1 shipped into
 * `src/components/BoardCanvas.tsx` and re-running every instrument this repository owns. Two
 * mutations, and the second one is the whole reason this file is here:
 *
 *   M1 — a TYPE error (`placeFiducial` returns `undefined` instead of `null`). `npm run build` goes
 *        red with a file and a line number. A compile step catches it.
 *   M2 — REVERTING THE FIX ITSELF, in a way that still type-checks:
 *        `const unplacedFiducialCount = 0` in place of `fiducials.length - placedFiducials.length`.
 *        `npm run build` GREEN. `npm run lint` GREEN. And — measured, not assumed — `grep` for
 *        `unplacedFiducial` across the whole of `web/tests/` returned ZERO, so no e2e spec asserted
 *        it either. Three fiducial-mentioning specs exist (`00-visual-and-a11y`, `09-points-editor`,
 *        `13-machine-settings`) and none of them touches the count.
 *
 * ⇒ Wiring build+lint+e2e into the gate buys NOTHING against M2 unless a spec asserts the count.
 * That is what these two banks are. They are written to be red under M2 and green on the shipped
 * tree, and the pair was RUN in both states rather than reasoned about.
 *
 * 🔴 TWO BANKS, BECAUSE ONE IS NOT A MEASUREMENT. A note asserted only in the state where it should
 * appear is satisfied just as well by a note that ALWAYS appears — a constant wearing a check's
 * manners, which is the exact defect this repository's own item-60 declaration was written to stop.
 * So bank B asserts the note is ABSENT, over the same product, with the ONE input that decides it
 * changed: the reference image's dimensions.
 *
 * WHAT THE TWO BANKS SEPARATE, and it is not only the counter:
 *   BANK A — `imageWidth`/`imageHeight` NULL, so `placeFiducial`'s pixel fallback has nothing to
 *            divide by. One fiducial carries a normalized pair and places; two carry only absolute
 *            coordinates and cannot. Expect: the note, reading exactly TWO.
 *   BANK B — the SAME three fiducials with the image dimensions supplied. The fallback resolves all
 *            three, so nothing is unplaced. Expect: NO note, and the two formerly-dropped marks now
 *            drawn on the board.
 * Bank B is therefore also the only assertion in this suite that the FALLBACK LEG of the BN-1 fix
 * works at all — deleting that leg leaves bank A green and reddens bank B.
 *
 * 🔴 WHAT THIS SPEC DOES NOT MEASURE, said here because the count it asserts is one line of a
 * component with several:
 *   * It does not assert WHERE a placed fiducial lands. The marks are `aria-hidden` diamonds
 *     positioned by percentage style, so this reads their `title` (the accessible name a fiducial
 *     mark does NOT have) and their presence, never their coordinates. A fallback that placed every
 *     mark in the wrong corner passes both banks.
 *   * It does not measure `coordinateMode`. `placeFiducial` never consults it — that limitation is
 *     recorded in the function's own doc comment and in `Fiducial.cs`, and it is NOT a defect this
 *     spec is entitled to call one. For a `mm`-mode product the pixel ratio is meaningless and bank
 *     B would still pass.
 *   * It does not measure the i18n PLURAL. `vi` has no plural form for this key, so bank A pins one
 *     rendering of one dictionary; the English `1 fiducial`/`N fiducials` split is unasserted here.
 *
 * ISOLATION: a fresh throwaway product seeded and deleted per test through
 * `PUT`/`DELETE /v1/products/{code}`, the same idiom `08-product-config.spec.ts` and
 * `09-points-editor.spec.ts` use, so this file never reads or mutates the shared seeded catalog.
 */
const THROWAWAY_CODE = "E2E-CA1-FIDUCIALS"

/** Placed in BOTH banks: it carries its own normalized pair, so it never depends on the image
 * dimensions and its presence is what proves the banks differ by the FALLBACK and not by the
 * component rendering nothing at all. */
const FIDUCIAL_NORMALIZED = {
  code: "FN1",
  name: "Normalized mark",
  type: "cross",
  positionX: 300,
  positionY: 240,
  normalizedX: 0.3,
  normalizedY: 0.3,
  searchWindowW: null,
  searchWindowH: null,
  templateImageUrl: null,
  orderIndex: 0,
}

/** Unplaceable in bank A (no image to divide by), placeable in bank B. Absolute coordinates only —
 * exactly the shape `Fiducial.cs` describes a PULLED mark arriving in. */
const FIDUCIAL_ABSOLUTE_ONLY = [
  {
    code: "FA1",
    name: "Absolute mark one",
    type: "cross",
    positionX: 100,
    positionY: 160,
    normalizedX: null,
    normalizedY: null,
    searchWindowW: null,
    searchWindowH: null,
    templateImageUrl: null,
    orderIndex: 1,
  },
  {
    code: "FA2",
    name: "Absolute mark two",
    type: "cross",
    positionX: 800,
    positionY: 640,
    normalizedX: null,
    normalizedY: null,
    searchWindowW: null,
    searchWindowH: null,
    templateImageUrl: null,
    orderIndex: 2,
  },
]

/** One point, and it carries its own normalized pair on purpose: with the image dimensions null in
 * bank A a point WITHOUT one would be unplaced too, and the POINTS note
 * (`pointsEditor.canvas.unplacedNote`) would appear beside the fiducial note. Two notes differing by
 * one word is how a spec ends up asserting the wrong one. This keeps the points note absent in both
 * banks, so the only thing that moves is the fiducial count. */
const SEED_POINT = {
  code: "TP1",
  name: "Anchor point",
  description: "keeps the POINTS note out of both banks",
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

/** The ONLY difference between the two banks is `imageWidth`/`imageHeight`. Everything else — the
 * three fiducials, the point, the coordinate mode — is byte-identical, so a difference in the
 * rendered result cannot be attributed to anything else. */
async function seedThrowawayProduct(
  request: APIRequestContext,
  image: { width: number | null; height: number | null }
): Promise<void> {
  const res = await request.put(`${ENGINE_URL}/v1/products/${THROWAWAY_CODE}`, {
    data: {
      code: THROWAWAY_CODE,
      name: "CA-1 fiducial placement board",
      lifecycleStatus: "development",
      referenceImageUrl: null,
      imageWidth: image.width,
      imageHeight: image.height,
      imageHash: null,
      coordinateMode: "pixel",
      pointsConfigVersion: 1,
      fiducials: [FIDUCIAL_NORMALIZED, ...FIDUCIAL_ABSOLUTE_ONLY],
      variants: [],
      points: [SEED_POINT],
    },
  })
  expect(res.ok(), `seed PUT failed: ${res.status()}`).toBeTruthy()
}

test.describe("board canvas — fiducials that cannot be placed are COUNTED, not dropped", () => {
  test.afterEach(async ({ request }) => {
    await deleteThrowawayIfPresent(request)
  })

  test("BANK A — with no image dimensions, the two absolute-only marks are unplaced and the canvas says so, reading exactly 2", async ({
    page,
    request,
  }) => {
    await deleteThrowawayIfPresent(request)
    await seedThrowawayProduct(request, { width: null, height: null })

    await gotoProductConfigPoints(page, THROWAWAY_CODE)

    // The product really does carry THREE marks — read off the fiducials panel, which lists every
    // one regardless of whether the board could draw it. Without this, "2 unplaced" could equally
    // well be a product that only ever had two fiducials.
    await expect(page.getByRole("cell", { name: "FN1", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "FA1", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "FA2", exact: true })).toBeVisible()

    // 🔴 THE ASSERTION ITEM 60 EXISTS FOR. Under mutation M2 (`unplacedFiducialCount = 0`) this note
    // is never rendered and this line is the one that goes red. Under a `fiducials.length` mutation
    // it renders 3 and this line goes red on the NUMBER — which is why the count is pinned rather
    // than the note's mere presence.
    await expect(
      page.getByText(viDict.pointsEditor.canvas.unplacedFiducialsNote({ count: 2 }), { exact: true })
    ).toBeVisible()

    // The one mark that carries its own normalized pair is still DRAWN. This separates "two are
    // unplaced" from "the board rendered no fiducials at all", which would satisfy the count above
    // by accident.
    await expect(page.locator('[title="Normalized mark"]')).toBeVisible()
    await expect(page.locator('[title="Absolute mark one"]')).toHaveCount(0)
    await expect(page.locator('[title="Absolute mark two"]')).toHaveCount(0)

    // The POINTS note must stay out of it — see SEED_POINT's comment. If this ever fails, the
    // assertion above is at risk of matching the wrong sentence.
    await expect(page.getByText(viDict.pointsEditor.canvas.unplacedNote({ count: 1 }))).toHaveCount(0)
  })

  test("BANK B — supply the image dimensions and the same three marks all place from the pixel fallback: no note at all", async ({
    page,
    request,
  }) => {
    await deleteThrowawayIfPresent(request)
    await seedThrowawayProduct(request, { width: 1000, height: 800 })

    await gotoProductConfigPoints(page, THROWAWAY_CODE)

    await expect(page.getByRole("cell", { name: "FA1", exact: true })).toBeVisible()

    // All three drawn — the two absolute-only marks resolve through `positionX / imageWidth`, which
    // is the leg of the BN-1 fix that bank A cannot reach. Delete that leg and THIS goes red.
    await expect(page.locator('[title="Normalized mark"]')).toBeVisible()
    await expect(page.locator('[title="Absolute mark one"]')).toBeVisible()
    await expect(page.locator('[title="Absolute mark two"]')).toBeVisible()

    // 🔴 THE CONTROL HALF. Nothing is unplaced, so the note must be absent — for EVERY count, not
    // just for 2. A note that renders here would mean bank A's green came from a constant.
    await expect(page.getByText(/fiducial chưa xác định vị trí/)).toHaveCount(0)
    await expect(page.getByText(viDict.pointsEditor.canvas.unplacedNote({ count: 1 }))).toHaveCount(0)
  })
})
