/**
 * W7-D (doc 27 gap V6) — MicroBatcher + Semaphore unit tests.
 * Pure logic: window fill, partial flush on timer, order preservation,
 * per-item error isolation, whole-batch failure, semaphore concurrency cap.
 */
import { describe, it, expect, vi } from "vitest";
import { MicroBatcher, Semaphore, type BatchOutcome } from "./microBatcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MicroBatcher", () => {
  it("flushes immediately when batchMax is reached (window fill)", async () => {
    const batches: number[][] = [];
    const b = new MicroBatcher<number, number>({
      batchMax: 4,
      windowMs: 10_000, // long window — flush must come from batchMax, not the timer
      runBatch: async (inputs) => {
        batches.push([...inputs]);
        return inputs.map((v) => ({ status: "fulfilled" as const, value: v * 10 }));
      },
    });

    const results = await Promise.all([1, 2, 3, 4].map((v) => b.enqueue(v)));
    expect(results).toEqual([10, 20, 30, 40]);
    expect(batches).toEqual([[1, 2, 3, 4]]); // ONE coalesced batch
    expect(b.pending).toBe(0);
  });

  it("flushes a PARTIAL batch when the window timer fires", async () => {
    const batches: number[][] = [];
    const b = new MicroBatcher<number, number>({
      batchMax: 8,
      windowMs: 20,
      runBatch: async (inputs) => {
        batches.push([...inputs]);
        return inputs.map((v) => ({ status: "fulfilled" as const, value: v }));
      },
    });

    const p1 = b.enqueue(1);
    const p2 = b.enqueue(2);
    expect(b.pending).toBe(2); // below batchMax — waiting on the window
    await Promise.all([p1, p2]);
    expect(batches).toEqual([[1, 2]]); // partial flush ≤ windowMs later
  });

  it("preserves input order across a flush", async () => {
    const b = new MicroBatcher<number, string>({
      batchMax: 5,
      windowMs: 5,
      runBatch: async (inputs) =>
        inputs.map((v) => ({ status: "fulfilled" as const, value: `out-${v}` })),
    });
    const results = await Promise.all([7, 3, 9, 1, 5].map((v) => b.enqueue(v)));
    expect(results).toEqual(["out-7", "out-3", "out-9", "out-1", "out-5"]);
  });

  it("isolates per-item errors — one rejected outcome rejects ONLY its own promise", async () => {
    const b = new MicroBatcher<number, number>({
      batchMax: 3,
      windowMs: 5,
      runBatch: async (inputs) =>
        inputs.map((v): BatchOutcome<number> =>
          v === 2
            ? { status: "rejected", reason: new Error(`bad item ${v}`) }
            : { status: "fulfilled", value: v },
        ),
    });
    const settled = await Promise.allSettled([1, 2, 3].map((v) => b.enqueue(v)));
    expect(settled[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(settled[1].status).toBe("rejected");
    expect((settled[1] as PromiseRejectedResult).reason.message).toBe("bad item 2");
    expect(settled[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("rejects every item of a flush when runBatch itself throws", async () => {
    const b = new MicroBatcher<number, number>({
      batchMax: 2,
      windowMs: 5,
      runBatch: async () => {
        throw new Error("whole batch down");
      },
    });
    const settled = await Promise.allSettled([1, 2].map((v) => b.enqueue(v)));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect((settled[0] as PromiseRejectedResult).reason.message).toBe("whole batch down");
  });

  it("rejects when runBatch returns the wrong number of outcomes (contract guard)", async () => {
    const b = new MicroBatcher<number, number>({
      batchMax: 2,
      windowMs: 5,
      runBatch: async () => [{ status: "fulfilled" as const, value: 1 }], // 1 for 2
    });
    const settled = await Promise.allSettled([1, 2].map((v) => b.enqueue(v)));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(String((settled[0] as PromiseRejectedResult).reason.message)).toContain("outcomes");
  });

  it("overflow beyond batchMax lands in the NEXT flush (remainder keeps its window)", async () => {
    const batches: number[][] = [];
    const b = new MicroBatcher<number, number>({
      batchMax: 3,
      windowMs: 10,
      runBatch: async (inputs) => {
        batches.push([...inputs]);
        return inputs.map((v) => ({ status: "fulfilled" as const, value: v }));
      },
    });
    const results = await Promise.all([1, 2, 3, 4, 5].map((v) => b.enqueue(v)));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(batches.length).toBe(2);
    expect(batches[0]).toEqual([1, 2, 3]);
    expect(batches[1]).toEqual([4, 5]);
  });

  it("validates constructor params", () => {
    const runBatch = async () => [];
    expect(() => new MicroBatcher({ batchMax: 0, windowMs: 5, runBatch })).toThrow();
    expect(() => new MicroBatcher({ batchMax: 2, windowMs: -1, runBatch })).toThrow();
  });
});

describe("Semaphore", () => {
  it("caps concurrency at max and drains the queue", async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let peak = 0;

    const job = async () =>
      sem.run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(15);
        inFlight--;
      });

    await Promise.all(Array.from({ length: 7 }, job));
    expect(peak).toBe(2); // never above the cap
    expect(sem.running).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it("releases the permit on error (finally semantics)", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // Permit must be free again:
    const v = await sem.run(async () => 42);
    expect(v).toBe(42);
  });

  it("double-release is a no-op (idempotent releaser)", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release(); // must NOT free a second permit
    expect(sem.running).toBe(0);
    const r2 = await sem.acquire();
    expect(sem.running).toBe(1);
    r2();
  });

  it("rejects invalid max", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
