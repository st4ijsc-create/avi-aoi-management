/**
 * doc 81 Đợt 10 task F2 — ruling R-10-t: the apply scripts of 0316 / 0363 / 0369 / 0370 / 0371 (and 0125, through
 * migrate-standalone — the only runner of 0125 / 0316) refuse when 0376 is applied, unless 0376 is re-applied right after.
 * Unit + structure here (no DB); the real refusal on `_test` is in migration0376Guard.db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as G from "./migration0376Guard.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const F0376 = "0376_pin_function_search_path.sql";

/** A postgres.js-shaped fake: tagged template → the next canned answer; records the SQL text. */
function fakeSql(answers: unknown[][]) {
  const seen: string[] = [];
  const fn = (strings: TemplateStringsArray) => {
    seen.push(strings.join("?"));
    return Promise.resolve(answers.shift() ?? []);
  };
  return { fn, seen };
}

describe("R-10-t — decide0376 (pure)", () => {
  const ALL = ["0125_tenant_rls_hot_tables.sql", "0316_loginmethod_noi_bo_guard.sql", "0363_engineering_assignments.sql", "0369_api_key_holder_identity.sql", "0370_edge_run_execution.sql", "0371_safety_event_trust_and_read_mode.sql"];

  it("the guarded set is exactly the files whose functions 0376 re-pins", () => {
    expect(Object.keys(G.REVERTED_BY_REAPPLY).sort()).toEqual([...ALL].sort());
    // every function 0376 re-creates / re-pins is listed (cross-check with the migration text)
    const sql0376 = readFileSync(path.join(DIR, "..", "drizzle", F0376), "utf8");
    for (const fn of G.PINNED_BY_0376) expect(sql0376, fn).toContain(fn);
  });

  for (const f of ALL) {
    it(`${f}: 0376 applied, no flag ⇒ refuse (message names the flag)`, () => {
      const d = G.decide0376({ files: [f], applied0376: true, args: ["--test-only"] });
      expect(d.action).toBe("refuse");
      expect(d.message).toContain("--then-0376");
      expect(d.message).toContain(f);
    });
  }
  it("0376 applied + --then-0376 ⇒ then-0376", () => {
    expect(G.decide0376({ files: ["0371_safety_event_trust_and_read_mode.sql"], applied0376: true, args: ["--test-only", "--then-0376"] }).action).toBe("then-0376");
  });
  it("0376 NOT applied ⇒ proceed (a fresh DB applies 0363–0371 then 0376 in order)", () => {
    expect(G.decide0376({ files: ["0363_engineering_assignments.sql"], applied0376: false, args: [] }).action).toBe("proceed");
  });
  it("a file 0376 does not re-pin ⇒ proceed", () => {
    expect(G.decide0376({ files: ["0372_edge_step_authorizations.sql", "0327_tenant_rls_null_la_du_lieu_dung_chung.sql"], applied0376: true, args: [] }).action).toBe("proceed");
  });
  it("migrate-standalone --force: 0376 runs AFTER the reverting files in the same pass ⇒ proceed", () => {
    expect(G.decide0376({ files: [...ALL, "0372_x.sql", F0376, "0377_y.sql"], applied0376: true, args: ["--force"] }).action).toBe("proceed");
  });
  it("0376 listed BEFORE a reverting file (wrong order) ⇒ still refused", () => {
    expect(G.decide0376({ files: [F0376, "0371_safety_event_trust_and_read_mode.sql"], applied0376: true, args: [] }).action).toBe("refuse");
  });
});

describe("R-10-t — is0376Applied / guard0376BeforeDdl / reapply0376", () => {
  it("ledger row present ⇒ applied (catalog not even asked)", async () => {
    const s = fakeSql([[{ ok: true }], [{ n: 1 }]]);
    expect(await G.is0376Applied(s.fn)).toBe(true);
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1]).toContain('"__applied_migrations"');
  });
  it("no ledger row but a pinned function in the catalog ⇒ applied (fail closed)", async () => {
    const s = fakeSql([[{ ok: true }], [{ n: 0 }], [{ n: 3 }]]);
    expect(await G.is0376Applied(s.fn)).toBe(true);
    expect(s.seen[2]).toContain("proconfig");
  });
  it("no ledger table and nothing pinned ⇒ not applied", async () => {
    const s = fakeSql([[{ ok: false }], [{ n: 0 }]]);
    expect(await G.is0376Applied(s.fn)).toBe(false);
  });
  it("guard: applied, no flag ⇒ throws Refused0376Error BEFORE any DDL; with flag ⇒ true; not applied ⇒ false", async () => {
    await expect(G.guard0376BeforeDdl({ sql: fakeSql([[{ ok: true }], [{ n: 1 }]]).fn, file: "0370_edge_run_execution.sql", args: ["--test-only"] })).rejects.toMatchObject({ refused0376: true });
    expect(await G.guard0376BeforeDdl({ sql: fakeSql([[{ ok: true }], [{ n: 1 }]]).fn, file: "0370_edge_run_execution.sql", args: ["--test-only", "--then-0376"] })).toBe(true);
    expect(await G.guard0376BeforeDdl({ sql: fakeSql([[{ ok: true }], [{ n: 0 }], [{ n: 0 }]]).fn, file: "0370_edge_run_execution.sql", args: ["--test-only"] })).toBe(false);
  });
  it("reapply0376 runs apply-migration-0376.mjs on the SAME target only, and throws unless it exited 0", () => {
    const calls: string[][] = [];
    const ok = (_: string, a: string[]) => (calls.push(a), { status: 0 });
    G.reapply0376("test", { spawn: ok, log: () => {} });
    G.reapply0376("dev", { spawn: ok, log: () => {} });
    expect(calls.map((a) => [path.basename(a[0]), a[1]])).toEqual([["apply-migration-0376.mjs", "--test-only"], ["apply-migration-0376.mjs", "--dev-only"]]);
    expect(() => G.reapply0376("test", { spawn: () => ({ status: 1 }), log: () => {} })).toThrow(/re-applying 0376 on test FAILED/);
    expect(() => G.reapply0376("both", { spawn: ok, log: () => {} })).toThrow(/unknown target/);
  });
});

describe("R-10-t — every runner that can re-apply a guarded file calls the guard (structure)", () => {
  for (const n of ["0363", "0369", "0370", "0371"]) {
    it(`apply-migration-${n}.mjs: guard BEFORE sql.unsafe(content), re-apply 0376 AFTER the success line`, () => {
      const src = readFileSync(path.join(DIR, `apply-migration-${n}.mjs`), "utf8");
      expect(src).toContain('from "./migration0376Guard.mjs"');
      const g = src.indexOf("await guard0376BeforeDdl({ sql, file: MIGRATION_FILE");
      const ddl = src.indexOf("await sql.unsafe(content)");
      const ok = src.search(/console\.log\(`\$\{TAG\} \$\{label\}: applied \+ verified/);
      const re = src.indexOf("if (then0376) reapply0376(label)");
      expect(g, "guard call").toBeGreaterThan(0);
      expect(g, "guard must run before the DDL").toBeLessThan(ddl);
      expect(re, "0376 re-applied after the success line").toBeGreaterThan(ok);
      expect(ok).toBeGreaterThan(ddl);
    });
  }
  it("migrate-standalone.mjs decides on the pending list BEFORE applying anything", () => {
    const src = readFileSync(path.join(DIR, "migrate-standalone.mjs"), "utf8");
    const d = src.indexOf("decide0376({ files: pending");
    const apply = src.indexOf("Applying migrations...");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(apply);
    expect(src).toContain("process.exit(1)");
  });
  it("0316 / 0125 have no dedicated apply script (migrate-standalone is their only runner) — if one appears it must be guarded too", () => {
    const names = readdirSync(DIR);
    for (const n of ["0125", "0316"]) {
      const s = names.find((f) => f.startsWith(`apply-migration-${n}`) && f.endsWith(".mjs"));
      if (s) expect(readFileSync(path.join(DIR, s), "utf8"), s).toContain("guard0376BeforeDdl");
    }
  });
});
