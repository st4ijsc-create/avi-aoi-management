/**
 * doc 81 Đợt 10 task F2 — ruling R-10-t on the REAL `_test` DB (0376 is applied there): every guarded apply script, run with
 * --test-only and WITHOUT --then-0376, exits 1 with the R-10-t refusal and changes nothing — its ledger row keeps its
 * applied_at and the functions 0376 pinned stay pinned. (The positive path — `--then-0376` re-applies 0376 right after — was
 * run by hand on `_test`, see group-F2-report.md; it is not repeated here because it re-runs DDL on the shared `_test`.)
 * The child gets ONLY the `_test` URL (DATABASE_URL = TEST_DATABASE_URL = vitest.setup's forced test DB): no dev URL exists in
 * its environment, and --test-only never opens the "dev" target.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.DATABASE_URL ?? "";
const SCRIPTS: Array<[string, string]> = [
  ["0363", "0363_engineering_assignments.sql"],
  ["0369", "0369_api_key_holder_identity.sql"],
  ["0370", "0370_edge_run_execution.sql"],
  ["0371", "0371_safety_event_trust_and_read_mode.sql"],
];
const PINNED = ["orchestration_runs_bump_pending_epoch", "api_keys_holder_history", "edge_node_credentials_guard", "safety_event_trust_guard", "kiem_xac_thuc_noi_bo"];

let sql: ReturnType<typeof postgres>;
beforeAll(() => {
  if (!/_test$/.test(new URL(TEST_URL).pathname)) throw new Error(`refusing: ${new URL(TEST_URL).pathname} is not a _test DB`);
  sql = postgres(TEST_URL, { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

const appliedAt = async (f: string) => (await sql`SELECT applied_at FROM "__applied_migrations" WHERE filename = ${f}`)[0]?.applied_at?.toISOString?.() ?? null;
const pinned = async () =>
  (await sql`SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
              WHERE s.nspname = 'public' AND p.proname = ANY(${PINNED}) AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]`).map((r) => r.n).sort();

describe("R-10-t — on _test (0376 applied) a guarded apply script refuses and changes nothing", () => {
  it("fuse: 0376 IS applied on _test and its pins are in place", async () => {
    expect(await appliedAt("0376_pin_function_search_path.sql")).not.toBeNull();
    expect(await pinned()).toEqual([...PINNED].sort());
  });

  for (const [n, file] of SCRIPTS) {
    it(`apply-migration-${n}.mjs --test-only ⇒ exit 1, R-10-t refusal, ledger + pins unchanged`, async () => {
      const before = await appliedAt(file);
      const r = spawnSync(process.execPath, [path.join(DIR, `apply-migration-${n}.mjs`), "--test-only"], {
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(/R-10-t: 0376 is applied on this DB/);
      expect(r.stderr).toMatch(/Nothing was run\. Re-run with --then-0376/);
      expect(r.stdout).not.toMatch(/applied \+ verified/);
      expect(await appliedAt(file)).toBe(before);
      expect(await pinned()).toEqual([...PINNED].sort());
    });
  }
});
