/**
 * doc 81 Đợt 10 task F2 round 2 (R-10-bj) — migrate-standalone records a migration whose effect is PROVEN present (and that can
 * never run to success) WITHOUT executing it. Unit: the recorder only records what its probe proves, never executes, honours
 * dry-run, keeps the rest pending in order; structure: migrate-standalone records them BEFORE the R-10-t guard and the apply loop,
 * and never under --force. `_test`: every probe is true and nothing is pending (measured after the 2026-10-13 run).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { EFFECTIVE_PROBES, recordEffectiveMigrations } from "./migrationEffectiveProbes.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function fakeSql(answers: Record<string, unknown[]>) {
  const writes: unknown[][] = [];
  const fn = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("INSERT INTO \"__applied_migrations\"")) {
      writes.push(vals);
      return Promise.resolve([]);
    }
    const key = Object.keys(answers).find((k) => q.includes(k));
    return Promise.resolve(key ? answers[key] : [{ n: 0 }]);
  };
  return { fn, writes };
}

describe("R-10-bj — recordEffectiveMigrations", () => {
  it("covers exactly the four files measured on _test, each with a reason", () => {
    expect(Object.keys(EFFECTIVE_PROBES).sort()).toEqual(["0057_resilient_mqtt_subscriptions_unique.sql", "0066_spc_quality_gate.sql", "0125_tenant_rls_hot_tables.sql", "0234_perf_indexes.sql"]);
    for (const p of Object.values(EFFECTIVE_PROBES)) expect(p.why.length).toBeGreaterThan(30);
  });
  it("probe true ⇒ recorded success with the file's checksum and dropped; probe false / error / unlisted ⇒ stays pending, in order", async () => {
    const s = fakeSql({ "mqtt_subscriptions_client_topic_unique": [{ n: 1 }], "idx_results_pointdef_created": [{ n: 0 }] });
    const logs: string[] = [];
    const r = await recordEffectiveMigrations(s.fn, ["0057_resilient_mqtt_subscriptions_unique.sql", "0234_perf_indexes.sql", "0356_x.sql"], { checksumOf: (f: string) => `cs:${f}`, log: (l: string) => logs.push(l) });
    expect(r).toEqual({ pending: ["0234_perf_indexes.sql", "0356_x.sql"], recorded: ["0057_resilient_mqtt_subscriptions_unique.sql"] });
    expect(s.writes).toEqual([["0057_resilient_mqtt_subscriptions_unique.sql", "cs:0057_resilient_mqtt_subscriptions_unique.sql", "cs:0057_resilient_mqtt_subscriptions_unique.sql"]]);
    expect(logs.join("\n")).toMatch(/NOT executed/);
    expect(logs.join("\n")).toMatch(/\[PROBE-NO\] 0234/);
  });
  it("0125 needs BOTH its four functions AND 0328 recorded; a throwing probe keeps the file pending", async () => {
    const no0328 = fakeSql({ "count(DISTINCT p.proname)": [{ n: 4 }], "0328_tenant_rls": [{ n: 0 }] });
    expect((await recordEffectiveMigrations(no0328.fn, ["0125_tenant_rls_hot_tables.sql"], { checksumOf: () => "x", log: () => {} })).pending).toEqual(["0125_tenant_rls_hot_tables.sql"]);
    const three = fakeSql({ "count(DISTINCT p.proname)": [{ n: 3 }], "0328_tenant_rls": [{ n: 1 }] });
    expect((await recordEffectiveMigrations(three.fn, ["0125_tenant_rls_hot_tables.sql"], { checksumOf: () => "x", log: () => {} })).pending).toEqual(["0125_tenant_rls_hot_tables.sql"]);
    const ok = fakeSql({ "count(DISTINCT p.proname)": [{ n: 4 }], "0328_tenant_rls": [{ n: 1 }] });
    expect((await recordEffectiveMigrations(ok.fn, ["0125_tenant_rls_hot_tables.sql"], { checksumOf: () => "x", log: () => {} })).recorded).toEqual(["0125_tenant_rls_hot_tables.sql"]);
    const boom = () => Promise.reject(new Error("db down"));
    expect((await recordEffectiveMigrations(boom, ["0066_spc_quality_gate.sql"], { checksumOf: () => "x", log: () => {} })).pending).toEqual(["0066_spc_quality_gate.sql"]);
  });
  it("dry-run records nothing", async () => {
    const s = fakeSql({ "mqtt_subscriptions_client_topic_unique": [{ n: 1 }] });
    const r = await recordEffectiveMigrations(s.fn, ["0057_resilient_mqtt_subscriptions_unique.sql"], { checksumOf: () => "x", dryRun: true, log: () => {} });
    expect(r.recorded).toEqual(["0057_resilient_mqtt_subscriptions_unique.sql"]);
    expect(s.writes).toEqual([]);
  });
  it("migrate-standalone: recorded BEFORE the R-10-t guard and the apply loop, never under --force", () => {
    const src = readFileSync(path.join(DIR, "migrate-standalone.mjs"), "utf8");
    const rec = src.indexOf("recordEffectiveMigrations(sql, pending");
    expect(rec).toBeGreaterThan(0);
    expect(rec).toBeLessThan(src.indexOf("decide0376({ files: pending"));
    expect(rec).toBeLessThan(src.indexOf("Applying migrations..."));
    expect(src.slice(src.lastIndexOf("if (!FORCE)", rec), rec)).toContain("if (!FORCE)");
  });
});

const TEST_URL = process.env.DATABASE_URL ?? "";
describe.skipIf(!/_test/.test(TEST_URL))("R-10-bj — _test is consistent: every probe true, nothing pending, 0327 + 0376 effective", () => {
  it("measured", async () => {
    const sql = postgres(TEST_URL, { max: 1, onnotice: () => {} });
    try {
      for (const [f, p] of Object.entries(EFFECTIVE_PROBES)) expect((await p.probe(sql)).ok, f).toBe(true);
      const ok = new Set((await sql`SELECT filename FROM "__applied_migrations" WHERE success = true`).map((r) => r.filename as string));
      const { readdirSync } = await import("node:fs");
      const pending = readdirSync(path.join(DIR, "..", "drizzle")).filter((f) => f.endsWith(".sql")).filter((f) => !ok.has(f));
      expect(pending).toEqual([]);
      const [def] = await sql`SELECT pg_get_functiondef('public.app_tenant_allows(text,text)'::regprocedure) AS d`;
      expect(def.d).toMatch(/p_factory IS NULL AND p_corporate IS NULL/); // 0327 in force
      const pinned = await sql`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public'
        AND p.proname IN ('app_factory_of_machine_code','app_factory_of_line_id','app_factory_of_line_code','kiem_xac_thuc_noi_bo') AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]`;
      expect(pinned[0].n).toBe(4); // 0376 in force
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
