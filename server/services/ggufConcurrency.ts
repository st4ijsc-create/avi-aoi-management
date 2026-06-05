/**
 * GGUF inference concurrency control — AI Copilot GĐ2 Mục 4
 *
 * Protects the GPU (e.g. RTX 4050 6GB) from VRAM OOM by serializing GGUF
 * inference through a global FIFO async semaphore. Without this, multiple
 * concurrent requests each grab a context sequence and compete for VRAM.
 *
 * Tunables (env, all optional):
 *  - GGUF_MAX_CONCURRENCY  max in-flight inferences         (default 1  → safe for 6GB)
 *  - GGUF_QUEUE_MAX        max waiters before backpressure  (default 8)
 *  - GGUF_INFER_TIMEOUT_MS max wait for a slot, ms          (default 120000)
 *
 * No external dependencies. Single shared semaphore is used for ALL inference
 * (text/chat/json/stream/embedding) — embeddings are light but still gated to
 * keep the 6GB budget simple and safe.
 */

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/** Error thrown when the wait queue is full (backpressure). */
export class GgufOverloadError extends Error {
  readonly code = "GGUF_OVERLOADED";
  constructor(message = "GGUF đang quá tải, thử lại sau") {
    super(message);
    this.name = "GgufOverloadError";
  }
}

/** Error thrown when waiting for a slot exceeds GGUF_INFER_TIMEOUT_MS. */
export class GgufSlotTimeoutError extends Error {
  readonly code = "GGUF_SLOT_TIMEOUT";
  constructor(message = "GGUF hết thời gian chờ slot, thử lại sau") {
    super(message);
    this.name = "GgufSlotTimeoutError";
  }
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * FIFO async semaphore. acquire() resolves when a slot is free; if all slots
 * are taken the caller is queued. The queue is bounded (rejects with overload)
 * and each wait is bounded by a timeout (rejects + frees its queue position).
 */
export class AsyncSemaphore {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    public readonly maxConcurrency: number,
    public readonly queueMax: number,
    public readonly waitTimeoutMs: number,
  ) {}

  get runningCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  acquire(): Promise<void> {
    // Fast path: a slot is immediately available.
    if (this.running < this.maxConcurrency) {
      this.running++;
      return Promise.resolve();
    }

    // Backpressure: refuse to grow the queue past the cap.
    if (this.queue.length >= this.queueMax) {
      return Promise.reject(new GgufOverloadError());
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: null };

      waiter.timer = setTimeout(() => {
        // Remove this waiter from the queue if still pending, then reject.
        const idx = this.queue.indexOf(waiter);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new GgufSlotTimeoutError());
      }, this.waitTimeoutMs);
      waiter.timer.unref?.();

      this.queue.push(waiter);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot directly to the next waiter (running count unchanged).
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
      return;
    }
    if (this.running > 0) this.running--;
  }
}

const semaphore = new AsyncSemaphore(
  envInt("GGUF_MAX_CONCURRENCY", 1),
  envInt("GGUF_QUEUE_MAX", 8),
  envInt("GGUF_INFER_TIMEOUT_MS", 120000),
);

/**
 * Run `fn` while holding one GGUF inference slot. Acquires (may queue/timeout),
 * runs `fn`, and ALWAYS releases — including when `fn` throws/rejects.
 *
 * For async generators, do NOT wrap the generator body in this; instead acquire
 * before the first yield and release in a finally that surrounds the whole
 * yield loop (see withGgufSlotGenerator).
 */
export async function withGgufSlot<T>(fn: () => Promise<T>): Promise<T> {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}

/**
 * Generator-aware variant: holds the slot for the ENTIRE lifetime of the
 * delegated async generator and releases in finally — covering normal
 * completion, early `return()` from the consumer (client abort), and throws.
 *
 * Note: the slot is only acquired once iteration begins (first `.next()`),
 * matching node generator semantics.
 */
export async function* withGgufSlotGenerator<T>(
  makeGen: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  await semaphore.acquire();
  try {
    yield* makeGen();
  } finally {
    semaphore.release();
  }
}

/** Snapshot for health endpoints. */
export function getGgufQueueStats(): { running: number; queued: number; max: number } {
  return {
    running: semaphore.runningCount,
    queued: semaphore.queuedCount,
    max: semaphore.maxConcurrency,
  };
}

/** Exposed for tests only. */
export const __ggufSemaphore = semaphore;
