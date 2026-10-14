/**
 * doc 81 Đợt 10 final fix wave — M-3 (ruling R-10-br): the 0125 probe proves the 0327 BODY of app_tenant_allows (the NULL/NULL
 * "shared reference data" branch), not only that the function exists. On a DB where a past 0125 re-run reverted 0327 (dev:
 * 0125 success=false — the owner's open question), recording 0125 would hide that drift for good. Then the probe REFUSES:
 * nothing is recorded, nothing is applied (migrate-standalone stops), and the operator is told to re-apply 0327 and then 0376.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// DOT11_H_PROBES (mutation runs only — doc 81 Đợt 11 H fix 1): an untracked copy of the module
const { EFFECTIVE_PROBES, recordEffectiveMigrations } = (await import(process.env.DOT11_H_PROBES || "./migrationEffectiveProbes.mjs")) as typeof import("./migrationEffectiveProbes.mjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BODY_0327 = "SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on' OR (p_factory IS NULL AND p_corporate IS NULL) OR (p_factory IS NOT NULL AND …)";
const BODY_0125 = "SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on' OR (p_factory IS NOT NULL AND …)";

function fakeSql(body: string | null) {
  const writes: unknown[][] = [];
  const fn = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.join("?");
    if (q.includes('INSERT INTO "__applied_migrations"')) {
      writes.push(vals);
      return Promise.resolve([]);
    }
    if (q.includes("count(DISTINCT p.proname)")) return Promise.resolve([{ n: 4 }]);
    if (q.includes("0328_tenant_rls")) return Promise.resolve([{ n: 1 }]);
    if (q.includes("pg_get_functiondef")) return Promise.resolve(body === null ? [] : [{ d: body }]);
    return Promise.resolve([{ n: 0 }]);
  };
  return { fn, writes };
}

describe("final fix wave M-3 — the 0125 probe checks the 0327 body", () => {
  it("★ 0327 in force ⇒ 0125 recorded (unchanged)", async () => {
    const s = fakeSql(BODY_0327);
    const r = await recordEffectiveMigrations(s.fn, ["0125_tenant_rls_hot_tables.sql"], { checksumOf: () => "x", log: () => {} });
    expect(r.recorded).toEqual(["0125_tenant_rls_hot_tables.sql"]);
    expect(r.refused ?? []).toEqual([]);
  });

  it("★ 0327 REVERTED (functions + 0328 present, body without the NULL/NULL branch) ⇒ REFUSED: nothing recorded, the operator is told 0327 then 0376", async () => {
    const s = fakeSql(BODY_0125);
    const logs: string[] = [];
    const r = await recordEffectiveMigrations(s.fn, ["0125_tenant_rls_hot_tables.sql", "0377_x.sql"], { checksumOf: () => "x", log: (l: string) => logs.push(l) });
    expect(r.recorded).toEqual([]);
    expect(s.writes).toEqual([]);
    expect(r.refused).toEqual([{ file: "0125_tenant_rls_hot_tables.sql", detail: expect.stringMatching(/0327.*0376/) }]);
    // doc 81 Đợt 11 H fix 1 (review H-R4): after 0377 the repair must end with 0377 (0327 re-creates app_tenant_allows unqualified)
    expect(r.refused[0].detail).toMatch(/0327 .*--then-0377.*then 0376 .*then 0377 \(node scripts\/apply-migration-0377\.mjs\)/);
    expect(logs.join("\n")).toMatch(/REFUSED/);
  });

  it("the body cannot be read ⇒ refused too (never recorded on a guess)", async () => {
    const r = await recordEffectiveMigrations(fakeSql(null).fn, ["0125_tenant_rls_hot_tables.sql"], { checksumOf: () => "x", log: () => {} });
    expect(r.recorded).toEqual([]);
    expect(r.refused?.map((x: { file: string }) => x.file)).toEqual(["0125_tenant_rls_hot_tables.sql"]);
    expect(Object.keys(EFFECTIVE_PROBES)).toContain("0125_tenant_rls_hot_tables.sql");
  });

  it("migrate-standalone stops (exit 1, nothing applied) when a probe refuses", () => {
    const src = readFileSync(path.join(DIR, "migrate-standalone.mjs"), "utf8");
    const rec = src.indexOf("recordEffectiveMigrations(sql, pending");
    const refuse = src.indexOf("r.refused.length > 0", rec);
    expect(refuse).toBeGreaterThan(rec);
    expect(refuse).toBeLessThan(src.indexOf("Applying migrations..."));
    expect(src.slice(refuse, refuse + 400)).toMatch(/process\.exit\(1\)/);
  });
});
