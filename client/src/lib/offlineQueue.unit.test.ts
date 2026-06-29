/**
 * Doc 10 / U16 — offline queue unit tests (vitest, node env; pure logic via injected storage).
 * Named *.unit.test.ts so the node-only client glob picks it up (not the jsdom exportUtils test).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OfflineQueue,
  flushQueue,
  type QueueStorage,
  type QueuedAction,
} from "./offlineQueue";

/** In-memory storage stand-in for deterministic tests. */
function memStorage(): QueueStorage & { raw: () => string | null } {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; }, raw: () => v };
}

let idN = 0;
function newQueue(maxAttempts = 5) {
  idN = 0;
  return new OfflineQueue(memStorage(), { maxAttempts, idGen: () => `id${idN++}` });
}

describe("OfflineQueue", () => {
  beforeEach(() => { idN = 0; });

  it("enqueue/list/size + FIFO order", () => {
    const q = newQueue();
    q.enqueue("scan", { sn: "A" }, { createdAt: 1 });
    q.enqueue("scan", { sn: "B" }, { createdAt: 2 });
    expect(q.size()).toBe(2);
    expect(q.list().map((a) => (a.payload as any).sn)).toEqual(["A", "B"]);
    expect(q.list()[0].attempts).toBe(0);
  });

  it("dedupe: same dedupeKey is not queued twice", () => {
    const q = newQueue();
    const a = q.enqueue("scan", { sn: "A" }, { dedupeKey: "sn:A" });
    const b = q.enqueue("scan", { sn: "A again" }, { dedupeKey: "sn:A" });
    expect(q.size()).toBe(1);
    expect(b.id).toBe(a.id); // returns the existing one
  });

  it("remove + clear", () => {
    const q = newQueue();
    const a = q.enqueue("x", 1);
    q.enqueue("x", 2);
    q.remove(a.id);
    expect(q.size()).toBe(1);
    q.clear();
    expect(q.size()).toBe(0);
  });

  it("fail bumps attempts; drops at maxAttempts", () => {
    const q = newQueue(2);
    const a = q.enqueue("x", 1);
    expect(q.fail(a.id)).toBe(false); // attempts 1
    expect(q.list()[0].attempts).toBe(1);
    expect(q.fail(a.id)).toBe(true); // attempts 2 == max → dropped
    expect(q.size()).toBe(0);
  });

  it("survives corrupt storage", () => {
    const s = memStorage();
    s.write("not json");
    const q = new OfflineQueue(s, { idGen: () => "id0" });
    expect(q.list()).toEqual([]);
    q.enqueue("x", 1);
    expect(q.size()).toBe(1);
  });
});

describe("flushQueue", () => {
  it("all succeed → queue emptied, sent counted", async () => {
    const q = newQueue();
    q.enqueue("scan", { sn: "A" });
    q.enqueue("scan", { sn: "B" });
    const handler = vi.fn(async () => {});
    const r = await flushQueue(q, handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ sent: 2, failedKept: 0, dropped: 0, remaining: 0 });
  });

  it("a failing item is KEPT (under maxAttempts) and counted", async () => {
    const q = newQueue(3);
    q.enqueue("ok", 1);
    q.enqueue("bad", 2);
    const handler = async (a: QueuedAction) => {
      if (a.kind === "bad") throw new Error("network");
    };
    const r = await flushQueue(q, handler);
    expect(r.sent).toBe(1);
    expect(r.failedKept).toBe(1);
    expect(r.remaining).toBe(1);
    expect(q.list()[0].attempts).toBe(1); // bumped, retained for a later flush
  });

  it("a poison item is DROPPED once it exceeds maxAttempts across flushes", async () => {
    const q = newQueue(2);
    q.enqueue("bad", 1);
    const handler = async () => { throw new Error("always"); };
    await flushQueue(q, handler); // attempts 1, kept
    expect(q.size()).toBe(1);
    const r = await flushQueue(q, handler); // attempts 2 == max → dropped
    expect(r.dropped).toBe(1);
    expect(q.size()).toBe(0);
  });

  it("never throws when handler rejects", async () => {
    const q = newQueue();
    q.enqueue("x", 1);
    await expect(flushQueue(q, async () => { throw new Error("boom"); })).resolves.toBeTruthy();
  });
});
