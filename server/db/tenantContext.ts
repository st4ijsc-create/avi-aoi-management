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
