/**
 * doc 81 Đợt 11 task H — the R-10-t rule (migration0376Guard.mjs) for 0377: re-applying a migration that (re-)defines a
 * function 0377 owns puts its pre-0377 body back — for 0374 the request-first STOP ack bodies (40P01 against an owner change),
 * silently (measured 2026-10-14: a `npm run test:serial` run — whose edgeControlSchema suite re-runs apply-migration-0374 —
 * reverted 0377's lock order on `_test`); for 0327 / 0174 / … the unqualified / unpinned bodies.
 *
 *   ∀ apply of a REVERTED_BY_REAPPLY_0377 file on a DB where 0377 is applied: refused before any DDL — unless 0377 runs after
 *   it in the same pass, or `--then-0377` (migrate-standalone: or `--then-0376`) is given — then 0377 is re-applied right after.
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
/**
 * fix 1 (review H-R2 / H-R3) — EVERY migration that (re-)defines a function 0377 re-creates (file → what it reverts); a census
 * test (migration0377Guard.test.ts) keeps this list equal to drizzle/. Runners: apply-migration-0374 (shared runner hook),
 * apply-migration-0327 (its own runner), migrate-standalone (every file; --then-0376 also re-appends 0377).
 */
const TENANT = "app_tenant_allows (qualified body)";
export const REVERTED_BY_REAPPLY_0377 = Object.freeze({
  "0092_p4b_measurement_samples_spc.sql": "ensure_measurement_samples_partition (pin)",
  "0111_qw3_materialized_views.sql": "refresh_qw_caches (pin)",
  "0122_tenant_rls_extend.sql": TENANT,
  "0125_tenant_rls_hot_tables.sql": TENANT,
  "0142_fleet_orchestration.sql": TENANT,
  "0143_fleet_resource_skill_charging.sql": TENANT,
  "0144_twin_equipment_3d_models.sql": TENANT,
  "0145_safety_workforce.sql": TENANT,
  "0146_equipment_standards.sql": TENANT,
  "0147_equipment_integration.sql": TENANT,
  "0148_field_abstraction.sql": TENANT,
  "0150_ai_loop_completion.sql": TENANT,
  "0153_safety_zones.sql": TENANT,
  "0154_safety_vision_plc.sql": TENANT,
  "0156_tenant_scope_isolation_holes.sql": TENANT,
  "0159_aoi_embedding_head_dataset.sql": TENANT,
  "0169_master_alarms.sql": TENANT,
  "0174_mv_canonical_yield_tz.sql": "factory_timezone / db_storage_timezone / to_factory_time (qualified bodies), refresh_qw_caches (pin)",
  "0327_tenant_rls_null_la_du_lieu_dung_chung.sql": TENANT,
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

/**
 * Pure decision. `files` = what is about to be (re-)applied, in order; `thenFlags` = the flags that ask for 0377 to be re-applied
 * afterwards (single-file runners: --then-0377; migrate-standalone also --then-0376). proceed | then-0377 | refuse.
 */
export function decide0377({ files, applied0377, args, thenFlags = [THEN_0377_FLAG] }) {
  const reverting = files.filter((f) => Object.prototype.hasOwnProperty.call(REVERTED_BY_REAPPLY_0377, f));
  if (!applied0377 || reverting.length === 0) return { action: "proceed", reverting: [] };
  const last = files.lastIndexOf(FILE_0377);
  const lastReverting = Math.max(...reverting.map((f) => files.lastIndexOf(f)));
  if (last > lastReverting) return { action: "proceed", reverting }; // 0377 itself runs after them (migrate-standalone --force)
  if (thenFlags.some((f) => args.includes(f))) return { action: "then-0377", reverting };
  return {
    action: "refuse",
    reverting,
    message:
      `Đợt 11 H: 0377 is applied on this DB; re-applying ${reverting.join(", ")} would restore ` +
      `${[...new Set(reverting.map((f) => REVERTED_BY_REAPPLY_0377[f]))].join("; ")} in its pre-0377 form ` +
      `(edge_stop_*: request-first ⇒ 40P01 against an owner change). Nothing was run. Re-run with ${thenFlags.join(" or ")} to re-apply 0377 right after it.`,
  };
}

/** For a single-file runner: call BEFORE its DDL. Throws Refused0377Error; true ⇔ 0377 must be re-applied afterwards. */
export async function guard0377BeforeDdl({ sql, file, args }) {
  const d = decide0377({ files: [file], applied0377: await is0377Applied(sql), args });
  if (d.action === "refuse") throw new Refused0377Error(d.message);
  return d.action === "then-0377";
}

/**
 * fix 1 (review H-R8) — the lock order in a STOP function's source, per branch: the body is split at each `RETURN` (every
 * early-exit branch ends with one), and in each segment every request lock (`FOR UPDATE`) must come AFTER a device lock
 * (`FOR SHARE`) and no device lock may follow it. Returns one entry per offending FOR UPDATE.
 */
export function stopLockOrderViolations(src) {
  const code = String(src).replace(/--[^\n]*/g, "");
  const out = [];
  let offset = 0;
  for (const seg of code.split(/\bRETURN\b/i)) {
    const locks = [...seg.matchAll(/FOR\s+(SHARE|UPDATE)\b/gi)].map((m) => ({ kind: m[1].toUpperCase(), at: offset + (m.index ?? 0) }));
    locks.forEach((l, i) => {
      if (l.kind !== "UPDATE") return;
      const shareBefore = locks.slice(0, i).some((x) => x.kind === "SHARE");
      const shareAfter = locks.slice(i + 1).some((x) => x.kind === "SHARE");
      if (!shareBefore || shareAfter) out.push(`FOR UPDATE at ${l.at}: ${!shareBefore ? "no device FOR SHARE before it" : "a device FOR SHARE after it"} (same branch)`);
    });
    offset += seg.length + "RETURN".length;
  }
  return out;
}

/** Re-apply 0377 on ONE target (label "dev" | "test") through its own apply script; throws unless it exited 0. */
export function reapply0377(label, { spawn = spawnSync, log = console.log } = {}) {
  const flag = label === "dev" ? "--dev-only" : label === "test" ? "--test-only" : null;
  if (!flag) throw new Error(`reapply0377: unknown target "${label}"`);
  log(`  [Đợt 11 H] ${label}: re-applying 0377 right after — node scripts/apply-migration-0377.mjs ${flag}`);
  const r = spawn(process.execPath, [path.join(__dirname, "apply-migration-0377.mjs"), flag], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`Đợt 11 H: re-applying 0377 on ${label} FAILED (exit ${r.status}) — the lock order may be reverted: run apply-migration-0377.mjs ${flag} now`);
}

/** The runMigration hooks (apply-migration-dot10-common.mjs `guard`) for a file 0377 can be reverted by. */
export function guard0377Hooks(file) {
  return {
    async before({ sql, args }) {
      return guard0377BeforeDdl({ sql, file, args });
    },
    after({ label }) {
      reapply0377(label);
    },
  };
}
