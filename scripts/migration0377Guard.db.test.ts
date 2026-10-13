/**
 * doc 81 Đợt 11 task H — on the REAL `_test` DB (0377 applied): apply-migration-0374 --test-only WITHOUT --then-0377 exits 1
 * with the refusal and changes nothing — its ledger row keeps its applied_at and the STOP functions keep 0377's device-first
 * body. (Measured before the guard: a `test:serial` run — edgeControlSchema re-runs apply-migration-0374 — silently reverted
 * 0377's lock order on `_test`. The positive path, --then-0377, is what edgeControlSchema.dot10 runs.)
 */
import { spawnSync } from "node:child_process";
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
