/**
 * doc 81 Đợt 10 final fix wave residual — MIN-3 (ruling R-10-bt): a motion lock that can be made durable NOWHERE (the pending-
 * marker directory is not writable AND the DB write did not land) used to be only logged — a restart then started the robot
 * UNLOCKED. Now:
 *   • registration probes the marker directory (write + fsync + remove); not writable ⇒ the robot starts LOCKED `persistUnknown`
 *     and a durable alert is raised;
 *   • a lock whose marker cannot be written keeps the in-memory lock AND holds motion (a DURABILITY HOLD) until a persisted lock
 *     (its upsert landed) or a persisted clear (its delete landed) succeeds — a clear while nothing is durable does not release
 *     motion; a durable alert is raised.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const F = vi.hoisted(() => ({ dbUp: true, alerts: [] as Array<{ kind: string; message: string; recipients: number[]; retryUntilPersisted?: unknown }> }));
vi.mock("../../db/connection", () => ({
  getDb: async () =>
    F.dbUp
      ? {
          insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
          delete: () => ({ where: async () => undefined }),
          // residual 2 — the recipients of the durable alert: active admins / supervisors
          execute: async () => [{ id: 901 }, { id: 902 }],
        }
      : null,
}));
vi.mock("./criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; message: string; recipients: number[]; retryUntilPersisted?: unknown }) => void F.alerts.push(a),
}));

const ROOT = mkdtempSync(path.join(os.tmpdir(), "rml-durability-"));
const GOOD = path.join(ROOT, "ok");
const FILE = path.join(ROOT, "a-file");
writeFileSync(FILE, "not a directory");
const BAD = path.join(FILE, "markers"); // a directory under a FILE: never writable
process.env.ROBOT_MOTION_LOCK_PENDING_DIR = GOOD;

import { attachMotionLockPersistence, _flushMotionLockWritesForTests, _setNotDurableRecipientRetryMsForTests } from "./robotMotionLockStore";
import { MotionLock, MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE } from "./robotDriver";

const noRows = { ok: true as const, rows: new Map() };
const MOVE = { jobType: "move" } as never;
beforeEach(async () => {
  await _flushMotionLockWritesForTests();
  F.dbUp = true;
  F.alerts.length = 0;
  process.env.ROBOT_MOTION_LOCK_PENDING_DIR = GOOD;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("residual MIN-3 — a lock that cannot be made durable never lets the robot move / restart unlocked", () => {
  it("★ registration: the marker directory is not writable ⇒ starts LOCKED persistUnknown + a durable alert", async () => {
    process.env.ROBOT_MOTION_LOCK_PENDING_DIR = BAD;
    const lock = new MotionLock();
    expect(attachMotionLockPersistence(61, lock, noRows)).toBe("persistUnknown");
    expect(lock.snapshot()).toMatchObject({ locked: true, reasonCode: MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE });
    await new Promise((r) => setTimeout(r, 10));
    expect(F.alerts.some((a) => a.kind === "motion_lock_not_durable")).toBe(true);
  });

  it("★ marker unwritable AND DB write failed ⇒ motion held even after a clear, until a persisted lock / clear succeeds", async () => {
    const lock = new MotionLock();
    expect(attachMotionLockPersistence(62, lock, noRows)).toBe("none");
    process.env.ROBOT_MOTION_LOCK_PENDING_DIR = BAD;
    F.dbUp = false;
    lock.lock("motion_outcome_unknown", "link lost");
    await _flushMotionLockWritesForTests();
    await new Promise((r) => setTimeout(r, 10));
    expect(F.alerts.some((a) => a.kind === "motion_lock_not_durable")).toBe(true);
    lock.clearByOperator({ reason: "checked", userId: 1, expectedGeneration: lock.snapshot().generation! });
    await _flushMotionLockWritesForTests();
    expect(lock.isLocked()).toBe(true); // the clear did not land: motion still held
    expect(lock.refusal(MOVE)).not.toBeNull();
    // the DB is back: a persisted clear (the next clear's delete lands) releases the hold
    F.dbUp = true;
    lock.clearByOperator({ reason: "checked again", userId: 1, expectedGeneration: lock.snapshot().generation! });
    await _flushMotionLockWritesForTests();
    expect(lock.isLocked()).toBe(false);
    expect(lock.refusal(MOVE)).toBeNull();
  });

  it("★ marker unwritable but the UPSERT lands ⇒ durable through the DB: the hold is released, the lock behaves as before", async () => {
    const lock = new MotionLock();
    attachMotionLockPersistence(63, lock, noRows);
    process.env.ROBOT_MOTION_LOCK_PENDING_DIR = BAD;
    lock.lock("motion_outcome_unknown");
    await _flushMotionLockWritesForTests(); // the upsert LANDED: the lock is durable (in the DB) ⇒ the hold is released
    F.dbUp = false; // the clear's delete will fail: the row stays ⇒ a restart starts locked (fail-closed) — memory may unlock
    lock.clearByStop();
    await _flushMotionLockWritesForTests();
    expect(lock.isLocked()).toBe(false);
  });
});

describe("residual 2 (R-10-bu, P-3) — motion_lock_not_durable goes through the DURABLE alert path", () => {
  it("★ recipients = the active admins / supervisors, with retryUntilPersisted (an inbox row, retried) — not a log line only", async () => {
    process.env.ROBOT_MOTION_LOCK_PENDING_DIR = BAD;
    attachMotionLockPersistence(64, new MotionLock(), noRows);
    await vi.waitFor(() => expect(F.alerts.find((a) => a.kind === "motion_lock_not_durable" && a.recipients.length > 0)).toBeTruthy(), { timeout: 2_000, interval: 10 });
    const a = F.alerts.find((x) => x.kind === "motion_lock_not_durable" && x.recipients.length > 0)!;
    expect(a.recipients).toEqual([901, 902]);
    expect(a.retryUntilPersisted).toMatchObject({ attempts: expect.any(Number) });
  });
  it("★ the DB is down when it is raised ⇒ the recipients are read again later, then the durable alert goes out", async () => {
    _setNotDurableRecipientRetryMsForTests(20);
    try {
      process.env.ROBOT_MOTION_LOCK_PENDING_DIR = BAD;
      F.dbUp = false;
      attachMotionLockPersistence(65, new MotionLock(), noRows);
      await new Promise((r) => setTimeout(r, 60));
      expect(F.alerts.some((a) => a.kind === "motion_lock_not_durable" && a.recipients.length > 0)).toBe(false);
      F.dbUp = true;
      await vi.waitFor(() => expect(F.alerts.some((a) => a.kind === "motion_lock_not_durable" && a.recipients.length > 0)).toBe(true), { timeout: 2_000, interval: 10 });
    } finally {
      _setNotDurableRecipientRetryMsForTests(null);
    }
  });
});
