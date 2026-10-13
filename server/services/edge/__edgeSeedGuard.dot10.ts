/**
 * doc 81 Đợt 10 final fix wave — I-6 (ruling R-10-br): the SHARED `_test` seed row SIM-SAFETY-PLC-1 (mig 0270: enabled, scope 'sim',
 * no factory, no target) applies to EVERY safety target (R-4-c) and is never shipped to an edge (R-10-aw), so with it enabled
 * every real-mode, preflight-on edge authorisation is refused. The F1 harness used to run
 *     UPDATE safety_plc_configs SET enabled = false WHERE enabled AND <every target column> IS NULL
 * which ALSO disabled the untargeted fixture rows other suites insert while it runs (measured: safetySimOnly.dot1c ×5 red), and a
 * crash between disable and restore left the seed disabled.
 *
 * Why the seed is still touched at all (said plainly): a row that names no target guards every target by design — no fixture of
 * the harness (its own factory-scoped safety-PLC config is there already) can make central skip it; the only alternative is a
 * separate database. So the harness touches EXACTLY that one seeded row (by code), and nothing else:
 *   • every harness holds `pg_advisory_lock_shared(SEED_LOCK_KEY)` on its own connection for its whole life (released by the
 *     server if the process dies); the first one that finds the seed ENABLED disables it and records that in a marker file;
 *   • at teardown the harness drops its shared lock and, only if it can then take the lock EXCLUSIVELY (no other harness
 *     running), re-enables the seed and removes the marker — a harness never re-enables it under another one;
 *   • a crash: process.on('exit') runs the same restore synchronously (a child node process, bounded); a marker found with the
 *     lock free at the next start / by the census (safetySeedIntact.finalfix.dot10.db) is a leftover — the census fails.
 * Not a test file: imported by the E2E harness and its census.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

export const SIM_SAFETY_SEED_CODE = "SIM-SAFETY-PLC-1";
/** the advisory lock every E2E harness holds SHARED for its life (exclusive = "no harness running") */
export const SEED_LOCK_KEY = 7_341_001;

export function seedMarkerFile(dbUrl: string): string {
  const db = new URL(dbUrl).pathname.replace(/^\//, "") || "db";
  return path.join(os.tmpdir(), `avi-e2e-sim-seed-${db}.json`);
}

export interface SeedGuard {
  /** the seed row ids the harnesses disabled (the marker's ids) — what the attack suite toggles to measure R-10-aw */
  disabledIds: number[];
  release(): Promise<void>;
}

const exitHooks = new Set<string>();

/** Restore synchronously (exit handler): a child process takes the exclusive lock (retried ≤ 5 s) and re-enables the seed. */
function restoreSync(dbUrl: string): void {
  const marker = seedMarkerFile(dbUrl);
  if (!existsSync(marker)) return;
  const script = `
    import postgres from "postgres";
    import { readFileSync, rmSync } from "node:fs";
    const sql = postgres(process.env.SEED_DB, { max: 1, connect_timeout: 10, onnotice: () => {} });
    try {
      for (let i = 0; i < 50; i++) {
        const [r] = await sql\`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok\`;
        if (r.ok) {
          const m = JSON.parse(readFileSync(process.env.SEED_MARKER, "utf8"));
          await sql\`UPDATE safety_plc_configs SET enabled = true WHERE code = ${JSON.stringify(SIM_SAFETY_SEED_CODE)} AND id IN \${sql(m.ids)}\`;
          rmSync(process.env.SEED_MARKER, { force: true });
          await sql\`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})\`;
          break;
        }
        await new Promise((x) => setTimeout(x, 100));
      }
    } finally { await sql.end({ timeout: 2 }); }`;
  spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), env: { ...process.env, SEED_DB: dbUrl, SEED_MARKER: marker }, timeout: 15_000, stdio: "ignore" });
}

/** Take the shared seed lock, disable the seed if it is enabled (recording it), and arm the crash restore. */
export async function acquireSeedGuard(dbUrl: string): Promise<SeedGuard> {
  if (!/_test\b/.test(dbUrl)) {
    // never a seed change outside a _test DB: an inert guard (nothing disabled, nothing to restore)
    console.error("[seed guard] refused: not a _test DB — the seed is left untouched");
    return { disabledIds: [], release: async () => undefined };
  }
  const marker = seedMarkerFile(dbUrl);
  const lockConn = postgres(dbUrl, { max: 1, connect_timeout: 30, onnotice: () => {} });
  await lockConn`SELECT pg_advisory_lock_shared(${SEED_LOCK_KEY})`;
  const turned = (await lockConn`UPDATE safety_plc_configs SET enabled = false WHERE code = ${SIM_SAFETY_SEED_CODE} AND enabled RETURNING id`).map((r) => Number(r.id));
  if (turned.length > 0) {
    const prev = existsSync(marker) ? (JSON.parse(readFileSync(marker, "utf8")) as { ids: number[] }).ids : [];
    writeFileSync(marker, JSON.stringify({ ids: [...new Set([...prev, ...turned])], at: new Date().toISOString(), pid: process.pid }));
  }
  const disabledIds = existsSync(marker) ? (JSON.parse(readFileSync(marker, "utf8")) as { ids: number[] }).ids : [];
  if (!exitHooks.has(dbUrl)) {
    exitHooks.add(dbUrl);
    process.on("exit", () => restoreSync(dbUrl));
  }
  let released = false;
  return {
    disabledIds,
    async release() {
      if (released) return;
      released = true;
      try {
        await lockConn`SELECT pg_advisory_unlock_shared(${SEED_LOCK_KEY})`;
        const [r] = await lockConn`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok`;
        if (r.ok) {
          try {
            if (existsSync(marker)) {
              const ids = (JSON.parse(readFileSync(marker, "utf8")) as { ids: number[] }).ids;
              if (ids.length) await lockConn`UPDATE safety_plc_configs SET enabled = true WHERE code = ${SIM_SAFETY_SEED_CODE} AND id IN ${lockConn(ids)}`;
              rmSync(marker, { force: true });
            }
          } finally {
            await lockConn`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
          }
        }
      } finally {
        await lockConn.end({ timeout: 5 });
      }
    },
  };
}
