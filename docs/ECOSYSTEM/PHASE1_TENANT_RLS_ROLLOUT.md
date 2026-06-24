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
