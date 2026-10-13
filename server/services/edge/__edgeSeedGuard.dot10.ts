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
 *   • a crash: NO exit hook (residual R-10-bt — the dying process still holds its shared lock, a restore there can never run): a
 *     marker found with the lock free is a leftover — reported at the next harness start and restored by its release; the census
 *     (safetySeedIntact.finalfix.dot10.db) fails with the way out (seedLeftover).
 * Not a test file: imported by the E2E harness and its census.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  __abandonForTests?(): Promise<void>;
}

/** The leftover of a harness that died between disable and restore (the census's wording), read without changing anything. */
export async function seedLeftover(dbUrl: string): Promise<{ leftover: boolean; message: string }> {
  const marker = seedMarkerFile(dbUrl);
  if (!existsSync(marker)) return { leftover: false, message: "no seed marker" };
  const conn = postgres(dbUrl, { max: 1, connect_timeout: 30, onnotice: () => {} });
  try {
    const [r] = await conn`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok`;
    if (!r.ok) return { leftover: false, message: "a harness is running (its marker is live)" };
    await conn`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
    return {
      leftover: true,
      message:
        `${SIM_SAFETY_SEED_CODE} was left DISABLED by a harness that did not finish (marker ${marker}, no harness running). It is restored at the next harness start/release ` +
        "(run any F1 E2E suite through vitest.serial.config.ts), or by hand: UPDATE safety_plc_configs SET enabled = true WHERE code = 'SIM-SAFETY-PLC-1' on _test, then delete the marker.",
    };
  } finally {
    await conn.end({ timeout: 5 });
  }
}

/**
 * Take the shared seed lock and disable the seed if it is enabled (recording it). A leftover of a harness that died is reported
 * here and restored by THIS guard's release (residual R-10-bt: no exit hook — a dying process still holds its shared lock).
 */
export async function acquireSeedGuard(dbUrl: string): Promise<SeedGuard> {
  if (!/_test\b/.test(dbUrl)) {
    // never a seed change outside a _test DB: an inert guard (nothing disabled, nothing to restore)
    console.error("[seed guard] refused: not a _test DB — the seed is left untouched");
    return { disabledIds: [], release: async () => undefined };
  }
  const marker = seedMarkerFile(dbUrl);
  const lockConn = postgres(dbUrl, { max: 1, connect_timeout: 30, onnotice: () => {} });
  if (existsSync(marker)) {
    const [r] = await lockConn`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok`;
    if (r.ok) {
      await lockConn`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
      console.warn(`[seed guard] ${SIM_SAFETY_SEED_CODE} was left disabled by a harness that did not finish (marker ${marker}) — it stays off for this run and is restored at this harness's release`);
    }
  }
  await lockConn`SELECT pg_advisory_lock_shared(${SEED_LOCK_KEY})`;
  const turned = (await lockConn`UPDATE safety_plc_configs SET enabled = false WHERE code = ${SIM_SAFETY_SEED_CODE} AND enabled RETURNING id`).map((r) => Number(r.id));
  if (turned.length > 0) {
    const prev = existsSync(marker) ? (JSON.parse(readFileSync(marker, "utf8")) as { ids: number[] }).ids : [];
    writeFileSync(marker, JSON.stringify({ ids: [...new Set([...prev, ...turned])], at: new Date().toISOString(), pid: process.pid }));
  }
  const disabledIds = existsSync(marker) ? (JSON.parse(readFileSync(marker, "utf8")) as { ids: number[] }).ids : [];
  let released = false;
  return {
    disabledIds,
    /** tests only — the process "dies": the connection closes (its shared lock goes), nothing is restored */
    async __abandonForTests() {
      released = true;
      await lockConn.end({ timeout: 5 });
    },
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
