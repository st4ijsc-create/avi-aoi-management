/**
 * microBatcher.ts — doc 27 Đợt 7 W7-D (gap V6): GPU micro-batching primitives.
 *
 * Two small, PURE utilities (no ONNX/DB imports — unit-testable in isolation):
 *
 *  • Semaphore — caps concurrent `session.run` calls across all models
 *    (AI_GPU_CONCURRENCY). onnxruntime already parallelises intra-op; letting an
 *    unbounded number of sessions hit the GPU concurrently only thrashes VRAM.
 *
 *  • MicroBatcher<TIn, TOut> — collects individual requests for the SAME model
 *    for up to `batchMax` items or `windowMs` milliseconds, then hands the whole
 *    group to `runBatch` in ONE call. Guarantees:
 *      – ORDER: outcome[i] belongs to the i-th enqueued input of that flush.
 *      – ISOLATION: runBatch reports a per-item outcome; one bad item rejects
 *        only its own promise. If runBatch itself throws, every item of that
 *        flush is rejected (the engine layer falls back to per-item runs).
 *      – PARTIAL FLUSH: when the window timer fires with fewer than batchMax
 *        items queued, the partial batch is flushed (bounded latency, ≤windowMs).
 */

export type BatchOutcome<TOut> =
  | { status: "fulfilled"; value: TOut }
  | { status: "rejected"; reason: unknown };

export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isFinite(max) || max < 1) throw new Error(`Semaphore max must be ≥1 (got ${max})`);
  }

  /** Currently held permits (for tests/telemetry). */
  get running(): number { return this.active; }
  /** Callers parked waiting for a permit. */
  get waiting(): number { return this.queue.length; }

  async acquire(): Promise<() => void> {
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  /** Run `fn` while holding one permit. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export interface MicroBatcherOptions<TIn, TOut> {
  /** Max items per flush (≥1). 1 effectively disables coalescing. */
  batchMax: number;
  /** Collection window in ms before a partial batch flushes (≥0). */
  windowMs: number;
  /**
   * Execute one batch. MUST return exactly `inputs.length` outcomes, in input
   * order. A thrown error rejects every item of the flush.
   */
  runBatch: (inputs: TIn[]) => Promise<Array<BatchOutcome<TOut>>>;
}

interface Pending<TIn, TOut> {
  input: TIn;
  resolve: (v: TOut) => void;
  reject: (e: unknown) => void;
}

export class MicroBatcher<TIn, TOut> {
  private queue: Pending<TIn, TOut>[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: MicroBatcherOptions<TIn, TOut>) {
    if (!Number.isFinite(opts.batchMax) || opts.batchMax < 1) {
      throw new Error(`MicroBatcher batchMax must be ≥1 (got ${opts.batchMax})`);
    }
    if (!Number.isFinite(opts.windowMs) || opts.windowMs < 0) {
      throw new Error(`MicroBatcher windowMs must be ≥0 (got ${opts.windowMs})`);
    }
  }

  /** Items currently waiting for a flush (for tests/telemetry). */
  get pending(): number { return this.queue.length; }

  enqueue(input: TIn): Promise<TOut> {
    return new Promise<TOut>((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      if (this.queue.length >= this.opts.batchMax) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.opts.windowMs);
        // Never keep the process alive just for a pending flush timer.
        this.timer.unref?.();
      }
    });
  }

  /** Flush up to batchMax queued items now. Remainder keeps its own window. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.opts.batchMax);
    if (this.queue.length > 0) {
      // More waiting than one flush can take — restart the window for the rest.
      this.timer = setTimeout(() => this.flush(), this.opts.windowMs);
      this.timer.unref?.();
    }

    void this.opts
      .runBatch(batch.map((b) => b.input))
      .then((outcomes) => {
        if (!Array.isArray(outcomes) || outcomes.length !== batch.length) {
          const err = new Error(
            `MicroBatcher: runBatch returned ${Array.isArray(outcomes) ? outcomes.length : typeof outcomes} outcomes for ${batch.length} inputs`,
          );
          for (const p of batch) p.reject(err);
          return;
        }
        for (let i = 0; i < batch.length; i++) {
          const o = outcomes[i];
          if (o.status === "fulfilled") batch[i].resolve(o.value);
          else batch[i].reject(o.reason);
        }
      })
      .catch((err) => {
        for (const p of batch) p.reject(err);
      });
  }
}
