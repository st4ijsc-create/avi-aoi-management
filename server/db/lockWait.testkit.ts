/**
 * doc 80 Đợt 1 Task 9 fix round 1 — race tests must not release an external lock after a FIXED
 * sleep ("hopefully the other side is queued by now"). This polls `pg_stat_activity` until at
 * least `min` backends are really waiting on a heavyweight lock (`wait_event_type = 'Lock'`),
 * either blocked BY a known holder backend (`holderPid`, from `SELECT pg_backend_pid()` inside the
 * holding transaction) or — when the holder is the app's own pooled connection — whose query text
 * matches `queryLike`. Returns the number of waiters seen (0 on timeout); the caller asserts on it,
 * so a race that never actually queued fails loudly instead of passing vacuously.
 *
 * Test-only helper (imported by *.db.test.ts); no product code imports it.
 */
import type postgres from "postgres";

export async function waitForLockWaiters(
  sql: postgres.Sql,
  opts: { holderPid?: number; queryLike?: string; min?: number; timeoutMs?: number },
): Promise<number> {
  const min = opts.min ?? 1;
  const until = Date.now() + (opts.timeoutMs ?? 15_000);
  let n = 0;
  while (Date.now() < until) {
    const rows = opts.holderPid != null
      ? await sql`SELECT count(*)::int AS n FROM pg_stat_activity
                   WHERE wait_event_type = 'Lock' AND ${opts.holderPid}::int = ANY(pg_blocking_pids(pid))`
      : await sql`SELECT count(*)::int AS n FROM pg_stat_activity
                   WHERE wait_event_type = 'Lock' AND datname = current_database()
                     AND query ILIKE ${opts.queryLike ?? "%"}`;
    n = (rows[0] as { n: number }).n;
    if (n >= min) return n;
    await new Promise((r) => setTimeout(r, 20));
  }
  return n;
}

/** `SELECT pg_backend_pid()` on the holder's transaction. */
export async function backendPid(tx: postgres.TransactionSql): Promise<number> {
  const rows = await tx`SELECT pg_backend_pid() AS pid`;
  return Number((rows[0] as { pid: number }).pid);
}
