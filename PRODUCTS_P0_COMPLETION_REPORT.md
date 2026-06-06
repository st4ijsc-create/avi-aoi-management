# Products & Measurement Points — P0 Foundation Completion Report

**Scope:** Phase 0 (P0) of `PRODUCTS_MEASUREMENT_POINTS_UPGRADE_REPORT.md` — foundation only.
**Date:** generated this session.
**Out of scope (deferred to P1+):** `machineApiRouters`, `client/src/pages/ProductModels.tsx` UI, `pointsConfigVersion` bumping, `productCategoryRouter` audit instrumentation, `machineStatusRouter` / `bulkImportRouter` (operational telemetry, not products).

---

## 1. Files changed

| File | Change summary |
|---|---|
| `drizzle/schema/product.ts` | Added `deletedAt` to `productModels` + `measurementPointDefs`; added `shape` (default `"circle"`) and `geometry` to `measurementPointDefs`; new `measurementPointVersions` table + `MeasurementPointVersion` / `InsertMeasurementPointVersion` types. |
| `drizzle/0084_p0_soft_delete_audit_versions.sql` | **New migration** — idempotent `ADD COLUMN IF NOT EXISTS` for the new columns; `CREATE TABLE IF NOT EXISTS measurement_point_versions` with `unique(pointDefId, version)` and supporting btree indexes; indexes on the new `deletedAt` columns. |
| `server/db/product.ts` | `productModels` and `measurementPointDefs` reads now filter `isNull(deletedAt)` everywhere; `deleteProductModel` and `deleteMeasurementPointDef` converted to soft-delete (`deletedAt = now(), isActive = false`); `deleteProductModel` cascades soft-delete to active `measurementPointDefs`; `updateMeasurementPointDef(id, data, options?)` snapshots the **previous** row state into `measurementPointVersions` (next version = `COALESCE(MAX(version),0)+1`) before applying the update; `getPointsModifiedSince` / `getPointsChangedSinceVersion` filter soft-deleted rows; `deleteProductMachineMapping` left as **hard delete** per spec. |
| `server/routers/productRouters.ts` | Tightened Zod input validation (`code` patterns `^[A-Za-z0-9_\\-]+$`, `id` fields `int().positive()`, coordinates `int().nonnegative().max(100000)`); `measurementPointRouter.create/update` accept optional `shape: enum(["circle","rect","polygon"])` + `geometry: any`; `measurementPointRouter.update` and `productModelRouter.update` accept optional `changeReason: string().max(500)` and pass `{ changedBy: ctx.user.id, changeReason }` through to `updateMeasurementPointDef`; audit logging added to `productModelRouter.create/update/delete`, `measurementPointRouter.create/update/delete/uploadCroppedImage`, and `productMachineMappingRouter.create/update/delete`. All audit calls are wrapped in `try/catch + console.warn` so audit failures never block mutations. |
| `server/routers/statusTemplateRouters.ts` | Tightened Zod on `templateRouter.delete` (id `int().positive()`) and `templateRouter.clone` (`newCode` regex); added audit logging to `templateRouter.create/update/delete/clone` (passing `ctx.user.id` and `ctx.user.name ?? undefined`); same `try/catch + console.warn` guard. `machineStatusRouter` and `bulkImportRouter` in the same file were intentionally not modified. |

No files were created besides the migration and this report. `server/templateDb.ts` was not modified (templates use `isActive` only — per spec, no `deletedAt` on templates in P0).

---

## 2. Migration

**Filename:** `drizzle/0084_p0_soft_delete_audit_versions.sql`

The migration is fully idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) and safe to re-run.

⚠️ **Migration is NOT auto-applied.** Apply it manually via the project's migration runner (e.g. one of the `run-008*-migration.mjs` scripts) or `pnpm` migration command. Recommended:

1. Back up the DB.
2. Run the migration in a transaction.
3. Verify with `\d+ "productModels"`, `\d+ "measurementPointDefs"`, and `\d+ "measurementPointVersions"`.

---

## 3. TypeScript validation

- `tsc` version: **5.9.3**.
- Pre-existing config issue: `tsconfig.json` sets `"ignoreDeprecations": "6.0"`, which tsc 5.9 rejects with `TS5103`. This is **out of P0 scope** and was not modified.
- Workaround used to validate: `pnpm exec tsc --noEmit -p tsconfig.json --ignoreDeprecations 5.0`.
- Result: **0 errors in P0-edited files** (`drizzle/schema/product.ts`, `server/db/product.ts`, `server/routers/productRouters.ts`, `server/routers/statusTemplateRouters.ts`).
- The repository has 293 pre-existing tsc errors in unrelated files; none reference P0-edited paths.
- `get_errors` on each modified router file returned clean.

---

## 4. P0 acceptance-criteria checklist

| Criterion | Status |
|---|---|
| `productModels.deletedAt` column added (nullable timestamp) | ✓ |
| `measurementPointDefs.deletedAt` column added | ✓ |
| `measurementPointDefs.shape` column added (`circle` default, NOT NULL) | ✓ |
| `measurementPointDefs.geometry` column added (json, nullable) | ✓ |
| `measurementPointVersions` table created with `unique(pointDefId, version)` | ✓ |
| All product/measurement-point reads filter `isNull(deletedAt)` | ✓ |
| `deleteProductModel` is soft-delete and cascades to active points | ✓ |
| `deleteMeasurementPointDef` is soft-delete | ✓ |
| `deleteProductMachineMapping` remains hard-delete (per spec) | ✓ |
| `updateMeasurementPointDef` snapshots previous row to `measurementPointVersions` | ✓ |
| Version numbering uses `COALESCE(MAX(version),0)+1` (correct first-version case) | ✓ |
| Zod input validation tightened (code regex, positive int IDs, bounded coordinates) | ✓ |
| `shape` + `geometry` accepted on measurement-point create/update | ✓ |
| `changeReason` accepted and persisted via `measurementPointVersions.changeReason` | ✓ |
| `changedBy` recorded from `ctx.user.id` | ✓ |
| Audit logs written for product / point / mapping / template mutations | ✓ |
| Audit failures wrapped (`try/catch + console.warn`) — never block mutations | ✓ |
| `pointsConfigVersion` left untouched (per directive) | ✓ |
| Migration is idempotent | ✓ |

---

## 5. Deviations from spec

1. `productCategoryRouter` mutations were **not** audit-instrumented — explicitly out of P0 scope.
2. `productMachineMappings.delete` is **hard delete** — matches spec; included for clarity.
3. `pointsConfigVersion` is **not bumped** anywhere in the new code paths — matches the directive that P0 must not change versioning behavior.
4. `machineStatusRouter` and `bulkImportRouter` in `statusTemplateRouters.ts` are **untouched** — they handle operational telemetry / bulk import, not the products surface, so they belong to a later phase.
5. `tsconfig.json` `ignoreDeprecations: "6.0"` was **not corrected** — pre-existing issue, out of P0 scope.
6. Audit `entityType` uses `"product"` for product-model and template events and `"mapping"` for product-machine-mapping events. If the audit consumer needs more granular taxonomy (e.g. `"template"`, `"measurement_point"`), surface this in P1.

---

## 6. Reminders for the user

- ⚠️ **Apply migration manually**: `drizzle/0084_p0_soft_delete_audit_versions.sql`. Nothing in P0 auto-runs migrations.
- ⚠️ **Pre-existing tsc errors (293)** in unrelated code paths remain; the repo does not type-check cleanly today, but **no P0 edit contributes to that count**.
- ⚠️ **`tsconfig.json` `ignoreDeprecations: "6.0"`** must be either lowered to `"5.0"` or the project must adopt tsc ≥ 6.0. This is independent of P0.
- After migration is applied, smoke-test:
  1. Create a product → soft-delete it → confirm it disappears from `getProductModels` but remains in DB with `deletedAt` set.
  2. Update a measurement point → confirm a row is appended to `measurementPointVersions` with the **previous** snapshot, `changedBy` and `changeReason` set.
  3. Confirm audit log rows exist for each mutation (`auditLogs` table).

---

## 7. Hand-off to P1

P1 owners can now safely:

- Surface soft-deleted items in admin UI (filtering by `deletedAt IS NOT NULL`).
- Build version-history viewer on top of `measurementPointVersions`.
- Wire `machineApiRouters` to the new soft-delete + version model.
- Update `client/src/pages/ProductModels.tsx` to send `shape` / `geometry` / `changeReason`.
- Decide on bumping `pointsConfigVersion` strategy.
