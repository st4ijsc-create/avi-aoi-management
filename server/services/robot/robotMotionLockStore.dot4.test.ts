/**
 * doc 81 Đợt 4 Task B4 — pure pieces of motion-lock persistence (no DB): write ORDER per robot and the MotionLock hooks.
 * The DB-backed restart behaviour is measured in robotMotionLockPersist.dot4.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const F = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, insertDelayMs: 0, ops: [] as string[] }));
vi.mock("../../db/connection", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          await new Promise((r) => setTimeout(r, F.insertDelayMs));
          F.ops.push(`upsert:${v.generation}`);
          F.row = v;
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        F.ops.push("delete");
        F.row = null;
      },
    }),
  }),
}));

import { persistMotionLock, deleteMotionLock, _flushMotionLockWritesForTests } from "./robotMotionLockStore";
import { MotionLock } from "./robotDriver";

beforeEach(() => {
  F.row = null;
  F.insertDelayMs = 0;
  F.ops.length = 0;
});

describe("B4 — motion-lock persistence (pure)", () => {
  it("a slow upsert followed by a fast delete still ends with NO row (writes of one robot apply in order)", async () => {
    F.insertDelayMs = 150;
    void persistMotionLock(7, { locked: true, reasonCode: "x", since: new Date().toISOString(), generation: 1 });
    void deleteMotionLock(7, 1);
    await _flushMotionLockWritesForTests();
    expect(F.ops).toEqual(["upsert:1", "delete"]);
    expect(F.row).toBeNull();
  });

  it("a persistence hook that THROWS never breaks lock() / clearByStop() / clearByOperator()", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const l = new MotionLock();
    l.attachPersistence({
      locked: () => {
        throw new Error("boom");
      },
      cleared: () => {
        throw new Error("boom");
      },
    });
    expect(() => l.lock("a")).not.toThrow();
    expect(l.isLocked()).toBe(true);
    expect(() => l.clearByStop()).not.toThrow();
    expect(l.isLocked()).toBe(false);
    l.lock("b");
    expect(() => l.clearByOperator({ reason: "r", userId: 1, expectedGeneration: 2 })).not.toThrow();
    expect(l.isLocked()).toBe(false);
    err.mockRestore();
  });

  it("restore keeps the persisted generation; the next lock bumps it (an operator must quote the restored one)", () => {
    const l = new MotionLock();
    l.restore({ reasonCode: "line_connection_closed", detail: null, since: "2026-10-01T00:00:00.000Z", generation: 5 });
    expect(l.snapshot()).toMatchObject({ locked: true, reasonCode: "line_connection_closed", generation: 5, since: "2026-10-01T00:00:00.000Z" });
    expect(() => l.clearByOperator({ reason: "r", userId: 1, expectedGeneration: 1 })).toThrow(/motion_lock_changed/);
    l.clearByOperator({ reason: "r", userId: 1, expectedGeneration: 5 });
    l.lock("again");
    expect(l.snapshot().generation).toBe(6);
  });
});
