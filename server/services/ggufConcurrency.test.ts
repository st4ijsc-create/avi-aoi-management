/**
 * Tests for GGUF inference concurrency control — GĐ2 Mục 4.
 *
 * Verifies the FIFO AsyncSemaphore + withGgufSlot / withGgufSlotGenerator wrappers:
 *  - concurrency=1 serializes 5 concurrent tasks (max running = 1)
 *  - exceeding queueMax → backpressure rejection
 *  - waiting past timeout → rejection + the queue slot is freed
 *  - slot released when the wrapped fn throws
 *  - stream generator slot released on early consumer return() (client abort)
 */
import { describe, it, expect } from "vitest";
import {
  AsyncSemaphore,
  GgufOverloadError,
  GgufSlotTimeoutError,
  withGgufSlot,
  withGgufSlotGenerator,
  getGgufQueueStats,
} from "./ggufConcurrency";

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

describe("AsyncSemaphore — concurrency=1 serializes tasks", () => {
  it("runs 5 concurrent tasks one-at-a-time (max running = 1)", async () => {
    const sem = new AsyncSemaphore(1, 100, 5000);
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    const task = async (id: number) => {
      await sem.acquire();
      try {
        running++;
        maxRunning = Math.max(maxRunning, running);
        order.push(id);
        await tick(10);
      } finally {
        running--;
        sem.release();
      }
    };

    await Promise.all([0, 1, 2, 3, 4].map(task));

    expect(maxRunning).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4]); // FIFO order preserved
  });

  it("allows up to maxConcurrency in parallel when >1", async () => {
    const sem = new AsyncSemaphore(2, 100, 5000);
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      await sem.acquire();
      try {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await tick(10);
      } finally {
        running--;
        sem.release();
      }
    };
    await Promise.all([task(), task(), task(), task()]);
    expect(maxRunning).toBe(2);
  });
});

describe("backpressure — exceeding queueMax rejects", () => {
  it("rejects waiters beyond queueMax with GgufOverloadError", async () => {
    const sem = new AsyncSemaphore(1, 2, 5000); // 1 running + 2 queued = 3 accepted
    const release1 = sem.acquire(); // takes the only slot
    await release1;

    const w2 = sem.acquire(); // queued (1)
    const w3 = sem.acquire(); // queued (2)
    const w4 = sem.acquire(); // over cap → reject

    await expect(w4).rejects.toBeInstanceOf(GgufOverloadError);
    expect(sem.queuedCount).toBe(2);

    // Drain so the queued waiters settle and the test doesn't leak timers.
    sem.release(); // hands slot to w2
    await w2;
    sem.release(); // hands slot to w3
    await w3;
    sem.release();
  });
});

describe("timeout waiting for a slot", () => {
  it("rejects with GgufSlotTimeoutError and frees the queue position", async () => {
    const sem = new AsyncSemaphore(1, 8, 30); // short wait timeout
    await sem.acquire(); // hold the only slot, never release until after timeout

    const waiter = sem.acquire();
    expect(sem.queuedCount).toBe(1);

    await expect(waiter).rejects.toBeInstanceOf(GgufSlotTimeoutError);
    // The timed-out waiter must be removed from the queue.
    expect(sem.queuedCount).toBe(0);

    // The slot is still held by the first acquirer; releasing it must restore capacity.
    sem.release();
    expect(sem.runningCount).toBe(0);
    // A fresh acquire now succeeds immediately.
    await sem.acquire();
    expect(sem.runningCount).toBe(1);
    sem.release();
  });
});

describe("withGgufSlot — release on throw", () => {
  it("releases the slot even when fn throws", async () => {
    const before = getGgufQueueStats();
    await expect(
      withGgufSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = getGgufQueueStats();
    // No leaked running slot on the shared singleton.
    expect(after.running).toBe(before.running);
    expect(after.running).toBe(0);
  });

  it("serializes two withGgufSlot calls (singleton default concurrency=1)", async () => {
    let running = 0;
    let maxRunning = 0;
    const job = () =>
      withGgufSlot(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await tick(10);
        running--;
        return true;
      });
    await Promise.all([job(), job(), job()]);
    expect(maxRunning).toBe(1);
    expect(getGgufQueueStats().running).toBe(0);
  });
});

describe("withGgufSlotGenerator — release on early abort", () => {
  it("releases the slot when consumer return()s mid-stream", async () => {
    let releasedFinally = false;
    const gen = withGgufSlotGenerator<number>(async function* () {
      try {
        for (let i = 0; i < 100; i++) {
          yield i;
          await tick(1);
        }
      } finally {
        releasedFinally = true; // inner generator finally must run on early return
      }
    });

    const first = await gen.next();
    expect(first.value).toBe(0);
    expect(getGgufQueueStats().running).toBe(1); // slot held during iteration

    // Simulate client abort / early break.
    await gen.return(undefined);

    expect(releasedFinally).toBe(true);
    expect(getGgufQueueStats().running).toBe(0); // slot released
  });

  it("releases the slot when the generator throws", async () => {
    const gen = withGgufSlotGenerator<number>(async function* () {
      yield 1;
      throw new Error("stream boom");
    });

    await gen.next(); // yields 1, holds slot
    await expect(gen.next()).rejects.toThrow("stream boom");
    expect(getGgufQueueStats().running).toBe(0);
  });

  it("releases the slot on normal completion", async () => {
    const gen = withGgufSlotGenerator<number>(async function* () {
      yield 1;
      yield 2;
    });
    const out: number[] = [];
    for await (const v of gen) out.push(v);
    expect(out).toEqual([1, 2]);
    expect(getGgufQueueStats().running).toBe(0);
  });
});
