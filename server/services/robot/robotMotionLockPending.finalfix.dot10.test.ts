/**
 * doc 81 Đợt 10 final fix wave — I-5 code half (ruling R-10-br; QĐ-4c "restart starts locked"): a robot whose LAST motion-lock
 * persist FAILED or is UNKNOWN (the DB down past the deadline, a trigger refusing the row — the 0374 writer guard against a
 * stale build — or the process dying before the write landed) boots LOCKED (`persistUnknown`), never unlocked. Before this, the
 * store's own header said so plainly (final wave G6): "a lock whose UPSERT never lands … the NEXT restart starts UNLOCKED".
 *   • lock() writes a durable local marker (fsync) BEFORE its upsert is queued; the upsert landing removes it; a clear removes it;
 *   • registration: no DB row, but a marker left by ANOTHER process (a previous run) ⇒ persistUnknown; an unreadable marker ⇒
 *     persistUnknown; this process's own marker (an in-process re-registration) is not a restart;
 *   • the marker directory is ROBOT_MOTION_LOCK_PENDING_DIR (tests: a temp dir — never data/).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const F = vi.hoisted(() => ({ dbUp: true, ops: [] as string[], delayMs: 0, failGen: -1 }));
vi.mock("../../db/connection", () => ({
  getDb: async () =>
    F.dbUp
      ? {
          insert: () => ({
            values: (v: Record<string, unknown>) => ({
              onConflictDoUpdate: async () => {
                await new Promise((r) => setTimeout(r, F.delayMs));
                if (v.generation === F.failGen) throw new Error("injected: upsert refused");
                F.ops.push(`upsert:${v.generation}`);
              },
            }),
          }),
          delete: () => ({
            where: async () => {
              F.ops.push("delete");
            },
          }),
        }
      : null,
}));

const DIR = mkdtempSync(path.join(os.tmpdir(), "rml-pending-ff-"));
process.env.ROBOT_MOTION_LOCK_PENDING_DIR = DIR;

import { attachMotionLockPersistence, _flushMotionLockWritesForTests, motionLockWriterInstanceId } from "./robotMotionLockStore";
import { MotionLock, MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE } from "./robotDriver";

const markers = () => readdirSync(DIR).filter((f) => f.endsWith(".json"));
const noRows = { ok: true as const, rows: new Map() };

beforeEach(async () => {
  await _flushMotionLockWritesForTests(); // a previous case's queued writes land before this one starts
  F.dbUp = true;
  F.ops.length = 0;
  F.delayMs = 0;
  F.failGen = -1;
  for (const f of readdirSync(DIR)) rmSync(path.join(DIR, f), { force: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe("final fix wave I-5 — a lock that was never persisted survives the restart", () => {
  it("★ the upsert FAILS ⇒ the marker stays; a later boot (another process) with no DB row starts LOCKED persistUnknown", async () => {
    const lock = new MotionLock();
    expect(attachMotionLockPersistence(41, lock, noRows)).toBe("none");
    F.dbUp = false; // the persist will fail (DB down / the 0374 writer guard refusing a stale build's row)
    lock.lock("motion_outcome_unknown", "link lost mid-motion");
    expect(markers()).toEqual(["41.json"]); // written BEFORE the upsert was even tried
    await _flushMotionLockWritesForTests();
    expect(markers()).toEqual(["41.json"]);
    const m = JSON.parse(readFileSync(path.join(DIR, "41.json"), "utf8"));
    expect(m).toMatchObject({ robotId: 41, generation: 1, reasonCode: "motion_outcome_unknown", writer: motionLockWriterInstanceId(lock) });
    // RESTART: another process (simulated by rewriting the marker's writer), the DB has no row for robot 41
    writeFileSync(path.join(DIR, "41.json"), JSON.stringify({ ...m, writer: "00000000-0000-4000-8000-0000000000aa" }));
    F.dbUp = true;
    const after = new MotionLock();
    expect(attachMotionLockPersistence(41, after, noRows)).toBe("persistUnknown");
    expect(after.snapshot()).toMatchObject({ locked: true, reasonCode: MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE });
    expect(after.snapshot().detail).toMatch(/motion_outcome_unknown/);
  });

  it("★ the upsert LANDS ⇒ the marker is removed (a later boot without a row is not locked by it)", async () => {
    const lock = new MotionLock();
    attachMotionLockPersistence(42, lock, noRows);
    lock.lock("motion_outcome_unknown");
    await _flushMotionLockWritesForTests();
    expect(F.ops).toEqual(["upsert:1"]);
    expect(markers()).toEqual([]);
  });

  it("★ a clear removes the marker (the operator / a confirmed STOP decided) — no false lock at the next boot", async () => {
    const lock = new MotionLock();
    attachMotionLockPersistence(43, lock, noRows);
    F.dbUp = false;
    lock.lock("motion_outcome_unknown");
    await _flushMotionLockWritesForTests();
    expect(markers()).toEqual(["43.json"]);
    lock.clearByStop();
    await _flushMotionLockWritesForTests();
    await new Promise((r) => setTimeout(r, 20));
    expect(markers()).toEqual([]);
  });

  it("★ an OLDER lock's upsert landing late never removes a NEWER lock's marker (whose own upsert then fails)", async () => {
    const lock = new MotionLock();
    attachMotionLockPersistence(46, lock, noRows);
    F.delayMs = 80; // generation 1's upsert is slow …
    lock.lock("first");
    lock.clearByStop(); // … the lock is cleared (its marker removed) …
    F.failGen = 2;
    lock.lock("second"); // … and locked again: generation 2's marker; its upsert will be REFUSED
    await _flushMotionLockWritesForTests();
    expect(F.ops).toContain("upsert:1");
    expect(markers()).toEqual(["46.json"]);
    expect(JSON.parse(readFileSync(path.join(DIR, "46.json"), "utf8"))).toMatchObject({ generation: 2, reasonCode: "second" });
  });

  it("★ an UNREADABLE marker ⇒ persistUnknown (unknown counts as locked); this process's OWN marker is not a restart", async () => {
    writeFileSync(path.join(DIR, "44.json"), "{not json");
    const a = new MotionLock();
    expect(attachMotionLockPersistence(44, a, noRows)).toBe("persistUnknown");
    // own marker (an in-process re-registration of a robot whose persist failed here): not a restart signal
    const b = new MotionLock();
    attachMotionLockPersistence(45, b, noRows);
    F.dbUp = false;
    b.lock("x");
    await _flushMotionLockWritesForTests();
    F.dbUp = true;
    const c = new MotionLock();
    expect(attachMotionLockPersistence(45, c, noRows)).toBe("none");
  });
});
