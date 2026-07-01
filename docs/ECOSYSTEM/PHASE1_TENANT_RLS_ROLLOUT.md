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

---

## Phase 1 WS4 EXTEND ② — HOT time-series tables via factory-join helpers (2026-06)

`drizzle/0125_tenant_rls_hot_tables.sql` (auto-applied top-level migration)
promotes the three commented SKELETONS from `0122` into **real, fail-open**
policies. These tables have **no** denormalized tenant column, so the factory is
resolved through the hierarchy by `STABLE` `SECURITY DEFINER` helper functions.

### Verified join columns (against `drizzle/schema/{oee,process,mes,hierarchy}.ts`, 2026-06-28)
| Table | Key column | Resolver | Join path → `factories.code` |
|---|---|---|---|
| `oee_metrics` | `machineCode` (varchar, UNIQUE on `machines.code`) | `app_factory_of_machine_code(text)` | machines→stations→production_lines→workshops→factories |
| `process_results` | `lineCode` (varchar, nullable) | `app_factory_of_line_code(text)` | production_lines(`code`)→workshops→factories |
| `wip_tracking` | `lineId` (int, nullable) | `app_factory_of_line_id(int)` | production_lines(`id`)→workshops→factories |

Hierarchy hops: `machines.stationId→stations.id`, `stations.lineId→production_lines.id`,
`production_lines.workshopId→workshops.id`, `workshops.factoryId→factories.id`.
The factory code column is `factories.code` (UNIQUE).

**Caveat:** `production_lines.code` is **not** globally unique (only `idx_lines_code`,
no UNIQUE constraint). `app_factory_of_line_code` uses `LIMIT 1`; line codes that
collide across factories can't be disambiguated from `lineCode` alone (documented
in the SQL). `machineCode` and `lineId` resolve to exactly one factory.

### Policies + fail-open composition (reused from 0122)
Each policy composes the **same** inert-by-default helper with a resolver, e.g.
`USING ( app_tenant_allows( app_factory_of_machine_code("machineCode"), NULL ) )`,
and a matching `FOR ALL` + `WITH CHECK` (same shape as `0122`). `app_tenant_allows`
checks the GUCs **first**, so:
- **Flag OFF / GUC unset / table owner / unscoped query → TRUE (allow-all).** No
  lockout. This is the fail-open guarantee.
- **Resolver returns NULL** (orphan row / NULL key / broken link) → with the flag
  ON, a scoped non-bypass user does **not** see that row (intended: a row we can't
  attribute to the user's factory is hidden). Admin/`bypass` and the flag-OFF
  default still see everything. There is **no global lockout** — turning the flag
  off restores full visibility instantly.

### Why `SECURITY DEFINER`
The resolver must read the hierarchy tables even from a scoped, RLS-restricted
role (and even if RLS is later added to hierarchy tables); it returns only a
factory **code**, never row data. `search_path` is pinned to `public, pg_temp`.

### Performance
Resolvers are `STABLE` → evaluated at most once per distinct argument per
statement (not per row). Every join key is already indexed (`idx_machines_code`,
`idx_machines_station`, `idx_lines_code`, `idx_lines_workshop`,
`idx_workshops_factory`, PKs) — no missing supporting index.

### Idempotent + guarded
`CREATE OR REPLACE FUNCTION` for the helper + resolvers; `ENABLE RLS` is a no-op
if already on; policies are `DROP ... IF EXISTS` then re-created; the policy block
is wrapped in a `DO` guard that skips if `app_tenant_allows` is missing.

### Adoption caveat (same as 0122)
Enforcement on these tables only takes effect when the call site wraps the query
in `runWithTenantScope` **and** `TENANT_RLS_ENABLED=true`. Until then the
migration is fully inert (fail-open).

### Verification step
1. **Fail-open with the flag OFF** (`TENANT_RLS_ENABLED` unset): a non-admin
   scoped to one factory still sees **all** `oee_metrics` / `process_results` /
   `wip_tracking` rows (the `app.tenant_rls_active` GUC is never set). Proves no
   breakage.
2. **Flag ON, scoped user** (query routed through `runWithTenantScope`): a user
   scoped to factory `F01` sees **only** rows whose resolved factory is `F01`
   (e.g. OEE rows for machines in `F01`'s lines). Rows whose factory can't be
   resolved are hidden from the scoped user.
3. **Admin / bypass** (`app.tenant_bypass='on'`): sees **all** rows regardless of
   factory — admin bypasses the policy.
4. **Rollback:** set `TENANT_RLS_ENABLED=false` (instant, no data loss) or run the
   per-table rollback block at the bottom of `0125_tenant_rls_hot_tables.sql`.

---

## U6-a — isolation-hole backfill (doc 21 §6 U6 / G-9, 2026-07)

`drizzle/0156_tenant_scope_isolation_holes.sql` (auto-applied top-level migration,
additive + idempotent) closes **G-9**: three table families that carried NO tenant
columns and NO RLS — unlike the uniform Khối-2/3/7 tables — now reach the SAME
inert-by-default isolation posture. **Schema + inert policy only; NO query
behaviour changed.**

### Tables backfilled (each gets `corporateCode` varchar(50) + `factoryId` int, nullable)
| Family | Tables | Schema file |
|---|---|---|
| Device Programming / IR (G-9) | `program_projects`, `program_artifacts`, `program_builds`, `program_sim_runs`, `program_deployments`, `program_symbols` | `drizzle/schema/programming.ts` |
| IMAGE anomaly banks/profiles (G-9) | `ai_anomaly_memory_bank`, `ai_anomaly_profiles` (note: `robot_behavior_anomalies` was already scoped in `aiLoop.ts`) | `drizzle/schema/ai.ts` |
| Predictive / maintenance (G-9) | `maintenance_schedules`, `maintenance_work_orders` | `drizzle/schema/mes.ts` |

### Pattern (mirrors 0145 / 0153 exactly)
- `ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50)` + `"factoryId" integer` on
  each table (existing rows get `NULL` = unscoped = allow-all under the inert
  policy — fully backward-compatible).
- `ENABLE ROW LEVEL SECURITY` + `tenant_select` (FOR SELECT) + `tenant_modify`
  (FOR ALL, WITH CHECK) policies, each composing the shared inert helper
  `app_tenant_allows(NULL, "corporateCode")`. factory is passed `NULL` (these tables
  scope by `corporateCode` + optional `factoryId` int, not a factory CODE string).
- The whole RLS block is wrapped in a `DO` guard (skips a table if absent / helper
  missing). `CREATE OR REPLACE FUNCTION` re-defines the inert helper so the
  migration is self-contained + re-runnable.

### Fail-open guarantee (identical to the earlier passes)
WITHOUT the session GUC — flag `TENANT_RLS_ENABLED` OFF (default), or table owner,
or any query not wrapped in `runWithTenantScope` — `app_tenant_allows()` returns
TRUE = allow-all. So this migration is a **complete no-op by default**. Enforcement
only takes effect for a query wrapped in `runWithTenantScope` when the flag is ON,
exactly like the established Khối-2/3/7 tables. No data-layer call site is changed.

### Rollback
Set `TENANT_RLS_ENABLED=false` (instant, no data loss). To also drop the policies +
disable RLS, run the commented rollback block at the bottom of
`0156_tenant_scope_isolation_holes.sql` (the columns are harmless and can stay).

### Test coverage
`server/services/ecosystem/tenantScopeU6.test.ts` (11) asserts the schema TS was
updated to match the migration — each of the 10 tables exposes `corporateCode` +
`factoryId`, and `corporateCode` maps to the exact DB column name the RLS predicate
uses.
