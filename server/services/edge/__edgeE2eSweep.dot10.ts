/**
 * A2 test (R1b-2b-2a) — the start-up sweep of the F1 edge e2e harness (__edgeE2eHarness.dot10.ts): leftovers of DEAD runs.
 * Not a test file (no `.test.`): imported by the harness (setupCentral, before it inserts anything) and by its DB test.
 *
 * Why: when the GPU-window guard kills the whole process tree, the harness's teardown() never runs. Run F1X-1793541269940 left an
 * ENABLED `SPLC-*` row pointing at a dead Modbus port ⇒ safetySimOnly.dot1c red (SAFETY_UNKNOWN) for every later run until the
 * coordinator disabled it by hand.
 *
 * What it does (UPDATE only — never DELETE / TRUNCATE; coordinator rule + AMENDMENT 1):
 *   • scope = ONLY rows carrying the harness's own marker: `<table prefix>-<DAU>` where DAU = `<harness prefix>-<13-digit ms>` and
 *     the harness prefix is one of HARNESS_PREFIXES (setupCentral refuses any other prefix, so the list cannot drift):
 *       safety_plc_configs.code  SPLC-<DAU> | SPLCB-<DAU>           → enabled = false, ONLY when its port no longer listens
 *       device_adapters.code     AA-<DAU> | AB-<DAU>                 → "isEnabled" = false, ONLY without a pending STOP
 *       robots.code              RA-<DAU> | RB-<DAU> | RC-<DAU>      → "isEnabled" = false, ONLY without a pending STOP
 *       users."openId"           <DAU>-owner|approver|admin|engineer → "isActive" = false
 *       orchestration_workflows.ref  <DAU>-<tag>                     → status = 'archived'
 *     A row without the marker is never touched, however old; the seed SIM-SAFETY-PLC-1 never matches (and is excluded by name).
 *   • age: the DAU's own timestamp is older than SWEEP_HORIZON_MS (6 h) — see the constant for the justification. A live run of
 *     another session on the same _test DB is younger than that, so it is never swept.
 *   • still ACTIVE only (enabled / isEnabled / isActive true, status not archived): every UPDATE re-checks the marker + the active
 *     state in its WHERE (idempotent; two harnesses sweeping at once write each row at most once).
 *   • a device with a PENDING STOP (the L-7 predicate of mig 0374 device_keep_pending_stop) stays exactly as it is and is LOGGED by
 *     id: a STOP is closed by its device (edge / central ack) or by a person (edge_stop_resolve) — never by this sweep.
 *     (Adapters too: the brief names the exemption for robots; the same L-7 reason applies to an adapter's STOP — reported.)
 *   • fail closed on the DB: current_database() must be 'aoi_management_test' AND current_user must not be the owner 'aoi',
 *     otherwise NOTHING is swept (one log line).
 *   • one log line per row made inert (table, id, reason) and one per row kept for a pending STOP / a listening port.
 */
import net from "node:net";
import type postgres from "postgres";

/** The prefixes setupCentral is called with (edgeAttack F1X, edgeExecution F1E, s3 S3V2, s4 S4V2, edgeSimRobotLock N12). */
export const HARNESS_PREFIXES = ["F1X", "F1E", "S3V2", "S4V2", "N12"] as const;

/**
 * 6 h. A run's DAU is stamped at setupCentral START; the longest a run can live is bounded by vitest's own timeouts of the suite
 * file (beforeAll + every it + afterAll, the third argument of each block — summed 2026-11-02): edgeAttack 2 875 s (≈ 48 min),
 * edgeExecution.dot10 1 920 s, s3 1 380 s, s4 1 290 s, edgeSimRobotLock 840 s; inside a block the harness waits at most 180 s
 * (edge up), 90 s (edge stop), 60 s (teardown per edge). The serial project runs ONE file at a time, so a DAU older than ~48 min
 * belongs to a dead run already; 6 h is > 7× that bound (room for a slow machine / a debugger) and still clears a killed run
 * the same working day.
 */
export const SWEEP_HORIZON_MS = 6 * 60 * 60_000;
export const SWEEP_DB = "aoi_management_test";
export const SWEEP_PORT_PROBE_MS = 400;

type Sql = postgres.Sql | postgres.TransactionSql;

export interface SweepDeps {
  now?: () => number;
  /** true ⇔ a TCP connect to host:port succeeds within SWEEP_PORT_PROBE_MS */
  portListens?: (host: string, port: number) => Promise<boolean>;
  /** test seam: the identity the fail-closed DB check reads */
  readDbIdentity?: (sql: Sql) => Promise<{ db: string; user: string }>;
  /** test seam: the harness prefixes in scope (default HARNESS_PREFIXES) */
  prefixes?: readonly string[];
  log?: (line: string) => void;
}
export interface SweepRow {
  table: "safety_plc_configs" | "device_adapters" | "robots" | "users" | "orchestration_workflows";
  id: number;
  code: string;
  reason: string;
}
export interface SweepReport {
  /** set ⇔ nothing was swept (the fail-closed DB check refused) */
  skipped?: string;
  inert: SweepRow[];
  keptPendingStop: SweepRow[];
  keptPortListening: SweepRow[];
  keptEndpointUnknown: SweepRow[];
}

/** One TCP connect, bounded. Never throws. */
export function tcpPortListens(host: string, port: number, ms = SWEEP_PORT_PROBE_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v: boolean) => {
      s.removeAllListeners();
      s.destroy();
      resolve(v);
    };
    s.setTimeout(ms, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const defaultIdentity = async (sql: Sql) => {
  const [r] = await sql`SELECT current_database() AS db, current_user AS u`;
  return { db: String(r.db), user: String(r.u) };
};

/** `tcp://host:port` → { host, port }; anything else ⇒ null (the row is then KEPT: its port cannot be checked). */
export function endpointHostPort(endpoint: string | null): { host: string; port: number } | null {
  const m = /^tcp:\/\/([^/:]+):(\d{1,5})\/?$/.exec(String(endpoint ?? "").trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65_536 ? { host: m[1], port } : null;
}

/** The marker patterns (POSIX ARE for Postgres `~` and JS RegExp alike); group 2 = the DAU's 13-digit ms. */
export function harnessPatterns(prefixes: readonly string[]) {
  const safe = prefixes.filter((p) => /^[A-Z][A-Z0-9]{0,15}$/.test(p));
  if (!safe.length) return null;
  const P = `(${safe.join("|")})`;
  return {
    plc: `^SPLCB?-${P}-([0-9]{13})$`,
    adapter: `^A[AB]-${P}-([0-9]{13})$`,
    robot: `^R[ABC]-${P}-([0-9]{13})$`,
    user: `^${P}-([0-9]{13})-(owner|approver|admin|engineer)$`,
    workflow: `^${P}-([0-9]{13})-.+$`,
  };
}

/** The pending-STOP predicate of mig 0374 device_keep_pending_stop (the L-7 "device undeletable" rule); q = the request, d = the device. */
const pendingStopOf = (sql: Sql, col: "robotId" | "adapterId") =>
  sql`q.${sql(col)} = d.id AND q."kind" = 'stop' AND q."carriedToId" IS NULL AND (q."ackedAt" IS NULL OR (q."outcome" IN ('refused', 'failed') AND q."resolvedAt" IS NULL))`;

/** The start-up sweep. Errors propagate (the harness logs them and goes on: a failed sweep sweeps nothing more). */
export async function sweepHarnessLeftovers(sql: Sql, deps: SweepDeps = {}): Promise<SweepReport> {
  const log = deps.log ?? ((l: string) => console.warn(l));
  const now = (deps.now ?? Date.now)();
  const listens = deps.portListens ?? tcpPortListens;
  const rep: SweepReport = { inert: [], keptPendingStop: [], keptPortListening: [], keptEndpointUnknown: [] };

  const id = await (deps.readDbIdentity ?? defaultIdentity)(sql);
  if (id.db !== SWEEP_DB || id.user === "aoi") {
    rep.skipped = `database "${id.db}" as "${id.user}" — the sweep runs only on ${SWEEP_DB} and never as the owner aoi`;
    log(`[F1 sweep] NOT swept: ${rep.skipped}`);
    return rep;
  }

  const pat = harnessPatterns(deps.prefixes ?? HARNESS_PREFIXES);
  if (!pat) {
    rep.skipped = "no valid harness prefix in scope";
    log(`[F1 sweep] NOT swept: ${rep.skipped}`);
    return rep;
  }
  const old = (code: string, re: string): { ageH: string } | null => {
    const m = new RegExp(re).exec(code);
    if (!m) return null;
    const age = now - Number(m[2]);
    return age > SWEEP_HORIZON_MS ? { ageH: (age / 3_600_000).toFixed(1) } : null;
  };
  const inert = (r: SweepRow) => {
    rep.inert.push(r);
    log(`[F1 sweep] inert ${r.table} #${r.id} ${r.code} — ${r.reason}`);
  };

  // ── safety PLC configs: only when the port no longer listens ──
  for (const r of await sql`SELECT id, code, endpoint FROM safety_plc_configs WHERE code ~ ${pat.plc} AND enabled = true AND code <> 'SIM-SAFETY-PLC-1' ORDER BY id`) {
    const o = old(String(r.code), pat.plc);
    if (!o) continue;
    const row = { table: "safety_plc_configs" as const, id: Number(r.id), code: String(r.code) };
    const hp = endpointHostPort(r.endpoint as string | null);
    if (!hp) {
      rep.keptEndpointUnknown.push({ ...row, reason: `endpoint "${String(r.endpoint)}" is not tcp://host:port — its port cannot be checked` });
      log(`[F1 sweep] kept safety_plc_configs #${row.id} ${row.code} — endpoint not tcp://host:port, port not checkable`);
      continue;
    }
    if (await listens(hp.host, hp.port)) {
      rep.keptPortListening.push({ ...row, reason: `port ${hp.host}:${hp.port} still listens` });
      log(`[F1 sweep] kept safety_plc_configs #${row.id} ${row.code} — port ${hp.host}:${hp.port} still listens`);
      continue;
    }
    const u = await sql`UPDATE safety_plc_configs SET enabled = false, "updatedAt" = now() WHERE id = ${row.id} AND enabled = true AND code ~ ${pat.plc} AND code <> 'SIM-SAFETY-PLC-1' RETURNING id`;
    if (u.length) inert({ ...row, reason: `dead run (${o.ageH} h old), port ${hp.host}:${hp.port} not listening ⇒ enabled=false` });
  }

  // ── devices: only without a pending STOP ──
  for (const [table, re, col] of [["device_adapters", pat.adapter, "adapterId"], ["robots", pat.robot, "robotId"]] as const) {
    const rows = await sql`
      SELECT d.id, d.code,
             (SELECT array_agg(q.id ORDER BY q.id) FROM robot_motion_lock_requests q WHERE ${pendingStopOf(sql, col)}) AS stops
        FROM ${sql(table)} d
       WHERE d.code ~ ${re} AND d."isEnabled" = true
       ORDER BY d.id`;
    for (const r of rows) {
      const o = old(String(r.code), re);
      if (!o) continue;
      const row = { table, id: Number(r.id), code: String(r.code) };
      const stops = (r.stops as number[] | null) ?? [];
      if (stops.length) {
        rep.keptPendingStop.push({ ...row, reason: `pending STOP request(s) #${stops.join(", #")}` });
        log(`[F1 sweep] kept ${table} #${row.id} ${row.code} — pending STOP request(s) #${stops.join(", #")}: left as it is (a STOP is closed by its device or a person, never here)`);
        continue;
      }
      const u = await sql`
        UPDATE ${sql(table)} d SET "isEnabled" = false
         WHERE d.id = ${row.id} AND d."isEnabled" = true AND d.code ~ ${re}
           AND NOT EXISTS (SELECT 1 FROM robot_motion_lock_requests q WHERE ${pendingStopOf(sql, col)})
         RETURNING d.id`;
      if (u.length) inert({ ...row, reason: `dead run (${o.ageH} h old), no pending STOP ⇒ isEnabled=false` });
    }
  }

  // ── people ──
  for (const r of await sql`SELECT id, "openId" AS code FROM users WHERE "openId" ~ ${pat.user} AND "isActive" = true ORDER BY id`) {
    const o = old(String(r.code), pat.user);
    if (!o) continue;
    const u = await sql`UPDATE users SET "isActive" = false WHERE id = ${Number(r.id)} AND "isActive" = true AND "openId" ~ ${pat.user} RETURNING id`;
    if (u.length) inert({ table: "users", id: Number(r.id), code: String(r.code), reason: `dead run (${o.ageH} h old) ⇒ isActive=false` });
  }

  // ── workflows ──
  for (const r of await sql`SELECT id, ref AS code FROM orchestration_workflows WHERE ref ~ ${pat.workflow} AND status <> 'archived' ORDER BY id`) {
    const o = old(String(r.code), pat.workflow);
    if (!o) continue;
    const u = await sql`UPDATE orchestration_workflows SET status = 'archived' WHERE id = ${Number(r.id)} AND status <> 'archived' AND ref ~ ${pat.workflow} RETURNING id`;
    if (u.length) inert({ table: "orchestration_workflows", id: Number(r.id), code: String(r.code), reason: `dead run (${o.ageH} h old) ⇒ status=archived` });
  }

  log(`[F1 sweep] done: ${rep.inert.length} made inert, ${rep.keptPendingStop.length} kept (pending STOP), ${rep.keptPortListening.length} kept (port listens), ${rep.keptEndpointUnknown.length} kept (endpoint unknown)`);
  return rep;
}
