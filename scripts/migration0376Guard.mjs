/**
 * doc 81 Đợt 10 task F2 — ruling R-10-t (extended to 0316 by A fix round 3, and to 0125 here): migration 0376 RE-PINS the
 * search_path of functions first created by 0125 (RLS helpers app_factory_of_*), 0316 (kiem_xac_thuc_noi_bo), 0363, 0369,
 * 0370 and 0371. Those migrations `CREATE OR REPLACE` the same functions WITHOUT the pin, so re-applying any of them after
 * 0376 silently restores the unpinned (shadowable, 4 of them exploitable) bodies.
 *
 *   ∀ apply of a file in REVERTED_BY_REAPPLY on a DB where 0376 is applied:
 *     refused before any DDL — unless the caller asked `--then-0376`, in which case 0376 is re-applied right after it.
 *
 * "0376 is applied" = a `__applied_migrations` row for it (any success value — a partial 0376 run counts: fail closed) OR any
 * of its re-created functions already carrying the pinned search_path in the catalog (a DB where the ledger row is missing).
 * Used by apply-migration-0363 / 0369 / 0370 / 0371 (before `sql.unsafe(content)`) and by migrate-standalone.mjs (which is
 * the only runner that can (re-)apply 0125 / 0316).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FILE_0376 = "0376_pin_function_search_path.sql";
export const THEN_0376_FLAG = "--then-0376";
/** The files whose re-application reverts a pin of 0376 (file → what it reverts). */
export const REVERTED_BY_REAPPLY = Object.freeze({
  "0125_tenant_rls_hot_tables.sql": "app_factory_of_machine_code / app_factory_of_line_id / app_factory_of_line_code",
  "0316_loginmethod_noi_bo_guard.sql": "kiem_xac_thuc_noi_bo",
  "0363_engineering_assignments.sql": "orchestration_runs_bump_pending_epoch",
  "0369_api_key_holder_identity.sql": "api_keys_holder_history / orch_runs_api_key_write_once",
  "0370_edge_run_execution.sql": "edge_node_credentials_guard / edge_run_assignment_insert_guard / edge_run_assignment_guard / orch_runs_edge_workflow_pinned",
  "0371_safety_event_trust_and_read_mode.sql": "safety_event_trust_guard",
});
/** Functions 0376 re-creates / re-pins (catalog signal). */
export const PINNED_BY_0376 = Object.freeze([
  "orchestration_runs_bump_pending_epoch", "api_keys_holder_history", "orch_runs_api_key_write_once", "edge_node_credentials_guard",
  "edge_run_assignment_insert_guard", "edge_run_assignment_guard", "orch_runs_edge_workflow_pinned", "safety_event_trust_guard",
  "kiem_xac_thuc_noi_bo", "app_factory_of_machine_code", "app_factory_of_line_id", "app_factory_of_line_code",
]);
export const PINNED_SEARCH_PATH = "search_path=pg_catalog, public, pg_temp";

export class Refused0376Error extends Error {
  constructor(message) {
    super(message);
    this.name = "Refused0376Error";
    this.refused0376 = true;
  }
}

/** Is 0376 in force on this DB (ledger row, or a pinned function in the catalog)? `sql` = a postgres.js connection. */
export async function is0376Applied(sql) {
  const [t] = await sql`SELECT to_regclass('public.__applied_migrations') IS NOT NULL AS ok`;
  if (t.ok) {
    const [r] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${FILE_0376}`;
    if (r.n > 0) return true;
  }
  const [c] = await sql`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = ANY(${[...PINNED_BY_0376]}) AND p.proconfig @> ARRAY[${PINNED_SEARCH_PATH}]::text[]`;
  return c.n > 0;
}

/**
 * Pure decision. `files` = what is about to be (re-)applied, in order; `applied0376` = is0376Applied(); `args` = argv.
 * proceed ⇒ nothing reverts a pin; then-0376 ⇒ apply, then re-apply 0376 (the caller does it); refuse ⇒ nothing may run.
 */
export function decide0376({ files, applied0376, args }) {
  const reverting = files.filter((f) => Object.prototype.hasOwnProperty.call(REVERTED_BY_REAPPLY, f));
  if (!applied0376 || reverting.length === 0) return { action: "proceed", reverting: [] };
  const last = files.lastIndexOf(FILE_0376);
  const lastReverting = Math.max(...reverting.map((f) => files.lastIndexOf(f)));
  if (last > lastReverting) return { action: "proceed", reverting }; // 0376 itself runs after them (migrate-standalone --force)
  if (args.includes(THEN_0376_FLAG)) return { action: "then-0376", reverting };
  return {
    action: "refuse",
    reverting,
    message:
      `R-10-t: 0376 is applied on this DB; re-applying ${reverting.join(", ")} would restore the UNPINNED bodies of ` +
      `${reverting.map((f) => REVERTED_BY_REAPPLY[f]).join("; ")} (search_path shadowing). Nothing was run. ` +
      `Re-run with ${THEN_0376_FLAG} to re-apply 0376 right after it.`,
  };
}

/** For a single-file apply script: call BEFORE `sql.unsafe(content)`. Returns true ⇔ 0376 must be re-applied afterwards. */
export async function guard0376BeforeDdl({ sql, file, args }) {
  const d = decide0376({ files: [file], applied0376: await is0376Applied(sql), args });
  if (d.action === "refuse") throw new Refused0376Error(d.message);
  return d.action === "then-0376";
}

/** Re-apply 0376 on ONE target (label "dev" | "test") through its own apply script; throws unless it exited 0. */
export function reapply0376(label, { spawn = spawnSync, log = console.log } = {}) {
  const flag = label === "dev" ? "--dev-only" : label === "test" ? "--test-only" : null;
  if (!flag) throw new Error(`reapply0376: unknown target "${label}"`);
  log(`  [R-10-t] ${label}: re-applying 0376 (pins) right after — node scripts/apply-migration-0376.mjs ${flag}`);
  const r = spawn(process.execPath, [path.join(__dirname, "apply-migration-0376.mjs"), flag], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`R-10-t: re-applying 0376 on ${label} FAILED (exit ${r.status}) — the pins may be reverted: run apply-migration-0376.mjs ${flag} now`);
}
