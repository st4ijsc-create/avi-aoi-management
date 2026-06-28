# Phase 1 WS1.2/WS4 — Tenant RLS rollout (safe-by-default)

Tenant isolation was **app-layer only** (`server/_core/accessControl.ts`). This
adds **database-enforced** isolation via PostgreSQL Row-Level Security, designed
so it can be **enabled on every tenant table without breaking the app**, then
tightened.

## The safe-by-default design
`drizzle/optional/0002_tenant_rls_all.sql` defines `app_tenant_allows()` to be
**inert** — it returns TRUE (allow-all) unless the connection sets
`app.tenant_rls_active='on'`. Enforcement only happens inside
`withTenantScope()`, which sets that GUC (plus the codes / bypass) with
`SET LOCAL` for one transaction. So:

- Enable RLS on the tables now → unscoped queries (global `db`) keep working.
- Queries run via `withTenantScope(db, scope, fn)` → policies enforce.
- Admin/service: `withTenantScope(db, { bypass: true }, fn)` → see all.

## What's wired
- **Migration** `drizzle/optional/0002_tenant_rls_all.sql` — RLS + policies on `product_inspections` and `inspection_packages` (the tables with denormalized tenant codes) + limited-role template. Operator-applied (runner doesn't auto-apply `drizzle/optional/`).
- **Middleware** `tenantScopeMiddleware` in `server/_core/trpc.ts` (flag `TENANT_RLS_ENABLED`, default off) — derives the caller's scope via `getTenantScope` and exposes it on `ctx.tenantScope`.
- **Mechanism** `server/db/tenantContext.ts` — `withTenantScope(db, scope, fn)` sets the GUCs (incl. `tenant_rls_active='on'`) per transaction.

## Remaining step (data-layer adoption)
The middleware provides `ctx.tenantScope`; the **data-layer queries on tenant
tables must run inside `withTenantScope`** for enforcement to take effect, e.g.:

```ts
// inside a protected procedure
return withTenantScope(db, ctx.tenantScope, (tx) =>
  tx.select().from(productInspections)...   // RLS enforced for this tx
);
```

This adoption is incremental and testable table-by-table.

## Hard preconditions
1. **App must connect as a NON-owner role** (template in the SQL) — RLS is bypassed for the table owner / superusers.
2. Test on staging: confirm a non-admin sees only their factories' rows under `withTenantScope`, and admin/bypass sees all; confirm unscoped queries are unaffected before adoption.

## Child tables
`measurement_results`, `process_results`, `package_images`, … have no
denormalized tenant code; they reach the tenant via a join. Enable RLS on them
only after adding a denormalized code or an EXISTS-subquery policy — otherwise a
scoped query returns zero child rows. Tracked as follow-up.

---

## Phase 1 WS4 EXTEND — master-data policies + request-path wiring (2026-06)

This pass wires the flag into the request path and extends RLS coverage to the
new master-data tables. It is **additive and OFF by default**.

### What changed
- **`drizzle/0122_tenant_rls_extend.sql`** (auto-applied top-level migration) —
  enables RLS + adds `tenant_select` / `tenant_modify` policies on the four
  master-data tables that carry **both** `corporateCode` and `factoryCode`:
  `suppliers`, `materials`, `customers`, `tools`. It re-defines the inert
  `app_tenant_allows()` helper (same as `drizzle/optional/0002_tenant_rls_all.sql`)
  so it is self-contained and idempotent.
  - File number is `0122` (not `0101` — that number is already taken by two
    existing migrations). It lives top-level because it is written to be safe
    even when auto-applied (fail-open, inert-by-default).
- **`server/db/tenantContext.ts`** — added `isTenantRlsEnabled()` and
  `runWithTenantScope(db, scope, fn)`. With the flag **OFF** the latter is a
  pure pass-through (no transaction, no GUC); with the flag **ON** it runs the
  work inside `withTenantScope` (SET LOCAL GUCs).
- **`server/_core/trpc.ts`** — `tenantScopeMiddleware` (already present) derives
  `ctx.tenantScope` only when `TENANT_RLS_ENABLED=true`; unchanged.
- **Flag** `TENANT_RLS_ENABLED` documented (commented, OFF) in `.env` / `.env.example`.

### Why `process_results` / `oee_metrics` / `wip_tracking` are NOT enforced yet
Verified against the schema: **none** of these three carry a `corporateCode` /
`factoryCode` column (they have `lineCode`, `machineCode`, `lineId`
respectively). The factory code is several hops away in the hierarchy
(`machine → station → line → workshop → factory`). Enabling a column-based
policy would error; enabling a broken join-based policy would silently return
**zero rows** once the flag is on. `0122` therefore ships only commented
SKELETONS for them with the join left as a TODO. Do not uncomment until the
multi-hop join is validated on staging.

### Connection-model caveat (important)
The app uses a **shared `postgres-js` pool** (`max: 10`, see
`server/db/connection.ts`). A GUC set with plain `SET` would leak to the next
request that reuses the connection. Enforcement therefore **cannot** be applied
once-per-request in middleware; it must use `SET LOCAL` inside a transaction
(`runWithTenantScope`). Consequence: a tenant-table query is only enforced if
its call site wraps it in `runWithTenantScope`. Middleware only computes the
scope; **data-layer adoption is incremental and table-by-table**.

### Go-live steps (operator)
1. **Provision the non-owner role** (RLS is bypassed for the table owner /
   superuser). Use the role template at the bottom of
   `drizzle/optional/0002_tenant_rls_all.sql`, then point `DATABASE_URL` at it.
2. **Apply the migration.** `0122_tenant_rls_extend.sql` runs automatically via
   `node scripts/migrate-standalone.mjs` (or your normal migrate step). It is
   idempotent.
3. **Verify FAIL-OPEN with the flag still OFF.** With `TENANT_RLS_ENABLED`
   unset, log in as a non-admin scoped to one factory and confirm the
   master-data screens (suppliers/materials/customers/tools) still show all
   rows — RLS is dormant because the `app.tenant_rls_active` GUC is never set.
   This proves the migration did not break anything.
4. **Enable the flag.** Set `TENANT_RLS_ENABLED=true` and restart the server.
5. **Verify scoping per role** (on staging first):
   - Non-admin scoped to factory `F01` → sees only `F01`/their corporate rows in
     any query routed through `runWithTenantScope`.
   - Admin → `bypass` GUC set → sees all rows.
   - A query NOT yet wrapped in `runWithTenantScope` → still sees all rows
     (expected; adoption is incremental).
6. **Rollback** (no data loss, instant): set `TENANT_RLS_ENABLED=false` and
   restart. The GUC is never set, `app_tenant_allows()` short-circuits to allow,
   and every row is visible again. To also remove the policies, run the per-table
   rollback block at the bottom of `0122_tenant_rls_extend.sql`.

### Test coverage
`server/db/__tests__/tenantContext.test.ts` asserts: `getTenantScope` shape per
role (admin → bypass, scoped user → codes); `runWithTenantScope` is a no-op
(no transaction) when the flag is OFF and opens a transaction + sets the GUCs
when ON; and the `0122` migration SQL shape (RLS enabled + fail-open helper for
each master-data table, hot tables left commented).
