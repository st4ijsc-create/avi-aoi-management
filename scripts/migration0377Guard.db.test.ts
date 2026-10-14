/**
 * doc 81 Đợt 11 task H — on the REAL `_test` DB (0377 applied): apply-migration-0374 --test-only WITHOUT --then-0377 exits 1
 * with the refusal and changes nothing — its ledger row keeps its applied_at and the STOP functions keep 0377's device-first
 * body. (Measured before the guard: a `test:serial` run — edgeControlSchema re-runs apply-migration-0374 — silently reverted
 * 0377's lock order on `_test`. The positive path, --then-0377, is what edgeControlSchema.dot10 runs.)
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.DATABASE_URL ?? "";
let sql: ReturnType<typeof postgres>;
beforeAll(() => {
  if (!/_test$/.test(new URL(TEST_URL).pathname)) throw new Error(`refusing: ${new URL(TEST_URL).pathname} is not a _test DB`);
  sql = postgres(TEST_URL, { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await sql?.end({ timeout: 5 });
});
const appliedAt = async (f: string) => (await sql`SELECT applied_at FROM "__applied_migrations" WHERE filename = ${f}`)[0]?.applied_at?.toISOString?.() ?? null;
const OWNER_URL = (() => {
  const u = new URL(TEST_URL);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
})();
const qualifiedTenant = async () => (await sql`SELECT position('OPERATOR(pg_catalog.=)' in pg_get_functiondef('public.app_tenant_allows(text,text)'::regprocedure)) > 0 AS q`)[0].q;
/** the child sees ONLY the _test URL (both DATABASE_URL and TEST_DATABASE_URL): its "dev" target is _test too — never dev */
const childEnv = () => ({ PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL });
const deviceFirst = async () =>
  (await sql`SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
              WHERE s.nspname = 'public' AND p.proname IN ('edge_stop_ack_edge', 'edge_stop_ack_central', 'edge_stop_resolve') AND position('0377 lock order' in p.prosrc) > 0`).map((r) => r.n).sort();

describe("Đợt 11 H — on _test (0377 applied) apply-migration-0374 without --then-0377 refuses and changes nothing", () => {
  it("fuse: 0377 is applied and in force", async () => {
    expect(await appliedAt("0377_pin_invoker_functions_and_stop_lock_order.sql")).not.toBeNull();
    expect(await deviceFirst()).toEqual(["edge_stop_ack_central", "edge_stop_ack_edge", "edge_stop_resolve"]);
  });
  it("apply-migration-0374.mjs --test-only ⇒ exit 1, the refusal, ledger + lock order unchanged", async () => {
    const before = await appliedAt("0374_edge_device_ownership_and_lock_authority.sql");
    const r = spawnSync(process.execPath, [path.join(DIR, "apply-migration-0374.mjs"), "--test-only"], {
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/0377 is applied on this DB/);
    expect(r.stderr).toMatch(/Nothing was run\. Re-run with --then-0377/);
    expect(r.stdout).not.toMatch(/applied \+ verified/);
    expect(await appliedAt("0374_edge_device_ownership_and_lock_authority.sql")).toBe(before);
    expect(await deviceFirst()).toEqual(["edge_stop_ack_central", "edge_stop_ack_edge", "edge_stop_resolve"]);
  }, 90_000);
});

describe("Đợt 11 H fix 1 (H-R2) — apply-migration-0327 after 0377: refused (both of its modes), nothing changed", () => {
  for (const [label, args] of [["--test-only", ["--test-only"]], ["no flag (its dev + test mode; both URLs are _test here)", []]] as const) {
    it(`★ apply-migration-0327.mjs ${label} ⇒ exit 1, the refusal per target, ledger + qualified body unchanged`, async () => {
      const before = await appliedAt("0327_tenant_rls_null_la_du_lieu_dung_chung.sql");
      const r = spawnSync(process.execPath, [path.join(DIR, process.env.DOT11_H_0327 || "apply-migration-0327.mjs"), ...args], { env: childEnv(), encoding: "utf8", timeout: 60_000 });
      expect(r.status, `${r.stdout}
${r.stderr}`).toBe(1);
      expect((r.stderr.match(/0377 is applied on this DB/g) ?? []).length).toBe(args.length ? 1 : 2);
      expect(r.stderr).toMatch(/Re-run with --then-0377/);
      expect(r.stdout).not.toMatch(/applied \+ verified/);
      expect(await appliedAt("0327_tenant_rls_null_la_du_lieu_dung_chung.sql")).toBe(before);
      expect(await qualifiedTenant()).toBe(true);
    }, 90_000);
  }
});

/**
 * migrate-standalone, read-only (--dry-run --force) from a scratch ROOT whose drizzle/ holds only 0327: the R-10-t-style 0377
 * decision runs before anything is applied. The root lives under node_modules/.cache (module resolution walks up to the repo's
 * node_modules); it is removed afterwards.
 */
describe("Đợt 11 H fix 1 (H-R2) — migrate-standalone: 0327 pending after 0377 ⇒ refused; --then-0376 / --then-0377 re-append 0377", () => {
  const root = path.join(DIR, "..", "node_modules", ".cache", `dot11h-ms-${Date.now()}`);
  beforeAll(() => {
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "drizzle"), { recursive: true });
    // DOT11_H_MS (mutation runs only): the runner copied from an untracked mutant instead
    for (const f of ["migrate-standalone.mjs", "migrationEffectiveProbes.mjs", "migration0376Guard.mjs", "migration0377Guard.mjs"]) copyFileSync(path.resolve(DIR, f === "migrate-standalone.mjs" && process.env.DOT11_H_MS ? process.env.DOT11_H_MS : f), path.join(root, "scripts", f));
    copyFileSync(path.join(DIR, "..", "drizzle", "0327_tenant_rls_null_la_du_lieu_dung_chung.sql"), path.join(root, "drizzle", "0327_tenant_rls_null_la_du_lieu_dung_chung.sql"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const run = (extra: string[]) =>
    spawnSync(process.execPath, [path.join(root, "scripts", "migrate-standalone.mjs"), "--dry-run", "--force", ...extra], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: OWNER_URL },
      encoding: "utf8",
      timeout: 60_000,
    });
  it("★ no flag ⇒ exit 1, REFUSED (0377), nothing listed to apply", async () => {
    const before = await appliedAt("0327_tenant_rls_null_la_du_lieu_dung_chung.sql");
    const r = run([]);
    expect(r.status, `${r.stdout}
${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/REFUSED: Đợt 11 H: 0377 is applied on this DB/);
    expect(await appliedAt("0327_tenant_rls_null_la_du_lieu_dung_chung.sql")).toBe(before);
    expect(await qualifiedTenant()).toBe(true);
  }, 90_000);
  for (const flag of ["--then-0376", "--then-0377"]) {
    it(`★ ${flag} ⇒ 0377 is appended LAST (dry run: listed, nothing applied)`, async () => {
      const r = run([flag]);
      expect(r.status, `${r.stdout}
${r.stderr}`).toBe(0);
      const listed = [...r.stdout.matchAll(/→ (\S+\.sql)/g)].map((m) => m[1]);
      expect(listed[listed.length - 1]).toBe("0377_pin_invoker_functions_and_stop_lock_order.sql");
      expect(listed).toContain("0327_tenant_rls_null_la_du_lieu_dung_chung.sql");
      expect(await qualifiedTenant()).toBe(true);
    }, 90_000);
  }
});
