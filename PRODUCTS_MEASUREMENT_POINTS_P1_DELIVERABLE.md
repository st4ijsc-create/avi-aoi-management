# P1 — Products / Measurement Points Upgrade — Final Deliverable Report

**Scope**: P1 only. **DO NOT proceed to P2.** All changes are additive and backward-compatible. No migrations were executed.

---

## 1. Files Created / Modified

### Created
| File | Purpose |
|---|---|
| `drizzle/0085_p1_fiducials_and_coordinate_mode.sql` | Idempotent migration: adds `productModels.coordinateMode`, `measurementPointDefs.shape`, `measurementPointDefs.geometry` (jsonb), creates `fiducial_marks` table. **NOT executed.** |
| `server/lib/measurementGeometry.ts` | Shape/geometry zod schemas (`circle`, `rect`, `polygon`, `line`, `ring`, `mask`, `array`), `expandArrayGeometry`, `deriveLegacyAnchor` for back-compat. |
| `server/db/product.ts` (fiducial helpers added) | `listFiducialMarksByProductModel`, `getFiducialMarksByProductModel`, `createFiducialMark`, `updateFiducialMark`, `deleteFiducialMark`. |
| `client/src/components/measurement-point-canvas/MeasurementPointCanvas.tsx` | Read-only/preview SVG canvas v2 rendering all P1 shapes + array cells. Drop-in component. |
| `client/src/components/product-fiducials/ProductFiducialsTab.tsx` | Standalone reusable tab UI for fiducial CRUD (modal + table). |
| `apidocs/measurement-geometry-and-fiducials.md` | The single P1 markdown doc (geometry JSON contract + fiducial API + machine sync delta). |
| `_add-p1-i18n.mjs` | One-shot idempotent injector (already executed; safe to delete). |

### Modified
| File | Change |
|---|---|
| `drizzle/schema/product.ts` | Added `productModels.coordinateMode varchar(20) default "pixel"`; added `measurementPointDefs.shape` + `geometry jsonb`; added `fiducialMarks` pgTable + types. All additive. |
| `server/routers/productRouters.ts` | Widened `measurementPointRouter.create/update` inputs to accept optional `shape`+`geometry`. Added `fiducialMarkRouter` (6 procs: `listByProductModel`, `create`, `update`, `delete`, `uploadTemplateImage`, `getById`). |
| `server/routers.ts` | Mounts `fiducialMark: fiducialMarkRouter`. |
| `server/routers/machineApiRouters.ts` | **Phase F additive emissions** — `syncMeasurementPoints` now persists `shape`+`geometry`; `deltaSyncPoints` returns `coordinateMode`, `fiducials[]`, per-point `shape`/`geometry`/expanded `cells[]`. Legacy fields (`positionX/Y`, `radius`) still emitted. |
| `client/src/i18n/locales/{en,vi,zh}.json` | Added `measurementPointP1` namespace: `shape.*`, `tool.*`, `fiducial.*` (incl. `fiducial.types.{cross,circle,square,custom}`). |

---

## 2. Migration `drizzle/0085_p1_fiducials_and_coordinate_mode.sql` (NOT executed)

Idempotent SQL (uses `IF NOT EXISTS`):
- `ALTER TABLE product_models ADD COLUMN IF NOT EXISTS coordinate_mode VARCHAR(20) DEFAULT 'pixel'` (`'pixel'` | `'mm'`)
- `ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS shape VARCHAR(32) DEFAULT 'circle'`
- `ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS geometry JSONB`
- `CREATE TABLE IF NOT EXISTS fiducial_marks (id, product_model_id FK, code, type, position_x, position_y, template_image_url, search_radius, version, is_deleted, deleted_at, created_at, updated_at, created_by, updated_by)`
- Index `fiducial_marks_product_model_id_idx`

**To apply** (manual, when the operator decides):
```bash
pnpm exec drizzle-kit push    # or use the project's normal migration runner
```

---

## 3. New tRPC Procedure Signatures

### `measurementPoint` (widened — back-compat)
```ts
create({ productModelId, code, positionX, positionY, radius?,
        shape?: ShapeName, geometry?: MeasurementGeometry })
update({ id, ...partial of above })
// listByProductModel / getById / softDelete unchanged
```

### `fiducialMark` (new)
```ts
listByProductModel({ productModelId: number }): FiducialMark[]
getById({ id: number }): FiducialMark
create({ productModelId, code, type: "cross"|"circle"|"square"|"custom",
         positionX, positionY, templateImageUrl?, searchRadius? })
update({ id, ...partial })
delete({ id })
uploadTemplateImage({ id, fileBase64, mimeType })
```

All procs use `ctx.user.id` and `ctx.user.name ?? undefined`, follow soft-delete + version-snapshot patterns from P0.

---

## 4. Geometry JSON Examples

Full reference: [`apidocs/measurement-geometry-and-fiducials.md`](../apidocs/measurement-geometry-and-fiducials.md). Quick examples:

```jsonc
// circle (default / legacy-compatible)
{ "shape": "circle", "x": 100, "y": 200, "radius": 8 }

// rect (with optional rotation in degrees)
{ "shape": "rect", "x": 50, "y": 60, "width": 40, "height": 30, "rotation": 15 }

// polygon (min 3 points, object form)
{ "shape": "polygon", "points": [{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":10}] }

// line
{ "shape": "line", "x1": 0, "y1": 0, "x2": 100, "y2": 0, "thickness": 2 }

// ring (donut)
{ "shape": "ring", "x": 100, "y": 100, "rOuter": 20, "rInner": 8 }

// mask (region-based; bbox is derived)
{ "shape": "mask", "region": { "kind": "rect", "x": 0, "y": 0, "width": 50, "height": 50 }, "invert": false }

// array (grid; cells expanded server-side via expandArrayGeometry)
{ "shape": "array", "rows": 4, "cols": 6,
  "pitchX": 10, "pitchY": 10, "originX": 0, "originY": 0,
  "cellShape": "circle", "cellGeometry": { "radius": 3 } }
```

---

## 5. Acceptance Test Cases (manual)

1. **Legacy circle-only client** calls `deltaSyncPoints` → still receives `positionX/Y`, `radius` for every point. `shape`/`geometry`/`cells`/`fiducials`/`coordinateMode` are additive and ignored by old clients.
2. **New client** calls `measurementPoint.create({ shape:"rect", geometry:{...} })` → row persisted with shape=`"rect"` and geometry JSONB. `deriveLegacyAnchor` populates `positionX/Y/radius` so legacy reads still work.
3. **Array shape** → `deltaSyncPoints` emits `cells[]` (one entry per `ExpandedArrayCell` from `expandArrayGeometry`); old clients that only read top-level `positionX/Y` still see the array's anchor.
4. **Fiducials** — `fiducialMark.create` → row appears in `fiducial_marks`; `deltaSyncPoints` returns it under `fiducials[]`. `fiducialMark.delete` → soft-deleted, excluded from subsequent list/sync responses.
5. **`coordinateMode`** — newly created productModel defaults to `"pixel"`; setting to `"mm"` flows through `deltaSyncPoints` so machine clients can switch coordinate interpretation.
6. **Canvas preview** — `<MeasurementPointCanvas>` renders each shape correctly; array shape renders all expanded cells; mask renders dashed bbox.

---

## 6. TypeScript Validation (P1 scope)

Command: `pnpm exec tsc --noEmit -p tsconfig.json --ignoreDeprecations 5.0`

| File | Errors |
|---|---|
| `server/lib/measurementGeometry.ts` | **0** |
| `server/db/product.ts` (fiducial helpers) | **0** |
| `server/routers/productRouters.ts` | **0** |
| `server/routers.ts` | **0** |
| `client/src/components/measurement-point-canvas/MeasurementPointCanvas.tsx` | **0** |
| `client/src/components/product-fiducials/ProductFiducialsTab.tsx` | **0** |
| `client/src/i18n/locales/{en,vi,zh}.json` | n/a (data) |
| **All P1 files combined** | **0 errors** |

Project-wide tsc reports 294 errors across 30+ pre-existing files unrelated to P1 (`AILocalChatBubble.tsx`, `WorkshopLayoutEditor.tsx`, `AdvancedVisionLabPage.tsx`, `Users.tsx`, `aiAnalysisHubRouter.ts`, `aoiPackageRouter.ts`, `permissionsRouter.ts`, `license-service.ts`, etc.). **None are introduced or worsened by P1.**

---

## 7. Deferred to P2 / P3 (out of scope per hard rule)

- **Full interactive canvas editor v2** — transform handles, polygon vertex editing, array-grid drag-to-edit, snap-to-grid. P1 ships read-only/preview MVP only.
- **mm-mode UI controls** — `coordinateMode='mm'` is plumbed end-to-end at the API layer, but no UI selector / unit-conversion overlay is included in P1.
- **Canvas measurement-result preview overlay** — overlaying live OK/NG/NTF results onto the canvas.
- **`ProductModels.tsx` integration** — mounting `<ProductFiducialsTab>` into the Product Models page. The component is standalone reusable; user mounts it where appropriate (no Tabs container existed in `ProductModels.tsx`).
- **Pre-existing TS errors** — `server/routers/machineApiRouters.ts` (6 errors: line ~153 OK/NG/NTF, ~620/621/658/659 `hash`); `client/src/components/WorkshopLayoutEditor.tsx:135` (`'find' does not exist on type '{}'`); plus ~287 others across `AILocalChatBubble.tsx`, `AdvancedVisionLabPage.tsx`, `Users.tsx`, `ai*Router.ts`, `aoiPackageRouter.ts`, `permissionsRouter.ts`, `license-service.ts`, etc. All pre-date P1; tracked for separate cleanup.
- **Apply migration `0085`** — written but not executed; operator runs it when ready.

---

**STOP. P1 complete. Do not proceed to P2.**
