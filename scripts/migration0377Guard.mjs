/**
 * doc 81 Đợt 11 task H — the R-10-t rule (migration0376Guard.mjs) for 0377: re-applying 0374 AFTER 0377 puts back 0374's
 * request-first bodies of edge_stop_ack_edge / edge_stop_ack_central / edge_stop_resolve (its CREATE OR REPLACE), i.e. the
 * 40P01 lock inversion against the owner change — silently (measured 2026-10-14: a `npm run test:serial` run — whose
 * edgeControlSchema suite re-runs apply-migration-0374 — reverted 0377's lock order on `_test`).
 *
 *   ∀ apply of 0374 on a DB where 0377 is applied: refused before any DDL — unless `--then-0377`, then 0377 is re-applied
 *   right after it (same target).
 *
 * "0377 is applied" = a `__applied_migrations` row for it (any success value: fail closed) OR one of the STOP functions already
 * carrying 0377's device-first body in the catalog (a DB where the ledger row is missing).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FILE_0377 = "0377_pin_invoker_functions_and_stop_lock_order.sql";
export const THEN_0377_FLAG = "--then-0377";
/** files whose re-application reverts what 0377 re-creates (file → what) — those with an apply script that can re-run them */
export const REVERTED_BY_REAPPLY_0377 = Object.freeze({
  "0374_edge_device_ownership_and_lock_authority.sql": "edge_stop_ack_edge / edge_stop_ack_central / edge_stop_resolve (device-first lock order)",
});
/** the marker 0377's STOP function bodies carry (catalog signal) */
export const MARKER_0377 = "0377 lock order";

export class Refused0377Error extends Error {
  constructor(message) {
    super(message);
    this.name = "Refused0377Error";
    this.refused0377 = true;
  }
}

/** Is 0377 in force on this DB (ledger row, or a STOP function with the 0377 body)? `sql` = a postgres.js connection. */
export async function is0377Applied(sql) {
  const [t] = await sql`SELECT to_regclass('public.__applied_migrations') IS NOT NULL AS ok`;
  if (t.ok) {
    const [r] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${FILE_0377}`;
    if (r.n > 0) return true;
  }
  const [c] = await sql`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname IN ('edge_stop_ack_edge', 'edge_stop_ack_central', 'edge_stop_resolve')
       AND position(${MARKER_0377} in p.prosrc) > 0`;
  return c.n > 0;
}

/** Pure decision for ONE file about to be applied. proceed | then-0377 | refuse (with the message). */
export function decide0377({ file, applied0377, args }) {
  if (!applied0377 || !Object.prototype.hasOwnProperty.call(REVERTED_BY_REAPPLY_0377, file)) return { action: "proceed" };
  if (args.includes(THEN_0377_FLAG)) return { action: "then-0377" };
  return {
    action: "refuse",
    message:
      `Đợt 11 H: 0377 is applied on this DB; re-applying ${file} would restore ${REVERTED_BY_REAPPLY_0377[file]} in 0374's ` +
      `request-first form (40P01 against an owner change). Nothing was run. Re-run with ${THEN_0377_FLAG} to re-apply 0377 right after it.`,
  };
}

/** Re-apply 0377 on ONE target (label "dev" | "test") through its own apply script; throws unless it exited 0. */
export function reapply0377(label, { spawn = spawnSync, log = console.log } = {}) {
  const flag = label === "dev" ? "--dev-only" : label === "test" ? "--test-only" : null;
  if (!flag) throw new Error(`reapply0377: unknown target "${label}"`);
  log(`  [Đợt 11 H] ${label}: re-applying 0377 right after — node scripts/apply-migration-0377.mjs ${flag}`);
  const r = spawn(process.execPath, [path.join(__dirname, "apply-migration-0377.mjs"), flag], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`Đợt 11 H: re-applying 0377 on ${label} FAILED (exit ${r.status}) — the lock order may be reverted: run apply-migration-0377.mjs ${flag} now`);
}

/** The runMigration hooks (apply-migration-dot10-common.mjs `before` / `after`) for a file 0377 can be reverted by. */
export function guard0377Hooks(file) {
  return {
    async before({ sql, args }) {
      const d = decide0377({ file, applied0377: await is0377Applied(sql), args });
      if (d.action === "refuse") throw new Refused0377Error(d.message);
      return d.action === "then-0377";
    },
    after({ label }) {
      reapply0377(label);
    },
  };
}
