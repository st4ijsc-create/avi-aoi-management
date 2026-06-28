/**
 * Tenant context for Row-Level Security (Phase 1 WS1.2).
 *
 * STAGED CAPABILITY — not yet wired into the request path. Activate together
 * with drizzle/optional/0001_tenant_rls.sql once the app connects as a
 * non-owner DB role and the rollout has been tested on staging.
 *
 * RLS policies read per-connection GUCs. Because the app uses a shared
 * connection pool, the context must be set with `SET LOCAL` inside a
 * transaction (via set_config(..., is_local => true)) so it never leaks to
 * another request reusing the connection. Use `withTenantScope` to run a unit
 * of work under a tenant context.
 *
 * Example wiring (future, per authenticated request):
 *   await withTenantScope(db, scopeFromUser(ctx.user), async (tx) => {
 *     return tx.select().from(productInspections)...;
 *   });
 */
import { sql } from "drizzle-orm";

export interface TenantScope {
  /** Admin / service: bypass tenant filtering (see all rows). */
  bypass?: boolean;
  /** Factory codes this scope may access. */
  factoryCodes?: string[];
  /** Corporate codes this scope may access. */
  corporateCodes?: string[];
}

type DbLike = {
  transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T>;
};
type TxLike = { execute: (q: unknown) => Promise<unknown> };

/** Apply the tenant GUCs on a transaction handle (SET LOCAL semantics). */
export async function applyTenantContext(tx: TxLike, scope: TenantScope): Promise<void> {
  const factories = (scope.factoryCodes ?? []).join(",");
  const corporates = (scope.corporateCodes ?? []).join(",");
  // set_config(key, value, is_local=true) == SET LOCAL — scoped to this tx.
  // Setting tenant_rls_active='on' activates the RLS policies for THIS tx only;
  // outside a tenant scope the policies stay inert (default-allow), so enabling
  // RLS at the table level never breaks unscoped queries.
  await tx.execute(sql`SELECT set_config('app.tenant_rls_active', 'on', true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_bypass', ${scope.bypass ? "on" : "off"}, true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_factory_codes', ${factories}, true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_corporate_codes', ${corporates}, true)`);
}

/** Run `fn` inside a transaction with the tenant context applied. */
export async function withTenantScope<T>(
  db: DbLike,
  scope: TenantScope,
  fn: (tx: TxLike) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await applyTenantContext(tx, scope);
    return fn(tx);
  });
}

/**
 * Is DB-level tenant RLS enforcement enabled? Read at call time (not module
 * load) so tests / operators can flip it without a process restart.
 *
 * SAFETY: default OFF. When OFF, `runWithTenantScope` is a pure pass-through —
 * it never opens a transaction and never sets any GUC, so the request path is
 * byte-for-byte the legacy behaviour (zero risk, zero cost).
 */
export function isTenantRlsEnabled(): boolean {
  return process.env.TENANT_RLS_ENABLED === "true";
}

/**
 * FLAG-GATED entry point for the data layer.
 *
 * - Flag OFF (default): runs `fn(db)` directly — NO transaction, NO GUCs.
 *   Identical to calling the query on the global pool. This is what keeps the
 *   app safe while RLS is dormant.
 * - Flag ON: runs `fn` inside `withTenantScope(db, scope, fn)` so the
 *   per-transaction GUCs (`SET LOCAL`) activate the RLS policies for exactly
 *   that unit of work on exactly the connection the transaction holds.
 *
 * CONNECTION-MODEL CAVEAT (read server/db/connection.ts): the app uses a SHARED
 * postgres-js pool (max 10). A GUC set with plain `SET` would leak to whichever
 * request next reuses that pooled connection. That is why enforcement MUST go
 * through a transaction with `SET LOCAL` (set_config(..., is_local => true)) —
 * the GUC is bound to the transaction and discarded on COMMIT/ROLLBACK. It is
 * therefore NOT possible to "set the GUC once in middleware for the whole
 * request" on this pool; enforcement is opt-in at the query site via this
 * helper. Middleware only derives the scope (ctx.tenantScope); the data layer
 * decides when to enforce. Tables whose queries are not yet wrapped here remain
 * unenforced even with the flag ON — adoption is incremental and table-by-table.
 */
export async function runWithTenantScope<T>(
  db: DbLike & { transaction: DbLike["transaction"] },
  scope: TenantScope,
  fn: (handle: TxLike) => Promise<T>,
): Promise<T> {
  if (!isTenantRlsEnabled()) {
    // No-op fast path: run against the passed handle with no tx / no GUCs.
    return fn(db as unknown as TxLike);
  }
  return withTenantScope(db, scope, fn);
}
