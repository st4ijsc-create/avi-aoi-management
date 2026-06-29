/**
 * Doc 10 / U16 — offline action QUEUE (store-and-forward).
 *
 * When the shop-floor browser is offline, operator actions (scans, issue reports) can be
 * QUEUED locally and replayed once connectivity returns, instead of failing silently. This
 * module is the pure, testable core; `useOfflineQueue` wraps it with React + online events.
 *
 * Design notes:
 *   • Storage is injected (QueueStorage) so the logic is unit-testable without a DOM; the
 *     default is localStorage-backed.
 *   • Optional dedupe: an enqueue carrying a key already present is skipped (so a double-tap
 *     or a retry doesn't queue the same scan twice).
 *   • flushQueue replays in FIFO order; a handler success removes the item, a failure bumps
 *     `attempts` and keeps it — until `maxAttempts`, after which it is dropped (counted) so a
 *     poison item can't block the queue forever.
 */

export interface QueuedAction<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  createdAt: number;
  attempts: number;
  /** Optional dedupe key — at most one queued action per key. */
  dedupeKey?: string;
}

/** Minimal persistence the queue needs (one string slot). */
export interface QueueStorage {
  read(): string | null;
  write(value: string): void;
}

/** localStorage-backed storage (browser default). Safe no-op when localStorage is absent. */
export function localStorageQueueStorage(key = "offlineQueue:v1"): QueueStorage {
  return {
    read() {
      try {
        return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      } catch {
        return null;
      }
    },
    write(value: string) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
      } catch {
        /* best-effort (quota/private mode) */
      }
    },
  };
}

export interface OfflineQueueOptions {
  maxAttempts?: number;
  /** Monotonic-ish id generator (injectable for deterministic tests). */
  idGen?: () => string;
}

export class OfflineQueue {
  private readonly maxAttempts: number;
  private readonly idGen: () => string;

  constructor(private readonly storage: QueueStorage, opts: OfflineQueueOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    let n = 0;
    this.idGen = opts.idGen ?? (() => `q_${Date.now()}_${n++}`);
  }

  list<P = unknown>(): QueuedAction<P>[] {
    const raw = this.storage.read();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as QueuedAction<P>[]) : [];
    } catch {
      return [];
    }
  }

  private save(items: QueuedAction[]): void {
    this.storage.write(JSON.stringify(items));
  }

  size(): number {
    return this.list().length;
  }

  /** Append an action. Returns the queued (or existing, if deduped) action. */
  enqueue<P>(kind: string, payload: P, opts: { dedupeKey?: string; createdAt?: number } = {}): QueuedAction<P> {
    const items = this.list();
    if (opts.dedupeKey) {
      const existing = items.find((a) => a.dedupeKey === opts.dedupeKey);
      if (existing) return existing as QueuedAction<P>;
    }
    const action: QueuedAction<P> = {
      id: this.idGen(),
      kind,
      payload,
      createdAt: opts.createdAt ?? Date.now(),
      attempts: 0,
      dedupeKey: opts.dedupeKey,
    };
    items.push(action as QueuedAction);
    this.save(items);
    return action;
  }

  remove(id: string): void {
    this.save(this.list().filter((a) => a.id !== id));
  }

  /** Bump attempts; drop (and return true) when maxAttempts is reached. */
  fail(id: string): boolean {
    const items = this.list();
    const a = items.find((x) => x.id === id);
    if (!a) return false;
    a.attempts += 1;
    if (a.attempts >= this.maxAttempts) {
      this.save(items.filter((x) => x.id !== id));
      return true; // dropped
    }
    this.save(items);
    return false;
  }

  clear(): void {
    this.save([]);
  }

  getMaxAttempts(): number {
    return this.maxAttempts;
  }
}

export interface FlushResult {
  sent: number;
  failedKept: number;
  dropped: number;
  remaining: number;
}

/**
 * Replay every queued action through `handler` in FIFO order. Success removes the item; a
 * thrown handler bumps attempts (kept, or dropped past maxAttempts). Never throws.
 */
export async function flushQueue(
  queue: OfflineQueue,
  handler: (action: QueuedAction) => Promise<void>,
): Promise<FlushResult> {
  const snapshot = queue.list();
  let sent = 0;
  let failedKept = 0;
  let dropped = 0;
  for (const action of snapshot) {
    try {
      await handler(action);
      queue.remove(action.id);
      sent++;
    } catch {
      const wasDropped = queue.fail(action.id);
      if (wasDropped) dropped++;
      else failedKept++;
    }
  }
  return { sent, failedKept, dropped, remaining: queue.size() };
}
