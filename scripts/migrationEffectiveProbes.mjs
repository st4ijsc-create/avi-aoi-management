/**
 * doc 81 Đợt 10 task F2 round 2 (ruling R-10-bj, the `_test` 0125 ledger) — the SANCTIONED way for migrate-standalone to record a
 * migration whose effect is ALREADY in the database but which can never be (re-)run to success, instead of re-running it on
 * every pass.
 *
 * Why it exists (measured 2026-10-13 on aoi_management_test; 0328's header measured the same on dev on 2026-08-18):
 *   • 0125 is `success = false` for ever: its last statement (a DO block that ENABLEs RLS on hot tables) fails with 0A000
 *     "operation not supported on hypertables that have columnstore enabled" — by design, see 0328 (which applied what CAN be
 *     applied). Its first four statements DO commit (app_tenant_allows + the three app_factory_of_* resolvers). Because the row
 *     stays false, every migrate-standalone pass re-runs it: that REVERTS 0327 (app_tenant_allows without the NULL/NULL branch —
 *     exactly the `_test` drift of 2026-09-05) and un-pins the 0376 resolvers.
 *   • 0057 / 0066 / 0234 failed on the same pass with "already exists" / "concurrent index on a hypertable" although their
 *     objects ARE present.
 *
 * Rule: a file listed here is recorded `success = true` WITHOUT being executed ONLY when its probe proves, in the catalog, that
 * every object it is there to create exists (and, for 0125, that 0328 — the decision that its RLS block cannot apply — is
 * recorded). A failing probe leaves the file pending and it runs as before. Probes are read-only, deterministic and reviewed here.
 */

/** @type {Record<string, { why: string; probe: (sql: any) => Promise<{ ok: boolean; detail: string }> }>} */
export const EFFECTIVE_PROBES = {
  "0057_resilient_mqtt_subscriptions_unique.sql": {
    why: "a VALID UNIQUE index mqtt_subscriptions_client_topic_unique on (clientId, topic) exists (the DO block's ADD CONSTRAINT then fails 42P07)",
    async probe(sql) {
      const [r] = await sql`
        SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'mqtt_subscriptions_client_topic_unique' AND i.indisunique AND i.indisvalid
           AND i.indrelid = to_regclass('public.mqtt_subscriptions')
           AND pg_get_indexdef(i.indexrelid) LIKE '%("clientId", topic)%'`;
      return { ok: r.n === 1, detail: `unique valid index: ${r.n}` };
    },
  },
  "0066_spc_quality_gate.sql": {
    why: "its 6 enum types and 6 tables exist (every CREATE then fails 42710 / 42P07)",
    async probe(sql) {
      const types = ["spc_chart_type_enum", "spc_rule_type_enum", "spc_severity_enum", "quality_gate_type_enum", "quality_gate_action_enum", "quality_gate_event_status_enum"];
      const tables = ["spc_configurations", "spc_rule_violations", "cpk_history", "correlation_analyses", "quality_gates", "quality_gate_events"];
      const [t] = await sql`SELECT count(*)::int AS n FROM pg_type WHERE typname = ANY(${types})`;
      const [r] = await sql`SELECT count(*)::int AS n FROM unnest(${tables}::text[]) x WHERE to_regclass('public.' || x) IS NOT NULL`;
      return { ok: t.n === types.length && r.n === tables.length, detail: `types ${t.n}/${types.length}, tables ${r.n}/${tables.length}` };
    },
  },
  "0125_tenant_rls_hot_tables.sql": {
    why:
      "its committable part exists (app_tenant_allows + app_factory_of_machine_code / _line_id / _line_code) and 0328 — which records that the hot-table RLS block CANNOT apply (columnstore hypertables, 0A000) — is applied; re-running it would revert 0327 and un-pin 0376",
    async probe(sql) {
      const fns = ["app_tenant_allows", "app_factory_of_machine_code", "app_factory_of_line_id", "app_factory_of_line_code"];
      const [f] = await sql`SELECT count(DISTINCT p.proname)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = ANY(${fns})`;
      const [l] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = '0328_tenant_rls_bang_nong_cai_lam_duoc.sql' AND success = true`;
      const base = f.n === fns.length && l.n === 1;
      if (!base) return { ok: false, detail: `functions ${f.n}/${fns.length}, 0328 applied ${l.n === 1}` };
      // doc 81 Đợt 10 final fix wave (M-3) — the 0327 BODY must be in force: a past 0125 re-run reverts it (the `_test` drift of
      // 2026-09-05; dev's 0125 is success=false). Recording 0125 over a reverted body would hide that drift for good ⇒ REFUSE.
      const rows = await sql`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'app_tenant_allows' LIMIT 1`;
      const body = String(rows?.[0]?.d ?? "");
      if (!/p_factory\s+IS\s+NULL\s+AND\s+p_corporate\s+IS\s+NULL/i.test(body)) {
        return {
          ok: false,
          refuse: true,
          detail:
            `app_tenant_allows does NOT have the 0327 body (the NULL/NULL shared-data branch${body ? "" : " — body unreadable"}): a past 0125 run reverted it. ` +
            "Re-apply 0327 (node scripts/apply-migration-0327.mjs, owner role; --then-0377 where 0377 is applied), then 0376 (node scripts/apply-migration-0376.mjs), then 0377 (node scripts/apply-migration-0377.mjs) on this DB, then run migrate-standalone again — 0125 is recorded only over the 0327 body",
        };
      }
      return { ok: true, detail: `functions ${f.n}/${fns.length}, 0328 applied, 0327 body in force` };
    },
  },
  "0234_perf_indexes.sql": {
    why: "a VALID index idx_results_pointdef_created on measurement_results (pointDefId, createdAt) exists (CREATE INDEX CONCURRENTLY is refused on a hypertable, 0A000)",
    async probe(sql) {
      const [r] = await sql`
        SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'idx_results_pointdef_created' AND i.indisvalid AND i.indrelid = to_regclass('public.measurement_results')
           AND pg_get_indexdef(i.indexrelid) LIKE '%("pointDefId", "createdAt")%'`;
      return { ok: r.n === 1, detail: `valid index: ${r.n}` };
    },
  },
};

/**
 * For every PENDING file with a probe: probe it; effective ⇒ (unless dryRun) record `success = true` with its checksum and drop it
 * from the pending list. Returns the files still pending (in order) and what was recorded.
 */
export async function recordEffectiveMigrations(sql, pending, { checksumOf, dryRun = false, log = console.log } = {}) {
  const still = [];
  const recorded = [];
  /** M-3 — a probe that proves the DB is in a state that must be repaired by hand first: nothing may run */
  const refused = [];
  for (const file of pending) {
    const p = EFFECTIVE_PROBES[file];
    if (!p) {
      still.push(file);
      continue;
    }
    let res;
    try {
      res = await p.probe(sql);
    } catch (e) {
      res = { ok: false, detail: `probe error: ${e?.message ?? e}` };
    }
    if (!res.ok && res.refuse) {
      refused.push({ file, detail: res.detail });
      log(`    [REFUSED] ${file} — ${res.detail}`);
      still.push(file);
      continue;
    }
    if (!res.ok) {
      log(`    [PROBE-NO] ${file} — not effective (${res.detail}); it runs as before`);
      still.push(file);
      continue;
    }
    if (!dryRun) {
      const checksum = checksumOf(file);
      await sql`
        INSERT INTO "__applied_migrations" (filename, checksum, success)
        VALUES (${file}, ${checksum}, true)
        ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
    }
    recorded.push(file);
    log(`    [EFFECTIVE${dryRun ? " (dry-run, not recorded)" : ""}] ${file} — ${p.why} (${res.detail}); NOT executed`);
  }
  return refused.length > 0 ? { pending: still, recorded, refused } : { pending: still, recorded };
}
