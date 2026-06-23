# Phase 1 WS1.2 — Tenant RLS rollout (staged, not yet active)

Today tenant isolation is **app-layer only** (`server/_core/accessControl.ts`
adds `corporateCode/factoryCode` filters). A query bug can cross tenants. This
workstream prepares **database-enforced** isolation via PostgreSQL Row-Level
Security, but ships it **disabled** because it has a wide blast radius and must
be tested against a real DB first.

## Artifacts (ready, inert)
- `drizzle/optional/0001_tenant_rls.sql` — RLS enable + policies (operator-applied; the migration runner does **not** auto-apply `drizzle/optional/`).
- `server/db/tenantContext.ts` — `withTenantScope(db, scope, fn)` sets per-transaction GUCs (`SET LOCAL`) the policies read. **Not yet wired into the request path.**

## Hard preconditions
1. **App must NOT connect as the table owner or a superuser** — RLS is bypassed for them, so it would silently do nothing. Create a dedicated app role with `GRANT`s but no ownership.
2. Every request path that touches tenant tables must run under `withTenantScope` (admin/service → `{ bypass: true }`).

## Recommended sequence
1. Staging DB, non-owner app role.
2. Wire `withTenantScope` into the inspection/process/OEE read+write paths; derive scope from `ctx.user` assignments (mirror `getAccessFilterConditions`).
3. Apply `0001_tenant_rls.sql` on staging; run the suite; confirm cross-tenant queries return zero rows and admin/bypass sees all.
4. Extend policies to `process_results` (lineCode), `oee_metrics` (resolve machine→factory), and other denormalized tables.
5. Add a trigger (follow-up) to keep denormalized tenant codes consistent with the hierarchy, or backfill+validate on write.
6. Roll to production behind a maintenance window; rollback = `DISABLE ROW LEVEL SECURITY` + drop policies (documented in the SQL).

## Why not enabled now
Auto-enabling RLS without the per-request context wired would make non-admin
connections see **zero rows** across the app. The wiring + non-owner role +
end-to-end test is a focused, DB-backed effort — intentionally separated from
this code-readiness commit.
