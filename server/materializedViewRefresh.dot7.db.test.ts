/**
 * doc 81 Đợt 7 task K4 — the REAL refresh cycle against the isolated `_test` DB, as the app role.
 *
 * On dev every cycle failed with 42501 "permission denied for materialized view machine_status_latest": the app runs as
 * `avi_app`, the QW3 views belong to `aoi`, and REFRESH needs the owner or (PG 17+) MAINTAIN. Migration 0366 grants
 * MAINTAIN on exactly the two views. This file measures the outcome (a refresh that succeeds) and that the grant stayed
 * narrow (no ownership, no ALTER) — not the mechanism.
 *
 * Needs 0366 applied to `_test` (`node scripts/apply-migration-0366.mjs --test-only`); before it, the first case is red
 * with the same 42501 as dev.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getJobsDb } from "./db/connection";
import { refreshQwCachesOnce, getMatviewRefreshInfo } from "./services/materializedViewRefreshService";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const d = await getJobsDb();
  const r = (await d!.execute(q)) as unknown as Row[] | { rows: Row[] };
  return Array.isArray(r) ? r : r.rows;
}

afterAll(async () => {
  // nothing to clean: a refresh rewrites the two caches from their sources; db_feature_status keeps one upserted row.
});

describe("K4 — refresh_qw_caches() runs as the app role on _test", () => {
  it("fixture is real: connected as a NON-owner, non-superuser role (the dev situation)", async () => {
    const [who] = await rows(sql`
      SELECT current_user AS u, current_database() AS db, r.rolsuper AS su,
             (SELECT bool_or(pg_has_role(current_user, c.relowner, 'MEMBER')) FROM pg_class c
               WHERE c.relname IN ('machine_status_latest', 'hourly_yield_cache')) AS owner_member
        FROM pg_roles r WHERE r.rolname = current_user`);
    expect(String(who.db)).toMatch(/_test$/);
    expect(who.su).toBe(false);
    expect(who.owner_member).toBe(false);
  });

  it("refreshQwCachesOnce() succeeds and records status ok", async () => {
    const ok = await refreshQwCachesOnce();
    expect(getMatviewRefreshInfo().lastError).toBeNull();
    expect(ok).toBe(true);
    const [st] = await rows(sql`SELECT status FROM db_feature_status WHERE feature = 'matview_refresh_qw'`);
    expect(st.status).toBe("ok");
  });

  it("the grant is narrow: MAINTAIN on the two views only; the app role still cannot ALTER them", async () => {
    const priv = await rows(sql`
      SELECT c.relname, has_table_privilege(c.oid, 'MAINTAIN') AS m
        FROM pg_class c WHERE c.relname IN ('machine_status_latest', 'hourly_yield_cache') ORDER BY 1`);
    expect(priv).toEqual([
      { relname: "hourly_yield_cache", m: true },
      { relname: "machine_status_latest", m: true },
    ]);
    const [pm] = await rows(sql`SELECT pg_has_role(current_user, 'pg_maintain', 'MEMBER') AS m`);
    expect(pm.m).toBe(false);
    let code: string | null = null;
    try {
      await rows(sql`ALTER MATERIALIZED VIEW machine_status_latest SET (fillfactor = 100)`);
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      code = err.cause?.code ?? err.code ?? "unknown";
    }
    expect(code).toBe("42501");
  });
});
